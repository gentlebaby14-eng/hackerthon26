"""미사용 test 도면 또는 별도 한국 도면의 정답 마스크로 IoU/Dice를 계산한다."""

import argparse
import json
from pathlib import Path

import numpy as np
import torch
from PIL import Image
from torch.utils.data import DataLoader

from data import training_dataset
from model import UNet
from train import validate
from synthetic_data import SyntheticFloorplans


def load_checkpoint(path):
    checkpoint = torch.load(path, map_location='cpu', weights_only=True)
    model = UNet(checkpoint['base_channels'])
    model.load_state_dict(checkpoint['model'])
    model.eval()
    return model, checkpoint


@torch.no_grad()
def evaluate_pair(model, checkpoint, image_path, mask_path):
    size = checkpoint['size']
    with Image.open(image_path) as source:
        image = source.convert('RGB').resize((size, size), Image.Resampling.BILINEAR)
    with Image.open(mask_path) as source:
        mask = source.convert('L').resize((size, size), Image.Resampling.NEAREST)
    x = torch.from_numpy(np.asarray(image, dtype=np.float32).copy()).permute(2, 0, 1)[None] / 255
    actual = np.asarray(mask) >= 128
    predicted = (model(x).sigmoid()[0, 0].numpy() >= checkpoint['threshold'])
    intersection = np.logical_and(predicted, actual).sum()
    union = np.logical_or(predicted, actual).sum()
    denominator = predicted.sum() + actual.sum()
    return {'iou': float(intersection / union) if union else 1.0,
            'dice': float(2 * intersection / denominator) if denominator else 1.0}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--checkpoint', default='ai/checkpoints/walls.pt')
    parser.add_argument('--data-root', help='공식 cubicasa5k/ 폴더; test.txt 평가')
    parser.add_argument('--image', help='한국 도면 등 별도 이미지')
    parser.add_argument('--mask', help='해당 이미지의 수작업 정답 마스크')
    parser.add_argument('--batch-size', type=int, default=4)
    parser.add_argument('--synthetic-test', action='store_true', help='체크포인트와 분리된 합성 test 평가')
    parser.add_argument('--out', help='평가 결과 JSON 저장 경로')
    args = parser.parse_args()
    if bool(args.image) != bool(args.mask) or not (args.data_root or args.image or args.synthetic_test):
        parser.error('--data-root, --synthetic-test 또는 --image와 --mask를 함께 입력하세요')
    model, checkpoint = load_checkpoint(Path(args.checkpoint))
    results = {'checkpoint_epoch': checkpoint['epoch'], 'limited_training': checkpoint.get('limited', False)}
    if args.data_root:
        dataset = training_dataset(args.data_root, 'test', checkpoint['size'])
        loader = DataLoader(dataset, batch_size=args.batch_size, shuffle=False, num_workers=0)
        results['cubicasa_test'] = {'samples': len(dataset), **validate(model, loader, 'cpu', checkpoint['threshold'])}
    if args.image:
        results['external_pair'] = evaluate_pair(model, checkpoint, args.image, args.mask)
    if args.synthetic_test:
        samples = checkpoint.get('train_samples', 600)
        dataset = SyntheticFloorplans('test', checkpoint['size'], samples, checkpoint.get('seed', 42))
        loader = DataLoader(dataset, batch_size=args.batch_size, shuffle=False, num_workers=0)
        results['synthetic_test'] = {'samples': len(dataset), **validate(model, loader, 'cpu', checkpoint['threshold'])}
    rendered = json.dumps(results, ensure_ascii=False, indent=2)
    if args.out:
        Path(args.out).write_text(rendered, encoding='utf-8')
    print(rendered)


if __name__ == '__main__':
    main()
