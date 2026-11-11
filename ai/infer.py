"""Node 백엔드가 호출하는 1회 추론 CLI. stdout은 JSON 한 줄만 쓴다."""

import argparse
import json
import time

import numpy as np
import torch
from PIL import Image
from torch.nn import functional as F

from model import UNet


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--image', required=True)
    parser.add_argument('--checkpoint', required=True)
    parser.add_argument('--grid-size', type=int, default=128)
    args = parser.parse_args()
    checkpoint = torch.load(args.checkpoint, map_location='cpu', weights_only=True)
    if checkpoint.get('limited'):
        raise RuntimeError('개발용 --limit 가중치는 실제 도면 분석에 사용할 수 없습니다')
    model = UNet(checkpoint['base_channels'])
    model.load_state_dict(checkpoint['model'])
    model.eval()
    Image.MAX_IMAGE_PIXELS = 25_000_000
    with Image.open(args.image) as source:
        source.load()
        image = source.convert('RGB').resize((checkpoint['size'], checkpoint['size']), Image.Resampling.BILINEAR)
    tensor = torch.from_numpy(np.asarray(image, dtype=np.float32).copy()).permute(2, 0, 1)[None] / 255.0
    started = time.perf_counter()
    with torch.no_grad():
        probability = model(tensor).sigmoid()
        walls = (probability >= checkpoint['threshold']).float()
        # Max pool은 경로 계산용 격자에서 얇은 벽이 사라지는 일을 줄인다.
        grid = F.adaptive_max_pool2d(walls, (args.grid_size, args.grid_size))[0, 0].numpy().astype(bool)
    rows = [''.join('1' if cell else '0' for cell in row) for row in grid]
    confidence = torch.where(probability >= .5, probability, 1 - probability).mean().item()
    print(json.dumps({'width': args.grid_size, 'height': args.grid_size,
                      'mask': rows, 'threshold': checkpoint['threshold'],
                      'model': 'U-Net', 'trainedEpoch': checkpoint['epoch'],
                      'validationIoU': checkpoint['val_iou'],
                      'dataset': checkpoint.get('dataset', 'unknown'),
                      'architecture': checkpoint.get('architecture', 'U-Net'),
                      'trainSamples': checkpoint.get('train_samples'),
                      'valSamples': checkpoint.get('val_samples'),
                      'meanConfidence': confidence,
                      'wallRatio': walls.mean().item(),
                      'inferenceMs': round((time.perf_counter() - started) * 1000, 1)}, ensure_ascii=False))


if __name__ == '__main__':
    main()
