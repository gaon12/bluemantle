import test from 'node:test';
import assert from 'node:assert/strict';
import { request as httpRequest } from 'node:http';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createApp } from '../src/server.mjs';
import { GameService } from '../src/game.mjs';
import { fixturePack } from './helpers.mjs';

async function running(t) {
  const pack = fixturePack();
  const service = new GameService(new Map([['fruit', pack]]), 'test-secret');
  const staticRoot = await mkdtemp(path.join(os.tmpdir(), 'bluemantle-static-test-'));
  await mkdir(path.join(staticRoot, 'assets'));
  await writeFile(path.join(staticRoot, 'index.html'), '<html><body><div id="root"></div><script src="/assets/app-test.js"></script></body></html>');
  await writeFile(path.join(staticRoot, 'assets/app-test.js'), 'console.log("test asset")');
  t.after(() => rm(staticRoot, { recursive: true, force: true }));
  const server = createApp(service, [], staticRoot);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (url, body) => fetch(base + url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return { base, post, service };
}

test('HTTP game flow scores aliases, hints, restores and reveals on explicit request', async t => {
  const { base, post, service } = await running(t);
  const packs = await (await fetch(base + '/api/packs')).json();
  assert.equal(packs.packs[0].id, 'fruit');
  assert.equal(Object.hasOwn(packs.packs[0], 'embedding'), false);
  const game = await (await post('/api/games', { packId: 'fruit' })).json();
  const puzzle = service.resolve(game.token).puzzle;
  const answer = puzzle.reveal();
  const guess = await (await post('/api/guess', { token: game.token, word: answer.word })).json();
  assert.equal(guess.correct, true);
  const restored = await (await post('/api/restore', { token: game.token, guesses: [{ id: guess.id, hint: false }] })).json();
  assert.equal(restored.guesses[0].correct, true);
  assert.equal(Object.hasOwn(restored, 'answer'), false);
  assert.equal((await (await post('/api/reveal', { token: game.token })).json()).word, answer.word);
});

test('unknown words, malformed requests and tampered games return structured errors', async t => {
  const { post, base } = await running(t);
  const game = await (await post('/api/games', { packId: 'fruit' })).json();
  const unknown = await post('/api/guess', { token: game.token, word: '없는 단어' });
  assert.equal(unknown.status, 422);
  assert.equal((await unknown.json()).error.code, 'UNKNOWN_WORD');
  assert.equal((await post('/api/guess', { token: 'bad', word: '사과' })).status, 401);
  assert.equal((await fetch(base + '/api/games', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{' })).status, 400);
  assert.equal((await fetch(base + '/api/games', { method: 'POST', body: '{}' })).status, 415);
  assert.equal((await post('/api/restore', { token: game.token, guesses: [{ id: 'invented', hint: false }] })).status, 400);
});

test('static routes never expose vocabulary, vectors, secrets or server source', async t => {
  const { base } = await running(t);
  for (const route of ['/data/packs/fruit/terms.json', '/src/server.mjs', '/.bluemantle/secret', '/manifest.json']) assert.equal((await fetch(base + route)).status, 404);
  const page = await fetch(base + '/');
  assert.equal(page.status, 200);
  assert.ok(page.headers.get('content-security-policy').includes("script-src 'self'"));
  assert.ok((await page.text()).includes('id="root"'));
  const asset = await fetch(base + '/assets/app-test.js');
  assert.equal(asset.status, 200);
  assert.ok(asset.headers.get('cache-control').includes('immutable'));
  assert.equal((await fetch(base + '/assets/missing.js')).status, 404);
});

test('split UTF-8 request chunks preserve Korean words', async t => {
  const { base, post } = await running(t);
  const game = await (await post('/api/games', { packId: 'fruit' })).json();
  const raw = Buffer.from(JSON.stringify({ token: game.token, word: '사과' }));
  const position = raw.indexOf(Buffer.from('사')) + 1;
  const result = await new Promise((resolve, reject) => {
    const request = httpRequest(base + '/api/guess', { method: 'POST', headers: { 'Content-Type': 'application/json' } }, response => {
      const chunks = []; response.on('data', chunk => chunks.push(chunk)); response.on('end', () => resolve(JSON.parse(Buffer.concat(chunks))));
    });
    request.on('error', reject); request.write(raw.subarray(0, position));
    setTimeout(() => request.end(raw.subarray(position)), 5);
  });
  assert.equal(result.word, '사과');
});
