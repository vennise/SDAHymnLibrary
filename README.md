# SDAHymnLibrary

Search hymn titles and numbers, open full-screen lyrics, and play your prerecorded worship program. **GitHub Pages** serves the website and worship recordings; **Cloudflare Workers Free** retrieves other hymns’ lyrics and audio on demand. No Python hosting is required.

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
| In-app online hymn lyrics/audio | Uses the Cloudflare Worker configured in `config.js` |

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

## Cloudflare Workers Free backend

The deployed API is **https://sdahymnlibrary-api.vennise.workers.dev/**. Its `/health` endpoint reports readiness. The frontend connects to it through `config.js`.

- `/api/catalog` serves the bundled title index without scraping during search.
- `/api/song/h/1` retrieves the hymn page and parses structured lyrics, fallback stanza text, and available recordings with Cloudflare's native `HTMLRewriter`.
- `/api/audio/h/1/0` streams a selected source recording and supports byte ranges for seeking.
- Metadata uses Cloudflare's built-in edge Cache API; no paid KV, database, or storage binding is needed. Audio is streamed rather than buffered in Worker memory.
- CORS allows this GitHub Pages origin and local port 8090. Change `ALLOWED_ORIGINS` in `wrangler.jsonc` if moving the frontend.

### Updating the Worker

Requires a current Node.js LTS version and a Cloudflare account:

```powershell
npm ci
npm run test:worker
npm run worker:check
npm run worker:login
npm run worker:deploy
```

If a browser callback is unavailable, use `npx wrangler login --device`. On a new Cloudflare account, open **Workers & Pages** and finish free `workers.dev` subdomain setup. A newly registered subdomain can need time for HTTPS provisioning.

The deploy command prints the API URL. Put it in `config.js` as `apiBase` and increment the config script's version in `index.html`, then push the frontend changes to GitHub. Cloudflare credentials are kept outside the repository; `.dev.vars`, `.wrangler`, and `node_modules` are ignored. No secrets or tokens belong in `config.js`.

Free-plan requests and CPU limits still apply. See the [Cloudflare dashboard](https://dash.cloudflare.com/) for actual usage. The service uses no scheduled tasks or background polling. Cache entries can be evicted, in which case a song is fetched again from the source.

### Local development and Python alternative

Run `npm run worker:dev` to test the Worker locally on port 8787. Point `apiBase` at it and add your frontend origin to `ALLOWED_ORIGINS` for that test. The existing Python server remains available for local use: set `apiBase` to `''` to let localhost use it automatically. Python hosting is optional; a separately hosted Python backend can still be connected by setting its `HYMN_ALLOWED_ORIGIN` and `apiBase`.

When a configured backend is unavailable, title search falls back to the static index. The worship program always reads bundled project files and does not depend on Cloudflare.

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
npm run test:worker
npm run worker:check
```

Song text and audio retain their original attribution. Online hymns link to hymnal.net; worship lyric sections include their source URLs in `data/worship.json`.
