#!/bin/bash

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

# Load .env file
if [ -f "$REPO_ROOT/.env" ]; then
    export $(grep -v '^#' "$REPO_ROOT/.env" | xargs)
fi

# Kill processes on ports (both Linux and Windows-side)
kill_port() {
    local port=$1

    # Kill Linux-side processes
    local pids=$(lsof -ti :$port 2>/dev/null)
    if [ -z "$pids" ]; then
        pids=$(fuser $port/tcp 2>/dev/null | tr -s ' ')
    fi
    if [ -n "$pids" ]; then
        echo "  Killing Linux process(es) on port $port: $pids"
        echo "$pids" | xargs kill -9 2>/dev/null
    fi

    # Kill Windows-side processes (WSL lsof/fuser can't see these)
    local win_pids=$(powershell.exe -NoProfile -Command \
        "(Get-NetTCPConnection -LocalPort $port -ErrorAction SilentlyContinue).OwningProcess | Sort-Object -Unique" \
        2>/dev/null | tr -d '\r' | grep -v '^$' | grep -v '^0$')
    if [ -n "$win_pids" ]; then
        for wp in $win_pids; do
            echo "  Killing Windows process on port $port: PID $wp"
            taskkill.exe /F /PID "$wp" >/dev/null 2>&1
        done
    fi
}

echo "Cleaning up existing processes..."
kill_port 8000
kill_port 5173
sleep 2

# Create logs directory and clear log files
mkdir -p logs
> logs/backend.log
> logs/backend-err.log
> logs/frontend.log
> logs/frontend-err.log

# Start backend
uv run python python/server.py >> logs/backend.log 2>> logs/backend-err.log &
BACKEND_PID=$!

# Start frontend
npm --prefix frontend run dev -- --host 127.0.0.1 >> logs/frontend.log 2>> logs/frontend-err.log &
FRONTEND_PID=$!

echo "Backend starting on http://127.0.0.1:8000  (PID $BACKEND_PID)"
echo "Frontend starting on http://127.0.0.1:5173  (PID $FRONTEND_PID)"
echo "Waiting for services..."
sleep 8

# Detect actual frontend port from logs (Vite may pick a different port)
FRONTEND_PORT=$(grep -oP 'Local:\s+http://127\.0\.0\.1:\K[0-9]+' logs/frontend.log 2>/dev/null | tail -1)
FRONTEND_PORT=${FRONTEND_PORT:-5173}

echo ""
if curl -s http://127.0.0.1:8000/health > /dev/null 2>&1; then
    echo "Backend:  OK  (http://127.0.0.1:8000)"
else
    echo "Backend:  FAILED"
fi

if curl -s "http://127.0.0.1:${FRONTEND_PORT}" > /dev/null 2>&1 || \
   curl -s "http://$(hostname).local:${FRONTEND_PORT}" > /dev/null 2>&1 || \
   grep -q "VITE.*ready" logs/frontend.log 2>/dev/null; then
    echo "Frontend: OK  (http://127.0.0.1:${FRONTEND_PORT})"
else
    echo "Frontend: FAILED (expected http://127.0.0.1:${FRONTEND_PORT})"
fi

echo ""
echo "--- Streaming logs (Ctrl+C to stop) ---"
echo ""

# Cleanup function
cleanup() {
    echo ""
    echo "Stopping services..."
    kill $BACKEND_PID $FRONTEND_PID 2>/dev/null
    sleep 1
    kill -9 $BACKEND_PID $FRONTEND_PID $TAIL_BE_PID $TAIL_BE_ERR_PID $TAIL_FE_PID $TAIL_FE_ERR_PID 2>/dev/null
    exit 0
}

trap cleanup INT TERM

# Stream logs — use -n0 so tail only shows NEW lines, not replaying old content
tail -n0 -f logs/backend.log 2>/dev/null | sed -u 's/^/[BE] /' &
TAIL_BE_PID=$!
tail -n0 -f logs/backend-err.log 2>/dev/null | sed -u 's/^/[BE ERR] /' &
TAIL_BE_ERR_PID=$!
tail -n0 -f logs/frontend.log 2>/dev/null | sed -u 's/^/[FE] /' &
TAIL_FE_PID=$!
tail -n0 -f logs/frontend-err.log 2>/dev/null | sed -u 's/^/[FE ERR] /' &
TAIL_FE_ERR_PID=$!

wait
