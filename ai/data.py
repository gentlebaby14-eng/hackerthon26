"""CubiCasa5K SVG 주석에서 통행을 막는 벽의 이진 마스크를 만든다."""

from pathlib import Path
from xml.etree import ElementTree as ET

from PIL import Image, ImageDraw


def _local_name(element):
    return element.tag.rsplit('}', 1)[-1]


def _polygon_points(element):
    raw = element.attrib.get('points', '').replace(',', ' ').split()
    if len(raw) < 6 or len(raw) % 2:
        return []
    return [(float(raw[i]), float(raw[i + 1])) for i in range(0, len(raw), 2)]


def wall_mask(svg_path, image_size):
    """Wall 그룹의 직접 자식 polygon을 채우고 Door 영역을 통행 가능한 곳으로 뺀다.

    Window는 이동할 수 없으므로 벽 마스크에 남긴다. SVG 좌표는 공식
    F1_scaled.png의 픽셀 좌표와 같다. 마스크는 0/255 PNG로 저장 가능하다.
    """
    root = ET.parse(svg_path).getroot()
    mask = Image.new('L', image_size, 0)
    draw = ImageDraw.Draw(mask)
    walls = 0
    doors = []
    for group in root.iter():
        if _local_name(group) != 'g':
            continue
        if group.attrib.get('id') == 'Wall':
            for child in group:
                if _local_name(child) == 'polygon':
                    points = _polygon_points(child)
                    if points:
                        draw.polygon(points, fill=255)
                        walls += 1
        elif group.attrib.get('id') == 'Door':
            for child in group:
                if _local_name(child) == 'polygon':
                    points = _polygon_points(child)
                    if points:
                        doors.append(points)
    if walls == 0:
        raise ValueError(f'Wall polygon이 없습니다: {svg_path}')
    for points in doors:
        draw.polygon(points, fill=0)
    return mask


def read_split(data_root, split):
    root = Path(data_root)
    if split not in {'train', 'val', 'test'}:
        raise ValueError('split은 train, val, test 중 하나여야 합니다')
    lines = (root / f'{split}.txt').read_text(encoding='utf-8').splitlines()
    return [root / line.strip().strip('/') for line in lines if line.strip()]


def load_pair(folder, size=512):
    with Image.open(Path(folder) / 'F1_scaled.png') as image_file:
        image = image_file.convert('RGB')
    mask = wall_mask(Path(folder) / 'model.svg', image.size)
    return (
        image.resize((size, size), Image.Resampling.BILINEAR),
        mask.resize((size, size), Image.Resampling.NEAREST),
    )


def training_dataset(data_root, split, size=512, limit=None, augment=False):
    import numpy as np
    import torch
    from torch.utils.data import Dataset

    class CubiCasaWalls(Dataset):
        def __init__(self):
            self.folders = read_split(data_root, split)
            if limit:
                self.folders = self.folders[:limit]
            self.size = size

        def __len__(self):
            return len(self.folders)

        def __getitem__(self, index):
            image, mask = load_pair(self.folders[index], self.size)
            if augment and torch.rand(()) < 0.5:
                image = image.transpose(Image.Transpose.FLIP_LEFT_RIGHT)
                mask = mask.transpose(Image.Transpose.FLIP_LEFT_RIGHT)
            if augment and torch.rand(()) < 0.5:
                image = image.transpose(Image.Transpose.FLIP_TOP_BOTTOM)
                mask = mask.transpose(Image.Transpose.FLIP_TOP_BOTTOM)
            x = torch.from_numpy(np.asarray(image, dtype=np.float32).copy()).permute(2, 0, 1) / 255.0
            y = torch.from_numpy((np.asarray(mask, dtype=np.uint8) >= 128).astype(np.float32).copy()).unsqueeze(0)
            return x, y

    return CubiCasaWalls()
