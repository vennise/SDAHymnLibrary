import json
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from server import parse_page


class SourceTests(unittest.TestCase):
    def test_html_escaped_catalog(self):
        page = parse_page('<span id="first-lines-search-data" data-songs="{&quot;songs&quot;:[{&quot;title&quot;:&quot;Love &amp; peace&quot;,&quot;num&quot;:&quot;1&quot;}]}"></span>')
        self.assertEqual(page.songs[0]['title'], 'Love & peace')

    def test_separate_lyrics_and_recordings_without_duplicate_practice_audio(self):
        composition = {'@type': 'MusicComposition', 'name': 'Example', 'lyrics': {'text': 'First line\nSecond line\n\nNext verse'}}
        page = parse_page(f'<script type="application/ld+json">{json.dumps(composition)}</script>'
                          '<audio id="learn-audio"><source src="https://www.hymnal.net/Hymns/example.mp3" type="audio/mpeg"></audio>'
                          '<audio id="main-audio-full" data-stanzas="4.2:v1,22:v2,40:end"><source src="https://www.hymnal.net/Hymns/full.mp3" type="audio/mpeg"></audio>'
                          '<audio id="main-audio-singing"><source src="https://www.hymnal.net/Hymns/sing.mp3" type="audio/mpeg"></audio>')
        self.assertEqual(page.composition['lyrics']['text'], composition['lyrics']['text'])
        self.assertEqual(len(page.recordings), 2)
        self.assertEqual(page.recordings[0]['timings'], [{'time': 4.2, 'verse': 1}, {'time': 22.0, 'verse': 2}])
        self.assertEqual(page.recordings[1]['kind'], 'vocal')

    def test_external_audio_is_excluded(self):
        page = parse_page('<audio id="main-audio"><source src="https://example.com/track.mp3" type="audio/mpeg"></audio>')
        self.assertEqual(page.recordings, [])

    def test_lyrics_fallback_preserves_lines_and_excludes_chords(self):
        page = parse_page('<div class="text-container">First &amp; second<br/>Third <span>line</span></div>'
                          '<div class="chord-container">C G Am</div><div class="text-container">Next verse</div>')
        self.assertEqual(page.verses, ['First & second\nThird line', 'Next verse'])


if __name__ == '__main__':
    unittest.main()
