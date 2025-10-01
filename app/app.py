from flask import Flask, render_template, jsonify
from flask_socketio import SocketIO, emit

import threading, json, time
import boto3
from collections import deque
from datetime import datetime


app = Flask(__name__)
socketio = SocketIO(app, cors_allowed_origins="*")

# Buffer para últimos datos
sensor_data_buffer = deque(maxlen=100)

# Configuración DynamoDB
DYNAMODB_TABLE = "SensorData"

# Inicializa el cliente DynamoDB (usa credenciales de entorno)
dynamodb = boto3.resource('dynamodb', region_name='us-east-2')
table = dynamodb.Table(DYNAMODB_TABLE)

def dynamodb_query_thread():
    while True:
        try:
            # Consulta los últimos 10 datos (scan ordenado por timestamp descendente)
            response = table.scan()
            items = response.get('Items', [])
            # Ordena por timestamp descendente
            items.sort(key=lambda x: x.get('timestamp', ''), reverse=True)
            # Solo los últimos 10
            latest = items[:10]
            for item in reversed(latest):
                data = {
                    "sensor_id": item.get("sensor_id"),
                    "temperatura": float(item.get("temperatura", 0)),
                    "humedad": float(item.get("humedad", 0)),
                    "timestamp": item.get("timestamp")
                }
                sensor_data_buffer.append(data)
                socketio.emit('sensor_update', data)
            print(f"[DEBUG] Emitidos {len(latest)} datos desde DynamoDB")
        except Exception as e:
            print(f"[DEBUG] Error consultando DynamoDB: {e}")
        time.sleep(11)

@app.route("/")
def dashboard():
    return render_template("dashboard.html")

@app.route("/health")
def health_check():
    return "OK", 200

@app.route("/api/sensors/last")
def get_last_sensor():
    if sensor_data_buffer:
        return jsonify(sensor_data_buffer[-1])
    return jsonify({"error": "No data"}), 404

if __name__ == "__main__":
    t = threading.Thread(target=dynamodb_query_thread, daemon=True)
    t.start()
    socketio.run(app, debug=True, host="0.0.0.0", allow_unsafe_werkzeug=True)