# Usa Alpine (ligero)
FROM python:3.12-alpine

# Evita .pyc y buffer
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

# Dependencias de build (muchos wheels necesitan compilar)
# Agrega/quita libs según tus paquetes (ej. postgresql-dev, jpeg-dev, zlib-dev, etc.)
RUN apk add --no-cache gcc musl-dev libffi-dev openssl-dev cargo curl

WORKDIR /app

# Instala dependencias primero para aprovechar cache
COPY requirements.txt .
RUN pip install --upgrade pip setuptools wheel && \
    pip install -r requirements.txt

# Copia tu proyecto
COPY . .

# Usuario no-root
RUN adduser -D -H appuser && chown -R appuser /app
USER appuser

# Puerto por defecto Flask dev
EXPOSE 5000

# Comando por defecto (modo dev). En prod usa gunicorn (ver docker-compose)
CMD ["python", "-m", "flask", "run", "--host=0.0.0.0", "--port=5000"]
