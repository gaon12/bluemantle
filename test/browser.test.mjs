import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { fixturePack } from './helpers.mjs';
import { BrowserGameService } from '../web/browser-game.mjs';
import { loadBrowserPack } from '../web/browser-pack.mjs';
import { loadPack } from '../src/pack.mjs';
import { Puzzle } from '../src/puzzle.mjs';
import { GameStore } from '../web/game-store.mjs';

const pack = fixturePack();
const getPack = async id => {
  if (id !== pack.manifest.id) throw Object.assign(new Error('Unknown pack'), { code: 'UNKNOWN_PACK' });
  return pack;
};
const memory = () => { const values = new Map(); return { get: key => values.get(key) ?? null, set: (key, value) => values.set(key, value) }; };

test('browser daily games agree across clients and cover eligible answers once per cycle', async () => {
  let now = new Date('2026-10-13T00:00:00Z');
  const first = new BrowserGameService(getPack, () => now), second = new BrowserGameService(getPack, () => now);
  const answers = [];
  for (let i = 0; i < pack.answerIndices.length; i++) {
    const a = await first.open(pack.manifest.id), b = await second.open(pack.manifest.id);
    assert.deepEqual(a, b);
    const { puzzle } = await first.resolve(a.token);
    answers.push(puzzle.answerIndex);
    assert.ok(pack.terms[puzzle.answerIndex].answer !== false);
    assert.equal(a.endsAt, new Date(now.getTime() + 15 * 3600000).toISOString());
    now = new Date(now.getTime() + 86400000);
  }
  assert.equal(new Set(answers).size, pack.answerIndices.length);
});

test('browser token restoration rejects midnight, pack and scoring changes', async () => {
  let now = new Date('2026-10-13T14:59:59Z');
  const service = new BrowserGameService(getPack, () => now), game = await service.open(pack.manifest.id);
  assert.equal(game.date, '2026-10-13');
  const change = patch => JSON.stringify({ ...JSON.parse(game.token), ...patch });
  await assert.rejects(service.resolve('bad'), { code: 'INVALID_GAME' });
  await assert.rejects(service.resolve(change({ fingerprint: 'old' })), { code: 'PACK_CHANGED' });
  await assert.rejects(service.resolve(change({ rules: 'old' })), { code: 'RULES_CHANGED' });
  now = new Date('2026-10-13T15:00:00Z');
  await assert.rejects(service.resolve(game.token), { code: 'DAY_CHANGED' });
  assert.equal((await service.open(pack.manifest.id)).date, '2026-10-14');
});

test('browser practice games, hints, maps and saved history work without HTTP APIs', async () => {
  const storage = memory(), service = new BrowserGameService(getPack);
  const client = async (route, body) => route === '/api/packs' ? { packs: [pack.publicInfo()] } : service.request(route, body);
  const store = new GameStore(client, storage);
  await store.begin(pack.manifest.id, 'practice');
  const original = store.state.game;
  const { puzzle } = await service.resolve(original.token);
  const worst = pack.terms[puzzle.order.at(-1)];
  await store.submit(worst.label);
  await store.submit(worst.aliases?.[0] ?? worst.label);
  assert.equal(store.state.guesses.length, 1);
  await store.hint();
  assert.equal(store.state.guesses.length, 2);
  assert.ok(store.state.guesses[1].rank < store.state.guesses[0].rank);
  assert.deepEqual(store.state.connections.ids, store.state.guesses.map(g => g.id));
  const restarted = new GameStore(client, storage);
  await restarted.initialize();
  assert.equal(restarted.state.game.puzzleId, original.puzzleId);
  assert.deepEqual(restarted.state.guesses, store.state.guesses);
  await restarted.submit(puzzle.reveal().word);
  assert.equal(restarted.state.answer.word, puzzle.reveal().word);
  assert.ok(!restarted.shareText('https://gaon12.github.io/bluemantle/').includes(puzzle.reveal().word));
  await restarted.begin(pack.manifest.id, 'practice', true);
  assert.notEqual(restarted.state.game.puzzleId, original.puzzleId);
});

test('browser pack checksums and scores agree with the real server pack', async () => {
  const directory = new URL('../data/packs/blue-archive/', import.meta.url);
  const serverPack = await loadPack(fileURLToPath(directory));
  const manifest = serverPack.manifest, index = JSON.parse(await readFile(new URL(manifest.embeddings, directory), 'utf8'));
  const entry = { manifest, fingerprint: serverPack.fingerprint, terms: manifest.terms, vectors: index.file,
    termsSha256: index.termsSha256, vectorsSha256: index.vectorsSha256 };
  const fetcher = async url => {
    const bytes = await readFile(url);
    return { ok: true, arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) };
  };
  const browserPack = await loadBrowserPack(entry, directory, fetcher);
  const target = serverPack.resolve('아리스'), browserPuzzle = new Puzzle(browserPack, target), serverPuzzle = new Puzzle(serverPack, target);
  for (const word of ['아리스 댄스', '몰?루', '밀레니엄', '아루', '아!루']) assert.deepEqual(browserPuzzle.guess(word), serverPuzzle.guess(word));
  const ids = ['몰?루', '아리스 댄스', '밀레니엄'].map(word => serverPack.terms[serverPack.resolve(word)].id);
  assert.deepEqual(browserPuzzle.connections(ids), serverPuzzle.connections(ids));
  await assert.rejects(loadBrowserPack({ ...entry, vectorsSha256: 'bad' }, directory, fetcher), { code: 'PACK_LOAD_FAILED' });
});
