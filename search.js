(function (root) {
  function normalize(value) {
    return String(value).normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/['’]/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  }
  const order = { h: 0, nt: 1, ns: 2, c: 3 };
  function hasWord(words, token) {
    return words.some(word => word === token || (token.length >= 3 && word.startsWith(token)));
  }
  function distance(left, right) {
    const rows = Array.from({ length: left.length + 1 }, () => Array(right.length + 1).fill(0));
    for (let i = 0; i <= left.length; i++) rows[i][0] = i;
    for (let j = 0; j <= right.length; j++) rows[0][j] = j;
    for (let i = 1; i <= left.length; i++) {
      for (let j = 1; j <= right.length; j++) {
        rows[i][j] = Math.min(rows[i - 1][j] + 1, rows[i][j - 1] + 1, rows[i - 1][j - 1] + (left[i - 1] === right[j - 1] ? 0 : 1));
        if (i > 1 && j > 1 && left[i - 1] === right[j - 2] && left[i - 2] === right[j - 1]) rows[i][j] = Math.min(rows[i][j], rows[i - 2][j - 2] + 1);
      }
    }
    return rows[left.length][right.length];
  }
  function fuzzyScore(title, tokens) {
    const words = title.split(' ');
    let mistakes = 0;
    for (const token of tokens) {
      if (hasWord(words, token)) continue;
      // Keep short words exact; allow a small spelling error budget for the title.
      const allowance = token.length >= 5 ? 2 : token.length >= 4 ? 1 : 0;
      if (!allowance) return Infinity;
      let best = Infinity;
      for (const word of words) {
        if (Math.abs(word.length - token.length) <= allowance) best = Math.min(best, distance(token, word));
      }
      if (best > allowance) return Infinity;
      mistakes += best;
      if (mistakes > 2) return Infinity;
    }
    return 10 + mistakes + Math.max(0, words.length - tokens.length) * 0.01;
  }
  function searchSongs(songs, query) {
    const raw = query.trim();
    if (!raw) return [];
    const number = /^(?:hymn\s*|#\s*)?(\d+)$/i.exec(raw);
    const phrase = normalize(raw);
    if (!phrase) return [];
    const tokens = phrase.split(/\s+/);
    return songs.map(song => {
      if (number) return { song, score: Number(song.number) === Number(number[1]) ? 0 : Infinity };
      const title = normalize(song.title);
      const score = title === phrase ? 0 : title.startsWith(phrase) ? 1 : title.includes(phrase) ? 2 : tokens.every(token => hasWord(title.split(' '), token)) ? 3 : fuzzyScore(title, tokens);
      return { song, score };
    }).filter(item => Number.isFinite(item.score)).sort((a, b) => a.score - b.score || (order[a.song.type] ?? 4) - (order[b.song.type] ?? 4) || a.song.title.localeCompare(b.song.title) || Number(a.song.number) - Number(b.song.number)).map(item => item.song);
  }
  if (typeof module !== 'undefined' && module.exports) module.exports = { normalize, searchSongs };
  else root.HymnSearch = { normalize, searchSongs };
})(typeof window !== 'undefined' ? window : globalThis);
