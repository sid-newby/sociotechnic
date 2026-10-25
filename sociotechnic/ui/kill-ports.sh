#!/bin/sh
set -eu

command -v lsof >/dev/null

for port in "$@"; do
  case "$port" in
    ''|*[!0-9]*) echo "Invalid TCP port: $port" >&2; exit 1 ;;
  esac
  if [ "$port" -lt 1 ] || [ "$port" -gt 65535 ]; then
    echo "Invalid TCP port: $port" >&2
    exit 1
  fi
done

listeners() {
  lsof -nP -t -iTCP:"$1" -sTCP:LISTEN || [ "$?" -eq 1 ]
}

for port in "$@"; do
  pids=$(listeners "$port")
  [ -n "$pids" ] || continue
  echo "Freeing TCP port $port (PIDs: $(echo "$pids" | tr '\n' ' '))"
  for pid in $pids; do
    kill -TERM "$pid" 2>/dev/null || true
  done

  attempts=0
  while [ "$attempts" -lt 5 ]; do
    pids=$(listeners "$port")
    [ -n "$pids" ] || break
    sleep 1
    attempts=$((attempts + 1))
  done

  pids=$(listeners "$port")
  if [ -n "$pids" ]; then
    echo "Force-stopping remaining listeners on TCP port $port"
    for pid in $pids; do
      kill -KILL "$pid" 2>/dev/null || true
    done
    sleep 1
  fi
  if [ -n "$(listeners "$port")" ]; then
    echo "TCP port $port is still occupied; refusing to start development servers." >&2
    exit 1
  fi
done
