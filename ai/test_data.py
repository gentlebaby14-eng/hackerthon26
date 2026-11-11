import tempfile
import unittest
from pathlib import Path

from PIL import Image

from data import structure_dataset, structure_mask, wall_mask


class WallMaskTests(unittest.TestCase):
    def test_wall_polygon_filled_and_door_opened(self):
        svg = '''<svg xmlns="http://www.w3.org/2000/svg">
          <g id="Wall"><polygon points="2,2 18,2 18,8 2,8"/>
            <g id="Door"><polygon points="9,2 12,2 12,8 9,8"/></g>
          </g></svg>'''
        with tempfile.TemporaryDirectory(dir=Path(__file__).parent) as folder:
            path = Path(folder) / 'model.svg'
            path.write_text(svg, encoding='utf-8')
            mask = wall_mask(path, (20, 20))
        self.assertEqual(mask.getpixel((4, 5)), 255)
        self.assertEqual(mask.getpixel((10, 5)), 0)
        self.assertEqual(mask.getpixel((4, 15)), 0)

    def test_missing_wall_is_rejected(self):
        with tempfile.TemporaryDirectory(dir=Path(__file__).parent) as folder:
            path = Path(folder) / 'model.svg'
            path.write_text('<svg/>', encoding='utf-8')
            with self.assertRaises(ValueError):
                wall_mask(path, (20, 20))

    def test_structure_labels_override_wall_and_report_door_window_overlap(self):
        svg = '''<svg xmlns="http://www.w3.org/2000/svg">
          <g id="Wall"><polygon points="2,2 18,2 18,8 2,8"/></g>
          <g id="Door"><polygon points="8,2 12,2 12,8 8,8"/></g>
          <g id="Window"><polygon points="11,2 16,2 16,8 11,8"/></g></svg>'''
        with tempfile.TemporaryDirectory(dir=Path(__file__).parent) as folder:
            path = Path(folder) / 'model.svg'; path.write_text(svg, encoding='utf-8')
            mask, stats = structure_mask(path, (20, 20), return_stats=True)
        self.assertEqual(mask.getpixel((4, 5)), 1)
        self.assertEqual(mask.getpixel((9, 5)), 2)
        self.assertEqual(mask.getpixel((14, 5)), 3)
        self.assertEqual(mask.getpixel((11, 5)), 3)
        self.assertGreater(stats['door_window_overlap_pixels'], 0)

    def test_structure_resize_uses_only_valid_class_numbers(self):
        svg = '''<svg><g id="Wall"><polygon points="0,0 9,0 9,2 0,2"/></g>
          <g id="Door"><polygon points="3,0 5,0 5,2 3,2"/></g></svg>'''
        with tempfile.TemporaryDirectory(dir=Path(__file__).parent) as folder:
            path = Path(folder) / 'model.svg'; path.write_text(svg, encoding='utf-8')
            mask = structure_mask(path, (10, 10)).resize((37, 37), Image.Resampling.NEAREST)
        self.assertTrue(set(mask.getdata()).issubset({0, 1, 2, 3}))

    def test_structure_dataset_returns_rgb_and_integer_labels(self):
        svg = '''<svg><g id="Wall"><polygon points="1,1 30,1 30,5 1,5"/></g>
          <g id="Door"><polygon points="12,1 17,1 17,5 12,5"/></g>
          <g id="Window"><polygon points="22,1 27,1 27,5 22,5"/></g></svg>'''
        with tempfile.TemporaryDirectory(dir=Path(__file__).parent) as folder:
            root = Path(folder); sample = root / 'sample'; sample.mkdir()
            Image.new('RGB', (32, 32), 'white').save(sample / 'F1_scaled.png')
            (sample / 'model.svg').write_text(svg, encoding='utf-8')
            for split in ('train', 'val', 'test'):
                (root / f'{split}.txt').write_text('sample\n', encoding='utf-8')
            image, labels = structure_dataset(root, 'train', 64)[0]
        self.assertEqual(tuple(image.shape), (3, 64, 64))
        self.assertEqual(tuple(labels.shape), (64, 64))
        self.assertTrue(set(labels.unique().tolist()).issubset({0, 1, 2, 3}))


if __name__ == '__main__':
    unittest.main()
