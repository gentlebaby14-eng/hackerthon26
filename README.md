# Roommate · AI 인테리어 동선 앱

프로젝트는 요청한 대로 세 폴더로 나뉩니다.

| 폴더 | 내용 |
| --- | --- |
| [`frontend/`](frontend/) | 기존 가구 배치 화면과 새 도면 벽·동선 비교 화면 |
| [`backend/`](backend/) | Node.js API, 정해진 답변 챗봇, 벽 기반 경로 계산 |
| [`ai/`](ai/) | CubiCasa5K 벽 정답 추출, U-Net 학습·평가·추론 코드와 예시 한 쌍 |

## 화면 실행

Node.js 20 이상에서 `backend/start-backend.bat`을 더블 클릭하거나 다음을 실행합니다.

```powershell
cd backend
npm start
```

브라우저에서 `http://127.0.0.1:3000`을 열고 **내 도면 분석**을 누르세요. `공식 정답 마스크로 체험`은 실제 CubiCasa5K 주석으로 경로 기능을 확인합니다. 업로드한 도면을 U-Net으로 분석하려면 [학습 절차](ai/README.md)에 따라 가중치를 만들어야 합니다. 학습 가중치와 5.5GB 원본 데이터는 저장소에 포함하지 않았습니다.

기존 프론트의 55→72cm 시연은 고정 예시로 유지됩니다. 새 화면의 경로는 벽 마스크와 사용자 입력 치수·가구 위치를 사용해 계산합니다. API 설명은 [backend/README.md](backend/README.md)에 있습니다.
