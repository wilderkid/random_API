#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
PID_FILE="$ROOT/data/equal_ask.pid"
PORT=3000

is_running() {
  local pid="$1"
  [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null
}

PIDS=()

if [[ -f "$PID_FILE" ]]; then
  OLD_PID="$(tr -d '[:space:]' < "$PID_FILE" || true)"
  if is_running "$OLD_PID"; then
    PIDS+=("$OLD_PID")
  fi
fi

if [[ ${#PIDS[@]} -eq 0 ]] && command -v pgrep >/dev/null 2>&1; then
  while read -r pid; do
    [[ -n "$pid" ]] && PIDS+=("$pid")
  done < <(pgrep -f "$ROOT/backend/server.js" || true)
fi

if [[ ${#PIDS[@]} -eq 0 ]] && command -v lsof >/dev/null 2>&1; then
  while read -r pid; do
    if [[ -n "$pid" ]] && tr '\0' ' ' < "/proc/$pid/cmdline" 2>/dev/null | grep -q "server.js"; then
      PIDS+=("$pid")
    fi
  done < <(lsof -t -iTCP:"$PORT" -sTCP:LISTEN 2>/dev/null || true)
fi

if [[ ${#PIDS[@]} -eq 0 ]]; then
  echo "Equal Ask 未在运行"
  rm -f "$PID_FILE"
  exit 0
fi

UNIQUE_PIDS="$(printf '%s\n' "${PIDS[@]}" | awk 'NF && !seen[$0]++')"
for pid in $UNIQUE_PIDS; do
  echo "正在停止 Equal Ask (PID $pid)"
  kill -TERM "$pid" 2>/dev/null || true
done

for _ in 1 2 3 4 5 6 7 8 9 10; do
  still=0
  for pid in $UNIQUE_PIDS; do
    if is_running "$pid"; then
      still=1
      break
    fi
  done
  [[ $still -eq 0 ]] && break
  sleep 0.3
done

for pid in $UNIQUE_PIDS; do
  if is_running "$pid"; then
    echo "进程未退出，强制结束 PID $pid"
    kill -KILL "$pid" 2>/dev/null || true
  fi
done

rm -f "$PID_FILE"
echo "Equal Ask 已停止"
echo "端口 $PORT 已释放"
