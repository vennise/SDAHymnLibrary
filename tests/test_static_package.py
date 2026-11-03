import json
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]


class StaticPackageTests(unittest.TestCase):
    def test_all_worship_tracks_have_bundled_audio(self):
        songs = json.loads((ROOT / 'data/worship.json').read_text(encoding='utf-8'))['songs']
        self.assertEqual([song['id'] for song in songs], ['1', '2', '3', '5', '6', '7', '8'])
        for song in songs:
            self.assertTrue(song['media'].startswith('media/worship/'))
            media = ROOT / song['media']
            self.assertTrue(media.is_file(), song['title'])
            self.assertGreater(media.stat().st_size, 10000)
            if song['id'] in ['5', '6', '8']:
                self.assertEqual(song['sections'], [])
            else:
                self.assertTrue(any(section['verses'] for section in song['sections']))

    def test_catalog_snapshot_can_be_searched_without_backend(self):
        catalog = json.loads((ROOT / 'data/catalog.json').read_text(encoding='utf-8'))
        self.assertGreater(len(catalog['songs']), 3000)
        self.assertEqual(set(song['type'] for song in catalog['songs']), {'h', 'nt', 'ns', 'c'})
        self.assertTrue(any('amazing grace' == song['title'].lower() for song in catalog['songs']))

    def test_manifest_stays_under_repository_path(self):
        manifest = json.loads((ROOT / 'manifest.webmanifest').read_text(encoding='utf-8'))
        self.assertEqual(manifest['start_url'], './')
        self.assertEqual(manifest['scope'], './')
        self.assertTrue(all(not icon['src'].startswith('/') for icon in manifest['icons']))


if __name__ == '__main__':
    unittest.main()
