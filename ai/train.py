"""공식 train/val 분할로 U-Net을 학습한다. test는 evaluate.py에서만 사용한다."""

import argparse
import json
import random
from pathlib import Path

import numpy as np
import torch
from torch import nn
from torch.utils.data import DataLoader

from data import training_dataset
from model import UNet
from synthetic_data import SyntheticFloorplans


def loss_fn(logits, target):
    bce = nn.functional.binary_cross_entropy_with_logits(logits, target)
    prediction = logits.sigmoid()
    intersection = (prediction * target).sum(dim=(1, 2, 3))
    denominator = prediction.sum(dim=(1, 2, 3)) + target.sum(dim=(1, 2, 3))
    dice_loss = 1 - ((2 * intersection + 1) / (denominator + 1)).mean()
    return bce + dice_loss


@torch.no_grad()
def validate(model, loader, device, threshold):
    model.eval()
    loss_total = 0.0
    intersection = union = dice_denominator = 0.0
    for image, target in loader:
        image, target = image.to(device), target.to(device)
        logits = model(image)
        loss_total += loss_fn(logits, target).item() * image.size(0)
        predicted = (logits.sigmoid() >= threshold)
        actual = target > 0.5
        intersection += (predicted & actual).sum().item()
        union += (predicted | actual).sum().item()
        dice_denominator += predicted.sum().item() + actual.sum().item()
    return {
        'loss': loss_total / len(loader.dataset),
        'iou': intersection / union if union else 1.0,
        'dice': 2 * intersection / dice_denominator if dice_denominator else 1.0,
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--data-root', help='cubicasa5k/ 폴더')
    parser.add_argument('--synthetic-samples', type=int, help='재현 가능한 합성 평면도 train 개수')
    parser.add_argument('--out', default='ai/checkpoints/walls.pt')
    parser.add_argument('--epochs', type=int, default=30)
    parser.add_argument('--batch-size', type=int, default=4)
    parser.add_argument('--size', type=int, default=512)
    parser.add_argument('--base-channels', type=int, default=16)
    parser.add_argument('--learning-rate', type=float, default=1e-3)
    parser.add_argument('--limit', type=int, default=None, help='개발 중 빠른 실행용; 정식 평가에 사용 금지')
    parser.add_argument('--seed', type=int, default=42)
    args = parser.parse_args()
    if args.size < 32 or args.size % 16 or args.epochs < 1 or args.batch_size < 1:
        parser.error('size는 16의 배수이자 32 이상, epochs와 batch-size는 1 이상이어야 합니다')
    random.seed(args.seed)
    np.random.seed(args.seed)
    torch.manual_seed(args.seed)
    if bool(args.data_root) == bool(args.synthetic_samples):
        parser.error('--data-root 또는 --synthetic-samples 중 하나만 지정하세요')
    if args.synthetic_samples:
        if args.synthetic_samples < 100:
            parser.error('--synthetic-samples는 100 이상이어야 합니다')
        train_set = SyntheticFloorplans('train', args.size, args.synthetic_samples, args.seed, True)
        val_set = SyntheticFloorplans('val', args.size, args.synthetic_samples, args.seed)
        dataset_name = f'SyntheticFloorplans-v1 ({args.synthetic_samples} train)'
    else:
        train_set = training_dataset(args.data_root, 'train', args.size, args.limit, augment=True)
        val_set = training_dataset(args.data_root, 'val', args.size, args.limit)
        dataset_name = 'CubiCasa5K official train/val'
    if not len(train_set) or not len(val_set):
        parser.error('train/val 데이터가 비어 있습니다')
    train_loader = DataLoader(train_set, batch_size=args.batch_size, shuffle=True, num_workers=0)
    val_loader = DataLoader(val_set, batch_size=args.batch_size, shuffle=False, num_workers=0)
    device = torch.device('cuda' if torch.cuda.is_available() else 'cpu')
    model = UNet(args.base_channels).to(device)
    optimizer = torch.optim.AdamW(model.parameters(), lr=args.learning_rate)
    best_iou = -1.0
    output = Path(args.out)
    output.parent.mkdir(parents=True, exist_ok=True)
    print(f'device={device}, train={len(train_set)}, val={len(val_set)}', flush=True)
    for epoch in range(1, args.epochs + 1):
        model.train()
        train_loss = 0.0
        for image, target in train_loader:
            image, target = image.to(device), target.to(device)
            optimizer.zero_grad(set_to_none=True)
            loss = loss_fn(model(image), target)
            loss.backward()
            optimizer.step()
            train_loss += loss.item() * image.size(0)
        metrics = validate(model, val_loader, device, 0.5)
        print(json.dumps({'epoch': epoch, 'train_loss': train_loss / len(train_set), 'val': metrics}, ensure_ascii=False), flush=True)
        if metrics['iou'] > best_iou:
            best_iou = metrics['iou']
            model_card = {
                'model': 'U-Net', 'architecture': 'U-Net binary segmentation',
                'dataset': dataset_name, 'epoch': epoch, 'validation': metrics,
                'train_samples': len(train_set), 'val_samples': len(val_set),
                'input_size': args.size, 'seed': args.seed,
            }
            torch.save({
                'model': model.state_dict(), 'base_channels': args.base_channels,
                'size': args.size, 'threshold': 0.5, 'epoch': epoch,
                'val_iou': best_iou, 'seed': args.seed,
                'dataset': dataset_name, 'limited': args.limit is not None,
                'architecture': 'U-Net binary segmentation',
                'train_samples': len(train_set), 'val_samples': len(val_set),
            }, output)
            output.with_suffix('.json').write_text(json.dumps(model_card, ensure_ascii=False, indent=2), encoding='utf-8')
    print(f'best_val_iou={best_iou:.4f}; checkpoint={output}', flush=True)


if __name__ == '__main__':
    main()
