FROM python:3.12-alpine

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

# Dependencias de compilación (por si agregas eventlet más adelante)
RUN apk add --no-cache gcc musl-dev libffi-dev openssl-dev curl

WORKDIR /app

COPY requirements.txt .
RUN pip install --upgrade pip setuptools wheel && \
    pip install --no-cache-dir -r requirements.txt && \
    python - <<'PY'
import pkgutil; assert "flask_socketio" in [m.name for m in pkgutil.iter_modules()], "flask_socketio NO instalado"
print("OK flask_socketio instalado")
PY

COPY . .

# Usuario no root
RUN adduser -D -H appuser && chown -R appuser /app
USER appuser

EXPOSE 5000
ENV FLASK_APP=app/app.py

CMD ["python", "app.py"]
