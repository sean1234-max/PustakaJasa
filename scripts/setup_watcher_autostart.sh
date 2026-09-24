#!/bin/bash
# One-time setup: installs watch_ai_file_jobs.js as a macOS LaunchAgent, so
# it starts automatically at login and keeps running in the background —
# after running this once, nobody needs to open Terminal again to use the
# "Generate AI File" button on this machine.
#
# Usage (run once, from the repo root):
#   bash scripts/setup_watcher_autostart.sh
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$REPO_DIR/.env"
NODE_BIN="$(command -v node || true)"
PLIST_LABEL="com.pustakajasa.ai-file-watcher"
PLIST_PATH="$HOME/Library/LaunchAgents/$PLIST_LABEL.plist"

if [ -z "$NODE_BIN" ]; then
  echo "node not found on PATH — install Node.js first (https://nodejs.org), then re-run this script."
  exit 1
fi
if [ ! -f "$ENV_FILE" ]; then
  echo "Missing $ENV_FILE — copy .env.example to .env and fill in VITE_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, and (for a shared multi-person setup) WATCHER_USER_EMAIL first."
  exit 1
fi

mkdir -p "$HOME/Library/Logs" "$HOME/Library/LaunchAgents"
cat > "$PLIST_PATH" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$PLIST_LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>$NODE_BIN</string>
    <string>--env-file=$ENV_FILE</string>
    <string>$REPO_DIR/scripts/watch_ai_file_jobs.js</string>
  </array>
  <key>WorkingDirectory</key><string>$REPO_DIR</string>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>$HOME/Library/Logs/ai-file-watcher.log</string>
  <key>StandardErrorPath</key><string>$HOME/Library/Logs/ai-file-watcher.err.log</string>
</dict>
</plist>
PLIST

launchctl unload "$PLIST_PATH" 2>/dev/null || true
launchctl load "$PLIST_PATH"

echo "Installed and started: $PLIST_LABEL"
echo "It will now start automatically every time you log in — no Terminal needed."
echo "Logs: tail -f \"$HOME/Library/Logs/ai-file-watcher.log\""
echo "To stop it permanently: launchctl unload \"$PLIST_PATH\" && rm \"$PLIST_PATH\""
