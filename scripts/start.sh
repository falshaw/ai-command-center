#!/usr/bin/env sh
# Start the server in the background and open it as an app window if Chrome/Chromium is available.
cd "$(dirname "$0")/.." || exit 1
PORT=$(node -e "try{console.log(require('./hud.config.json').port||3020)}catch{console.log(3020)}")
URL="http://127.0.0.1:$PORT"
curl -fs "$URL/health" >/dev/null 2>&1 || { mkdir -p logs; nohup node server.mjs >logs/hud.log 2>&1 & sleep 1; }
for b in google-chrome chromium chromium-browser; do command -v "$b" >/dev/null && exec "$b" --app="$URL"; done
echo "Open $URL"
