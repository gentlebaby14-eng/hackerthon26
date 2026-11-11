import tempfile
import unittest
from pathlib import Path

from data import wall_mask


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


if __name__ == '__main__':
    unittest.main()
