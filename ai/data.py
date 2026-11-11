"""CubiCasa5K SVG 주석에서 통행을 막는 벽의 이진 마스크를 만든다."""

from pathlib import Path
from xml.etree import ElementTree as ET

from PIL import Image, ImageDraw

CLASS_NAMES = ('background', 'wall', 'door', 'window')


def _local_name(element):
    return element.tag.rsplit('}', 1)[-1]


def _polygon_points(element):
    raw = element.attrib.get('points', '').replace(',', ' ').split()
    if len(raw) < 6 or len(raw) % 2:
        return []
    return [(float(raw[i]), float(raw[i + 1])) for i in range(0, len(raw), 2)]


def _group_polygons(root, group_id):
    """id가 일치하는 그룹의 polygon을 모으되 다른 의미 그룹 안은 건너뛴다."""
    polygons = []
    semantic_ids = {'Wall', 'Door', 'Window'}

    def visit(element, top=False):
        if not top and _local_name(element) == 'g' and element.attrib.get('id') in semantic_ids:
            return
        if _local_name(element) == 'polygon':
            points = _polygon_points(element)
            if points:
                polygons.append(points)
        for child in element:
            visit(child)

    for group in root.iter():
        if _local_name(group) == 'g' and group.attrib.get('id') == group_id:
            visit(group, top=True)
    return polygons


def structure_mask(svg_path, image_size, return_stats=False):
    """0=기타, 1=벽, 2=문, 3=창문의 단일 라벨 마스크를 만든다.

    벽을 먼저 그리고 문, 창문 순으로 덮어 벽과 겹치는 개구부 라벨을 보존한다.
    문·창문이 서로 겹치면 최종 라벨은 창문이며 겹친 픽셀 수를 기록한다.
    """
    root = ET.parse(svg_path).getroot()
    groups = {name: _group_polygons(root, name) for name in ('Wall', 'Door', 'Window')}
    if not groups['Wall']:
        raise ValueError(f'Wall polygon이 없습니다: {svg_path}')
    mask = Image.new('L', image_size, 0)
    draw = ImageDraw.Draw(mask)
    for points in groups['Wall']:
        draw.polygon(points, fill=1)
    door_layer = Image.new('1', image_size, 0)
    door_draw = ImageDraw.Draw(door_layer)
    for points in groups['Door']:
        door_draw.polygon(points, fill=1)
        draw.polygon(points, fill=2)
    window_layer = Image.new('1', image_size, 0)
    window_draw = ImageDraw.Draw(window_layer)
    for points in groups['Window']:
        window_draw.polygon(points, fill=1)
        draw.polygon(points, fill=3)
    overlap_pixels = sum(a and b for a, b in zip(door_layer.getdata(), window_layer.getdata()))
    stats = {'polygons': {key.lower(): len(value) for key, value in groups.items()},
             'door_window_overlap_pixels': overlap_pixels}
    return (mask, stats) if return_stats else mask


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


def load_structure_pair(folder, size=512):
    with Image.open(Path(folder) / 'F1_scaled.png') as image_file:
        image = image_file.convert('RGB')
    mask = structure_mask(Path(folder) / 'model.svg', image.size)
    return (image.resize((size, size), Image.Resampling.BILINEAR),
            mask.resize((size, size), Image.Resampling.NEAREST))


def structure_dataset(data_root, split, size=512, limit=None, augment=False):
    import numpy as np
    import torch
    from torch.utils.data import Dataset

    class CubiCasaStructures(Dataset):
        def __init__(self):
            self.folders = read_split(data_root, split)
            if limit:
                self.folders = self.folders[:limit]

        def __len__(self):
            return len(self.folders)

        def __getitem__(self, index):
            image, mask = load_structure_pair(self.folders[index], size)
            if augment and torch.rand(()) < .5:
                image, mask = image.transpose(Image.Transpose.FLIP_LEFT_RIGHT), mask.transpose(Image.Transpose.FLIP_LEFT_RIGHT)
            if augment and torch.rand(()) < .5:
                image, mask = image.transpose(Image.Transpose.FLIP_TOP_BOTTOM), mask.transpose(Image.Transpose.FLIP_TOP_BOTTOM)
            x = torch.from_numpy(np.asarray(image, dtype=np.float32).copy()).permute(2, 0, 1) / 255
            y = torch.from_numpy(np.asarray(mask, dtype=np.int64).copy())
            return x, y

    return CubiCasaStructures()


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
