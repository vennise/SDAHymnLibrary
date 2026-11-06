"""Ordered local worship recordings and optional, cached lyric sources."""
from html.parser import HTMLParser
import os
from pathlib import Path
import re
from urllib.request import Request, urlopen

WORSHIP_DIR = Path(os.environ.get('WORSHIP_DIR', r'C:\Users\User\Downloads\worshipsong'))
AUDIO_DIR = Path(__file__).parent / '.cache' / 'worship-audio'
PROGRAM = [
    {'id': '1', 'title': 'As We Gather → Glory to the Father', 'file': '1st_as_we_gather.mp4',
     'sources': [('As We Gather', 'https://theworshipsongs.com/parts/lyrics/As-We-Gather-Lyrics.html')]},
    {'id': '2', 'title': 'Now, Dear Lord, as We Pray', 'file': '2nd_now_dear_lord_as_we_pray.mp4',
     'sources': [('', 'https://adventisthymns.com/en/1985/lyrics/671/as-we-come-to-you-in-prayer')]},
    {'id': '3', 'title': 'Almighty Father, Hear Our Prayer', 'file': '3rd_almighty_father_hear_our_pray.mp4',
     'sources': [('', 'https://adventisthymns.com/en/1985/lyrics/693/almighty-father')]},
    {'id': '5', 'title': 'Offering Song', 'file': '5th_offering_song.mp4', 'sources': []},
    {'id': '6', 'title': 'Amen F', 'file': '6th_amen_f.mp4', 'sources': []},
    {'id': '7', 'title': 'We Have This Hope', 'file': '7th_we_have_this_high_hope.mp4',
     'sources': [('', 'https://adventisthymns.com/en/1985/lyrics/214/we-have-this-hope')]},
    {'id': '8', 'title': 'Silent Prayer', 'file': '8th_silent_prayer.mp4', 'sources': []},
]


def track_for(track_id):
    return next((track for track in PROGRAM if track['id'] == track_id), None)


def program():
    return [{'id': track['id'], 'title': track['title'],
             'available': (WORSHIP_DIR / track['file']).is_file(),
             'media': f"/api/worship/{track['id']}/media",
             'original': f"/api/worship/{track['id']}/original"} for track in PROGRAM]


class LyricParser(HTMLParser):
    def __init__(self, plain=False):
        super().__init__(convert_charrefs=True)
        self.plain = plain
        self.active = False
        self.text = ''
        self.verses = []

    def handle_starttag(self, tag, attrs):
        if tag == 'p' and 'stz__body' in dict(attrs).get('class', '').split():
            self.active = True
            self.text = ''
        if tag == 'br' and (self.active or self.plain):
            self.text += '\n'

    def handle_data(self, data):
        if self.active or self.plain:
            self.text += data.strip('\r\n')

    def handle_endtag(self, tag):
        if tag == 'p' and self.active:
            self.verses.append(self.text.strip())
            self.active = False
            self.text = ''


def retrieve_lyrics(url):
    with urlopen(Request(url, headers={'User-Agent': 'Mozilla/5.0'}), timeout=20) as response:
        html = response.read().decode('utf-8')
    if 'theworshipsongs.com' in url:
        # This source combines a different medley. Use only the identified song,
        # not its unrelated chorus or the unconfirmed medley continuation.
        match = re.search(r'<b>Verse 1:</b>(.*?)<b>Chorus 1:</b>', html, re.S)
        if not match:
            raise ValueError('Lyric section not found')
        parser = LyricParser(plain=True)
        parser.feed(match[1])
        lines = [line.strip() for line in parser.text.splitlines() if line.strip()]
        half = len(lines) // 2
        if len(lines) % 2 == 0 and lines[:half] == lines[half:]:
            lines = lines[:half]
        return ['\n'.join(lines)]
    parser = LyricParser()
    parser.feed(html)
    if not parser.verses:
        raise ValueError('Lyric section not found')
    return parser.verses


def lyrics_for(track, cache):
    sections = []
    for index, (title, url) in enumerate(track['sources']):
        try:
            verses = cache(f"worship-lyrics-{track['id']}-{index}", lambda: retrieve_lyrics(url), 31536000)
            sections.append({'title': title, 'verses': verses, 'source': url})
        except Exception:
            # Local playback always works independently of lyric-source availability.
            pass
    if track['id'] == '1':
        sections.append({
            'title': 'Glory to the Father',
            'verses': ['Glory be to the Father,\nand to the Son,\nand to the Holy Ghost;\n'
                       'As it was in the beginning,\nis now, and ever shall be,\n'
                       'world without end.\nAmen, Amen.'],
            'source': 'https://adventisthymns.com/en/1985/lyrics/660/glory-be-to-the-father',
        })
    return {'id': track['id'], 'title': track['title'], 'sections': sections}


def byte_range(header, size):
    """Inclusive byte bounds, or None for an invalid/unsatisfiable range."""
    match = re.fullmatch(r'bytes=(\d*)-(\d*)', header)
    if not match or not any(match.groups()) or size <= 0:
        return None
    start, end = match.groups()
    if not start:
        length = int(end)
        return (max(0, size - length), size - 1) if length else None
    start = int(start)
    end = min(int(end), size - 1) if end else size - 1
    return (start, end) if 0 <= start <= end < size else None


def serve_media(handler, track, original=False):
    path = WORSHIP_DIR / track['file']
    if not path.is_file():
        return handler.send_error(404, 'Local recording not found')
    compatible = AUDIO_DIR / (track['id'] + '.mp3')
    if not original and compatible.is_file() and compatible.stat().st_mtime >= path.stat().st_mtime:
        path = compatible
    return serve_file(handler, path)


def serve_file(handler, path):
    """Serve an explicitly selected media file with browser seeking support."""
    if not path.is_file():
        return handler.send_error(404, 'Recording not found')
    size = path.stat().st_size
    range_header = handler.headers.get('Range')
    bounds = byte_range(range_header, size) if range_header else (0, size - 1)
    if bounds is None:
        handler.send_response(416)
        handler.send_header('Content-Range', f'bytes */{size}')
        handler.send_header('Content-Length', '0')
        handler.end_headers()
        return
    start, end = bounds
    handler.send_response(206 if range_header else 200)
    handler.send_header('Content-Type', 'audio/mpeg' if path.suffix == '.mp3' else 'video/mp4')
    handler.send_header('Accept-Ranges', 'bytes')
    handler.send_header('Content-Length', str(end - start + 1))
    # Revalidate on each load so a previously cached MP4 cannot mask an MP3 fix.
    handler.send_header('Cache-Control', 'no-cache')
    if range_header:
        handler.send_header('Content-Range', f'bytes {start}-{end}/{size}')
    handler.end_headers()
    if handler.command == 'HEAD':
        return
    try:
        with path.open('rb') as recording:
            recording.seek(start)
            remaining = end - start + 1
            while remaining:
                chunk = recording.read(min(65536, remaining))
                if not chunk:
                    break
                handler.wfile.write(chunk)
                remaining -= len(chunk)
    except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
        pass
