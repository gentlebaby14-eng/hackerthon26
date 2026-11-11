#!/bin/zsh
cd "$(dirname "$0")/.."
set -e
export PYTHONUNBUFFERED=1
export PYTORCH_ENABLE_MPS_FALLBACK=1
ai/.venv/bin/python ai/train_structures.py --data-root cubicasa5k --epochs 30 --size 256 --base-channels 16 --batch-size 4 --out ai/checkpoints/walls-doors-windows-full.pt
ai/.venv/bin/python ai/evaluate_structures.py --data-root cubicasa5k --checkpoint ai/checkpoints/walls-doors-windows-full.pt --batch-size 4 --report ai/checkpoints/walls-doors-windows-full-evaluation.json --examples-out ai/examples/full-structure-evaluation
