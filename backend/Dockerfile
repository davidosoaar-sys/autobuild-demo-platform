FROM python:3.11-slim

WORKDIR /app

# Install system dependencies for trimesh/scipy
RUN apt-get update && apt-get install -y \
    gcc \
    g++ \
    && rm -rf /var/lib/apt/lists/*

# Copy requirements first for layer caching
COPY requirements.txt .

# Install CPU-only torch + all dependencies
RUN pip install --no-cache-dir torch==2.3.0+cpu --extra-index-url https://download.pytorch.org/whl/cpu
RUN pip install --no-cache-dir -r requirements.txt

# Copy all backend files
COPY . .

# Start the server
CMD uvicorn main:app --host 0.0.0.0 --port $PORT