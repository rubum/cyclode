# Stage 1: Build Frontend Assets
FROM node:20-alpine AS frontend-builder
WORKDIR /app/frontend

COPY frontend/package*.json ./
RUN npm ci || npm install

COPY frontend/ ./
RUN npm run build

# Stage 2: Build Native Rust Search Service (cyclode-searchd)
FROM rust:1.80-slim AS rust-builder
WORKDIR /app/crates/cyclode-search
COPY crates/cyclode-search/Cargo.toml crates/cyclode-search/Cargo.lock* ./
# Pre-fetch and cache build layers
RUN mkdir src && echo "fn main() {}" > src/main.rs && echo "" > src/lib.rs && cargo build --release || true
COPY crates/cyclode-search/ ./
RUN cargo build --release

# Stage 3: Production Python Backend with Built Frontend & Native Rust Search Engine
FROM python:3.11-slim

# Install developer toolchains (Git, curl, build essentials, Node.js 20 & npm) for Antigravity agents
RUN apt-get update && apt-get install -y --no-install-recommends \
    git \
    curl \
    ca-certificates \
    gnupg \
    build-essential \
    && curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y --no-install-recommends nodejs \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install Python dependencies
COPY backend/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

# Copy backend application
COPY backend/app ./app

# Copy built frontend static assets into backend static directory
COPY --from=frontend-builder /app/frontend/dist ./static

# Copy compiled Native Rust search & AST daemon
COPY --from=rust-builder /app/crates/cyclode-search/target/release/cyclode-searchd /usr/local/bin/cyclode-searchd

# Ensure workspaces and data directories exist
RUN mkdir -p /workspaces /data

ENV PORT=8080
ENV HOST=0.0.0.0
ENV WORKSPACE_ROOT=/workspaces
ENV DATABASE_URL=sqlite+aiosqlite:////data/cyclode.db
ENV STATIC_DIR=/app/static

EXPOSE 8080

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8080"]
