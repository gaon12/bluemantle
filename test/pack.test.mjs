import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm, mkdir, cp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { loadPack, loadPacks, TopicPack, sha256 } from '../src/pack.mjs';
import { fixturePack } from './helpers.mjs';

async function diskPack(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'bluemantle-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const pack = fixturePack();
  const manifest = { ...pack.manifest, terms: 'terms.json', embeddings: 'embeddings.json' };
  const terms = JSON.stringify(pack.terms);
  const vectors = Buffer.alloc(pack.vectors.length * 4);
  pack.vectors.forEach((value, i) => vectors.writeFloatLE(value, i * 4));
  const index = { schemaVersion: 1, ...manifest.embedding, maxTokens: 512, dtype: 'float32-le', termsSha256: sha256(terms), vectorsSha256: sha256(vectors), file: 'vectors.f32', ids: pack.terms.map(term => term.id) };
  await Promise.all([
    writeFile(path.join(root, 'manifest.json'), JSON.stringify(manifest)), writeFile(path.join(root, 'terms.json'), terms),
    writeFile(path.join(root, 'embeddings.json'), JSON.stringify(index)), writeFile(path.join(root, 'vectors.f32'), vectors),
  ]);
  return { root, manifest, index };
}

test('binary pack loads and validates real row order and checksums', async t => {
  const { root } = await diskPack(t);
  const pack = await loadPack(root);
  assert.equal(pack.terms.length, 4);
  assert.equal(pack.resolve('apple'), 0);
  assert.ok(Math.abs(Math.hypot(...pack.vectors.slice(9, 12)) - 1) < 1e-6);
});

test('modified descriptions cannot silently reuse stale embeddings', async t => {
  const { root } = await diskPack(t);
  const filename = path.join(root, 'terms.json');
  await writeFile(filename, (await readFile(filename, 'utf8')).replace('붉은 과일', '다른 설명'));
  await assert.rejects(loadPack(root), /Terms changed/);
});

test('embedding row reorder and file corruption are rejected', async t => {
  const { root, index } = await diskPack(t);
  index.ids.reverse();
  await writeFile(path.join(root, 'embeddings.json'), JSON.stringify(index));
  await assert.rejects(loadPack(root), /row order/);
  index.ids.reverse();
  await writeFile(path.join(root, 'embeddings.json'), JSON.stringify(index));
  const file = path.join(root, 'vectors.f32');
  const bytes = await readFile(file); bytes[0] ^= 1; await writeFile(file, bytes);
  await assert.rejects(loadPack(root), /checksum/);
});

test('model or prompt changes require regenerated vectors', async t => {
  const { root, manifest } = await diskPack(t);
  manifest.embedding.prompt = 'SearchQuery';
  await writeFile(path.join(root, 'manifest.json'), JSON.stringify(manifest));
  await assert.rejects(loadPack(root), /configuration changed/);
});

test('editing the TXT without rebuilding embeddings invalidates the pack', async t => {
  const { root, manifest, index } = await diskPack(t);
  const words = '사과\n배\n빵\n사과 주스\n';
  manifest.vocabulary = 'words.txt'; index.vocabularySha256 = sha256(words);
  await writeFile(path.join(root, 'manifest.json'), JSON.stringify(manifest));
  await writeFile(path.join(root, 'embeddings.json'), JSON.stringify(index));
  await writeFile(path.join(root, 'words.txt'), words);
  await loadPack(root);
  await writeFile(path.join(root, 'words.txt'), words + '새로운 용어\n');
  await assert.rejects(loadPack(root), /TXT vocabulary changed/);
});

test('path traversal in a pack manifest is rejected', async t => {
  const { root, manifest } = await diskPack(t);
  manifest.terms = '../terms.json';
  await writeFile(path.join(root, 'manifest.json'), JSON.stringify(manifest));
  await assert.rejects(loadPack(root), /direct children/);
});

test('invalid numerical vectors and ambiguous aliases fail loudly', () => {
  const pack = fixturePack();
  const terms = structuredClone(pack.terms); terms[1].aliases = ['애플'];
  assert.throws(() => new TopicPack(pack.manifest, terms, new Float32Array(pack.vectors), 'test'), /Ambiguous/);
  const zero = new Float32Array(pack.vectors); zero.fill(0, 0, 3);
  assert.throws(() => new TopicPack(pack.manifest, pack.terms, zero, 'test'), /Zero vector/);
  const nan = new Float32Array(pack.vectors); nan[0] = NaN;
  assert.throws(() => new TopicPack(pack.manifest, pack.terms, nan, 'test'), /Nonfinite/);
});

test('one unavailable pack does not prevent other topics from loading', async t => {
  const { root } = await diskPack(t);
  const logs = [];
  const registry = path.join(root, 'registry');
  await mkdir(path.join(registry, 'ready'), { recursive: true });
  await mkdir(path.join(registry, 'broken'));
  for (const name of ['manifest.json', 'terms.json', 'embeddings.json', 'vectors.f32']) await cp(path.join(root, name), path.join(registry, 'ready', name));
  const loaded = await loadPacks(registry, message => logs.push(message));
  assert.equal(loaded.packs.size, 1);
  assert.equal(loaded.packs.get('fruit').terms.length, 4);
  assert.deepEqual(loaded.unavailable, [{ id: 'broken', name: 'broken', ready: false }]);
  assert.equal(logs.length, 1);
});
