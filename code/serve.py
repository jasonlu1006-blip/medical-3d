"""Small read-only viewer server. Explicit static assets and selected case packages only."""
import argparse
import json
import mimetypes
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit

WEB = Path(__file__).resolve().parents[1] / 'web'
STATIC = {'/': 'index.html', '/index.html': 'index.html', '/app.js': 'app.js',
          '/portal.js': 'portal.js', '/family.js': 'family.js', '/family.css': 'family.css', '/unlock.js': 'unlock.js', '/catalog.json': 'catalog.json', '/style.css': 'style.css', '/vendor/niivue-0.58.0.js': 'vendor/niivue-0.58.0.js',
          '/vendor/NIIVUE-LICENSE.txt': 'vendor/NIIVUE-LICENSE.txt'}


def make_handler(data_dir=None):
    datasets, paths = [], {}
    if data_dir:
        for i, p in enumerate(sorted(data_dir.glob('*.m3d'))):
            if i >= 8 or p.is_symlink() or p.stat().st_size > 64 * 1024**2:
                raise ValueError('Case package budget exceeded or symlink found')
            j = json.loads(p.read_text())
            if j.get('format') != 'medical-3d-display-stack-v1':
                raise ValueError('Unsupported case package')
            key = f'/data/stack-{i}.m3d'
            paths[key] = p
            datasets.append({'id': str(i), 'label': str(j['label'])[:100], 'url': '.' + key})

    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):
            path = urlsplit(self.path).path
            if path == '/api/catalog':
                raw = json.dumps({'datasets': datasets}).encode()
                content_type = 'application/json'
            elif path in STATIC:
                p = WEB / STATIC[path]
                raw = p.read_bytes()
                content_type = 'application/javascript' if p.suffix == '.js' else mimetypes.guess_type(p)[0] or 'text/plain'
            elif path in paths:
                raw = paths[path].read_bytes()
                content_type = 'application/json'
            else:
                self.send_error(404)
                return
            self.send_response(200)
            self.send_header('Content-Type', content_type)
            self.send_header('Content-Length', str(len(raw)))
            self.send_header('Cache-Control', 'no-store')
            self.send_header('X-Content-Type-Options', 'nosniff')
            self.send_header('Referrer-Policy', 'no-referrer')
            self.send_header('Content-Security-Policy', "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self'; img-src 'self' data: blob:; connect-src 'self'; worker-src 'self' blob:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'")
            self.end_headers()
            self.wfile.write(raw)

        def log_message(self, *_):
            pass

    return Handler


if __name__ == '__main__':
    p = argparse.ArgumentParser()
    p.add_argument('--host', default='127.0.0.1')
    p.add_argument('--port', type=int, default=8768)
    p.add_argument('--data-dir', type=Path)
    a = p.parse_args()
    server = ThreadingHTTPServer((a.host, a.port), make_handler(a.data_dir))
    print(f'Medical 3D available at http://{a.host}:{a.port}; selected assets only', flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        server.server_close()
