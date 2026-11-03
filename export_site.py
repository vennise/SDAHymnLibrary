"""Bundle worship audio, lyrics, and a title index for static hosting."""
import json
from pathlib import Path
import shutil
from server import cached, catalog_category, CATEGORIES, ROOT
from worship import AUDIO_DIR, PROGRAM, WORSHIP_DIR, lyrics_for


def export():
    media = ROOT / 'media' / 'worship'
    data = ROOT / 'data'
    media.mkdir(parents=True, exist_ok=True)
    data.mkdir(exist_ok=True)
    songs = []
    for track in PROGRAM:
        source = AUDIO_DIR / (track['id'] + '.mp3')
        destination = media / source.name
        if not source.is_file():
            raise FileNotFoundError(f'Prepare the MP3 recordings first: {source}')
        original = WORSHIP_DIR / track['file']
        if original.exists() and original.stat().st_mtime > source.stat().st_mtime:
            raise ValueError(f"Regenerate the changed recording {track['id']} with prepare_worship.py")
        detail = lyrics_for(track, cached)
        if track['sources'] and not any(section['verses'] for section in detail['sections']):
            raise ValueError(f"Identified lyrics missing for recording {track['id']}")
        shutil.copy2(source, destination)
        songs.append({'id': track['id'], 'title': track['title'],
                      'media': f'media/worship/{source.name}', 'sections': detail['sections']})
    write_json(data / 'worship.json', {'songs': songs})
    catalog = {song['id']: song for category in CATEGORIES for song in catalog_category(category)}
    write_json(data / 'catalog.json', {'categories': CATEGORIES, 'songs': list(catalog.values()), 'unavailable': []})
    print(f'Exported {len(songs)} recordings and lyrics, plus {len(catalog)} searchable hymn titles.')
    print(f'Static worship files are in {media} and {data}. No Python server is needed to host them.')


def write_json(path, value):
    temporary = path.with_suffix('.tmp')
    temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    temporary.replace(path)


if __name__ == '__main__':
    export()
