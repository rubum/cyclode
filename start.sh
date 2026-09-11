#!/usr/bin/env bash
set -e

GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

echo -e "${BLUE}====================================================${NC}"
echo -e "${BLUE}🚀 Starting Adappty (Production Mode) 🚀${NC}"
echo -e "${BLUE}====================================================${NC}"

if ! command -v docker &> /dev/null; then
    echo -e "${YELLOW}Error: Docker is not installed or not running.${NC}"
    exit 1
fi

if [ ! -f .env ]; then
    echo -e "${YELLOW}Creating .env from .env.example...${NC}"
    cp .env.example .env
fi

mkdir -p workspaces data

PORT_NUM=${PORT:-8080}
echo -e "${CYAN}Building production container...${NC}"
docker compose -f docker-compose.prod.yml up --build -d

echo -e "${CYAN}Waiting for healthcheck on port ${PORT_NUM}...${NC}"
for i in {1..30}; do
    if curl -s -f "http://localhost:${PORT_NUM}/healthz" > /dev/null 2>&1; then
        echo -e "\n${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
        echo -e "${GREEN}${BOLD}✅ Adappty Production Server is Live!${NC}"
        echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
        echo -e "  🌐 ${BOLD}Production Web App:${NC} ${CYAN}http://localhost:${PORT_NUM}${NC}"
        echo -e "  📚 ${BOLD}API Docs:${NC}            ${CYAN}http://localhost:${PORT_NUM}/docs${NC}"
        echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
        exit 0
    fi
    printf "."
    sleep 2
done

echo -e "\n${YELLOW}⚠️  Container started. Check logs with 'docker compose -f docker-compose.prod.yml logs'${NC}"
