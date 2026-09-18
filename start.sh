#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
BACKEND="$ROOT/backend"
PID_FILE="$ROOT/data/equal_ask.pid"
LOG_FILE="$ROOT/data/server.out.log"
PORT=3000

if ! command -v node >/dev/null 2>&1; then
  echo "未找到 node，请先安装 Node.js"
  exit 1
fi

if [[ ! -f "$BACKEND/server.js" ]]; then
  echo "未找到 backend/server.js"
  exit 1
fi

mkdir -p "$ROOT/data"

is_running() {
  local pid="$1"
  [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null
}

if [[ -f "$PID_FILE" ]]; then
  OLD_PID="$(tr -d '[:space:]' < "$PID_FILE" || true)"
  if is_running "$OLD_PID"; then
    echo "Equal Ask 已在运行 (PID $OLD_PID)  http://localhost:$PORT"
    exit 0
  fi
  rm -f "$PID_FILE"
fi

if command -v ss >/dev/null 2>&1; then
  if ss -ltn 2>/dev/null | grep -qE ":${PORT}\\b"; then
    echo "端口 $PORT 已被占用"
    exit 1
  fi
elif command -v lsof >/dev/null 2>&1; then
  if lsof -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
    echo "端口 $PORT 已被占用"
    exit 1
  fi
fi

cd "$BACKEND"
nohup node server.js >> "$LOG_FILE" 2>&1 &
NEW_PID=$!
echo "$NEW_PID" > "$PID_FILE"

sleep 0.4
if ! is_running "$NEW_PID"; then
  echo "启动失败，请查看 $LOG_FILE"
  rm -f "$PID_FILE"
  exit 1
fi

echo "Equal Ask 已启动 (PID $NEW_PID)"
echo "http://localhost:$PORT"
echo "日志: $LOG_FILE"
