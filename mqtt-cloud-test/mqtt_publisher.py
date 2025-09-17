import ssl
import json
import random
import time
import paho.mqtt.client as mqtt
from datetime import datetime

# Configuración
SENSOR_ID = "benavides"
MQTT_ENDPOINT = "a1ta2966q3hxa8-ats.iot.us-east-2.amazonaws.com"
MQTT_PORT = 8883
TOPIC = f"chirpstack/sensor/{SENSOR_ID}"

CERT_FILE = "device-certificate.crt.pem"
KEY_FILE = "private.key"
CA_FILE = "AmazonRootCA1.pem"

PUBLISH_INTERVAL = 5  # segundos

# Inicialización del publisher MQTT
print(f"""{"="*40}
PUBLISHER MQTT :O
{"="*40}
""")
client = mqtt.Client()
client.tls_set(ca_certs=CA_FILE, certfile=CERT_FILE, keyfile=KEY_FILE, cert_reqs=ssl.CERT_REQUIRED, tls_version=ssl.PROTOCOL_TLSv1_2)
client.connect(MQTT_ENDPOINT, MQTT_PORT, keepalive=60)

def generar_payload():
    return {
        "sensor_id": SENSOR_ID,
        "temperatura": round(random.uniform(25, 35), 1),
        "humedad": round(random.uniform(60, 80), 1),
        "timestamp": datetime.now().isoformat()
    }

while True:
    payload = generar_payload()
    client.publish(TOPIC, json.dumps(payload))
    print(f"Enviado: \n{json.dumps(payload, indent=2)}")
    time.sleep(PUBLISH_INTERVAL)
