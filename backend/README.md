# RoomAI 시연 백엔드

기존 상품 검색·고정 답변 챗봇·시연 배치 API와 새 **도면 벽 추론·경로 비교 API**를 제공하는 Node.js 20+ 서버입니다. 화면은 `frontend/`에 있습니다. 외부 GPT·쇼핑·지도 API는 호출하지 않습니다.

## 실행

```powershell
cd backend
npm start
```

기본 주소는 `http://127.0.0.1:3000`입니다. `PORT` 환경 변수로 포트를 바꿀 수 있습니다. `npm test`로 API 테스트를 실행합니다. npm 패키지 설치는 필요하지 않습니다.
Windows에서는 `start-backend.bat`을 더블 클릭해도 됩니다.
상품 추천의 Gemini 호출은 잠시 중지했습니다. API 키가 설정되어 있어도 호출하지 않습니다. `.env`는 Git에서 제외됩니다.
브라우저에서 `http://127.0.0.1:3000`을 열면 기존 앱, `http://127.0.0.1:3000/floorplan.html`을 열면 새 도면 화면이 나옵니다.

## API

| 요청 | 용도 |
| --- | --- |
| `GET /api/v1/health` | 상태 확인 |
| `GET /api/v1/demo` | 기본 입력값, 상품, 평면도와 좌표 |
| `GET /api/v1/products?kind=수납장&style=원목&budget=20&maxWidth=80` | 예산(만원)과 최대 폭(cm)으로 상품 검색 |
| `POST /api/v1/products/recommend` | 일시 중단: `503 PRODUCT_API_PAUSED` 반환, 외부 호출 없음 |
| `GET /api/v1/products/oak` | 상품 상세 |
| `POST /api/v1/simulations` | 현재·추천 배치의 경로, 위험 구간, 최소 통로 폭 비교 |
| `POST /api/v1/chat` | 키워드별 고정 상담 답변 |
| `GET /api/v1/model/status` | 벽·문·창문 4-class U-Net 가중치·클래스 호환 상태 |
| `GET /api/v1/walls/status` | 벽 전용 U-Net 가중치 상태 |
| `GET /api/v1/furniture/status` | YOLO-World 가중치 포함 여부 확인 |
| `POST /api/v1/walls/analyze` | 업로드 도면의 벽/벽 아님 마스크 추론 |
| `POST /api/v1/floorplans/analyze` | `{"image":"data:image/png;base64,..."}`를 U-Net으로 벽·문·창문 분할 |
| `POST /api/v1/routes/compare` | 벽 마스크와 현관·목적지·가구 전후 위치로 경로 비교 |

시뮬레이션 요청 예시:

```json
{
  "state": {
    "product": "oak", "position": 0, "rotated": false,
    "width": "360", "height": "270", "passage": "65",
    "routine": "내가 책상에서 공부하는 동안 룸메가 건조대를 펼친 채 현관에서 옷장으로 가요.",
    "applied": false
  }
}
```

`POST /api/v1/chat`은 `{"message":"추천 배치 보여줘","state":{...}}` 형식입니다. `state`에서 빠진 필드는 시연 기본값으로 채웁니다. 응답의 `demo: true`와 `label: "시연용 데이터"`를 화면에 표시하세요. 시뮬레이션의 `room.variants.before/after`에는 프론트 캔버스 기준 좌표가 있고, `currentResult`에는 현재 배치 결과가 있습니다. `recommendedState`를 적용하면 다시 실행할 때 72cm 결과가 나옵니다.

새 경로 API는 U-Net 출력의 128×128 `mask`(각 행이 `0`/`1` 문자열), `start`/`end` 좌표(이미지 크기에 대한 0~1 비율), `roomWidthCm`/`roomHeightCm`/`passageCm`, `furniture: {widthCm, depthCm, before:[x,y], after:[x,y]}`를 받습니다. 벽과 가구를 장애물로 놓고 필요한 통로 폭의 절반만큼 여유를 두어 경로를 탐색합니다. 결과의 `before`/`after`에 이동 가능 여부, 경로 좌표, 이동 거리, 대략적인 최소 통로 폭을 담습니다. 선택한 가구 한 개의 전후 배치를 비교합니다.

`layoutItems` 배열을 추가로 보내면 각 항목의 `box: {x,y,width,height}`를 두 배치 모두의 고정 장애물로 반영합니다. 경로 탐색은 격자 A*입니다. 생활 동선 화면은 같은 시드로 가구 주변의 접근 가능한 지점을 여러 번 방문하고, 실제 경로의 방문 횟수로 히트맵을 계산합니다.

## GitHub에서 내려받은 뒤 YOLO 실행

5GB 학습 데이터는 런타임에 필요하지 않습니다. 추론용 `yolov8s-world.pt`(약 26MB)는 이 저장소에 포함되어 있습니다. Python 가상환경은 각 컴퓨터에서 만들어야 하며 Git에 포함하지 않습니다. 저장소 루트에서 다음을 실행하세요. Python 3.10 이상과 Git이 필요합니다.

macOS/Linux:

```sh
python3 -m venv ai/.venv
ai/.venv/bin/python -m pip install -r ai/requirements.txt
cd backend && npm start
```

Windows PowerShell:

```powershell
py -3 -m venv ai/.venv
ai/.venv/Scripts/python.exe -m pip install -r ai/requirements.txt
cd backend
npm start
```

`ai/requirements.txt`에 YOLO-World가 사용하는 Ultralytics CLIP도 포함했습니다. 최초 가구 인식 시 CLIP 텍스트 인코더 가중치를 내려받아야 하므로 인터넷 연결이 필요할 수 있습니다. `GET /api/v1/furniture/status`로 저장소의 YOLO 파일 유무를 확인할 수 있고, Python 패키지 누락 시 API가 설치 명령을 안내합니다. 서버를 켠 상태에서 방 사진을 올려야 인식 결과가 나옵니다.

U-Net 가중치는 `ai/checkpoints/walls-doors-windows.pt`에 있어야 합니다. 같은 이름의 JSON 모델 카드에
`background, wall, door, window` 네 클래스와 출력 채널 4개가 확인되어야 준비 완료가 됩니다. 기존 `walls.pt`는 거절합니다.
별도 가상환경을 쓴다면 서버 시작 전 `PYTHON` 환경 변수에 Python 실행 파일을 지정하세요. 가중치가 없으면
분석 API는 `503 MODEL_NOT_READY`를 반환합니다. 공식 벽 정답 마스크 화면 체험은 학습 없이 가능하며 AI 예측으로 표시하지 않습니다.

RoomAI 배치 화면은 별도의 벽 전용 `ai/checkpoints/walls.pt`와 `walls.json`을 사용합니다. Windows에서 `ai/.venv`에 Python 환경을 만든 경우 서버가 이를 자동으로 사용합니다. 필요한 패키지는 `ai/requirements.txt`를 참고하세요. 벽 추론과 경로 계산은 서버 실행 중에만 동작하며, 모델은 합성 도면 학습본이므로 실제 아파트 도면에 적용할 때 결과를 눈으로 확인해야 합니다.

프론트엔드는 상품 추천 API를 호출하지 않고 `frontend/index.html`의 고정 상품 9개와 `frontend/assets/products/`의 사진을 보여줍니다. 판매처 이름과 표시 가격은 2026-11-11 확인한 값입니다. 가로·세로는 배치 시연용 예시 값입니다. 기존 Gemini 추천 구현과 프롬프트는 재개를 위해 코드에 보관했지만 서버 경로에서 호출하지 않습니다.

기존 55cm·72cm 시연 API는 그대로 유지하며 실제 경로 계산 결과와 혼동하지 않도록 `demo: true`를 반환합니다. 주소 크롤링, 3D 시뮬레이션, 사용자 데이터 저장은 아직 구현하지 않았습니다.

로컬 웹앱을 `file://`로 열어도 API 호출이 가능하도록 CORS를 허용합니다. 배포 단계에서는 허용 출처를 제한해야 합니다.
