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
DYNAMODB_TABLE = os.getenv("SENSOR_DATA", "SensorData")
SENSOR_ID = os.getenv("SENSOR_ID", "ac1f09fffe1397c9")

# Inicialización del cliente DynamoDB (usa credenciales de entorno)
dynamodb = boto3.resource('dynamodb', region_name='us-east-2')
table = dynamodb.Table(DYNAMODB_TABLE)

# ****************************************
# -> RUTAS
# ****************************************

# Ruta principal - Dashboard
@app.route("/")
def dashboard():
    return render_template("dashboard.html")

# Ruta health check
@app.route("/health")
def health_check():
    return "OK", 200

# API para últimos datos sobre el sensor
@app.route('/api/sensors/last')
def get_last_from_db():
    """Consultar DynamoDB y devolver el último registro para el SENSOR_ID fijo (luego hay que cambiar para que paso como query param uu).

    Usa Query con ScanIndexForward=False y Limit=1 para obtener el ítem más reciente
    ordenado por la clave de ordenamiento 'timestamp'. Responde en JSON con los
    campos principales.
    """

    try:
        resp = table.query(
            KeyConditionExpression=Key('sensor_id').eq(SENSOR_ID),
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

# API para listar datos del sensor con filtro de tiempo
@app.route('/api/sensors/list')
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

    try:
        latest_resp = table.query(
            KeyConditionExpression=Key('sensor_id').eq(SENSOR_ID),
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
            'KeyConditionExpression': Key('sensor_id').eq(SENSOR_ID) & Key('timestamp').gte(cutoff_str),
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
                'minT': float(it.get('minT')) if it.get('minT') is not None else None
            })

        normalized.sort(key=lambda x: x.get('timestamp') or '')
        return jsonify(normalized)
    except Exception as e:
        return jsonify({"error": str(e)}), 500

# ****************************************
# -> EJECUCIÓN PRINCIPAL    
# ****************************************
if __name__ == "__main__":
    app.run(debug=True, host="0.0.0.0", port=5000)
