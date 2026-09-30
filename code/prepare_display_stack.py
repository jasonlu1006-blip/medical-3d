"""Package verified PACS display frames for an explicitly uncalibrated UI demo.

Run only through FORGE/ops/safe_run.py. Original pixels/metadata are never edited.
This is not DICOM conversion or anatomical segmentation.
"""
import argparse
import base64
import hashlib
import json
from pathlib import Path



def prepare(manifest, series, out, label):
    manifest = manifest.resolve(strict=True)
    raw = manifest.read_bytes()
    capture = json.loads(raw)
    frames = [f for f in capture['frames'] if str(f['series_number']) == series]
    if not 8 <= len(frames) <= 256:
        raise ValueError('Expected 8–256 frames in one series')
    frames.sort(key=lambda f: int(f['image_number']))
    numbers = [int(f['image_number']) for f in frames]
    if len(set(numbers)) != len(numbers) or numbers != list(range(numbers[0], numbers[-1] + 1)):
        raise ValueError('Duplicate or missing captured frame numbers')
    images = []
    sources = []
    total = 0
    for frame in frames:
        p = (manifest.parent / frame['file']).resolve(strict=True)
        if not p.is_relative_to(manifest.parent):
            raise ValueError('Frame outside capture directory')
        data = p.read_bytes()
        total += len(data)
        if total > 64 * 1024**2:
            raise ValueError('64 MiB source budget exceeded')
        digest = hashlib.sha256(data).hexdigest()
        if digest != frame['sha256']:
            raise ValueError('Source hash mismatch')
        if not data.startswith(b'\xff\xd8\xff') or len(data) > 2 * 1024**2:
            raise ValueError('Expected bounded JPEG display frame')
        # Preserve source bytes. Browser decodes one bounded image at a time.
        images.append(base64.b64encode(data).decode('ascii'))
        sources.append({'path': str(p), 'sha256': digest, 'image_number': frame['image_number']})
    package = {
        'format': 'medical-3d-display-stack-v1',
        'label': label,
        'dimensions': [256, 256, len(frames)],
        'calibrated': False,
        'orientationKnown': False,
        'units': 'unknown',
        'displaySpacing': [1, 1, 4],
        'notice': 'PACS 顯示圖片堆疊；Z 軸 4× 僅為展示比例，並非切片間距。方向及毫米尺度未校準。',
        'sourceKind': 'PACS rendered JPEG',
        'seriesNumber': series,
        'firstFrameNumber': numbers[0],
        'framesBase64': images,
    }
    out.mkdir(parents=True, exist_ok=True)
    artifact = out / 'display-stack.m3d'
    with artifact.open('x') as f:
        json.dump(package, f, ensure_ascii=False, separators=(',', ':'))
    proof = {
        'source_manifest': str(manifest),
        'source_manifest_sha256': hashlib.sha256(raw).hexdigest(),
        'sources': sources,
        'operation': 'Original JPEG bytes preserved; sorted by captured image_number; browser resamples to 256x256 for display',
        'anatomical_geometry_verified': False,
        'original_study_complete': False,
        'source_bytes': total,
        'output_bytes': artifact.stat().st_size,
        'output_sha256': hashlib.sha256(artifact.read_bytes()).hexdigest(),
        'dimensions': package['dimensions'],
    }
    with (out / 'provenance.json').open('x') as f:
        json.dump(proof, f, ensure_ascii=False, indent=2)
    print(json.dumps({k: proof[k] for k in ['dimensions', 'source_bytes', 'output_bytes', 'output_sha256']}))


if __name__ == '__main__':
    p = argparse.ArgumentParser()
    p.add_argument('--manifest', type=Path, required=True)
    p.add_argument('--series', required=True)
    p.add_argument('--label', required=True)
    p.add_argument('--output-dir', type=Path, required=True)
    a = p.parse_args()
    prepare(a.manifest, a.series, a.output_dir, a.label)
