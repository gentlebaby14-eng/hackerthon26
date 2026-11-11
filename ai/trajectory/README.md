# THÖR → GRU 동선 모델

`prepare_thor.py`가 THÖR TSV의 첫 사람 위치(X/Y)를 읽어 최근 10프레임 시퀀스와 9방향(정지 포함) 정답으로 변환합니다. `train_gru.py`는 이를 이용해 작은 GRU를 학습하고 `ai/checkpoints/child-trajectory-gru.pt`에 저장합니다.

현재 TSV는 성인 실내 동선이므로 아이의 나이·키·활동량을 학습했다고 주장하지 않습니다. 아이 시연에서는 이 모델을 기본 이동 방향 예측기로 사용하고, 이후 아동 데이터가 생기면 해당 특성을 입력으로 확장합니다.
