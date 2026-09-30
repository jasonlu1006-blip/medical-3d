import hashlib
import json
import tempfile
import unittest
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from prepare_display_stack import prepare
from serve import STATIC, make_handler


class IntegrityTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        frames = []
        for i in range(1, 9):
            data = b'\xff\xd8\xff' + bytes([i]) * 16  # hash fixture, not a decodable clinical image
            (self.root / f'{i}.jpg').write_bytes(data)
            frames.append({'series_number': '7', 'image_number': i, 'file': f'{i}.jpg',
                           'sha256': hashlib.sha256(data).hexdigest()})
        self.capture = {'frames': frames}
        self.manifest = self.root / 'capture.json'
        self.save()

    def tearDown(self):
        self.tmp.cleanup()

    def save(self):
        self.manifest.write_text(json.dumps(self.capture))

    def run_package(self):
        prepare(self.manifest, '7', self.root / 'out', 'Synthetic integrity fixture')

    def test_preserves_original_bytes_and_marks_uncalibrated(self):
        self.run_package()
        result = json.loads((self.root / 'out/display-stack.m3d').read_text())
        self.assertFalse(result['calibrated'])
        self.assertFalse(result['orientationKnown'])
        self.assertEqual(result['dimensions'], [256, 256, 8])
        import base64
        self.assertEqual(base64.b64decode(result['framesBase64'][0]), (self.root / '1.jpg').read_bytes())

    def test_rejects_hash_mismatch_before_output(self):
        (self.root / '3.jpg').write_bytes(b'changed')
        with self.assertRaisesRegex(ValueError, 'hash mismatch'):
            self.run_package()
        self.assertFalse((self.root / 'out').exists())

    def test_rejects_missing_slice(self):
        self.capture['frames'][-1]['image_number'] = 9
        self.save()
        with self.assertRaisesRegex(ValueError, 'missing'):
            self.run_package()

    def test_rejects_duplicate_slice(self):
        self.capture['frames'][-1]['image_number'] = 7
        self.save()
        with self.assertRaisesRegex(ValueError, 'Duplicate'):
            self.run_package()

    def test_rejects_path_escape(self):
        self.capture['frames'][0]['file'] = '../outside.jpg'
        self.save()
        with self.assertRaises((ValueError, FileNotFoundError)):
            self.run_package()

    def test_static_assets_exclude_project_and_patient_material(self):
        self.assertNotIn('/project.json', STATIC)
        self.assertNotIn('/README.md', STATIC)
        self.assertTrue(all('..' not in p for p in STATIC.values()))

    def test_server_rejects_unrecognized_packages(self):
        (self.root / 'bad.m3d').write_text('{}')
        with self.assertRaisesRegex(ValueError, 'Unsupported'):
            make_handler(self.root)


if __name__ == '__main__':
    unittest.main()
