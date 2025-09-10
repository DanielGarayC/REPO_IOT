import paho.mqtt.client as mqtt
import time

def on_message(client, userdata, msg):
    print("Recibido: ", msg.topic, msg.payload.decode())

client = mqtt.Client()
client.on_message = on_message

for _ in range(10):
    try:
        client.connect("mosquitto", 1883)
        break
    except Exception as e:
        print("Esperando a que Mosquitto esté listo...", e)
        time.sleep(2)

client.subscribe("iot/test")

client.loop_forever()