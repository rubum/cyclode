#!/usr/bin/env bash
# ==============================================================================
# Cyclode Universal Installer
# Usage:
#   curl -fsSL https://get.cyclode.ai/install.sh | bash
# ==============================================================================
set -euo pipefail

CYAN='\033[0;36m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

echo -e "${CYAN}"
echo "   ____           _           _      "
echo "  / ___|   _  ___| | ___   __| | ___ "
echo " | |  | | | |/ __| |/ _ \ / _\` |/ _ \\"
echo " | |__| |_| | (__| | (_) | (_| |  __/"
echo "  \____\__, |\___|_|\___/ \__,_|\___|"
echo "       |___/                         "
echo -e "${NC}"
echo "Autonomous Multi-Agent Orchestrator & Live App Builder"
echo "======================================================"

# Detect OS and Architecture
OS="$(uname -s | tr '[:upper:]' '[:lower:]')"
ARCH="$(uname -m)"

case "${ARCH}" in
    x86_64|amd64)
        ARCH="x86_64"
        ;;
    arm64|aarch64)
        ARCH="aarch64"
        ;;
    *)
        echo -e "${RED}Unsupported CPU architecture: ${ARCH}${NC}"
        exit 1
        ;;
esac

echo -e "Detected Platform: ${GREEN}${OS}-${ARCH}${NC}"

# Check Python 3.10+
if ! command -v python3 &>/dev/null; then
    echo -e "${RED}Error: Python 3.10 or higher is required.${NC}"
    echo "Please install Python 3 and try again."
    exit 1
fi

PY_VERSION=$(python3 -c 'import sys; print(f"{sys.version_info.major}.{sys.version_info.minor}")')
PY_MAJOR=$(echo "${PY_VERSION}" | cut -d. -f1)
PY_MINOR=$(echo "${PY_VERSION}" | cut -d. -f2)

if [ "${PY_MAJOR}" -lt 3 ] || [ "${PY_MINOR}" -lt 10 ]; then
    echo -e "${RED}Error: Python ${PY_VERSION} detected. Cyclode requires Python 3.10+.${NC}"
    exit 1
fi

echo -e "Python Version: ${GREEN}${PY_VERSION}${NC}"

# Determine installation method (uv > pipx > pip --user)
if command -v uv &>/dev/null; then
    echo -e "\n📦 Installing Cyclode via ${GREEN}uv tool${NC}..."
    uv tool install --force cyclode-ai
elif command -v pipx &>/dev/null; then
    echo -e "\n📦 Installing Cyclode via ${GREEN}pipx${NC}..."
    pipx install --force cyclode-ai
else
    echo -e "\n📦 Installing Cyclode via ${GREEN}python3 -m pip${NC}..."
    python3 -m pip install --user --upgrade cyclode-ai
fi

echo -e "\n${GREEN}✔ Cyclode installed successfully!${NC}"
echo -e "======================================================"
echo -e "Run the following command to get started:"
echo -e "  ${CYAN}cyclode start${NC}       # Launch Cyclode daemon & web UI"
echo -e "  ${CYAN}cyclode status${NC}      # Inspect running agents and health"
echo -e "  ${CYAN}cyclode --help${NC}      # View CLI options"
echo -e "======================================================"
