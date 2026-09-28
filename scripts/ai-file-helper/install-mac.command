#!/bin/bash
# Double-click in Finder to install the AI File helper on this Mac (first
# time: right-click > Open, since it's an unsigned script). Copies it to
# ~/Library/Application Support/PustakaJasa-AI-Helper and registers a
# LaunchAgent so it starts at every login and restarts if it ever quits.
cd "$(dirname "$0")" || exit 1
export PATH="$PATH:/usr/local/bin:/opt/homebrew/bin"

finish() { echo; read -r -p "Press Enter to close."; exit "$1"; }

NODE_BIN="$(command -v node || true)"
if [ -z "$NODE_BIN" ]; then
  echo "Node.js is not installed. Install it from https://nodejs.org (LTS), then run this again."
  finish 1
fi

DEST="$HOME/Library/Application Support/PustakaJasa-AI-Helper"
LABEL="com.pustakajasa.ai-file-helper"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
OLD_PLIST="$HOME/Library/LaunchAgents/com.pustakajasa.ai-file-watcher.plist"

mkdir -p "$DEST" "$HOME/Library/LaunchAgents"
cp ai-file-helper.mjs "$DEST/"

# Retire the old watch_ai_file_jobs.js watcher this replaces, if installed.
if [ -f "$OLD_PLIST" ]; then launchctl unload "$OLD_PLIST" 2>/dev/null; rm -f "$OLD_PLIST"; fi

cat > "$PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>$NODE_BIN</string>
    <string>$DEST/ai-file-helper.mjs</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>$DEST/helper.log</string>
  <key>StandardErrorPath</key><string>$DEST/helper.log</string>
</dict>
</plist>
PLIST

launchctl unload "$PLIST" 2>/dev/null
launchctl load "$PLIST"

echo "Starting the AI File helper..."
STATUS=""
for _ in 1 2 3 4 5 6 7 8 9 10; do
  sleep 2
  STATUS="$(curl -s --max-time 15 -H 'Origin: https://pustaka-jasa.vercel.app' http://127.0.0.1:47821/status)" && [ -n "$STATUS" ] && break
done

echo
if [ -z "$STATUS" ]; then
  echo "FAILED: the helper did not start. Send this log to Sean: $DEST/helper.log"
  finish 1
fi
echo "Installed. It starts automatically every time you log in."
case "$STATUS" in
  *'"nasOk":true'*) echo "AI FILE folder found: YES" ;;
  *) echo "AI FILE folder found: NO"
     echo "Connect to the NAS (Finder > Go > Connect to Server > smb://TEQGO/Artwork),"
     echo "or put the correct path (one line) in: $DEST/ai-file-dir.txt" ;;
esac
echo "$STATUS"
finish 0
