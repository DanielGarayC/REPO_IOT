
from flask import Flask, render_template, jsonify
from flask_socketio import SocketIO, emit
import threading, json, base64, time
import paho.mqtt.client as mqtt
from collections import deque
from datetime import datetime

app = Flask(__name__)
socketio = SocketIO(app, cors_allowed_origins="*")

# MQTT Configuración
MQTT_BROKER = "10.100.252.231"
MQTT_PORT = 1883
MQTT_TOPIC = "application/e270d3eb-ae8d-49d3-85bb-db401bc60eca/device/ac1f09fffe1397c9/event/up"

# Buffer para últimos datos
sensor_data_buffer = deque(maxlen=100)

def decode_dht22_payload(json_msg):
    """
    Decodifica un mensaje LoRaWAN JSON con payload Base64 de un DHT22.
    """
    try:
        payload_b64 = json_msg["data"]
        payload_bytes = base64.b64decode(payload_b64)
        if len(payload_bytes) < 4:
            raise ValueError("Payload demasiado corto, se esperan al menos 4 bytes")
        temp_int = payload_bytes[0] << 8 | payload_bytes[1]
        hum_int  = payload_bytes[2] << 8 | payload_bytes[3]
        temperature = temp_int / 100.0
        humidity    = hum_int / 100.0
        return temperature, humidity
    except Exception as e:
        print(f"[DEBUG] Error decodificando payload: {e}")
        return None, None

def on_connect(client, userdata, flags, rc):
    if rc == 0:
        print("[DEBUG] Conexión exitosa al broker MQTT")
        client.subscribe(MQTT_TOPIC)
        print(f"[DEBUG] Suscrito al tópico {MQTT_TOPIC}")
    else:
        print(f"[DEBUG] Falló la conexión, código de error: {rc}")

def on_message(client, userdata, msg):
    try:
        json_msg = json.loads(msg.payload.decode())
        temp, hum = decode_dht22_payload(json_msg)
        # Usar el campo 'time' del payload si existe, si no usar now
        timestamp = json_msg.get("time")
        if timestamp is None:
            timestamp = datetime.now().isoformat()
        print(f"[DEBUG] Mensaje recibido en {msg.topic}: Temperatura={temp}°C, Humedad={hum}%, Time={timestamp}")
        if temp is not None and hum is not None:
            data = {
                "sensor_id": json_msg.get("deviceInfo", {}).get("devEui", "ac1f09fffe1397c9"),
                "temperatura": temp,
                "humedad": hum,
                "timestamp": timestamp
            }
            sensor_data_buffer.append(data)
            socketio.emit('sensor_update', data)
    except Exception as e:
        print(f"[DEBUG] Error procesando mensaje: {e}")

def mqtt_thread():
    client = mqtt.Client()
    client.on_connect = on_connect
    client.on_message = on_message
    while True:
        for i in range(10):
            try:
                print(f"[DEBUG] Intentando conectar al broker (intento {i+1})...")
                client.connect(MQTT_BROKER, MQTT_PORT)
                client.loop_forever()
                break
            except Exception as e:
                print("[DEBUG] Esperando a que Mosquitto esté listo...", e)
                time.sleep(2)
        else:
            print("[DEBUG] No se pudo conectar al broker después de varios intentos. Reintentando en 10 segundos...")
            time.sleep(10)

@app.route("/")
def dashboard():
    return render_template("dashboard.html")

@app.route("/api/sensors/last")
def get_last_sensor():
    if sensor_data_buffer:
        return jsonify(sensor_data_buffer[-1])
    return jsonify({"error": "No data"}), 404

if __name__ == "__main__":
    t = threading.Thread(target=mqtt_thread, daemon=True)
    t.start()
    socketio.run(app, debug=True)