import paho.mqtt.client as mqtt
import time
import base64
import json

def decode_dht22_payload(json_msg):
    """
    Decodifica un mensaje LoRaWAN JSON con payload Base64 de un DHT22.
    Se asume que los dos primeros bytes son temperatura y los siguientes dos bytes humedad,
    multiplicados por 100 (para tener dos decimales).
    
    Args:
        json_msg (dict): Diccionario JSON recibido del gateway LoRaWAN.
        
    Returns:
        tuple: (temperatura, humedad) en formato float con dos decimales.
    """
    try:
        # Obtener el campo 'data'
        payload_b64 = json_msg["data"]
        
        # Decodificar Base64 a bytes
        payload_bytes = base64.b64decode(payload_b64)
        
        if len(payload_bytes) < 4:
            raise ValueError("Payload demasiado corto, se esperan al menos 4 bytes")
        
        # Combinar bytes para temperatura y humedad
        temp_int = payload_bytes[0] << 8 | payload_bytes[1]
        hum_int  = payload_bytes[2] << 8 | payload_bytes[3]
        
        # Convertir a valores reales
        temperature = temp_int / 100.0
        humidity    = hum_int / 100.0
        
        return temperature, humidity
    
    except Exception as e:
        print(f"Error decodificando payload: {e}")
        return None, None

def on_connect(client, userdata, flags, rc):
    if rc == 0:
        print("[DEBUG] Conexión exitosa al broker MQTT")
        client.subscribe("application/e270d3eb-ae8d-49d3-85bb-db401bc60eca/device/ac1f09fffe1397c9/event/up")
        print("[DEBUG] Suscrito al tópico")
    else:
        print(f"[DEBUG] Falló la conexión, código de error: {rc}")

def on_message(client, userdata, msg):
    print(f"[DEBUG] Mensaje recibido total {msg.topic}: {json.loads(msg.payload.decode())}")
    print(f"[DEBUG] Mensaje recibido con data util en {msg.topic}: {decode_dht22_payload(json.loads(msg.payload.decode()))}")

while True:
    client = mqtt.Client()
    client.on_connect = on_connect
    client.on_message = on_message

    for i in range(10):
        try:
            print(f"[DEBUG] Intentando conectar al broker (intento {i+1})...")
            client.connect("10.100.252.231", 1883)
            client.loop_forever()
            break
        except Exception as e:
            print("[DEBUG] Esperando a que Mosquitto esté listo...", e)
            time.sleep(2)
    else:
        print("[DEBUG] No se pudo conectar al broker después de varios intentos. Reintentando en 10 segundos...")
        time.sleep(10)




