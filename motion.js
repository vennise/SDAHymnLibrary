(() => {
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const running = new WeakMap();
  function animate(node, frames, options) {
    running.get(node)?.cancel();
    if (reduced.matches) return;
    const animation = node.animate(frames, { duration: 240, easing: 'cubic-bezier(.2,.75,.25,1)', ...options });
    running.set(node, animation);
  }
  function rise(node, delay = 0) {
    animate(node, [{ opacity: 0, transform: 'translateY(10px)' }, { opacity: 1, transform: 'translateY(0)' }], { delay, fill: 'backwards' });
  }
  function words(node, delay = 0) {
    if (!node || reduced.matches) return;
    // Preserve whitespace, line breaks, verse labels, and the natural accessible text.
    const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT, {
      acceptNode: text => text.textContent.trim() && !text.parentElement.closest('.motion-word, .verse-number') ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT,
    });
    const texts = []; while (walker.nextNode()) texts.push(walker.currentNode);
    for (const text of texts) {
      const fragment = document.createDocumentFragment();
      for (const part of text.textContent.split(/(\s+)/)) {
        if (!part) continue;
        if (/^\s+$/.test(part)) fragment.append(document.createTextNode(part));
        else { const span = document.createElement('span'); span.className = 'motion-word'; span.textContent = part; fragment.append(span); }
      }
      text.replaceWith(fragment);
    }
    const spans = [...node.querySelectorAll('.motion-word')];
    const step = Math.min(23, 280 / Math.max(1, spans.length - 1));
    spans.forEach((span, index) => animate(span, [
      { opacity: 0, transform: 'translateY(7px) scale(.98)' },
      { opacity: 1, transform: 'translateY(0) scale(1)' },
    ], { duration: 220, delay: delay + index * step, fill: 'backwards' }));
  }
  const waiting = new Set();
  const observer = new IntersectionObserver(entries => {
    entries.filter(entry => entry.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top).forEach((entry, index) => {
      words(entry.target, Math.min(index * 40, 120)); observer.unobserve(entry.target); waiting.delete(entry.target);
    });
  }, { threshold: .08 });
  function lyrics(root) {
    for (const verse of waiting) if (!verse.isConnected) { observer.unobserve(verse); waiting.delete(verse); }
    root.querySelectorAll('.verse').forEach(verse => { waiting.add(verse); observer.observe(verse); });
  }
  function page(root) {
    if (!root) return;
    rise(root);
    root.querySelectorAll('h1, .intro, .eyebrow, .worship-launch strong, .worship-launch small').forEach((node, index) => words(node, Math.min(index * 35, 140)));
    root.querySelectorAll('.topbar, .lyrics-toolbar, .worship-launch, .search-box, .results-heading, footer').forEach((node, index) => rise(node, Math.min(index * 45, 180)));
    lyrics(root);
  }
  function rows(root, previous = new Set()) {
    [...root.querySelectorAll('.song-row')].filter(row => !previous.has(row.dataset.songId)).forEach((row, index) => {
      const delay = Math.min(index, 5) * 35;
      rise(row, delay);
      words(row.querySelector('.song-info strong, .worship-song-name'), delay + 25);
    });
    const empty = root.querySelector('.empty'); if (empty) rise(empty);
  }
  document.addEventListener('click', event => {
    const button = event.target.closest('button');
    if (!button || button.disabled) return;
    animate(button, [{ transform: 'scale(.97)' }, { transform: 'scale(1)' }], { duration: 150 });
  });
  for (const [media, controls] of [['#audio', '#play'], ['#worship-video', '#worship-play, #worship-top-play']]) {
    for (const type of ['play', 'pause']) document.querySelector(media).addEventListener(type, () => {
      document.querySelectorAll(controls).forEach(button => animate(button, [{ opacity: .65 }, { opacity: 1 }], { duration: 120 }));
    });
  }
  const statuses = new MutationObserver(entries => {
    const changed = new Set(entries.map(entry => (entry.target.nodeType === Node.ELEMENT_NODE ? entry.target : entry.target.parentElement)?.closest('[role="status"]')));
    for (const status of changed) if (status && status.textContent.trim() && !status.hidden) rise(status);
  });
  document.querySelectorAll('[role="status"]').forEach(status => statuses.observe(status, { childList: true, characterData: true, subtree: true }));
  window.HymnMotion = { page, rows, lyrics, rise, words };
})();
