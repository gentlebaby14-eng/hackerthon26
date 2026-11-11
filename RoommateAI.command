#!/bin/zsh
cd "$(dirname "$0")"
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
if ! command -v node >/dev/null 2>&1; then
  osascript -e 'display alert "RoommateAI를 실행하려면 Node.js가 필요합니다."'
  exit 1
fi
# An old server may still occupy 3000; only reuse the current room-selection API.
for APP_PORT in {3000..3010}; do
  HEALTH=$(curl --max-time 1 -fsS "http://127.0.0.1:$APP_PORT/api/v1/health" 2>/dev/null)
  if [[ "$HEALTH" == *'room-selection-v2'* ]]; then break; fi
  if lsof -nP -iTCP:$APP_PORT -sTCP:LISTEN >/dev/null 2>&1; then continue; fi
  PORT=$APP_PORT nohup node backend/server.js >/tmp/roommate-ai-server.log 2>&1 &
  disown
  for i in {1..40}; do
    HEALTH=$(curl --max-time 1 -fsS "http://127.0.0.1:$APP_PORT/api/v1/health" 2>/dev/null)
    [[ "$HEALTH" == *'room-selection-v2'* ]] && break
    sleep .25
  done
  [[ "$HEALTH" == *'room-selection-v2'* ]] && break
done
if [[ "$HEALTH" != *'room-selection-v2'* ]]; then
  echo "서버 실행 실패. /tmp/roommate-ai-server.log 를 확인하세요."
  read '?Enter를 누르면 종료합니다.'
  exit 1
fi
open "http://127.0.0.1:$APP_PORT/index.html"
