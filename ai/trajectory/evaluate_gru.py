"""Evaluate the next-direction GRU on a held-out THÖR recording."""
import argparse
import json
from pathlib import Path

import numpy as np
import torch
from train_gru import TrajectoryGRU


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--data', type=Path, required=True)
    parser.add_argument('--checkpoint', type=Path, required=True)
    args = parser.parse_args()
    data = np.load(args.data)
    model = TrajectoryGRU()
    model.load_state_dict(torch.load(args.checkpoint, map_location='cpu', weights_only=True)['model'])
    model.eval()
    x = torch.tensor(data['X_test'], dtype=torch.float32)
    y = torch.tensor(data['y_test'], dtype=torch.long)
    with torch.no_grad():
        predicted = model(x).argmax(1)
    print(json.dumps({
        'test_samples': len(y),
        'test_accuracy': round((predicted == y).float().mean().item(), 4),
        'majority_baseline': round(np.bincount(data['y_test'], minlength=9).max() / len(y), 4),
    }))


if __name__ == '__main__':
    main()
