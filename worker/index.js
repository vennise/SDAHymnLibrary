import { decodeHTML } from 'entities';
import catalog from '../data/catalog.json';

const SOURCE = 'https://www.hymnal.net';
const CATALOG_JSON = JSON.stringify(catalog);
const LABELS = {
  'main-audio-singing': ['Singing', 'vocal'],
  'main-audio-full': ['Piano · full song', 'instrumental'],
  'main-audio': ['Piano · verse', 'instrumental'],
  'main-audio-guide': ['Melody guide', 'instrumental'],
};

export function recordingURL(value) {
  try {
    const url = new URL(value);
    return url.origin === SOURCE && url.pathname.startsWith('/Hymns/') && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}

export async function parseSong(response, id) {
  let composition = null;
  let jsonText = '';
  let verseText = '';
  let currentAudio = null;
  const verses = [];
  const recordings = [];
  const transformed = new HTMLRewriter()
    .on('script[type="application/ld+json"]', {
      element(element) {
        jsonText = '';
        element.onEndTag(() => {
          try {
            const value = JSON.parse(jsonText);
            if (value['@type'] === 'MusicComposition') composition = value;
          } catch { /* Other structured-data blocks are not hymn compositions. */ }
        });
      },
      text(chunk) { jsonText += chunk.text; },
    })
    .on('.lyrics .text-container', {
      element(element) {
        verseText = '';
        element.onEndTag(() => { if (verseText.trim()) verses.push(decodeHTML(verseText.trim())); });
      },
      text(chunk) { verseText += chunk.text; },
    })
    .on('.lyrics .text-container br', { element() { verseText += '\n'; } })
    .on('audio[id^="main-audio"]', {
      element(element) {
        currentAudio = { id: element.getAttribute('id'), stanzas: element.getAttribute('data-stanzas') || '' };
      },
    })
    .on('audio[id^="main-audio"] source', {
      element(element) {
        const url = recordingURL(element.getAttribute('src'));
        if (!currentAudio || !url || element.getAttribute('type') !== 'audio/mpeg') return;
        const [label, kind] = LABELS[currentAudio.id] || ['Recording', 'other'];
        const timings = currentAudio.stanzas.split(',').flatMap(item => {
          const match = /^(\d+(?:\.\d+)?):v(\d+)$/.exec(item);
          return match ? [{ time: Number(match[1]), verse: Number(match[2]) }] : [];
        });
        recordings.push({ url, label, kind, timings });
      },
    }).transform(response);
  // Consume without constructing another complete copy of the source HTML.
  await transformed.body.pipeTo(new WritableStream({ write() {} }));
  if (!composition?.name) throw new Error('The hymn source did not return a readable song.');
  return {
    id, title: decodeHTML(composition.name),
    lyrics: composition.lyrics?.text || verses.join('\n\n'),
    key: composition.musicalKey || '', recordings,
    source: `${SOURCE}/en/hymn/${id}`,
  };
}

async function sourceFetch(url, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);
  try {
    return await fetch(url, { ...options, signal: controller.signal, redirect: 'manual' });
  } finally { clearTimeout(timeout); }
}

async function songDetail(id, request, context) {
  const cacheKey = new Request(new URL(`/cached-song/v1/${id}`, request.url));
  const hit = await caches.default.match(cacheKey);
  if (hit) return hit.json();
  const response = await sourceFetch(`${SOURCE}/en/hymn/${id}`, {
    headers: { Accept: 'text/html', 'User-Agent': 'SDAHymnLibrary/1.0' },
  });
  if (!response.ok) {
    const error = new Error(response.status === 404 ? 'Hymn not found.' : 'The hymn source is temporarily unavailable.');
    error.status = response.status === 404 ? 404 : 502;
    throw error;
  }
  const song = await parseSong(response, id);
  const cached = Response.json(song, { headers: { 'Cache-Control': 'public, max-age=604800' } });
  context.waitUntil(caches.default.put(cacheKey, cached));
  return song;
}

async function streamRecording(id, index, request, context) {
  const song = await songDetail(id, request, context);
  const url = recordingURL(song.recordings[index]?.url);
  if (!url) return json({ error: 'Recording not found.' }, 404);
  const headers = new Headers({ Referer: song.source, 'User-Agent': 'SDAHymnLibrary/1.0', 'Accept-Encoding': 'identity' });
  const range = request.headers.get('Range');
  if (range) {
    if (!/^bytes=\d*-\d*$/.test(range) || range === 'bytes=-') return json({ error: 'Invalid audio range.' }, 400);
    headers.set('Range', range);
  }
  const upstream = await sourceFetch(url, {
    method: request.method, headers,
    cf: { cacheEverything: true, cacheTtl: 86400 },
  });
  if (upstream.status === 416) {
    const result = new Headers();
    if (upstream.headers.has('Content-Range')) result.set('Content-Range', upstream.headers.get('Content-Range'));
    return new Response(null, { status: 416, headers: result });
  }
  if (!upstream.ok) { await upstream.body?.cancel(); return json({ error: 'This recording is temporarily unavailable. Try another version.' }, 502); }
  const result = new Headers();
  for (const name of ['Content-Type', 'Content-Length', 'Content-Range', 'Accept-Ranges', 'ETag', 'Last-Modified']) {
    if (upstream.headers.has(name)) result.set(name, upstream.headers.get(name));
  }
  result.set('Content-Type', 'audio/mpeg');
  result.set('Cache-Control', 'public, max-age=86400');
  // Forward the stream; do not buffer an entire recording in Worker memory.
  return new Response(request.method === 'HEAD' ? null : upstream.body, { status: upstream.status, headers: result });
}

function json(value, status = 200) {
  return Response.json(value, { status, headers: { 'Cache-Control': status === 200 ? 'public, max-age=300' : 'no-store' } });
}

function cors(response, origin, allowed) {
  const headers = new Headers(response.headers);
  if (origin && allowed.includes(origin)) headers.set('Access-Control-Allow-Origin', origin);
  headers.set('Vary', 'Origin');
  headers.set('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
  headers.set('Access-Control-Allow-Headers', 'Range');
  headers.set('Access-Control-Expose-Headers', 'Content-Range, Accept-Ranges, Content-Length');
  headers.set('X-Content-Type-Options', 'nosniff');
  return new Response(response.body, { status: response.status, headers });
}

export default {
  async fetch(request, env, context) {
    const allowed = (env.ALLOWED_ORIGINS || 'https://vennise.github.io').split(',').map(value => value.trim());
    const origin = request.headers.get('Origin');
    if (origin && !allowed.includes(origin)) return json({ error: 'This website is not configured to use this hymn service.' }, 403);
    let response;
    try {
      const path = new URL(request.url).pathname;
      if (request.method === 'OPTIONS') response = new Response(null, { status: 204 });
      else if (!['GET', 'HEAD'].includes(request.method)) response = json({ error: 'Method not allowed.' }, 405);
      else if (path === '/health') response = json({ status: 'ok', service: 'SDAHymnLibrary', catalog: catalog.songs.length });
      else if (path === '/api/catalog') response = new Response(CATALOG_JSON, { headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'public, max-age=86400' } });
      else {
        const song = /^\/api\/song\/((?:h|nt|ns|c|lb)\/\d{1,6})$/.exec(path);
        const audio = /^\/api\/audio\/((?:h|nt|ns|c|lb)\/\d{1,6})\/(\d{1,2})$/.exec(path);
        if (song) response = json(await songDetail(song[1], request, context));
        else if (audio) response = await streamRecording(audio[1], Number(audio[2]), request, context);
        else response = json({ error: 'Endpoint not found.' }, 404);
      }
    } catch (error) {
      console.error('Hymn request failed:', error.message);
      response = json({ error: error.status ? error.message : 'Unable to load the hymn source. Please try again shortly.' }, error.status || 502);
    }
    if (request.method === 'HEAD') response = new Response(null, { status: response.status, headers: response.headers });
    return cors(response, origin, allowed);
  },
};
