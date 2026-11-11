"""공식 도면 1장과 벽 정답 1장을 나란히 저장한다."""

import argparse
import json
from pathlib import Path

from PIL import Image, ImageDraw

from data import read_split, wall_mask


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--data-root', help='공식 cubicasa5k/ 폴더')
    parser.add_argument('--folder', help='F1_scaled.png, model.svg가 있는 단일 폴더')
    parser.add_argument('--split', choices=['train', 'val', 'test'], default='train')
    parser.add_argument('--index', type=int, default=0)
    parser.add_argument('--source-id', help='압축에서 꺼낸 원래 표본 경로')
    parser.add_argument('--out', default='ai/examples/first-pair')
    args = parser.parse_args()
    if bool(args.data_root) == bool(args.folder):
        parser.error('--data-root 또는 --folder 중 하나만 입력하세요')
    folder = Path(args.folder) if args.folder else read_split(args.data_root, args.split)[args.index]
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    with Image.open(folder / 'F1_scaled.png') as source:
        image = source.convert('RGB')
    mask = wall_mask(folder / 'model.svg', image.size)
    image.save(out / 'floorplan.png')
    mask.save(out / 'wall-mask.png')
    bounds = mask.getbbox()
    if bounds is None:
        raise ValueError('벽 마스크가 비어 있습니다')
    margin = max(40, round(max(bounds[2] - bounds[0], bounds[3] - bounds[1]) * 0.08))
    crop = (max(0, bounds[0] - margin), max(0, bounds[1] - margin),
            min(image.width, bounds[2] + margin), min(image.height, bounds[3] + margin))
    image_crop = image.crop(crop)
    mask_crop = mask.crop(crop)
    preview_width = 720
    preview_height = round(image_crop.height * preview_width / image_crop.width)
    image_small = image_crop.resize((preview_width, preview_height), Image.Resampling.LANCZOS)
    mask_small = mask_crop.resize((preview_width, preview_height), Image.Resampling.NEAREST)
    image_small.save(out / 'floorplan-crop.png')
    mask_small.save(out / 'wall-mask-crop.png')
    grid = mask_small.resize((128, 128), Image.Resampling.BILINEAR)
    values = list(grid.getdata())
    rows = [''.join('1' if values[y * 128 + x] >= 128 else '0' for x in range(128)) for y in range(128)]
    (out / 'wall-mask-grid.json').write_text(json.dumps(rows), encoding='utf-8')
    preview = Image.new('RGB', (preview_width * 2 + 24, preview_height + 48), '#f5f1e8')
    preview.paste(image_small, (0, 48))
    preview.paste(mask_small.convert('RGB'), (preview_width + 24, 48))
    draw = ImageDraw.Draw(preview)
    draw.text((12, 16), 'CubiCasa5K floor plan', fill='#222222')
    draw.text((preview_width + 36, 16), 'Wall ground truth (white)', fill='#222222')
    preview.save(out / 'side-by-side.png')
    metadata = {'source': 'CubiCasa5K', 'source_url': 'https://zenodo.org/records/2613548',
                'license': 'CC BY-NC 4.0', 'folder': args.source_id or str(folder), 'split': args.split,
                'image_size': list(image.size), 'preview_crop': list(crop),
                'wall_pixels': sum(1 for pixel in mask.getdata() if pixel)}
    (out / 'source.json').write_text(json.dumps(metadata, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps(metadata, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
