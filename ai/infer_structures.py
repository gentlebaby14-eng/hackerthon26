"""벽·문·창문 U-Net 1회 추론. stdout은 JSON 한 줄이다."""

import argparse
import json
import time

import numpy as np
import torch
from PIL import Image
from torch.nn import functional as F

from data import CLASS_NAMES
from model import UNet


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--image', required=True)
    parser.add_argument('--checkpoint', required=True)
    parser.add_argument('--grid-size', type=int, default=128)
    args = parser.parse_args()
    checkpoint = torch.load(args.checkpoint, map_location='cpu', weights_only=True)
    if checkpoint.get('classes') != list(CLASS_NAMES) or checkpoint.get('out_channels') != 4:
        raise RuntimeError('벽·문·창문 4-class 체크포인트가 아닙니다')
    if checkpoint.get('limited'):
        raise RuntimeError('개발용 --limit 가중치는 발표 추론에 사용할 수 없습니다')
    model = UNet(checkpoint['base_channels'], checkpoint['out_channels'])
    model.load_state_dict(checkpoint['model']); model.eval()
    with Image.open(args.image) as source:
        image = source.convert('RGB').resize((checkpoint['size'], checkpoint['size']), Image.Resampling.BILINEAR)
    tensor = torch.from_numpy(np.asarray(image, dtype=np.float32).copy()).permute(2, 0, 1)[None] / 255
    started = time.perf_counter()
    with torch.no_grad():
        probability = model(tensor).softmax(1)
        labels = probability.argmax(1).float().unsqueeze(1)
        # 클래스 번호가 섞이지 않도록 최근접 보간한다.
        grid = F.interpolate(labels, (args.grid_size, args.grid_size), mode='nearest')[0, 0].byte().numpy()
    confidence = probability.max(1).values.mean().item()
    rows = [''.join(str(int(cell)) for cell in row) for row in grid]
    ratios = {name: float((grid == label).mean()) for label, name in enumerate(CLASS_NAMES)}
    print(json.dumps({'width': args.grid_size, 'height': args.grid_size, 'labels': rows,
        'classes': {str(i): name for i, name in enumerate(CLASS_NAMES)},
        'model': 'U-Net multi-class segmentation', 'checkpointEpoch': checkpoint['epoch'],
        'validation': checkpoint['val_metrics'], 'preprocessing': checkpoint['preprocessing'],
        'classRatios': ratios, 'meanConfidence': confidence,
        'inferenceMs': round((time.perf_counter() - started) * 1000, 1)}, ensure_ascii=False))


if __name__ == '__main__':
    main()
