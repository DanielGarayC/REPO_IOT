// Se ejecuta automáticamente al primer arranque del contenedor
// usando las variables de root del compose.

const IOT_DB = "iot";
const IOT_USER = "iot_user";
const IOT_PASS = "iot_pass";

// Conectarse a la DB "admin" (contexto por defecto de los scripts)
db = db.getSiblingDB(IOT_DB);

// Crear usuario de aplicación con permisos mínimos
db.createUser({
  user: IOT_USER,
  pwd: IOT_PASS,
  roles: [{ role: "readWrite", db: IOT_DB }]
});

// Crear colección de series temporales con retención
// Doc recomendado para IoT temperatura:
// { ts: ISODate, meta: { deviceId, site, ... }, tempC: Number, ... }
db.createCollection("temperaturas", {
  timeseries: {
    timeField: "ts",
    metaField: "meta",
    granularity: "seconds"
  },
  // Retención: borra mediciones automáticamente después de 30 días
  expireAfterSeconds: 30 * 24 * 60 * 60
});

// Índices útiles (consultas por dispositivo/sitio y por tiempo)
db.temperaturas.createIndex({ "meta.deviceId": 1 });
db.temperaturas.createIndex({ "meta.site": 1 });
// El orden temporal ya está optimizado por time series; adicionalmente:
db.temperaturas.createIndex({ ts: 1 });

print(">> MongoDB IoT listo: usuario, colección TS y TTL configurados.");
