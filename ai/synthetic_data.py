"""저작권 문제 없이 재현 가능한 평면도/벽 마스크 학습 데이터를 만든다.

단순 복사 학습을 피하려고 방 수, 벽 두께, 문 위치, 색, 노이즈를 seed별로
바꾼다. 입력 그림에는 문호와 가구 기호도 넣지만 정답은 통행을 막는 벽만 담는다.
"""

import random

import numpy as np
import torch
from PIL import Image, ImageDraw, ImageFilter
from torch.utils.data import Dataset


def _sample(index, size, seed, augment):
    rng = random.Random(seed + index * 7919)
    scale = 3
    canvas = size * scale
    paper = rng.randint(238, 255)
    image = Image.new('RGB', (canvas, canvas), (paper, paper - rng.randint(0, 6), paper - rng.randint(0, 9)))
    mask = Image.new('L', (canvas, canvas), 0)
    ink, truth = ImageDraw.Draw(image), ImageDraw.Draw(mask)
    margin = rng.randint(canvas // 18, canvas // 10)
    thickness = rng.randint(max(5, canvas // 55), max(8, canvas // 34))
    x0, y0, x1, y1 = margin, margin, canvas - margin, canvas - margin

    # 외벽과 1~4개의 내벽. 각 벽에는 실제 통과 가능한 문 틈을 낸다.
    segments = [(x0, y0, x1, y0), (x1, y0, x1, y1), (x1, y1, x0, y1), (x0, y1, x0, y0)]
    for _ in range(rng.randint(1, 4)):
        vertical = rng.random() < .5
        if vertical:
            x = rng.randint(x0 + (x1-x0)//4, x1 - (x1-x0)//4)
            segments.append((x, y0, x, y1))
        else:
            y = rng.randint(y0 + (y1-y0)//4, y1 - (y1-y0)//4)
            segments.append((x0, y, x1, y))

    for idx, (ax, ay, bx, by) in enumerate(segments):
        color = rng.randint(15, 65)
        ink.line((ax, ay, bx, by), fill=(color, color, color), width=thickness)
        truth.line((ax, ay, bx, by), fill=255, width=thickness)
        if idx >= 4:
            door = rng.randint(canvas // 12, canvas // 8)
            if ax == bx:
                center = rng.randint(y0 + door, y1 - door)
                gap = (ax, center-door//2, bx, center+door//2)
                ink.line(gap, fill=image.getpixel((margin//2, margin//2)), width=thickness+3)
                truth.line(gap, fill=0, width=thickness+3)
                ink.arc((ax-door, center-door//2, ax, center+door//2), 270, 360, fill=(90,90,90), width=max(2, thickness//5))
            else:
                center = rng.randint(x0 + door, x1 - door)
                gap = (center-door//2, ay, center+door//2, by)
                ink.line(gap, fill=image.getpixel((margin//2, margin//2)), width=thickness+3)
                truth.line(gap, fill=0, width=thickness+3)
                ink.arc((center-door//2, ay-door, center+door//2, ay), 0, 90, fill=(90,90,90), width=max(2, thickness//5))

    # 가구 기호는 입력에만 존재하므로 모델이 검은 선을 전부 벽으로 외우지 못한다.
    for _ in range(rng.randint(2, 7)):
        w, h = rng.randint(canvas//12, canvas//4), rng.randint(canvas//14, canvas//5)
        fx, fy = rng.randint(x0+thickness, x1-w-thickness), rng.randint(y0+thickness, y1-h-thickness)
        shade = rng.randint(125, 205)
        ink.rectangle((fx, fy, fx+w, fy+h), outline=(shade,shade,shade), width=max(2, thickness//6))
        if rng.random() < .5:
            ink.line((fx, fy, fx+w, fy+h), fill=(shade,shade,shade), width=max(1, thickness//8))

    if rng.random() < .65:
        image = image.filter(ImageFilter.GaussianBlur(rng.uniform(0, 1.2)))
    arr = np.asarray(image, dtype=np.int16)
    noise = np.random.default_rng(seed + index).normal(0, rng.uniform(0, 5), arr.shape)
    image = Image.fromarray(np.clip(arr + noise, 0, 255).astype(np.uint8))
    image = image.resize((size, size), Image.Resampling.BILINEAR)
    mask = mask.resize((size, size), Image.Resampling.NEAREST)
    if augment and rng.random() < .5:
        image, mask = image.transpose(Image.Transpose.FLIP_LEFT_RIGHT), mask.transpose(Image.Transpose.FLIP_LEFT_RIGHT)
    x = torch.from_numpy(np.asarray(image, dtype=np.float32).copy()).permute(2, 0, 1) / 255
    y = torch.from_numpy((np.asarray(mask) >= 128).astype(np.float32).copy()).unsqueeze(0)
    return x, y


class SyntheticFloorplans(Dataset):
    def __init__(self, split, size=128, samples=600, seed=42, augment=False):
        counts = {'train': samples, 'val': max(80, samples // 5), 'test': max(100, samples // 4)}
        offsets = {'train': 0, 'val': 1_000_000, 'test': 2_000_000}
        self.count, self.offset = counts[split], offsets[split]
        self.size, self.seed, self.augment = size, seed, augment

    def __len__(self):
        return self.count

    def __getitem__(self, index):
        return _sample(index + self.offset, self.size, self.seed, self.augment)
