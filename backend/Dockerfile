FROM python:3.11-slim

WORKDIR /app

RUN apt-get update && apt-get install -y \
    gcc \
    g++ \
    && rm -rf /var/lib/apt/lists/*

# Copy from backend/ folder
COPY backend/requirements.txt .

# Install CPU-only torch first
RUN pip install --no-cache-dir torch==2.3.0+cpu --extra-index-url https://download.pytorch.org/whl/cpu

# Install rest of dependencies
RUN pip install --no-cache-dir -r requirements.txt

# Copy all backend files
COPY backend/ .

CMD uvicorn main:app --host 0.0.0.0 --port $PORT