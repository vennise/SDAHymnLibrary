(() => {
  const video = $('#worship-video');
  let songs = [];
  let selected = -1;
  video.volume = .8;

  function updatePlayButton() {
    for (const selector of ['#worship-play', '#worship-top-play']) {
      $(selector).replaceChildren(document.createTextNode(video.paused ? '▶ ' : 'Ⅱ '), element('span', '', video.paused ? 'Play' : 'Pause'));
      $(selector).setAttribute('aria-label', video.paused ? 'Play worship recording' : 'Pause worship recording');
    }
  }

  function mediaActions(worshipMode) {
    if (!('mediaSession' in navigator)) return;
    navigator.mediaSession.setActionHandler('play', worshipMode ? playLocal : play);
    navigator.mediaSession.setActionHandler('pause', () => worshipMode ? video.pause() : audio.pause());
    navigator.mediaSession.setActionHandler('previoustrack', () => worshipMode ? selectLocal(selected - 1) : step(-1));
    navigator.mediaSession.setActionHandler('nexttrack', () => worshipMode ? selectLocal(selected + 1) : step(1));
  }

  function renderList() {
    const fragment = document.createDocumentFragment();
    for (const song of songs) {
      const row = element('div', 'song-row'); row.dataset.songId = song.id;
      const button = element('button', 'song-open'); button.type = 'button';
      button.append(element('span', 'song-number', song.id), element('span', 'worship-song-name', song.title), element('span', 'result-arrow', '›'));
      button.onclick = () => selectLocal(songs.indexOf(song));
      const start = element('button', 'play-button worship-list-play');
      start.type = 'button'; start.append(document.createTextNode('▶ '), element('span', '', 'Play'));
      start.setAttribute('aria-label', `Play ${song.title}`);
      start.onclick = () => selectLocal(songs.indexOf(song), true);
      row.append(button, start); fragment.append(row);
    }
    $('#worship-songs').replaceChildren(fragment);
    HymnMotion.rows($('#worship-songs'));
  }

  async function openProgram() {
    audio.pause(); showLyrics(false);
    $('#search-page').hidden = true; $('#player').hidden = true;
    $('#worship-page').hidden = false; document.body.classList.add('worship-open');
    mediaActions(true); showList();
    if (songs.length) return;
    $('#worship-list-status').textContent = 'Loading your recordings…';
    try {
      songs = (await fetchJSON(new URL('data/worship.json', document.baseURI))).songs;
      renderList(); $('#worship-list-status').textContent = '';
    } catch {
      $('#worship-list-status').replaceChildren(document.createTextNode('Could not load the worship program. '));
      const retry = element('button', 'text-button', 'Try again'); retry.onclick = openProgram; $('#worship-list-status').append(retry);
    }
  }

  function showList() {
    selected = -1; video.pause();
    $('#worship-list-view').hidden = false; $('#worship-song-view').hidden = true;
    $('#worship-player').hidden = true; $('#worship-font-controls').hidden = true;
    $('#worship-back').textContent = '← Back to search';
    $('#worship-list-view').scrollTop = 0;
    $('#worship-back').focus({ preventScroll: true });
    HymnMotion.page($('#worship-list-view')); HymnMotion.rows($('#worship-songs')); HymnMotion.rise($('#worship-page .lyrics-toolbar'));
  }

  function closeProgram() {
    selected = -1; video.pause(); video.removeAttribute('src'); video.load();
    $('#worship-page').hidden = true; $('#worship-player').hidden = true;
    document.body.classList.remove('worship-open'); $('#search-page').hidden = false;
    $('#player').hidden = !state.selected; $('#open-worship').focus({ preventScroll: true });
    mediaActions(false);
    HymnMotion.page($('#search-page'));
    if ('mediaSession' in navigator && 'MediaMetadata' in window) navigator.mediaSession.metadata = state.detail ? new MediaMetadata({ title: state.detail.title, artist: names[state.selected.type], album: 'Hymn Library' }) : null;
  }

  function selectLocal(index, autoplay = false) {
    if (index < 0 || index >= songs.length) return;
    selected = index; const song = songs[index]; video.pause();
    $('#worship-list-view').hidden = true; $('#worship-song-view').hidden = false;
    $('#worship-player').hidden = false; $('#worship-font-controls').hidden = false;
    $('#worship-back').textContent = '← Worship Program Songs';
    $('#worship-title').textContent = song.title; $('#worship-lyrics').replaceChildren();
    $('#worship-media-status').textContent = ''; $('#worship-seek').disabled = true;
    $('#worship-elapsed').textContent = '0:00'; $('#worship-duration').textContent = '0:00'; $('#worship-seek').value = 0;
    $('#worship-previous').disabled = index === 0; $('#worship-next').disabled = index === songs.length - 1;
    $('#worship-play').disabled = false; $('#worship-top-play').disabled = false;
    const mediaURL = new URL(song.media, document.baseURI).href;
    $('#worship-original').href = mediaURL;
    video.src = mediaURL; video.load(); updatePlayButton();
    $('#worship-song-view').scrollTop = 0; $('#worship-title').focus({ preventScroll: true });
    if ('mediaSession' in navigator && 'MediaMetadata' in window) navigator.mediaSession.metadata = new MediaMetadata({ title: song.title, artist: 'Worship Program' });
    // Start within the user's click gesture; lyric retrieval must not delay playback.
    if (autoplay) playLocal();
    for (const section of song.sections) {
      if (section.title) $('#worship-lyrics').append(element('h2', 'worship-section-title', section.title));
      for (const text of section.verses) $('#worship-lyrics').append(element('div', 'verse', text));
    }
    HymnMotion.page($('#worship-song-view')); HymnMotion.rise($('#worship-player')); HymnMotion.rise($('#worship-page .lyrics-toolbar'));
  }

  async function playLocal() {
    if (selected < 0) return;
    try { await video.play(); }
    catch (error) { if (error.name !== 'AbortError') $('#worship-media-status').textContent = `Unable to play (${error.name}). Try the Open audio link, or reload this page.`; }
  }

  video.addEventListener('play', updatePlayButton);
  video.addEventListener('pause', updatePlayButton);
  video.addEventListener('emptied', updatePlayButton);
  video.addEventListener('loadedmetadata', () => { $('#worship-duration').textContent = clock(video.duration); $('#worship-seek').disabled = !Number.isFinite(video.duration); });
  video.addEventListener('timeupdate', () => { $('#worship-elapsed').textContent = clock(video.currentTime); $('#worship-seek').value = video.duration > 0 ? video.currentTime / video.duration * 100 : 0; });
  video.addEventListener('error', () => { if (video.getAttribute('src')) { const error = video.error; $('#worship-media-status').textContent = `Playback error ${error?.code || ''}: ${error?.message || 'Unable to decode the recording.'} You can also use the Open audio link.`; } });
  // Service items always wait for the worship leader; no automatic next track.
  $('#open-worship').onclick = openProgram;
  $('#worship-back').onclick = () => selected < 0 ? closeProgram() : showList();
  $('#worship-play').onclick = () => video.paused ? playLocal() : video.pause();
  $('#worship-top-play').onclick = () => video.paused ? playLocal() : video.pause();
  $('#worship-previous').onclick = () => selectLocal(selected - 1);
  $('#worship-next').onclick = () => selectLocal(selected + 1);
  $('#worship-volume').oninput = event => { video.volume = Number(event.target.value); };
  $('#worship-seek').oninput = event => { if (Number.isFinite(video.duration)) video.currentTime = Number(event.target.value) / 100 * video.duration; };
  $('#worship-font-down').onclick = () => resizeFont(-2); $('#worship-font-up').onclick = () => resizeFont(2);
  document.addEventListener('keydown', event => {
    if ($('#worship-page').hidden) return;
    if (event.key === 'Escape') { selected < 0 ? closeProgram() : showList(); return; }
    if (event.code === 'Space' && selected >= 0 && !['INPUT', 'BUTTON', 'SELECT'].includes(document.activeElement.tagName)) { event.preventDefault(); video.paused ? playLocal() : video.pause(); }
  });
})();
