from flask import Flask, render_template, jsonify
from flask_socketio import SocketIO
from collections import deque
from datetime import datetime

app = Flask(__name__)
socketio = SocketIO(app, cors_allowed_origins="*")

# Buffer para últimos datos simulados (por ahora vacío)
sensor_data_buffer = deque(maxlen=100)

@app.route("/")
def dashboard():
    return render_template("dashboard.html")

@app.route("/api/sensors/last")
def get_last_sensor():
    if sensor_data_buffer:
        return jsonify(sensor_data_buffer[-1])
    return jsonify({"error": "No data"}), 404

@app.route("/health")
def health():
    return {"status": "ok"}, 200

if __name__ == "__main__":
    socketio.run(app, host="0.0.0.0", port=5000, debug=True)
