#!/bin/bash

echo ""
echo "────────────────────────────────────────────"
echo " MET Catalogue Maker – Installer"
echo "────────────────────────────────────────────"
echo ""

# 1. Check Node
if ! command -v node >/dev/null 2>&1; then
  echo "❌ Node.js is not installed."
  echo "   Please install Node.js (v18+) from:"
  echo "   https://nodejs.org"
  exit 1
fi

NODE_VERSION=$(node -v)
echo "✔ Node detected: $NODE_VERSION"

# 2. Check npm
if ! command -v npm >/dev/null 2>&1; then
  echo "❌ npm is not available."
  exit 1
fi

echo "✔ npm detected"

# 3. Initialize package.json if missing
if [ ! -f "package.json" ]; then
  echo ""
  echo "→ Initializing npm project…"
  npm init -y >/dev/null
  echo "✔ package.json created"
else
  echo "✔ package.json already exists"
fi

# 4. Install dependencies
echo ""
echo "→ Installing dependencies (express)…"
npm install express >/dev/null

if [ $? -ne 0 ]; then
  echo "❌ Failed to install dependencies"
  exit 1
fi

echo "✔ Dependencies installed"

# 5. Add dev script if missing
if ! grep -q '"dev"' package.json; then
  echo ""
  echo "→ Adding npm run dev script…"

  node -e "
    const fs = require('fs');
    const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
    pkg.scripts = pkg.scripts || {};
    pkg.scripts.dev = 'node server.js';
    fs.writeFileSync('package.json', JSON.stringify(pkg, null, 2));
  "

  echo "✔ npm run dev added"
else
  echo "✔ dev script already present"
fi

# 6. Final instructions
echo ""
echo "────────────────────────────────────────────"
echo " ✅ Installation complete"
echo "────────────────────────────────────────────"
echo ""
echo "To start the app:"
echo ""
echo "  npm run dev"
echo ""
echo "Then open in your browser:"
echo ""
echo "  http://localhost:3000"
echo ""
echo "Health check:"
echo ""
echo "  http://localhost:3000/health"
echo ""
echo "────────────────────────────────────────────"
echo " Enjoy the calm chaos."
echo "────────────────────────────────────────────"
echo ""
