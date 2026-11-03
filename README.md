# SDAHymnLibrary

Search hymn titles and numbers, open full-screen lyrics, and play your prerecorded worship program. The worship program is self-contained and ready for **GitHub Pages**.

## What is included

- `media/worship/`: all **seven MP3 recordings**, copied into the project and included in Git.
- `data/worship.json`: the ordered service list and confirmed lyrics. Offering Song, Amen F, Silent Prayer, and the unconfirmed medley continuation have no guessed lyrics.
- `data/catalog.json`: a snapshot of **3,316 searchable hymn titles** from all four English collections.
- Search tolerates small spelling mistakes, ignores punctuation and capitalization, and matches hymn numbers exactly.
- Worship pages have Play/Pause at the top and bottom, seeking, volume, adjustable lyrics, and Previous/Next. Play beside a song starts it immediately; selecting its title waits for Play. Next never starts automatically.

Worship playback **does not depend on Python, `.cache`, or your Downloads folder**. Original MP4s remain in `C:\Users\User\Downloads\worshipsong` and have not been modified. The website's Open audio link opens the bundled MP3.

## GitHub Pages deployment

1. Create a GitHub repository and upload/commit **the contents of this folder** at its root, including `media/`, `data/`, and `.github/workflows/pages.yml`.
2. In the repository's **Settings → Pages → Build and deployment**, choose **GitHub Actions**.
3. Push to `main` or `master`, or run **Deploy Hymn Library to GitHub Pages** from the Actions tab.
4. Open the Pages URL shown by the deployment.

The workflow publishes only the website files, `data/`, and `media/`. Python files, tests, local cache, and recordings outside the project are not published. All website paths are relative, so project URLs such as `https://USERNAME.github.io/REPOSITORY/` work.

Alternatively, deploy the static files to any static host. There is no npm install, build command, or media conversion needed for deployment.

### What works on Pages?

| Feature | Standalone GitHub Pages |
| --- | --- |
| Seven worship recordings and confirmed lyrics | Yes |
| Title/number searching, including typo matching | Yes, using the bundled catalog snapshot |
| Other hymns' lyrics and recordings | Open the selected hymn on hymnal.net |
| In-app online hymn lyrics/audio | Requires an optional separately hosted Python backend |

Hosting is not an offline download feature: a new browser visit needs internet to load the website and recordings. Local static hosting can play the bundled program without internet. There is no service worker or guaranteed browser-offline storage yet.

## Run on Windows

For the full local online hymn player, use Python 3.10 or newer:

```powershell
cd C:\project\hymn-player
python server.py
```

Open **http://127.0.0.1:8090**. You can also double-click `start.bat`. Keep the terminal open.

To preview the GitHub Pages/static version:

```powershell
python -m http.server 8091
```

Open **http://127.0.0.1:8091**. Online API requests fall back to the bundled title index when this simple server has no backend.

## Optional online hymn backend

`server.py` retrieves and caches the live hymnal.net catalog, lyrics, and recording metadata. It streams remote audio through a range-aware proxy. This is needed for in-app playback of hymns outside the bundled worship program.

1. Run `python server.py --host 0.0.0.0 --port 8090` on a Python-capable host behind HTTPS. Disable reverse-proxy buffering on `/api/audio/*`.
2. Set the backend's `HYMN_ALLOWED_ORIGIN` environment variable to your frontend origin, e.g. `https://USERNAME.github.io` (no repository path).
3. In `config.js`, set `apiBase` to the HTTPS backend URL, e.g. `https://hymns.example.com/`.

By default, localhost attempts its same-origin backend; public static deployments use bundled worship playback and title search. When a configured backend is unavailable, title search falls back to the static index. The worship program always reads bundled project files.

Source availability and markup changes can affect the online adapter. Verse highlighting is available only where a recording supplies stanza timestamps. Line-level timing and native Windows packaging are not implemented.

## Updating the bundled program

The deployed website files are already prepared. To regenerate them after changing the local source recordings or service list:

1. Edit the titles, filenames, order, and lyric sources in `worship.py`. Use `WORSHIP_DIR` to override the local source folder.
2. Install FFmpeg and run `python prepare_worship.py` (or supply `--ffmpeg C:\path\to\ffmpeg.exe`). This makes MP3 copies in `.cache/worship-audio/` without modifying the originals.
3. Run `python export_site.py` to copy MP3s to `media/worship/` and export lyric/catalog JSON to `data/`.
4. Commit the updated `media/` and `data/` files and push.

Conversion tools and lyric-source access are needed only when regenerating the package. Preserve `.cache/` locally to reuse previously fetched lyrics. The exported static package contains the identified standard text; recording repetitions may differ, and worship tracks do not use estimated synchronization.

## Checks

```powershell
python -m unittest discover -s tests -v
node --check app.js
node --check worship.js
node --test tests/search.test.js
```

Song text and audio retain their original attribution. Online hymns link to hymnal.net; worship lyric sections include their source URLs in `data/worship.json`.
