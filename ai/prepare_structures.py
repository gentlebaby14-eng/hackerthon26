"""원본·벽·문·창문 정답 예시와 문/창문 겹침 보고서를 만든다."""

import argparse
import json
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

from data import CLASS_NAMES, read_split, structure_mask

COLORS = np.array([[247, 244, 238], [91, 112, 75], [38, 106, 154], [183, 130, 45]], dtype=np.uint8)


def colorize(mask):
    return Image.fromarray(COLORS[np.asarray(mask, dtype=np.uint8)])


def save_example(folder, out, source):
    out.mkdir(parents=True, exist_ok=True)
    with Image.open(folder / 'F1_scaled.png') as handle:
        image = handle.convert('RGB')
    mask, stats = structure_mask(folder / 'model.svg', image.size, return_stats=True)
    image.save(out / 'floorplan.png'); mask.save(out / 'labels.png'); colorize(mask).save(out / 'labels-color.png')
    preview_width = 720
    preview_height = round(image.height * preview_width / image.width)
    image_small = image.resize((preview_width, preview_height), Image.Resampling.BILINEAR)
    # 라벨 번호가 섞이지 않도록 반드시 최근접 보간한다.
    mask_small = mask.resize((preview_width, preview_height), Image.Resampling.NEAREST)
    board = Image.new('RGB', (preview_width * 2 + 24, preview_height + 50), '#f5f1e8')
    board.paste(image_small, (0, 50)); board.paste(colorize(mask_small), (preview_width + 24, 50))
    draw = ImageDraw.Draw(board)
    draw.text((12, 16), 'CubiCasa5K floor plan', fill='#222')
    draw.text((preview_width + 36, 16), 'Wall · Door · Window ground truth', fill='#222')
    board.save(out / 'side-by-side.png')
    metadata = {'source': source, 'image_size': list(image.size), 'classes': dict(enumerate(CLASS_NAMES)), **stats}
    (out / 'source.json').write_text(json.dumps(metadata, ensure_ascii=False, indent=2), encoding='utf-8')
    return metadata


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--data-root', required=True)
    parser.add_argument('--split', choices=['train', 'val', 'test'], default='train')
    parser.add_argument('--index', type=int, default=0)
    parser.add_argument('--out', default='ai/examples/structures-first-pair')
    parser.add_argument('--overlap-report', default='ai/examples/door-window-overlaps.json')
    args = parser.parse_args()
    folders = read_split(args.data_root, args.split)
    selected = folders[args.index]
    example = save_example(selected, Path(args.out), f'{args.split}:{selected}')
    overlaps = []
    for split in ('train', 'val', 'test'):
        for index, folder in enumerate(read_split(args.data_root, split)):
            with Image.open(folder / 'F1_scaled.png') as handle:
                _, stats = structure_mask(folder / 'model.svg', handle.size, return_stats=True)
            if stats['door_window_overlap_pixels']:
                overlaps.append({'split': split, 'index': index, 'folder': str(folder), **stats})
    report = {'overlap_cases': len(overlaps), 'examples': overlaps[:20]}
    Path(args.overlap_report).parent.mkdir(parents=True, exist_ok=True)
    Path(args.overlap_report).write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps({'example': example, 'overlaps': report}, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
