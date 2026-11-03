const { test } = require('node:test');
const assert = require('node:assert/strict');
const { searchSongs } = require('../search.js');
const songs = [
  { id: 'c/12', type: 'c', number: '12', title: 'Jesus loves me' },
  { id: 'h/112', type: 'h', number: '112', title: 'Another song', topic: '12 apostles' },
  { id: 'h/12', type: 'h', number: '12', title: 'Glory be to God the Father' },
  { id: 'ns/99', type: 'ns', number: '99', title: 'Jesus loves me, this I know' },
  { id: 'h/44', type: 'h', number: '44', title: 'O Lord, Thou art my God!' },
];
test('exact number excludes substring numbers and unrelated metadata', () => {
  for (const query of ['12', '#12', 'hymn 12', '0012']) assert.deepEqual(searchSongs(songs, query).map(s => s.id), ['h/12', 'c/12']);
});
test('exact title ranks before longer titles across collections', () => {
  assert.deepEqual(searchSongs(songs, 'JESUS LOVES ME').map(s => s.id), ['c/12', 'ns/99']);
});
test('title words can be entered out of order and without punctuation', () => {
  assert.equal(searchSongs(songs, 'god glory father')[0].id, 'h/12');
  assert.equal(searchSongs(songs, 'O Lord Thou art my God')[0].id, 'h/44');
});
test('blank or unrelated queries do not flood the page with hymns', () => {
  for (const query of ['', ' ', '!!!', 'not a hymn', 'apostles']) assert.deepEqual(searchSongs(songs, query), []);
});
test('misspelled Jesus finds Jesus loves me', () => {
  assert.ok(searchSongs(songs, 'juses love me').some(song => song.id === 'c/12'));
  assert.ok(searchSongs(songs, 'jeuss loves me').some(song => song.id === 'c/12'));
});
test('exact matches stay ahead of fuzzy matches and number typos stay exact', () => {
  const titles = [...songs, { id: 'ns/10', type: 'ns', number: '10', title: 'Juses love me' }];
  assert.equal(searchSongs(titles, 'juses love me')[0].id, 'ns/10');
  assert.deepEqual(searchSongs(songs, '13'), []);
});
test('typo results favor focused titles and do not match me inside name', () => {
  const titles = [...songs,
    { id: 'h/500', type: 'h', number: '500', title: 'Jesus has loved me, wonderful Savior' },
    { id: 'h/501', type: 'h', number: '501', title: 'Jesus that name we love' },
  ];
  const results = searchSongs(titles, 'juses love me');
  assert.equal(results[0].id, 'c/12');
  assert.ok(!results.some(song => song.id === 'h/501'));
});
