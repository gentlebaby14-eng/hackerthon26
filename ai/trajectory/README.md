# THÖR → GRU 동선 모델

`prepare_thor.py`가 THÖR TSV의 첫 사람 위치(X/Y)를 읽어 최근 10프레임 시퀀스와 9방향(정지 포함) 정답으로 변환합니다. `train_gru.py`는 이를 이용해 작은 GRU를 학습하고 `ai/checkpoints/child-trajectory-gru.pt`에 저장합니다.

현재 TSV는 성인 실내 동선이므로 아이의 나이·키·활동량을 학습했다고 주장하지 않습니다. 아이 시연에서는 이 모델을 기본 이동 방향 예측기로 사용하고, 이후 아동 데이터가 생기면 해당 특성을 입력으로 확장합니다.

현재 체크포인트는 [THÖR 공식 기록](https://zenodo.org/records/3382145)의 `Exp_1_run_1.tsv`부터 `Exp_1_run_4.tsv`까지 4개를 사용했습니다. 각 파일의 MD5는 공식 배포 페이지와 대조했습니다. run 1·2는 학습, run 3은 검증, run 4는 시험에 사용합니다. 학습창과 API 추론 모두 최근 10개 위치의 가로·세로를 그 창의 최소·최대값으로 정규화합니다. 원본 TSV는 저장소에 넣지 않았습니다.

```powershell
python ai/trajectory/prepare_thor.py --data-dir work-tmp/thor --output work-tmp/child-trajectory.npz --max-windows 20000
python ai/trajectory/train_gru.py --data work-tmp/child-trajectory.npz --out ai/checkpoints/child-trajectory-gru.pt --epochs 12 --batch-size 256
python ai/trajectory/evaluate_gru.py --data work-tmp/child-trajectory.npz --checkpoint ai/checkpoints/child-trajectory-gru.pt
```

별도 기록인 run 4에서 다음 방향 정확도 96.96%, 최다 클래스만 고르는 기준선 47.62%였습니다. 연속 프레임의 방향은 높은 상관이 있어 이 수치는 새로운 집의 목표 지향 동선이나 아동 행동 성능을 뜻하지 않습니다. 모델 입력에 목적지와 장애물이 없으므로 A*가 통행 가능 여부를 판단하고 GRU의 이동은 예측 표현에만 사용합니다.
