"""공식 test 분할에서 클래스별 IoU/Dice를 계산하고 실패 예시를 저장한다."""

import argparse
import json
from pathlib import Path

import numpy as np
import torch
from PIL import Image, ImageDraw
from torch.utils.data import DataLoader

from data import CLASS_NAMES, load_structure_pair, read_split, structure_dataset
from model import UNet
from train_structures import validate

COLORS = np.array([[245, 242, 235], [91, 112, 75], [38, 106, 154], [183, 130, 45]], dtype=np.uint8)


def color_mask(mask):
    return Image.fromarray(COLORS[np.asarray(mask, dtype=np.uint8)])


@torch.no_grad()
def predict(model, image):
    x = torch.from_numpy(np.asarray(image, dtype=np.float32).copy()).permute(2, 0, 1)[None] / 255
    return model(x).argmax(1)[0].byte().numpy()


def sample_score(predicted, actual):
    scores = []
    for label in range(1, 4):
        p, a = predicted == label, actual == label
        union = np.logical_or(p, a).sum()
        if union:
            scores.append(np.logical_and(p, a).sum() / union)
    return sum(scores) / len(scores) if scores else 1.0


def comparison(image, truth, predicted, path, caption):
    width, height = image.size
    board = Image.new('RGB', (width * 3 + 24, height + 42), '#f5f1e8')
    board.paste(image, (0, 42)); board.paste(color_mask(truth), (width + 12, 42)); board.paste(color_mask(predicted), (width * 2 + 24, 42))
    draw = ImageDraw.Draw(board)
    draw.text((8, 13), 'ORIGINAL', fill='#222'); draw.text((width + 20, 13), 'GROUND TRUTH', fill='#222')
    draw.text((width * 2 + 32, 13), f'PREDICTION · {caption}', fill='#222')
    board.save(path)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--data-root', required=True)
    parser.add_argument('--checkpoint', default='ai/checkpoints/walls-doors-windows.pt')
    parser.add_argument('--batch-size', type=int, default=4)
    parser.add_argument('--examples-out', default='ai/examples/structure-evaluation')
    parser.add_argument('--report', default='ai/checkpoints/walls-doors-windows-evaluation.json')
    parser.add_argument('--example-count', type=int, default=6)
    args = parser.parse_args()
    checkpoint = torch.load(args.checkpoint, map_location='cpu', weights_only=True)
    if checkpoint.get('classes') != list(CLASS_NAMES) or checkpoint.get('limited'):
        raise RuntimeError('정식 4-class 체크포인트가 아닙니다')
    model = UNet(checkpoint['base_channels'], checkpoint['out_channels'])
    model.load_state_dict(checkpoint['model']); model.eval()
    dataset = structure_dataset(args.data_root, 'test', checkpoint['size'])
    metrics = validate(model, DataLoader(dataset, args.batch_size, shuffle=False, num_workers=0), 'cpu')
    dataset_name = ('CubiCasa5K mini official test' if 'mini' in Path(args.data_root).name.lower()
                    else 'CubiCasa5K official test')
    report = {'checkpoint_epoch': checkpoint['epoch'], 'test_samples': len(dataset),
              'dataset': dataset_name, 'metrics': metrics}
    Path(args.report).parent.mkdir(parents=True, exist_ok=True)
    Path(args.report).write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')

    folders = read_split(args.data_root, 'test')
    ranked = []
    for index, folder in enumerate(folders):
        image, truth = load_structure_pair(folder, checkpoint['size'])
        predicted = predict(model, image)
        ranked.append((sample_score(predicted, np.asarray(truth)), index, image, truth, predicted))
    out = Path(args.examples_out); out.mkdir(parents=True, exist_ok=True)
    manifest = []
    for rank, (score, index, image, truth, predicted) in enumerate(sorted(ranked, key=lambda item: item[0])[:args.example_count], 1):
        filename = f'missed-{rank:02d}-test-{index}.png'
        comparison(image, truth, predicted, out / filename, f'macro IoU {score:.3f}')
        manifest.append({'file': filename, 'test_index': index, 'sample_macro_iou': score, 'folder': str(folders[index])})
    (out / 'manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
