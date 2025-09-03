from flask import Flask, render_template, jsonify
import threading, json
from collections import deque
from datetime import datetime



app = Flask(__name__)

@app.route("/")
def dashboard():
    # Renderizado de dashboard.html en la carpeta templates :D
    return render_template("dashboard.html")

if __name__ == "__main__":
    app.run(debug=True)  # Por defecto: http://127.0.0.1:5000