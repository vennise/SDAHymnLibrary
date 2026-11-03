const $ = (selector) => document.querySelector(selector);
const names = { h: 'Classic Hymns', nt: 'New Tunes', ns: 'New Songs', c: 'Children’s Songs' };
const configuredBackend = window.HYMN_CONFIG?.apiBase?.trim();
const initialBackendBase = configuredBackend ? new URL(configuredBackend.replace(/\/?$/, '/'), document.baseURI).href : ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname) ? new URL('./', document.baseURI).href : null;
let backendBase = initialBackendBase;
function saved(key, fallback) { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; } }
function store(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* Storage may be unavailable. */ } }
const state = { songs: [], query: '', limit: 40, favorites: new Set(saved('hymn-favorites', [])), recent: saved('hymn-recent', []), selected: null, detail: null, request: 0, details: new Map(), pending: new Map() };
const audio = $('#audio');
audio.volume = .8;
let toastTimer;
function toast(message) { $('#toast').textContent = message; $('#toast').hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { $('#toast').hidden = true; }, 5000); }
async function fetchJSON(path) { const response = await fetch(path); if (!response.ok) throw new Error('Unable to load the requested file.'); return response.json(); }
function apiURL(path) { if (!backendBase) throw new Error('Online hymn playback needs a connected hymn service.'); return new URL(path.replace(/^\//, ''), backendBase).href; }
async function api(path) { const response = await fetch(apiURL(path)); if (!response.ok) { let message = 'Unable to reach the song library.'; try { message = (await response.json()).error || message; } catch {} throw new Error(message); } return response.json(); }
function matching() {
  return HymnSearch.searchSongs(state.songs, state.query);
}
function element(tag, className, text) { const node = document.createElement(tag); if (className) node.className = className; if (text !== undefined) node.textContent = text; return node; }
function render() {
  const previous = new Set([...$('#songs').querySelectorAll('.song-row')].map(row => row.dataset.songId));
  const results = matching();
  const fragment = document.createDocumentFragment();
  for (const song of results.slice(0, state.limit)) {
    const row = element('div', `song-row${state.selected?.id === song.id ? ' selected' : ''}`); row.dataset.type = song.type; row.dataset.songId = song.id;
    const open = element('button', 'song-open'); open.type = 'button'; open.setAttribute('aria-label', `Open ${song.title}, ${names[song.type]} ${song.number}`);
    open.append(element('span', 'song-number', song.number));
    const info = element('span', 'song-info'); info.append(element('strong', '', song.title), element('small', '', `Hymn ${song.number} · ${names[song.type]}`)); open.append(info, element('span', 'result-arrow', '›'));
    open.addEventListener('click', () => selectSong(song));
    const favorite = element('button', `icon-button favorite${state.favorites.has(song.id) ? ' active' : ''}`, state.favorites.has(song.id) ? '♥' : '♡');
    favorite.setAttribute('aria-label', `Favorite ${song.title}`); favorite.setAttribute('aria-pressed', String(state.favorites.has(song.id))); favorite.onclick = () => toggleFavorite(song.id);
    row.append(open, favorite); fragment.append(row);
  }
  if (!results.length) fragment.append(element('div', 'empty', !state.query ? 'Enter a hymn number or a few words from its title to get started.' : state.songs.length ? 'No matching titles or hymn numbers. Try fewer words or another title.' : 'Getting the hymn index ready. Your search will appear as soon as it loads.'));
  $('#songs').replaceChildren(fragment);
  HymnMotion.rows($('#songs'), previous);
  $('#library-title').textContent = state.query ? 'Search results' : 'Search for a hymn';
  $('#results-count').textContent = state.query ? `${results.length.toLocaleString()} ${results.length === 1 ? 'match' : 'matches'}` : '';
  $('#load-more').hidden = results.length <= state.limit;
  $('#player-favorite').textContent = state.favorites.has(state.selected?.id) ? '♥' : '♡';
  $('#player-favorite').setAttribute('aria-pressed', String(state.favorites.has(state.selected?.id)));
}
function toggleFavorite(id) { if (state.favorites.has(id)) state.favorites.delete(id); else state.favorites.add(id); store('hymn-favorites', [...state.favorites]); render(); }
function showLyrics(show = true) {
  if (show && !state.selected) return;
  $('#lyrics-panel').hidden = !show; document.body.classList.toggle('lyrics-open', show);
  $('#search-page').hidden = show; $('#lyrics-toggle').setAttribute('aria-expanded', String(show));
  if (show) { $('#lyric-title').focus({ preventScroll: true }); HymnMotion.page($('#lyrics-panel')); }
  else { $('#search').focus({ preventScroll: true }); HymnMotion.page($('#search-page')); }
}
async function detailFor(id) {
  if (state.details.has(id)) return state.details.get(id);
  if (!state.pending.has(id)) state.pending.set(id, api(`/api/song/${id}`).then(data => { state.details.set(id, data); return data; }).finally(() => state.pending.delete(id)));
  return state.pending.get(id);
}
async function selectSong(song, autoplay = false) {
  const request = ++state.request;
  state.selected = song; state.detail = null; audio.pause(); audio.removeAttribute('src'); audio.load();
  const playerWasHidden = $('#player').hidden;
  $('#player').hidden = false; if (playerWasHidden) HymnMotion.rise($('#player')); document.body.classList.add('has-song'); $('.lyrics-scroll').scrollTop = 0;
  $('#play').disabled = true; $('#seek').disabled = true; $('#player-favorite').disabled = false;
  $('#lyric-title').textContent = song.title; $('#lyric-collection').textContent = `${names[song.type]} · ${song.number}`;
  $('#playing-title').textContent = song.title; $('#playing-subtitle').textContent = 'Loading recording…';
  $('#lyric-meta').textContent = ''; $('#lyrics').replaceChildren(); $('#recording').replaceChildren(); $('#recording').disabled = true; $('#source-link').hidden = true;
  $('#song-status').textContent = 'Getting lyrics and recordings…'; showLyrics(); render();
  $('#source-link').textContent = 'View hymn on hymnal.net ↗';
  if (!backendBase) {
    $('#song-status').textContent = 'Open this hymn on hymnal.net for its lyrics and recordings. The Worship Program plays directly on this website.';
    $('#playing-subtitle').textContent = 'Online hymn · open source to listen';
    $('#source-link').href = `https://www.hymnal.net/en/hymn/${song.id}`; $('#source-link').textContent = 'Open hymn on hymnal.net ↗'; $('#source-link').hidden = false;
    return;
  }
  try {
    const detail = await detailFor(song.id); if (request !== state.request) return;
    state.detail = detail; $('#lyric-title').textContent = detail.title; $('#lyric-meta').textContent = [names[song.type], `No. ${song.number}`, detail.key].filter(Boolean).join(' · ');
    for (const [index, text] of detail.lyrics.split(/\n\s*\n/).filter(Boolean).entries()) { const verse = element('div', 'verse'); verse.dataset.verse = index + 1; verse.append(element('span', 'verse-number', `VERSE ${index + 1}`), document.createTextNode(text)); $('#lyrics').append(verse); }
    if (!detail.lyrics) $('#lyrics').append(element('p', 'empty', 'Lyrics are not available for this hymn.'));
    HymnMotion.words($('#lyric-title')); HymnMotion.rise($('#lyric-meta')); HymnMotion.lyrics($('#lyrics'));
    const recordings = detail.recordings;
    recordings.forEach((recording, index) => { const option = element('option', '', `${recording.kind === 'vocal' ? 'Vocal' : 'Instrumental'} · ${recording.label}`); option.value = index; $('#recording').append(option); });
    $('#recording').disabled = !recordings.length; $('#source-link').href = detail.source; $('#source-link').hidden = false;
    if (!recordings.length) { $('#song-status').textContent = 'No playable recording is available for this hymn.'; $('#playing-subtitle').textContent = 'Lyrics only'; return; }
    const preferred = saved('hymn-recording-kind', 'vocal'); const choice = Math.max(0, recordings.findIndex(recording => recording.kind === preferred));
    $('#recording').value = choice; setRecording(autoplay);
    if ('mediaSession' in navigator && 'MediaMetadata' in window) navigator.mediaSession.metadata = new MediaMetadata({ title: detail.title, artist: names[song.type], album: 'Hymn Library' });
  } catch (error) { if (request !== state.request) return; $('#song-status').textContent = error.message; $('#playing-subtitle').textContent = 'Could not load song'; const retry = element('button', 'text-button', 'Try again'); retry.onclick = () => selectSong(song); $('#lyrics').append(retry); }
}
function setRecording(autoplay) {
  const recording = state.detail?.recordings[Number($('#recording').value)]; if (!recording) return;
  audio.src = apiURL(`/api/audio/${state.selected.id}/${$('#recording').value}`); audio.load(); $('#play').disabled = false;
  $('#playing-subtitle').textContent = `${names[state.selected.type]} · ${recording.label}`;
  $('#song-status').textContent = recording.timings.length ? 'Verse highlighting is available for this recording.' : 'Lyrics view · synchronized highlighting is not available for this recording.';
  document.querySelectorAll('.verse.current').forEach(verse => verse.classList.remove('current'));
  if (autoplay) play();
}
async function play() { try { await audio.play(); } catch (error) { if (error.name === 'NotAllowedError') toast('Press Play to start listening.'); else if (error.name !== 'AbortError') toast('This recording could not play. Try another recording or open the source link.'); } }
function step(direction) { const list = matching(); if (!list.length) return; const index = list.findIndex(song => song.id === state.selected?.id); selectSong(list[(index + direction + list.length) % list.length], !audio.paused); }
function clock(seconds) { if (!Number.isFinite(seconds)) return '0:00'; return `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`; }
audio.addEventListener('play', () => { $('#play').replaceChildren(document.createTextNode('Ⅱ '), element('span', '', 'Pause')); $('#play').setAttribute('aria-label', 'Pause'); const id = state.selected?.id; if (id) { state.recent = [id, ...state.recent.filter(item => item !== id)].slice(0, 100); store('hymn-recent', state.recent); } });
audio.addEventListener('pause', () => { $('#play').replaceChildren(document.createTextNode('▶ '), element('span', '', 'Play')); $('#play').setAttribute('aria-label', 'Play'); });
audio.addEventListener('loadedmetadata', () => { $('#duration').textContent = clock(audio.duration); $('#seek').disabled = !Number.isFinite(audio.duration); });
audio.addEventListener('emptied', () => { $('#elapsed').textContent = '0:00'; $('#duration').textContent = '0:00'; $('#seek').value = 0; });
audio.addEventListener('timeupdate', () => {
  $('#elapsed').textContent = clock(audio.currentTime); $('#seek').value = Number.isFinite(audio.duration) && audio.duration > 0 ? audio.currentTime / audio.duration * 100 : 0;
  const recording = state.detail?.recordings[Number($('#recording').value)]; if (!recording?.timings.length) return;
  const current = recording.timings.filter(item => item.time <= audio.currentTime).at(-1)?.verse;
  document.querySelectorAll('.verse').forEach(verse => { const active = Number(verse.dataset.verse) === current; if (active && !verse.classList.contains('current') && !$('#lyrics-panel').hidden) verse.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); verse.classList.toggle('current', active); });
});
audio.addEventListener('error', () => { if (audio.getAttribute('src')) { $('#song-status').textContent = 'Recording unavailable. Choose another recording or visit the source below.'; toast('Unable to stream this recording. Try another version.'); } });
audio.addEventListener('ended', () => { if (!audio.loop) { const list = matching(); const index = list.findIndex(song => song.id === state.selected?.id); if (list.length > 1) selectSong(list[(index + 1) % list.length], true); } });
$('#play').onclick = () => audio.paused ? play() : audio.pause(); $('#previous').onclick = () => step(-1); $('#next').onclick = () => step(1);
$('#repeat').onclick = () => { audio.loop = !audio.loop; $('#repeat').setAttribute('aria-pressed', String(audio.loop)); };
$('#volume').oninput = event => { audio.volume = Number(event.target.value); };
$('#seek').oninput = event => { if (Number.isFinite(audio.duration)) audio.currentTime = Number(event.target.value) / 100 * audio.duration; };
$('#recording').onchange = () => { const recording = state.detail.recordings[Number($('#recording').value)]; store('hymn-recording-kind', recording.kind); setRecording(!audio.paused); };
$('#close-lyrics').onclick = () => showLyrics(false); $('#lyrics-toggle').onclick = () => showLyrics($('#lyrics-panel').hidden); $('#open-lyrics').onclick = () => showLyrics();
$('#player-favorite').onclick = () => { if (state.selected) toggleFavorite(state.selected.id); };
let fontSize = Math.max(14, Math.min(32, Number(saved('hymn-font-size', 24)) || 24));
function resizeFont(delta) { fontSize = Math.max(14, Math.min(32, fontSize + delta)); document.documentElement.style.setProperty('--lyric-size', `${fontSize}px`); store('hymn-font-size', fontSize); }
resizeFont(0); $('#font-down').onclick = () => resizeFont(-2); $('#font-up').onclick = () => resizeFont(2);
$('#search').oninput = event => { state.query = event.target.value.trim(); state.limit = 40; render(); };
$('#search-form').onsubmit = event => { event.preventDefault(); state.query = $('#search').value.trim(); state.limit = 40; render(); };
$('#load-more').onclick = () => { state.limit += 40; render(); };
document.addEventListener('keydown', event => { if (!$('#worship-page').hidden) return; if (event.key === 'Escape' && !$('#lyrics-panel').hidden) { showLyrics(false); return; } if (['INPUT', 'SELECT', 'TEXTAREA', 'BUTTON'].includes(document.activeElement.tagName)) return; if (event.key === '/') { event.preventDefault(); showLyrics(false); $('#search').focus(); } if (event.code === 'Space' && state.detail?.recordings.length) { event.preventDefault(); audio.paused ? play() : audio.pause(); } });
function connection() { $('#connection').textContent = navigator.onLine ? backendBase ? '● Online library' : '● Worship & title search' : '○ No internet connection'; }
window.addEventListener('online', connection); window.addEventListener('offline', connection); connection();
async function loadCatalog() {
  $('#retry-catalog').hidden = true;
  const cached = saved('hymn-catalog', null);
  if (cached?.songs?.length && !state.songs.length) { state.songs = cached.songs; render(); $('#catalog-status').textContent = 'Search is ready. Checking for updates…'; }
  try {
    let catalog;
    try { backendBase = initialBackendBase; catalog = await api('/api/catalog'); }
    catch { backendBase = null; catalog = await fetchJSON(new URL('data/catalog.json', document.baseURI)); }
    state.songs = catalog.songs; store('hymn-catalog', catalog); render();
    $('#catalog-status').textContent = backendBase ? catalog.unavailable.length ? `Some hymns could not load: ${catalog.unavailable.join(', ')}. Retry to reconnect.` : `${state.songs.length.toLocaleString()} hymns ready to search · title or exact hymn number` : `${state.songs.length.toLocaleString()} titles ready to search · worship recordings play here; other hymns open on hymnal.net`;
    $('#retry-catalog').hidden = !backendBase || !catalog.unavailable.length;
    connection();
  }
  catch (error) { $('#catalog-status').textContent = state.songs.length ? 'Showing your cached library. Reconnect to load recordings.' : error.message; $('#retry-catalog').hidden = false; render(); }
}
$('#retry-catalog').onclick = loadCatalog;
if ('mediaSession' in navigator) { navigator.mediaSession.setActionHandler('play', play); navigator.mediaSession.setActionHandler('pause', () => audio.pause()); navigator.mediaSession.setActionHandler('previoustrack', () => step(-1)); navigator.mediaSession.setActionHandler('nexttrack', () => step(1)); }
// Both players share the same compact preference without replacing media controls.
let playerCompact = saved('hymn-player-compact', true);
const playerSizeButtons = [...document.querySelectorAll('.player')].map(player => {
  const button = player.querySelector('.player-size-toggle') || element('button', 'player-size-toggle icon-button');
  button.type = 'button'; button.setAttribute('aria-controls', player.id);
  player.prepend(button);
  button.onclick = () => { playerCompact = !playerCompact; store('hymn-player-compact', playerCompact); updatePlayerSize(); };
  return button;
});
function updatePlayerSize() {
  document.documentElement.classList.toggle('player-compact', playerCompact);
  if (!playerCompact) document.querySelectorAll('.player:not([hidden]) .player-heading, .player:not([hidden]) .volume, .player:not([hidden]) #worship-original').forEach(node => HymnMotion.rise(node, 60));
  for (const button of playerSizeButtons) {
    button.textContent = playerCompact ? '⌃' : '⌄';
    button.title = playerCompact ? 'Expand player' : 'Shrink player';
    button.setAttribute('aria-label', button.title);
    button.setAttribute('aria-expanded', String(!playerCompact));
  }
}
updatePlayerSize();
render(); loadCatalog();
HymnMotion.page($('#search-page'));
