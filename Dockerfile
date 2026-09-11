# Stage 1: Build Frontend Assets
FROM node:20-alpine AS frontend-builder
WORKDIR /app/frontend

COPY frontend/package*.json ./
RUN npm ci || npm install

COPY frontend/ ./
RUN npm run build

# Stage 2: Production Python Backend with Built Frontend
FROM python:3.11-slim

# Install developer toolchains (Git, curl, build essentials) for Antigravity agents
RUN apt-get update && apt-get install -y --no-install-recommends \
    git \
    curl \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install Python dependencies
COPY backend/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

# Copy backend application
COPY backend/app ./app

# Copy built frontend static assets into backend static directory
COPY --from=frontend-builder /app/frontend/dist ./static

# Ensure workspaces and data directories exist
RUN mkdir -p /workspaces /data

ENV PORT=8080
ENV HOST=0.0.0.0
ENV WORKSPACE_ROOT=/workspaces
ENV DATABASE_URL=sqlite+aiosqlite:////data/adappty.db
ENV STATIC_DIR=/app/static

EXPOSE 8080

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8080"]
