"""CubiCasa5K 공식 분할로 벽·문·창문 4-class U-Net을 학습한다."""

import argparse
import json
import random
from pathlib import Path

import numpy as np
import torch
from torch import nn
from torch.utils.data import DataLoader

from data import CLASS_NAMES, structure_dataset
from model import UNet


def loss_fn(logits, target):
    # 작은 문/창문 클래스가 배경에 묻히지 않도록 가중치를 준다.
    weights = torch.tensor([0.15, 1.0, 4.0, 4.0], device=logits.device)
    ce = nn.functional.cross_entropy(logits, target, weight=weights)
    probability = logits.softmax(1)
    one_hot = nn.functional.one_hot(target, len(CLASS_NAMES)).permute(0, 3, 1, 2).float()
    intersection = (probability[:, 1:] * one_hot[:, 1:]).sum((0, 2, 3))
    denominator = probability[:, 1:].sum((0, 2, 3)) + one_hot[:, 1:].sum((0, 2, 3))
    dice_loss = 1 - ((2 * intersection + 1) / (denominator + 1)).mean()
    return ce + dice_loss


def metric_state():
    return {name: {'intersection': 0, 'union': 0, 'predicted': 0, 'actual': 0} for name in CLASS_NAMES[1:]}


def update_metrics(state, predicted, target):
    for label, name in enumerate(CLASS_NAMES[1:], 1):
        p, a = predicted == label, target == label
        state[name]['intersection'] += (p & a).sum().item()
        state[name]['union'] += (p | a).sum().item()
        state[name]['predicted'] += p.sum().item()
        state[name]['actual'] += a.sum().item()


def finish_metrics(state):
    result = {}
    for name, counts in state.items():
        union = counts['union']
        denominator = counts['predicted'] + counts['actual']
        result[name] = {'iou': counts['intersection'] / union if union else None,
                        'dice': 2 * counts['intersection'] / denominator if denominator else None,
                        **counts}
    present = [v['iou'] for v in result.values() if v['iou'] is not None]
    result['macro_iou'] = sum(present) / len(present) if present else 0
    return result


@torch.no_grad()
def validate(model, loader, device):
    model.eval(); total = 0.0; state = metric_state()
    for image, target in loader:
        image, target = image.to(device), target.to(device)
        logits = model(image)
        total += loss_fn(logits, target).item() * image.size(0)
        update_metrics(state, logits.argmax(1), target)
    return {'loss': total / len(loader.dataset), **finish_metrics(state)}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--data-root', required=True)
    parser.add_argument('--out', default='ai/checkpoints/walls-doors-windows.pt')
    parser.add_argument('--epochs', type=int, default=30)
    parser.add_argument('--batch-size', type=int, default=4)
    parser.add_argument('--size', type=int, default=512)
    parser.add_argument('--base-channels', type=int, default=16)
    parser.add_argument('--learning-rate', type=float, default=1e-3)
    parser.add_argument('--limit', type=int, default=None, help='코드 확인 전용; 발표 모델로 사용 금지')
    parser.add_argument('--seed', type=int, default=42)
    args = parser.parse_args()
    if args.size < 32 or args.size % 16 or args.epochs < 1:
        parser.error('size는 16의 배수이자 32 이상이어야 합니다')
    random.seed(args.seed); np.random.seed(args.seed); torch.manual_seed(args.seed)
    train_set = structure_dataset(args.data_root, 'train', args.size, args.limit, True)
    val_set = structure_dataset(args.data_root, 'val', args.size, args.limit)
    if not len(train_set) or not len(val_set):
        parser.error('공식 train/val 데이터가 비어 있습니다')
    train_loader = DataLoader(train_set, args.batch_size, shuffle=True, num_workers=0)
    val_loader = DataLoader(val_set, args.batch_size, shuffle=False, num_workers=0)
    device = torch.device('cuda' if torch.cuda.is_available() else
                          'mps' if torch.backends.mps.is_available() else 'cpu')
    model = UNet(args.base_channels, out_channels=len(CLASS_NAMES)).to(device)
    optimizer = torch.optim.AdamW(model.parameters(), lr=args.learning_rate)
    output = Path(args.out); output.parent.mkdir(parents=True, exist_ok=True)
    best = -1.0
    dataset_name = ('CubiCasa5K mini official split' if 'mini' in Path(args.data_root).name.lower()
                    else 'CubiCasa5K official train/val')
    print(f'device={device}, train={len(train_set)}, val={len(val_set)}', flush=True)
    for epoch in range(1, args.epochs + 1):
        model.train(); train_loss = 0.0
        for image, target in train_loader:
            image, target = image.to(device), target.to(device)
            optimizer.zero_grad(set_to_none=True)
            loss = loss_fn(model(image), target); loss.backward(); optimizer.step()
            train_loss += loss.item() * image.size(0)
        metrics = validate(model, val_loader, device)
        report = {'epoch': epoch, 'train_loss': train_loss / len(train_set), 'val': metrics}
        print(json.dumps(report, ensure_ascii=False), flush=True)
        if metrics['macro_iou'] > best:
            best = metrics['macro_iou']
            checkpoint = {'model': model.state_dict(), 'base_channels': args.base_channels,
                'out_channels': len(CLASS_NAMES), 'classes': list(CLASS_NAMES), 'size': args.size,
                'preprocessing': {'color': 'RGB', 'scale': '0..1', 'resize': 'bilinear'},
                'epoch': epoch, 'val_metrics': metrics, 'seed': args.seed,
                'dataset': dataset_name, 'train_samples': len(train_set), 'val_samples': len(val_set),
                'limited': args.limit is not None}
            torch.save(checkpoint, output)
            output.with_suffix('.json').write_text(json.dumps({k: v for k, v in checkpoint.items() if k != 'model'}, ensure_ascii=False, indent=2), encoding='utf-8')
    print(f'best_val_macro_iou={best:.4f}; checkpoint={output}', flush=True)


if __name__ == '__main__':
    main()
