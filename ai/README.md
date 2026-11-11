# 벽 분할 U-Net

평면도 RGB 이미지를 픽셀별 `벽/벽 아님`으로 분할하는 U-Net 학습 코드입니다. 공식 [CubiCasa5K](https://github.com/CubiCasa/CubiCasa5k)의 `F1_scaled.png`와 `model.svg`를 사용합니다. `Wall` 다각형을 벽으로 채우고 `Door` 다각형은 통과 가능하게 뺍니다. `Window`는 이동할 수 없는 고정 경계로 남깁니다. 원본 SVG와 이미지의 픽셀 좌표를 맞춘 마스크를 만듭니다.

## 먼저 도면·정답 한 쌍 보기

[`examples/first-pair/side-by-side.png`](examples/first-pair/side-by-side.png)는 공식 **train 분할의 `high_quality_architectural/6044`** 한 장입니다. 왼쪽은 도면, 오른쪽 흰색은 SVG에서 추출한 벽입니다. 같은 폴더의 `floorplan.png`와 `wall-mask.png`는 원본 크기 쌍이며, `*-crop.png`와 `wall-mask-grid.json`은 화면 체험용입니다. 이 이미지는 **AI 예측 결과가 아니라 정답 주석**입니다.

새 쌍을 만들려면 [Zenodo 원본 데이터](https://zenodo.org/records/2613548)의 5.5GB ZIP을 다운로드해 압축을 풀고 다음을 실행합니다.

```powershell
python ai/prepare_pair.py --data-root ai/data/cubicasa5k --split train --index 0 --out ai/examples/my-pair
```

원본 데이터와 여기 포함한 예시는 [**CC BY-NC 4.0**](https://creativecommons.org/licenses/by-nc/4.0/)입니다. 출처를 표시해야 하고 상업적 이용에는 별도 권리가 필요합니다. 데이터 전체와 학습 가중치는 Git에 넣지 않습니다.

## 학습 및 평가

현재 데모 체크포인트는 저작권 문제 없이 재현 가능한 합성 평면도 300장으로 학습하고,
검증 80장과 학습에 한 번도 쓰지 않은 test 100장으로 분리 평가합니다. 벽 두께·방 수·문 위치·가구 기호·노이즈를 seed마다 바꿉니다.

```bash
ai/.venv/bin/python ai/train.py --synthetic-samples 300 --epochs 10 --size 128 --base-channels 4 --batch-size 8 --out ai/checkpoints/walls.pt
ai/.venv/bin/python ai/evaluate.py --checkpoint ai/checkpoints/walls.pt --synthetic-test --batch-size 8 --out ai/checkpoints/evaluation.json
```

2026-11-11 생성 체크포인트의 결과는 validation IoU 0.9853 / Dice 0.9926,
미사용 test IoU 0.9863 / Dice 0.9931입니다. 이는 합성 분포 안에서의 성능이며 실제 아파트 도면 성능으로 과장해서는 안 됩니다.
화면에는 업로드·정규화 → U-Net 추론 → 벽 마스크 → 동선 탐색 순서와 실제 추론 수치가 표시됩니다.

Python 3.12와 PyTorch를 권장합니다. `python --version`으로 3.12인지 확인한 뒤 저장소 루트에서 실행합니다.

```powershell
python -m venv ai/.venv
.\ai\.venv\Scripts\python.exe -m pip install -r ai/requirements.txt
.\ai\.venv\Scripts\python.exe ai/train.py --data-root ai/data/cubicasa5k --epochs 30 --out ai/checkpoints/walls.pt
.\ai\.venv\Scripts\python.exe ai/evaluate.py --data-root ai/data/cubicasa5k --checkpoint ai/checkpoints/walls.pt
```

학습은 공식 `train.txt`, 모델 선택은 `val.txt`, 마지막 평가는 **학습에 쓰지 않은** `test.txt`로 합니다. 각 epoch에 validation IoU·Dice를 출력하고 최고 validation IoU 가중치를 저장합니다. `--limit`는 빠른 개발 확인용이며 그 가중치는 `infer.py`에서 실제 도면 분석에 쓰지 못하도록 막습니다.

한국 아파트 도면을 검증할 때는 도면 이미지와 사람이 표시한 벽 마스크를 같은 크기로 준비하세요. 이후:

```powershell
.\ai\.venv\Scripts\python.exe ai/evaluate.py --checkpoint ai/checkpoints/walls.pt --image apartment.png --mask apartment-wall-mask.png
```

`infer.py`는 백엔드에서 호출합니다. 학습된 가중치가 없으면 백엔드가 `MODEL_NOT_READY`를 반환하며 AI 분석을 했다고 표시하지 않습니다. 첫 버전은 벽만 예측합니다. 실제 치수, 현관·목적지, 가구 위치는 사람이 입력하고, 경로는 별도의 격자 탐색으로 계산합니다. 도어 주석을 사용한 학습 마스크라도 한국 도면의 문 표현은 다를 수 있어 결과를 육안으로 확인해야 합니다.
