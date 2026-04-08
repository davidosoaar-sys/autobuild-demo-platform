FROM python:3.11-slim

WORKDIR /app

RUN apt-get update && apt-get install -y \
    gcc \
    g++ \
    && rm -rf /var/lib/apt/lists/*

COPY backend/requirements.txt .

# Install numpy first at correct version
RUN pip install --no-cache-dir numpy==1.24.3

# Install CPU-only torch
RUN pip install --no-cache-dir torch==2.3.0+cpu --extra-index-url https://download.pytorch.org/whl/cpu

# Install rest of dependencies
RUN pip install --no-cache-dir -r requirements.txt

COPY backend/ .

CMD ["sh", "-c", "uvicorn main:app --host 0.0.0.0 --port ${PORT:-8000}"]