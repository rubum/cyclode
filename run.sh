#!/usr/bin/env bash
set -e

# Terminal Colors
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m' # No Color

echo -e "${BLUE}====================================================${NC}"
echo -e "${BLUE}⚡ Adappty: Event-Driven Autonomous Orchestrator ⚡${NC}"
echo -e "${BLUE}====================================================${NC}"

# 1. Check Docker prerequisite
if ! command -v docker &> /dev/null; then
    echo -e "${YELLOW}Error: Docker is not installed or not running.${NC}"
    echo "Please ensure Docker Desktop is running and try again."
    exit 1
fi

# 2. Ensure environment file
if [ ! -f .env ]; then
    echo -e "${YELLOW}Creating .env from .env.example...${NC}"
    cp .env.example .env
fi

# Source environment variables if available
set -a
[ -f .env ] && . ./.env
set +a

FRONT_PORT=${FRONTEND_PORT:-5174}
BACK_PORT=${PORT:-8000}

mkdir -p workspaces data

echo -e "${CYAN}[1/3] 🔨 Building and starting container services...${NC}"
docker compose up --build -d

echo -e "${CYAN}[2/3] ⏳ Waiting for backend and frontend services to be ready...${NC}"

# 3. Active Readiness Poll for Backend API
BACKEND_READY=0
for i in {1..30}; do
    if curl -s -f "http://localhost:${BACK_PORT}/healthz" > /dev/null 2>&1; then
        BACKEND_READY=1
        break
    fi
    printf "."
    sleep 2
done
printf "\n"

# 4. Active Readiness Poll for Frontend UI
FRONTEND_READY=0
for i in {1..25}; do
    if curl -s -f "http://localhost:${FRONT_PORT}" > /dev/null 2>&1; then
        FRONTEND_READY=1
        break
    fi
    printf "."
    sleep 1
done
printf "\n"

if [ $BACKEND_READY -eq 1 ] && [ $FRONTEND_READY -eq 1 ]; then
    echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${GREEN}${BOLD}✅ Adappty is Live, Healthy, and Ready!${NC}"
    echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "  🌐 ${BOLD}Frontend Dashboard:${NC}       ${CYAN}http://localhost:${FRONT_PORT}${NC}"
    echo -e "  ⚡ ${BOLD}Backend API & WebSockets:${NC} ${CYAN}http://localhost:${BACK_PORT}${NC}"
    echo -e "  📚 ${BOLD}Interactive API Docs:${NC}     ${CYAN}http://localhost:${BACK_PORT}/docs${NC}"
    echo -e "  ✦  ${BOLD}Antigravity Harness:${NC}      Gemini 3.7 Flash"
    echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${YELLOW}Streaming container logs below (Press Ctrl+C to stop)...${NC}\n"
else
    echo -e "${YELLOW}⚠️  Containers started on ports ${BACK_PORT} / ${FRONT_PORT}. Checking live logs...${NC}"
fi

# 5. Follow live logs
docker compose logs -f
