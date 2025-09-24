#include <HardwareSerial.h>
#include <DHT.h>

// --- Configuración LoRa ---
HardwareSerial LoRaSerial(2);  // UART2 para RAK3272S

String atCommands[] = {
  "AT\r\n",
  "AT+APPEUI=?\r\n",
  "AT+APPKEY=?\r\n",
  "AT+DEVEUI=?\r\n",
  "AT+NWM=1\r\n",
  "AT+NJM=1\r\n",
  "AT+CLASS=A\r\n",
  "AT+BAND=6\r\n",
  "AT+MASK=0001\r\n",
  "AT+TIMEREQ=1\r\n",
  "AT+LTIME=1\r\n",
  "AT+APPKEY=B89A8673B78B0CB4111A976FA2E309A8\r\n",
  "AT+APPEUI=F9D486154DC48388\r\n",
  "AT+JOIN=1:0:10:8\r\n"
};
int totalCmds = sizeof(atCommands) / sizeof(atCommands[0]);

unsigned long lastCmdTime = 0;
int cmdIndex = 0;
bool joined = false;
unsigned long lastSendTime = 0;
const unsigned long sendInterval = 10000; // 10 segundos

// --- Configuración DHT22 ---
#define DHTPIN 21          // Pin donde está conectado el DHT22
#define DHTTYPE DHT22
DHT dht(DHTPIN, DHTTYPE);

void setup() {
  Serial.begin(115200);
  LoRaSerial.begin(115200, SERIAL_8N1, 16, 17);
  dht.begin();
  Serial.println("Configurando RAK3272S para OTAA en AU915...");
}

void loop() {

  // Enviar comandos de configuración secuencialmente
  if (!joined && cmdIndex < totalCmds && millis() - lastCmdTime > 3000) {
    Serial.print("ESP32 >> ");
    Serial.print(atCommands[cmdIndex]);
    LoRaSerial.print(atCommands[cmdIndex]);
    lastCmdTime = millis();
    cmdIndex++;
  }

  // Leer respuestas del módulo
  while (LoRaSerial.available()) {
    String resp = LoRaSerial.readStringUntil('\r');
    resp.trim();
    if (resp.length() > 0) {
      Serial.println("RAK >> " + resp);

      // Detectar unión exitosa
      if (resp.indexOf("+EVT:JOINED") >= 0) {
        joined = true;
        Serial.println("✅ Unión exitosa a la red LoRaWAN!");
      }
    }
  }

  // Una vez unido, enviar valores de DHT22 periódicamente
  if (joined && millis() - lastSendTime > sendInterval) {
    float h = dht.readHumidity();
    float t = dht.readTemperature();

    if (!isnan(h) && !isnan(t)) {
      // Convertir a dos decimales y luego a entero (ej: 23.45 -> 2345)
      int tInt = round(t * 100);
      int hInt = round(h * 100);

      // Convertir a hex
      char payload[9]; // 4 dígitos temp + 4 dígitos humedad
      sprintf(payload, "%04X%04X", tInt, hInt);

      String cmd = "AT+SEND=2:" + String(payload) + "\r\n";
      Serial.print("ESP32 >> ");
      Serial.print(cmd);
      LoRaSerial.print(cmd);
    } else {
      Serial.println("⚠️ Error leyendo DHT22");
    }

    lastSendTime = millis();
  }
}
