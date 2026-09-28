#!/bin/zsh
# Install (or reinstall) the Hook Studio worker as a launchd agent on this Mac.
# It starts at login, restarts if it crashes, and logs to ~/Library/Logs.
#
#   scripts/hook-worker-install.sh          install + start
#   scripts/hook-worker-install.sh stop     stop + uninstall
#   scripts/hook-worker-install.sh status   is it running?
#   scripts/hook-worker-install.sh logs     tail the log

set -euo pipefail

LABEL="com.astrobiz.hook-worker"
REPO="$(cd "$(dirname "$0")/.." && pwd)"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
LOG="$HOME/Library/Logs/astrobiz-hook-worker.log"
NODE="${NODE_BIN:-$HOME/.local/node/bin/node}"
UID_NUM="$(id -u)"

case "${1:-install}" in
  stop)
    launchctl bootout "gui/$UID_NUM/$LABEL" 2>/dev/null || true
    rm -f "$PLIST"
    echo "stopped and removed $LABEL"
    ;;
  status)
    if launchctl print "gui/$UID_NUM/$LABEL" >/dev/null 2>&1; then
      launchctl print "gui/$UID_NUM/$LABEL" | grep -E "state|pid|last exit" | sed 's/^/  /'
    else
      echo "$LABEL is not loaded"
    fi
    ;;
  logs)
    tail -n 50 -f "$LOG"
    ;;
  install)
    [ -f "$REPO/worker/.env" ] || { echo "worker/.env is missing (SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)"; exit 1; }
    [ -x "$NODE" ] || { echo "node not found at $NODE (set NODE_BIN)"; exit 1; }
    mkdir -p "$HOME/Library/LaunchAgents" "$HOME/Library/Logs"
    cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>$NODE</string>
    <string>$REPO/worker/hook-worker.mjs</string>
  </array>
  <key>WorkingDirectory</key><string>$REPO</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key><string>$HOME/.local/bin:$HOME/.local/node/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
    <key>HOME</key><string>$HOME</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>10</integer>
  <key>StandardOutPath</key><string>$LOG</string>
  <key>StandardErrorPath</key><string>$LOG</string>
</dict>
</plist>
EOF
    launchctl bootout "gui/$UID_NUM/$LABEL" 2>/dev/null || true
    launchctl bootstrap "gui/$UID_NUM" "$PLIST"
    sleep 2
    echo "installed $LABEL"
    launchctl print "gui/$UID_NUM/$LABEL" | grep -E "state|pid" | sed 's/^/  /' || true
    echo "log: $LOG"
    ;;
  *)
    echo "usage: $0 [install|stop|status|logs]"; exit 1;;
esac
