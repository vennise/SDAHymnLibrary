"""Generate browser-compatible local MP3 copies; never change original recordings."""
import argparse
from pathlib import Path
import shutil
import subprocess
from worship import PROGRAM, WORSHIP_DIR, AUDIO_DIR


def prepare(ffmpeg):
    AUDIO_DIR.mkdir(parents=True, exist_ok=True)
    for track in PROGRAM:
        source = WORSHIP_DIR / track['file']
        target = AUDIO_DIR / (track['id'] + '.mp3')
        if not source.is_file():
            raise FileNotFoundError(source)
        if target.exists() and target.stat().st_mtime >= source.stat().st_mtime:
            continue
        temporary = target.with_suffix('.tmp.mp3')
        subprocess.run([str(ffmpeg), '-hide_banner', '-loglevel', 'error', '-y', '-i', str(source),
                        '-vn', '-codec:a', 'libmp3lame', '-b:a', '192k', str(temporary)], check=True)
        temporary.replace(target)
        print(f"Prepared recording {track['id']}: {target.name}")


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--ffmpeg', default=shutil.which('ffmpeg'))
    args = parser.parse_args()
    if not args.ffmpeg or not Path(args.ffmpeg).is_file():
        parser.error('Install FFmpeg or supply --ffmpeg with its executable path.')
    prepare(args.ffmpeg)
