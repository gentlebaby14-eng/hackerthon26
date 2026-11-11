#!/bin/zsh
cd "$(dirname "$0")"
if ! command -v node >/dev/null 2>&1; then
  osascript -e 'display alert "RoommateAI를 실행하려면 Node.js가 필요합니다."'
  exit 1
fi
PORT=3000 node backend/server.js >/tmp/roommate-ai-server.log 2>&1 &
SERVER_PID=$!
sleep 2
open "http://127.0.0.1:3000/room-select.html"
echo "RoommateAI 서버가 실행 중입니다. 종료하려면 이 창에서 Ctrl+C를 누르세요."
wait "$SERVER_PID"
