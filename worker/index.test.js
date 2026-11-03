import { createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { afterEach, describe, expect, it, vi } from 'vitest';
import worker, { parseSong, recordingURL } from './index.js';

const ORIGIN = 'https://vennise.github.io';
const SOURCE = 'https://www.hymnal.net';
const AUDIO = `${SOURCE}/Hymns/Test/example.mp3`;
const fixture = `<script type="application/ld+json">${JSON.stringify({ '@type': 'MusicComposition', name: 'Example hymn', musicalKey: 'C Major' })}</script>
<div class="lyrics"><div class="text-container">First &amp; second<br>Third line</div><div class="chord-container">C G Am</div><div class="text-container">Another verse</div></div>
<audio id="learn-audio"><source src="${AUDIO}" type="audio/mpeg"></audio>
<audio id="main-audio-full" data-stanzas="1.5:v1,20:v2,40:end"><source src="${AUDIO}" type="audio/mpeg"></audio>
<audio id="main-audio-singing"><source src="${AUDIO}" type="audio/mpeg"></audio>`;

async function invoke(path, options = {}) {
  const context = createExecutionContext();
  const response = await worker.fetch(new Request(`https://worker.example${path}`, { ...options, headers: { Origin: ORIGIN, ...options.headers } }), { ALLOWED_ORIGINS: ORIGIN }, context);
  await waitOnExecutionContext(context);
  return response;
}

afterEach(() => { vi.restoreAllMocks(); });

describe('Cloudflare hymn adapter', () => {
  it('serves a searchable catalog without fetching the source', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch');
    const response = await invoke('/api/catalog');
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe(ORIGIN);
    expect((await response.json()).songs.length).toBeGreaterThan(3000);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('uses native HTML parsing for fallback lyrics, recording types, and timings', async () => {
    const detail = await parseSong(new Response(fixture), 'h/98760');
    expect(detail.lyrics).toBe('First & second\nThird line\n\nAnother verse');
    expect(detail.recordings).toHaveLength(2);
    expect(detail.recordings[0].timings).toEqual([{ time: 1.5, verse: 1 }, { time: 20, verse: 2 }]);
    expect(detail.recordings[1].kind).toBe('vocal');
  });

  it('streams byte ranges and reuses cached song metadata', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, options) => {
      if (String(url).includes('/en/hymn/')) return new Response(fixture);
      expect(url).toBe(AUDIO);
      expect(options.headers.get('Referer')).toBe(`${SOURCE}/en/hymn/h/98761`);
      expect(options.headers.get('Range')).toBe('bytes=2-5');
      return new Response('2345', { status: 206, headers: { 'Content-Type': 'audio/mpeg', 'Content-Length': '4', 'Content-Range': 'bytes 2-5/10' } });
    });
    const response = await invoke('/api/audio/h/98761/1', { headers: { Range: 'bytes=2-5' } });
    expect(response.status).toBe(206);
    expect(response.headers.get('Content-Range')).toBe('bytes 2-5/10');
    expect(new TextDecoder().decode(await response.arrayBuffer())).toBe('2345');
    expect((await (await invoke('/api/song/h/98761')).json()).title).toBe('Example hymn');
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('preserves structured lyrics and returns readable source errors', async () => {
    const text = 'Example line\nAnother example';
    const page = `<script type="application/ld+json">${JSON.stringify({ '@type': 'MusicComposition', name: 'Example', lyrics: { text } })}</script>`;
    expect((await parseSong(new Response(page), 'c/98762')).lyrics).toBe(text);
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('', { status: 503 }));
    const response = await invoke('/api/song/h/98763');
    expect(response.status).toBe(502);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe(ORIGIN);
    expect((await response.json()).error).toContain('temporarily unavailable');
  });

  it('restricts upstream audio and does not expose an arbitrary URL proxy', async () => {
    expect(recordingURL('https://example.com/Hymns/file.mp3')).toBeNull();
    expect(recordingURL('https://www.hymnal.net@evil.example/Hymns/file.mp3')).toBeNull();
    expect(recordingURL(`${SOURCE}/private/file.mp3`)).toBeNull();
    expect(recordingURL(AUDIO)).toBe(AUDIO);
    const response = await invoke('/api/audio?url=https://example.com');
    expect(response.status).toBe(404);
  });

  it('handles CORS preflight, HEAD, and unconfigured origins', async () => {
    expect((await invoke('/api/song/h/1', { method: 'OPTIONS' })).status).toBe(204);
    const head = await invoke('/api/catalog', { method: 'HEAD' });
    expect(await head.text()).toBe('');
    const forbidden = await invoke('/api/catalog', { headers: { Origin: 'https://another.example' } });
    expect(forbidden.status).toBe(403);
    expect(forbidden.headers.has('Access-Control-Allow-Origin')).toBe(false);
  });
});
