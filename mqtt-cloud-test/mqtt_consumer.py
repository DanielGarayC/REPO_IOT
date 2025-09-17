import ssl
import json
import paho.mqtt.client as mqtt

# Configuración
SENSOR_ID = "benavides"
MQTT_ENDPOINT = "a1ta2966q3hxa8-ats.iot.us-east-2.amazonaws.com"
MQTT_PORT = 8883
TOPIC = f"chirpstack/sensor/{SENSOR_ID}"

CERT_FILE = "device-certificate.crt.pem"
KEY_FILE = "private.key"
CA_FILE = "AmazonRootCA1.pem"

def on_connect(client, userdata, flags, rc):
    client.subscribe(TOPIC)
    print("-" * 40)
    print(f"Suscrito a: {TOPIC}")
    print("-" * 40 + "\n")

def on_message(client, userdata, msg):
    payload = msg.payload.decode()
    try:
        data = json.loads(payload)
    except:
        data = payload
    print(f"Mensaje recibido en {msg.topic}: \n{json.dumps(data, indent=2)}")
    print("-" * 40)

# Inicialización del cliente MQTT
print(f"""{"="*40}
CONSUMIDOR MQTT :D
{"="*40}
""")
client = mqtt.Client()
client.tls_set(ca_certs=CA_FILE, certfile=CERT_FILE, keyfile=KEY_FILE, cert_reqs=ssl.CERT_REQUIRED, tls_version=ssl.PROTOCOL_TLSv1_2)
client.on_connect = on_connect
client.on_message = on_message

client.connect(MQTT_ENDPOINT, MQTT_PORT, keepalive=60)
client.loop_forever()
