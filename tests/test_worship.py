from io import BytesIO
from pathlib import Path
import sys
import os
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import worship


class Response:
    command = 'GET'

    def __init__(self, requested_range=None):
        self.headers = {'Range': requested_range} if requested_range else {}
        self.wfile = BytesIO()
        self.response_headers = {}

    def send_response(self, status):
        self.status = status

    def send_header(self, name, value):
        self.response_headers[name] = value

    def end_headers(self):
        pass

    def send_error(self, status, *args):
        self.status = status


class WorshipTests(unittest.TestCase):
    def test_program_order_and_unknown_tracks(self):
        self.assertEqual([song['id'] for song in worship.program()], ['1', '2', '3', '5', '6', '7', '8'])
        self.assertIsNone(worship.track_for('../server.py'))
        for track_id in ['5', '6', '8']:
            self.assertEqual(worship.lyrics_for(worship.track_for(track_id), None)['sections'], [])

    def test_lyric_parser_ignores_page_navigation_and_preserves_lines(self):
        parser = worship.LyricParser()
        parser.feed('<p>Navigation</p><p class="stz__body">One<br>Two &amp; three</p><p class="stz__body">Another verse</p><p>Details</p>')
        self.assertEqual(parser.verses, ['One\nTwo & three', 'Another verse'])

    def test_local_range_and_head_responses(self):
        track = worship.track_for('1')
        with TemporaryDirectory() as folder, patch.object(worship, 'WORSHIP_DIR', Path(folder)):
            (Path(folder) / track['file']).write_bytes(b'0123456789')
            response = Response('bytes=3-6')
            worship.serve_media(response, track)
            self.assertEqual(response.status, 206)
            self.assertEqual(response.wfile.getvalue(), b'3456')
            self.assertEqual(response.response_headers['Content-Range'], 'bytes 3-6/10')
            suffix = Response('bytes=-3')
            worship.serve_media(suffix, track)
            self.assertEqual(suffix.wfile.getvalue(), b'789')
            head = Response()
            head.command = 'HEAD'
            worship.serve_media(head, track)
            self.assertEqual(head.response_headers['Content-Length'], '10')
            self.assertEqual(head.wfile.getvalue(), b'')
            invalid = Response('bytes=99-100')
            worship.serve_media(invalid, track)
            self.assertEqual(invalid.status, 416)
            self.assertEqual(invalid.wfile.getvalue(), b'')

    def test_missing_recording_is_reported_without_opening_another_file(self):
        with TemporaryDirectory() as folder, patch.object(worship, 'WORSHIP_DIR', Path(folder)):
            response = Response()
            worship.serve_media(response, worship.track_for('1'))
            self.assertEqual(response.status, 404)
            self.assertFalse(any(song['available'] for song in worship.program()))

    def test_mp3_playback_copy_is_used_but_original_is_preserved(self):
        track = worship.track_for('1')
        with TemporaryDirectory() as folder, TemporaryDirectory() as audio_folder, patch.object(worship, 'WORSHIP_DIR', Path(folder)), patch.object(worship, 'AUDIO_DIR', Path(audio_folder)):
            source = Path(folder) / track['file']
            source.write_bytes(b'original-mp4')
            os.utime(source, (1, 1))
            (Path(audio_folder) / '1.mp3').write_bytes(b'compatible-mp3')
            audio = Response('bytes=0-9')
            worship.serve_media(audio, track)
            self.assertEqual(audio.response_headers['Content-Type'], 'audio/mpeg')
            self.assertEqual(audio.wfile.getvalue(), b'compatible')
            original = Response()
            worship.serve_media(original, track, original=True)
            self.assertEqual(original.response_headers['Content-Type'], 'video/mp4')
            self.assertEqual(original.wfile.getvalue(), b'original-mp4')


if __name__ == '__main__':
    unittest.main()
