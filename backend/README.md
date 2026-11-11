# Roommate 시연 백엔드

`프론트 3`인 `roommate-redesign (5).html`의 상품, 평면도, 동선 비교, 상담 문구에 맞춘 **의존성 없는 Node.js 20+ API**입니다. 외부 AI·쇼핑·지도 API는 호출하지 않습니다. 프론트 파일은 현재 자체 시연 데이터로 작동하며, 이 백엔드는 프론트를 연결할 때 사용할 API를 제공합니다.

## 실행

```powershell
cd backend
npm start
```

기본 주소는 `http://127.0.0.1:3000`입니다. `PORT` 환경 변수로 포트를 바꿀 수 있습니다. `npm test`로 API 테스트를 실행합니다. npm 패키지 설치는 필요하지 않습니다.
Windows에서는 `start-backend.bat`을 더블 클릭해도 됩니다.

## API

| 요청 | 용도 |
| --- | --- |
| `GET /api/v1/health` | 상태 확인 |
| `GET /api/v1/demo` | 기본 입력값, 상품, 평면도와 좌표 |
| `GET /api/v1/products?kind=수납장&style=원목&budget=20&maxWidth=80` | 예산(만원)과 최대 폭(cm)으로 상품 검색 |
| `GET /api/v1/products/oak` | 상품 상세 |
| `POST /api/v1/simulations` | 현재·추천 배치의 경로, 위험 구간, 최소 통로 폭 비교 |
| `POST /api/v1/chat` | 키워드별 고정 상담 답변 |

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

시연 조건 밖의 방 크기·가구·배치·생활 패턴은 `422 DEMO_ONLY`와 `resetDemo`를 반환합니다. 현재 55cm·72cm와 경로는 실제 공간 분석값이 아니라 프론트 3의 고정 시연 값입니다. 주소 크롤링, 사진 분석, 실제 상품 검색, 실제 경로 계산, 3D 시뮬레이션, 사용자 데이터 저장은 아직 구현 범위에 없습니다.

로컬 웹앱을 `file://`로 열어도 API 호출이 가능하도록 CORS를 허용합니다. 배포 단계에서는 허용 출처를 제한해야 합니다.
