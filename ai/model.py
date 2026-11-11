"""벽/비벽 이진 분할용 U-Net. 입력 RGB, 출력 1채널 로짓."""

import torch
from torch import nn
from torch.nn import functional as F


class DoubleConv(nn.Sequential):
    def __init__(self, in_channels, out_channels):
        super().__init__(
            nn.Conv2d(in_channels, out_channels, 3, padding=1, bias=False),
            nn.BatchNorm2d(out_channels),
            nn.ReLU(inplace=True),
            nn.Conv2d(out_channels, out_channels, 3, padding=1, bias=False),
            nn.BatchNorm2d(out_channels),
            nn.ReLU(inplace=True),
        )


class UNet(nn.Module):
    def __init__(self, base_channels=16):
        super().__init__()
        c = base_channels
        self.enc1 = DoubleConv(3, c)
        self.enc2 = DoubleConv(c, 2 * c)
        self.enc3 = DoubleConv(2 * c, 4 * c)
        self.enc4 = DoubleConv(4 * c, 8 * c)
        self.center = DoubleConv(8 * c, 16 * c)
        self.pool = nn.MaxPool2d(2)
        self.dec4 = DoubleConv(24 * c, 8 * c)
        self.dec3 = DoubleConv(12 * c, 4 * c)
        self.dec2 = DoubleConv(6 * c, 2 * c)
        self.dec1 = DoubleConv(3 * c, c)
        self.head = nn.Conv2d(c, 1, 1)

    @staticmethod
    def _up(x, skip):
        return F.interpolate(x, size=skip.shape[-2:], mode='bilinear', align_corners=False)

    def forward(self, x):
        e1 = self.enc1(x)
        e2 = self.enc2(self.pool(e1))
        e3 = self.enc3(self.pool(e2))
        e4 = self.enc4(self.pool(e3))
        x = self.center(self.pool(e4))
        x = self.dec4(torch.cat([self._up(x, e4), e4], dim=1))
        x = self.dec3(torch.cat([self._up(x, e3), e3], dim=1))
        x = self.dec2(torch.cat([self._up(x, e2), e2], dim=1))
        x = self.dec1(torch.cat([self._up(x, e1), e1], dim=1))
        return self.head(x)
