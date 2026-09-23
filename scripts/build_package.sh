#!/usr/bin/env bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

echo "=== 🚀 Building Cyclode Installable Package ==="
echo "Working directory: ${ROOT_DIR}"

# 1. Build Frontend Static Assets
echo "\n--- 📦 Step 1: Building Frontend SPA ---"
cd "${ROOT_DIR}/frontend"
if [ ! -d "node_modules" ]; then
    echo "Installing frontend dependencies..."
    npm install
fi
npm run build
echo "✔ Frontend built successfully in frontend/dist"

# 2. Build Native Rust Search Engine (cyclode-searchd)
echo "\n--- 🦀 Step 2: Building Native Rust Search Service ---"
if command -v cargo &>/dev/null; then
    cd "${ROOT_DIR}/crates/cyclode-search"
    cargo build --release
    echo "✔ Native Rust search engine compiled successfully"
else
    echo "⚠️ Cargo not found; package will build with ripgrep/Python fallbacks"
fi

# 3. Bundle Assets into Python Package
echo "\n--- 📁 Step 3: Bundling Static Assets, Skills & Binaries into Package ---"
cd "${ROOT_DIR}"
rm -rf backend/cyclode/static backend/cyclode/skills backend/cyclode/bin backend/app/static
mkdir -p backend/cyclode/static backend/app/static backend/cyclode/skills backend/cyclode/bin

cp -R frontend/dist/* backend/cyclode/static/
cp -R frontend/dist/* backend/app/static/

if [ -f "crates/cyclode-search/target/release/cyclode-searchd" ]; then
    cp "crates/cyclode-search/target/release/cyclode-searchd" backend/cyclode/bin/
    chmod +x backend/cyclode/bin/cyclode-searchd
    echo "✔ Copied cyclode-searchd to backend/cyclode/bin"
fi

if [ -d ".agents/skills" ]; then
    cp -R .agents/skills/* backend/cyclode/skills/
fi
echo "✔ Assets copied to backend/cyclode/static, backend/cyclode/skills & backend/cyclode/bin"

# 4. Build Python Wheel & Sdist
echo "\n--- 🐍 Step 4: Building Python Wheel (pipx / PyPI distribution) ---"
if ! python3 -c "import build" &>/dev/null; then
    echo "Installing build tool..."
    pip install build
fi

python3 -m build --no-isolation --wheel --sdist "${ROOT_DIR}"

echo "\n=============================================="
echo "🎉 Build Complete! Artifacts in dist/:"
ls -lh "${ROOT_DIR}/dist"
echo "=============================================="
echo "To test installation locally:"
echo "  pip install dist/cyclode_ai-*.whl"
echo "  cyclode --help"
echo "  cyclode status"
echo "=============================================="
