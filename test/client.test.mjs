import test from 'node:test';
import assert from 'node:assert/strict';
import { GameStore } from '../web/game-store.mjs';

const memory = () => { const values = new Map(); return { get: key => values.get(key) ?? null, set: (key, value) => values.set(key, value) }; };
const game = (id = 'topic') => ({ token: id, puzzleId: id, mode: 'daily', pack: { id, name: id }, serverTime: '2026-10-12T00:00:00Z', endsAt: '2026-10-12T15:00:00Z', date: '2026-10-12' });

test('a late response cannot overwrite a newer topic selection', async () => {
  let resolveFirst;
  const store = new GameStore((route, body) => body.packId === 'first' ? new Promise(resolve => { resolveFirst = resolve; }) : Promise.resolve(game('second')), memory(), () => Date.parse('2026-10-12T00:00:00Z'));
  const first = store.begin('first');
  await store.begin('second');
  resolveFirst(game('first')); await first;
  assert.equal(store.getSnapshot().game.pack.id, 'second');
  assert.equal(store.getSnapshot().busy, false);
});

test('canonical alias duplicates and unknown words never inflate the attempt count', async () => {
  const result = { id: 'arona', word: '아로나', rank: 20, similarity: 90, correct: false, hint: false };
  const store = new GameStore((route, body) => {
    if (route === '/api/games') return Promise.resolve(game());
    if (body.word === 'missing') return Promise.reject(Object.assign(new Error('없는 단어'), { code: 'UNKNOWN_WORD' }));
    return Promise.resolve(result);
  }, memory());
  await store.begin('topic');
  await store.submit('아로나'); await store.submit('Arona'); await store.submit('missing');
  assert.equal(store.getSnapshot().guesses.length, 1);
  assert.equal(store.getSnapshot().busy, false);
});

test('history restoration uses server scores and share text conceals the answer', async () => {
  const storage = memory();
  storage.set('bluemantle:topic:daily:topic', { guesses: [{ id: 'secret', hint: false }], gaveUp: false });
  const result = { id: 'secret', word: '숨겨진 정답', rank: 1, similarity: 100, correct: true, hint: false };
  const store = new GameStore(route => Promise.resolve(route === '/api/games' ? game() : route === '/api/restore' ? { guesses: [result] } : { ...result, description: '설명' }), storage);
  await store.begin('topic');
  assert.equal(store.getSnapshot().answer.word, '숨겨진 정답');
  assert.equal(store.getSnapshot().guesses[0].similarity, 100);
  assert.ok(!store.shareText('https://example.com').includes('숨겨진 정답'));
});

test('initial game request failure keeps a visible retry path', async () => {
  const store = new GameStore(() => Promise.reject(new Error('network')), memory());
  await store.begin('topic');
  assert.equal(store.getSnapshot().fatal, true);
  assert.equal(store.getSnapshot().busy, false);
});

test('client countdown expires exactly at the server midnight, never one second early', async () => {
  let now = Date.parse('2026-10-12T14:59:59.500Z');
  const store = new GameStore(() => Promise.resolve({ ...game(), serverTime: new Date(now).toISOString() }), memory(), () => now);
  await store.begin('topic');
  assert.equal(store.getSnapshot().countdown, '00:00:01');
  assert.equal(store.getSnapshot().expired, false);
  now = Date.parse('2026-10-12T15:00:00.000Z'); store.tick();
  assert.equal(store.getSnapshot().expired, true);
});

test('connection failures keep accepted guesses and can be retried without another attempt', async () => {
  let fail = true;
  const store = new GameStore(async (route, body) => {
    if (route === '/api/games') return game();
    if (route === '/api/connections') {
      if (fail) throw new Error('map network failure');
      return { ids: body.ids, similarities: [[100, 0], [0, 100]] };
    }
    return { id: body.word, word: body.word, rank: 20, similarity: 5, hint: false, correct: false };
  }, memory());
  await store.begin('topic');
  await store.submit('one'); await store.submit('two');
  assert.equal(store.getSnapshot().guesses.length, 2);
  assert.equal(store.getSnapshot().connectionsError, true);
  fail = false; await store.loadConnections();
  assert.deepEqual(store.getSnapshot().connections.ids, ['one', 'two']);
  assert.equal(store.getSnapshot().connectionsError, false);
  assert.equal(store.getSnapshot().guesses.length, 2);
});

test('a late connection response cannot replace the map of another puzzle', async () => {
  let resolveMap;
  const store = new GameStore(async (route, body) => {
    if (route === '/api/games') return game(body.packId);
    if (route === '/api/connections') return new Promise(resolve => { resolveMap = resolve; });
    return { id: body.word, word: body.word, rank: 20, similarity: 5, hint: false, correct: false };
  }, memory());
  await store.begin('first'); await store.submit('one');
  const pending = store.submit('two');
  await new Promise(resolve => setImmediate(resolve));
  await store.begin('second');
  resolveMap({ ids: ['one', 'two'], similarities: [[100, 0], [0, 100]] }); await pending;
  assert.equal(store.getSnapshot().game.pack.id, 'second');
  assert.equal(store.getSnapshot().guesses.length, 0);
  assert.equal(store.getSnapshot().connections, null);
});
