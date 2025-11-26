from flask import Flask, render_template, jsonify, request
import os
import json
import boto3
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo
from boto3.dynamodb.conditions import Key

# ****************************************
# -> CONFIGURACIÓN
# ****************************************

# Flask app
HOST = "0.0.0.0"
PORT = os.getenv("PORT", 5000)
app = Flask(__name__)

# DynamoDB y sensor fijo (solo por la presentación parcial)
# Tabla de datos y tabla de información de sensores
DYNAMODB_TABLE = os.getenv("SENSOR_DATA", "SensorData")
SENSOR_ID = os.getenv("SENSOR_ID", "ac1f09fffe1397c9")
SENSOR_INFO_TABLE = os.getenv("SENSOR_INFO_TABLE", "SensorInfo")

# Inicialización del cliente DynamoDB (usa credenciales de entorno)
AWS_REGION = os.getenv("AWS_DEFAULT_REGION", "us-east-2")
dynamodb = boto3.resource('dynamodb', region_name=AWS_REGION)
table = dynamodb.Table(DYNAMODB_TABLE)
table_info = dynamodb.Table(SENSOR_INFO_TABLE)

# ****************************************
# -> RUTAS
# ****************************************

# Ruta principal - Dashboard
@app.route("/dashboard")
def dashboard():
    return render_template("dashboard.html")


@app.route('/comparar')
def comparar():
    """Vista de comparación entre sensores."""
    return render_template('comparison.html')

# Ruta health check
@app.route("/health")
def health_check():
    return "OK", 200

# API para últimos datos sobre el sensor
@app.route('/api/sensors/data/last')
def get_last_from_db():
    """Consultar DynamoDB y devolver el último registro para un sensor.

    Acepta query param `sensor_id`. Si no se provee, usa la variable de
    entorno por defecto. Devuelve el ítem más reciente (por 'timestamp').
    """

    sensor_id = request.args.get('sensor_id', SENSOR_ID)

    try:
        resp = table.query(
            KeyConditionExpression=Key('sensor_id').eq(sensor_id),
            ScanIndexForward=False,  # newest first
            Limit=1
        )
        items = resp.get('Items', [])
        if not items:
            return jsonify({"error": "No data"}), 404
        item = items[0]
        data = {
            "sensor_id": item.get("sensor_id"),
            "temperatura": float(item.get("avgT", item.get("temperatura", 0))) if item.get("avgT") is not None or item.get("temperatura") is not None else None,
            "humedad": float(item.get("avgH", item.get("humedad", 0))) if item.get("avgH") is not None or item.get("humedad") is not None else None,
            "timestamp": item.get("timestamp"),
            # keep other stats if present
            "minT": item.get("minT"),
            "maxT": item.get("maxT"),
            "medT": item.get("medT"),
            "minH": item.get("minH"),
            "maxH": item.get("maxH"),
            "medH": item.get("medH")
        }
        return jsonify(data)
    except Exception as e:
        return jsonify({"error": str(e)}), 500


# API para listar sensores disponibles (SensorInfo)
@app.route('/api/sensors/info')
def get_sensors_info():
    """Devuelve la lista de sensores registrados en la tabla SensorInfo.

    Retorna objetos simples con `sensor_id` y `name`. Usa scan con paginación
    para cubrir tablas pequeñas/medianas.
    """
    try:
        sensors = []
        kwargs = {}
        while True:
            resp = table_info.scan(**kwargs)
            for it in resp.get('Items', []):
                sensors.append({
                    'sensor_id': it.get('sensor_id'),
                    'name': it.get('name') or it.get('sensor_id'),
                    'location': it.get('location') or ''
                })
            if 'LastEvaluatedKey' in resp:
                kwargs['ExclusiveStartKey'] = resp['LastEvaluatedKey']
            else:
                break

        # Ordenar por name para estabilidad en el frontend
        sensors.sort(key=lambda x: x.get('name') or x.get('sensor_id'))
        return jsonify(sensors)
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route('/api/sensors/data/multi')
def multi_sensors_data():
    """Devuelve series de datos para varios sensores en un solo request.

    Query params:
      - ids: coma-separados sensor_id (obligatorio)
      - filter: 1h|24h|7d|30d (opcional, por defecto 24h)

    Respuesta: { sensor_id: [items...], ... }
    """
    ids_param = request.args.get('ids')
    if not ids_param:
        return jsonify({"error": "Parámetro 'ids' requerido (coma-separados)."}), 400

    filter_param = request.args.get('filter', '24h')
    mapping = {
        '1h': timedelta(hours=1),
        '24h': timedelta(hours=24),
        '7d': timedelta(days=7),
        '30d': timedelta(days=30)
    }
    if filter_param not in mapping:
        return jsonify({"error": "Filtro inválido. Usa 1h,24h,7d o 30d."}), 400

    ids = [s.strip() for s in ids_param.split(',') if s.strip()]
    out = {}
    try:
        for sensor_id in ids:
            # compute reference datetime from latest item for that sensor
            try:
                latest_resp = table.query(
                    KeyConditionExpression=Key('sensor_id').eq(sensor_id),
                    ScanIndexForward=False,
                    Limit=1
                )
                latest_items = latest_resp.get('Items', [])
                if latest_items:
                    last_ts = latest_items[0].get('timestamp')
                    try:
                        ref_dt = datetime.fromisoformat(last_ts)
                    except Exception:
                        ref_dt = datetime.utcnow()
                else:
                    lima_now = datetime.now(ZoneInfo('America/Lima'))
                    ref_dt = lima_now.astimezone(ZoneInfo('UTC')).replace(tzinfo=None)
            except Exception:
                lima_now = datetime.now(ZoneInfo('America/Lima'))
                ref_dt = lima_now.astimezone(ZoneInfo('UTC')).replace(tzinfo=None)

            cutoff = ref_dt - mapping[filter_param]
            cutoff_str = cutoff.isoformat()

            # query items
            items = []
            kwargs_q = {
                'KeyConditionExpression': Key('sensor_id').eq(sensor_id) & Key('timestamp').gte(cutoff_str),
                'ScanIndexForward': True
            }
            while True:
                resp = table.query(**kwargs_q)
                items.extend(resp.get('Items', []))
                if 'LastEvaluatedKey' in resp:
                    kwargs_q['ExclusiveStartKey'] = resp['LastEvaluatedKey']
                else:
                    break

            # normalize
            normalized = []
            for it in items:
                normalized.append({
                    'sensor_id': it.get('sensor_id'),
                    'timestamp': it.get('timestamp'),
                    'avgT': float(it.get('avgT')) if it.get('avgT') is not None else None,
                    'avgH': float(it.get('avgH')) if it.get('avgH') is not None else None,
                    'maxT': float(it.get('maxT')) if it.get('maxT') is not None else None,
                    'maxH': float(it.get('maxH')) if it.get('maxH') is not None else None,
                    'medT': float(it.get('medT')) if it.get('medT') is not None else None,
                    'medH': float(it.get('medH')) if it.get('medH') is not None else None,
                    'minT': float(it.get('minT')) if it.get('minT') is not None else None,
                    'minH': float(it.get('minH')) if it.get('minH') is not None else None
                })
            normalized.sort(key=lambda x: x.get('timestamp') or '')
            out[sensor_id] = normalized

        return jsonify(out)
    except Exception as e:
        return jsonify({"error": str(e)}), 500

# API para listar datos del sensor con filtro de tiempo
@app.route('/api/sensors/data/list')
def list_sensors():
    """Devuelve una lista de registros para SENSOR_ID filtrada por el parámetro de consulta `filter`.

    Valores permitidos para el query param del `filter` son: '1h', '24h', '7d', '30d'. Por defecto: '1h'.
    La función calcula una marca de tiempo de corte (UTC, formato ISO)
    y consulta DynamoDB por ítems cuyo campo 'timestamp' sea >= corte.
    """

    filter_param = request.args.get('filter', '1h')
    mapping = {
        '1h': timedelta(hours=1),
        '24h': timedelta(hours=24),
        '7d': timedelta(days=7),
        '30d': timedelta(days=30)
    }

    if filter_param not in mapping:
        return jsonify({"error": "Filtro inválido. Usa 1h,24h,7d o 30d."}), 400

    sensor_id = request.args.get('sensor_id', SENSOR_ID)

    try:
        latest_resp = table.query(
            KeyConditionExpression=Key('sensor_id').eq(sensor_id),
            ScanIndexForward=False,
            Limit=1
        )
        latest_items = latest_resp.get('Items', [])
        if latest_items:
            last_ts = latest_items[0].get('timestamp')
            try:
                ref_dt = datetime.fromisoformat(last_ts)
            except Exception:
                ref_dt = datetime.utcnow()
        else:
            lima_now = datetime.now(ZoneInfo('America/Lima'))
            ref_dt = lima_now.astimezone(ZoneInfo('UTC')).replace(tzinfo=None)
    except Exception:
        lima_now = datetime.now(ZoneInfo('America/Lima'))
        ref_dt = lima_now.astimezone(ZoneInfo('UTC')).replace(tzinfo=None)

    cutoff = ref_dt - mapping[filter_param]
    cutoff_str = cutoff.isoformat()

    try:
        items = []
        kwargs = {
            'KeyConditionExpression': Key('sensor_id').eq(sensor_id) & Key('timestamp').gte(cutoff_str),
            'ScanIndexForward': True
        }

        while True:
            resp = table.query(**kwargs)
            items.extend(resp.get('Items', []))
            if 'LastEvaluatedKey' in resp:
                kwargs['ExclusiveStartKey'] = resp['LastEvaluatedKey']
            else:
                break

        # Normalición exagerada (aunque en la bd estan como numbers, nunca se sabe uu)
        normalized = []
        for it in items:
            normalized.append({
                'sensor_id': it.get('sensor_id'),
                'timestamp': it.get('timestamp'),
                'avgT': float(it.get('avgT')) if it.get('avgT') is not None else None,
                'avgH': float(it.get('avgH')) if it.get('avgH') is not None else None,
                'maxT': float(it.get('maxT')) if it.get('maxT') is not None else None,
                'maxH': float(it.get('maxH')) if it.get('maxH') is not None else None,
                'medT': float(it.get('medT')) if it.get('medT') is not None else None,
                'medH': float(it.get('medH')) if it.get('medH') is not None else None,
                'minT': float(it.get('minT')) if it.get('minT') is not None else None,
                'minH': float(it.get('minH')) if it.get('minH') is not None else None
            })

        normalized.sort(key=lambda x: x.get('timestamp') or '')
        return jsonify(normalized)
    except Exception as e:
        return jsonify({"error": str(e)}), 500

# ****************************************
# -> VISTAS: DISPOSITIVOS
# ****************************************

@app.route("/dispositivos")
def dispositivos():
    """
    Renderiza la vista HTML de gestión de dispositivos IoT.
    """
    return render_template("dispositivos.html")

@app.route("/api/dispositivos", methods=["GET"])
def listar_dispositivos():
    """
    Devuelve un listado de dispositivos registrados (mock temporal).
    En una versión real, esto consultaría una tabla DynamoDB llamada 'Dispositivos'.
    """
    dispositivos = [
        {
            "id": "ac1f09fffe1397c9",
            "nombre": "Sensor DHT22 #1",
            "tipo": "Temperatura / Humedad",
            "ubicacion": "Laboratorio GTI",
            "estado": "activo",
            "ultimo_registro": "2025-11-12T10:30:00"
        },
        {
            "id": "ac1f09fffexxxxx1",
            "nombre": "Sensor DHT22 #2",
            "tipo": "Temperatura / Humedad",
            "ubicacion": "Andahuaylillas",
            "estado": "inactivo",
            "ultimo_registro": "2025-11-11T22:15:00"
        }
    ]
    return jsonify(dispositivos)

# ****************************************
# -> VISTA: NUEVO DISPOSITIVOS
# ****************************************

@app.route("/nuevo-dispositivo")
def nuevo_dispositivo():
    """
    Renderiza el formulario para registrar un nuevo dispositivo IoT.
    """
    return render_template("nuevo_dispositivo.html")

@app.route("/api/dispositivos", methods=["POST"])
def crear_dispositivo():
    """
    Registra un nuevo dispositivo (por ahora simulado).
    En producción se guardaría en DynamoDB en la tabla 'Dispositivos'.
    """
    try:
        data = request.get_json()
        device_id = data.get("id")
        nombre = data.get("nombre")
        tipo = data.get("tipo")
        ubicacion = data.get("ubicacion")
        estado = data.get("estado")

        if not device_id or not nombre:
            return jsonify({"error": "El ID y el nombre son obligatorios"}), 400

        # Simulación de guardado (a futuro se hará put_item en DynamoDB)
        print("📡 Nuevo dispositivo recibido:", data)

        # Aquí iría, por ejemplo:
        # table_devices.put_item(Item=data)

        return jsonify({
            "message": "Dispositivo registrado correctamente",
            "data": data
        }), 201

    except Exception as e:
        return jsonify({"error": str(e)}), 500

# ****************************************
# -> EJECUCIÓN PRINCIPAL    
# ****************************************
if __name__ == "__main__":
    app.run(debug=True, host="0.0.0.0", port=5000)
