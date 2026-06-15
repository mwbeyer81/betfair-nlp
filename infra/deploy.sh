#!/usr/bin/env bash
# infra/deploy.sh — pull latest code and restart the Node.js server on the VM
# Run as the ubuntu user:  bash infra/deploy.sh
# Pass --client to also rebuild the Expo web client (slower, only needed when client/ changed)
set -euo pipefail

APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
BUILD_CLIENT=false

for arg in "$@"; do
    case $arg in
        --client) BUILD_CLIENT=true ;;
    esac
done

echo "==> Pulling latest code"
cd "$APP_DIR"
git pull origin main

echo "==> Installing backend dependencies"
npm install

echo "==> Compiling TypeScript"
npm run build

echo "==> Copying prompts to dist (tsc does not copy .md files)"
cp -r src/lib/service/prompts dist/lib/service/

if [ "$BUILD_CLIENT" = true ]; then
    echo "==> Building Expo web client"
    cd "$APP_DIR/client"
    npm install
    npx expo export --platform web --output-dir dist
    cd "$APP_DIR"
fi

echo "==> Restarting server"
pkill -f 'node dist/server/index.js' || true
sleep 1
# disown is required: without it the SSH session close sends SIGHUP to the
# background process, killing it even though nohup is set.
nohup node dist/server/index.js >> "$APP_DIR/server.log" 2>&1 & disown

sleep 3
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/hello-world)
if [ "$HTTP_CODE" = "200" ]; then
    echo "==> Server healthy (200)"
else
    echo "==> ERROR: server returned $HTTP_CODE — check server.log"
    tail -20 "$APP_DIR/server.log"
    exit 1
fi

echo ""
echo "Done. https://backbet.co.uk/ is live."
