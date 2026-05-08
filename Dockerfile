# ===== Stage 1: Build frontend =====
FROM node:20-alpine AS web-builder

WORKDIR /web

COPY web/package.json web/package-lock.json* ./
RUN npm ci --no-audit --no-fund

COPY web/ ./
RUN npm run build


# ===== Stage 2: Python runtime =====
FROM python:3.12-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy backend
COPY app/ ./app/

# Copy built frontend
COPY --from=web-builder /web/dist ./web/dist

EXPOSE 8080

CMD uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8080}
