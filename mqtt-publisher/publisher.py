import time
import paho.mqtt.client as mqtt

client = mqtt.Client()
for _ in range(10):
    try:
        client.connect("mosquitto", 1883)
        break
    except Exception as e:
        print("Esperando a que Mosquitto esté listo...", e)
        time.sleep(2)

client.loop_start()

while True:
    client.publish("iot/test", "ola")
    print("Ya publiqué")
    time.sleep(3)