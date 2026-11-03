"""Hymn Library: dependency-free web server and cached hymnal.net adapter."""
import argparse
from concurrent.futures import ThreadPoolExecutor
from html.parser import HTMLParser
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import re
import threading
import time
from urllib.error import HTTPError
from urllib.parse import urlsplit
from urllib.request import Request, urlopen
import worship

ROOT = Path(__file__).parent
CACHE = ROOT / '.cache'
ORIGIN = 'https://www.hymnal.net'
CATEGORIES = {'h': 'Classic Hymns', 'nt': 'New Tunes', 'ns': 'New Songs', 'c': 'Children’s Songs'}
locks = {}
guard = threading.Lock()


def fetch(path):
    request = Request(ORIGIN + path, headers={'User-Agent': 'HymnLibrary/1.0', 'Accept': 'text/html'})
    with urlopen(request, timeout=25) as response:
        return response.read().decode('utf-8')


class SourceParser(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.songs = []
        self.composition = {}
        self.script = None
        self.audio = None
        self.recordings = []
        self.verses = []
        self.text_depth = 0
        self.verse_text = ''

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag == 'div':
            if self.text_depth:
                self.text_depth += 1
            elif 'text-container' in attrs.get('class', '').split():
                self.text_depth = 1
                self.verse_text = ''
        if tag == 'br' and self.text_depth:
            self.verse_text += '\n'
        if attrs.get('id') == 'first-lines-search-data':
            self.songs = json.loads(attrs['data-songs'])['songs']
        if tag == 'script' and attrs.get('type') == 'application/ld+json':
            self.script = ''
        if tag == 'audio' and attrs.get('id', '').startswith('main-audio'):
            self.audio = attrs
        if tag == 'source' and self.audio and attrs.get('type') == 'audio/mpeg':
            suffix = self.audio['id'].removeprefix('main-audio')
            label, kind = {'-singing': ('Singing', 'vocal'), '-full': ('Piano · full song', 'instrumental'),
                           '-guide': ('Melody guide', 'instrumental'), '': ('Piano · verse', 'instrumental')}.get(suffix, ('Recording', 'other'))
            url = attrs.get('src', '')
            if urlsplit(url).hostname != 'www.hymnal.net' or not urlsplit(url).path.startswith('/Hymns/'):
                return
            timings = []
            for item in self.audio.get('data-stanzas', '').split(','):
                match = re.fullmatch(r'([\d.]+):v(\d+)', item)
                if match:
                    timings.append({'time': float(match[1]), 'verse': int(match[2])})
            self.recordings.append({'url': url, 'label': label, 'kind': kind, 'timings': timings})

    def handle_data(self, data):
        if self.text_depth:
            self.verse_text += data
        if self.script is not None:
            self.script += data

    def handle_endtag(self, tag):
        if tag == 'div' and self.text_depth:
            self.text_depth -= 1
            if not self.text_depth and self.verse_text.strip():
                self.verses.append(self.verse_text.strip())
        if tag == 'audio':
            self.audio = None
        if tag == 'script' and self.script is not None:
            try:
                value = json.loads(self.script)
                if isinstance(value, dict) and value.get('@type') == 'MusicComposition':
                    self.composition = value
            except ValueError:
                pass
            self.script = None


def parse_page(text):
    parser = SourceParser()
    parser.feed(text)
    return parser


def cached(key, loader, max_age=86400):
    with guard:
        lock = locks.setdefault(key, threading.Lock())
    with lock:
        path = CACHE / (key + '.json')
        old = None
        if path.exists():
            try:
                old = json.loads(path.read_text(encoding='utf-8'))
                if time.time() - path.stat().st_mtime < max_age:
                    return old
            except (ValueError, OSError):
                pass
        try:
            result = loader()
        except Exception:
            if old is not None:
                return old
            raise
        CACHE.mkdir(exist_ok=True)
        temporary = path.with_suffix('.tmp')
        temporary.write_text(json.dumps(result, ensure_ascii=False), encoding='utf-8')
        temporary.replace(path)
        return result


def catalog_category(category):
    def load():
        songs = parse_page(fetch('/en/song-index/' + category)).songs
        if not songs:
            raise ValueError('The source did not return a song index.')
        return [{'id': f"{song['type']}/{song['num']}", 'type': song['type'], 'number': str(song['num']),
                 'title': song['title'], 'topic': song.get('category', '')} for song in songs]
    songs = cached('catalog-' + category, load)
    # The New Songs index also contains legacy `lb` URLs in the same collection.
    return [dict(song, type='ns') if song['type'] == 'lb' else song for song in songs]


def song_detail(category, number):
    def load():
        page = parse_page(fetch(f'/en/hymn/{category}/{number}'))
        composition = page.composition
        if not composition:
            raise ValueError('This hymn could not be read from the source.')
        return {'id': f'{category}/{number}', 'title': composition['name'],
                'lyrics': composition.get('lyrics', {}).get('text') or '\n\n'.join(page.verses),
                'key': composition.get('musicalKey', ''), 'recordings': page.recordings,
                'source': f'{ORIGIN}/en/hymn/{category}/{number}'}
    return cached(f'song-v2-{category}-{number}', load, 604800)


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def end_headers(self):
        allowed = os.environ.get('HYMN_ALLOWED_ORIGIN', '').rstrip('/')
        origin = self.headers.get('Origin')
        if allowed and origin == allowed:
            self.send_header('Access-Control-Allow-Origin', origin)
            self.send_header('Vary', 'Origin')
        super().end_headers()

    def is_public_file(self, path):
        return path in ('/', '/index.html', '/app.js', '/config.js', '/search.js', '/worship.js', '/styles.css', '/motion.js', '/motion.css', '/manifest.webmanifest', '/icon.svg', '/data/worship.json', '/data/catalog.json')

    def json(self, value, status=200):
        body = json.dumps(value, ensure_ascii=False).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Cache-Control', 'public, max-age=300' if status == 200 else 'no-store')
        self.end_headers()
        self.wfile.write(body)

    def stream_audio(self, category, number, index):
        song = song_detail(category, number)
        if int(index) >= len(song['recordings']):
            return self.send_error(404)
        recording = song['recordings'][int(index)]
        headers = {'User-Agent': 'HymnLibrary/1.0', 'Referer': song['source']}
        requested_range = self.headers.get('Range', '')
        if re.fullmatch(r'bytes=\d*-\d*', requested_range):
            headers['Range'] = requested_range
        # Stream only URLs discovered in the parsed song, never arbitrary client URLs.
        with urlopen(Request(recording['url'], headers=headers), timeout=30) as upstream:
            self.send_response(upstream.status)
            for name in ('Content-Type', 'Content-Length', 'Content-Range', 'Accept-Ranges', 'ETag', 'Last-Modified'):
                if upstream.headers.get(name):
                    self.send_header(name, upstream.headers[name])
            self.send_header('Cache-Control', 'public, max-age=86400')
            self.end_headers()
            try:
                while chunk := upstream.read(32768):
                    self.wfile.write(chunk)
            except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
                pass

    def do_GET(self):
        path = urlsplit(self.path).path
        try:
            if re.fullmatch(r'/media/worship/(1|2|3|5|6|7|8)\.mp3', path):
                return worship.serve_file(self, ROOT / path.lstrip('/'))
            if path == '/api/worship':
                return self.json({'songs': worship.program()})
            worship_match = re.fullmatch(r'/api/worship/(\d+)(/media|/original)?', path)
            if worship_match:
                track = worship.track_for(worship_match[1])
                if track is None:
                    return self.send_error(404)
                if worship_match[2]:
                    return worship.serve_media(self, track, original=worship_match[2] == '/original')
                return self.json(worship.lyrics_for(track, cached))
            audio_match = re.fullmatch(r'/api/audio/(h|nt|ns|c|lb)/(\d{1,6})/(\d{1,2})', path)
            if audio_match:
                return self.stream_audio(*audio_match.groups())
            if path == '/api/catalog':
                def safe_category(category):
                    try:
                        return category, catalog_category(category), None
                    except Exception:
                        return category, [], CATEGORIES[category]
                with ThreadPoolExecutor(max_workers=4) as pool:
                    results = list(pool.map(safe_category, CATEGORIES))
                songs = {song['id']: song for _, group, _ in results for song in group}
                if not songs:
                    return self.json({'error': 'Could not reach hymnal.net. Please try again.'}, 502)
                return self.json({'categories': CATEGORIES, 'songs': list(songs.values()),
                                  'unavailable': [error for _, _, error in results if error]})
            match = re.fullmatch(r'/api/song/(h|nt|ns|c|lb)/(\d{1,6})', path)
            if match:
                return self.json(song_detail(*match.groups()))
            if not self.is_public_file(path):
                return self.send_error(404)
            super().do_GET()
        except HTTPError as error:
            self.json({'error': 'Song not found.' if error.code == 404 else 'The song source is temporarily unavailable.'}, 404 if error.code == 404 else 502)
        except Exception as error:
            print(f'Source error: {error}')
            self.json({'error': 'Unable to load this song. Please try again shortly.'}, 502)

    def do_HEAD(self):
        path = urlsplit(self.path).path
        if re.fullmatch(r'/media/worship/(1|2|3|5|6|7|8)\.mp3', path):
            return worship.serve_file(self, ROOT / path.lstrip('/'))
        match = re.fullmatch(r'/api/worship/(\d+)/(media|original)', urlsplit(self.path).path)
        if match:
            track = worship.track_for(match[1])
            return worship.serve_media(self, track, original=match[2] == 'original') if track else self.send_error(404)
        if not self.is_public_file(path):
            return self.send_error(404)
        super().do_HEAD()


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--port', type=int, default=8090)
    parser.add_argument('--host', default='127.0.0.1')
    args = parser.parse_args()
    print(f'Hymn Library is running at http://{args.host}:{args.port}', flush=True)
    ThreadingHTTPServer((args.host, args.port), Handler).serve_forever()
