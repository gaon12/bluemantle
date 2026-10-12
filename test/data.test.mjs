import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { loadPack } from '../src/pack.mjs';
import { GameService, Puzzle } from '../src/game.mjs';

test('real Blue Archive and coffee embeddings load in the same engine', async () => {
  const [archive, coffee] = await Promise.all([
    loadPack(fileURLToPath(new URL('../data/packs/blue-archive', import.meta.url))),
    loadPack(fileURLToPath(new URL('../examples/coffee', import.meta.url))),
  ]);
  assert.ok(archive.terms.length > 2000);
  assert.ok(archive.resolve('에리카') !== undefined);
  assert.ok(archive.resolve('키사키') !== undefined);
  assert.ok(new Set(archive.terms.map(t => t.category)).size >= 10);
  assert.equal(archive.resolve('시딤의 상자'), archive.resolve('싯딤의 상자'));
  assert.equal(archive.resolve('C&C'), archive.resolve('Cleaning&Clearing'));
  assert.equal(coffee.resolve('라떼'), coffee.resolve('카페 라테'));
  const service = new GameService(new Map([[archive.manifest.id, archive], [coffee.manifest.id, coffee]]), 'real-pack-test');
  const a = service.open(archive.manifest.id);
  const b = service.open(coffee.manifest.id);
  assert.equal(a.pack.termCount, archive.terms.length);
  assert.equal(b.pack.termCount, 12);
  assert.notEqual(a.puzzleId, b.puzzleId);
  assert.equal(service.resolve(b.token).puzzle.guess('에스프레소').word, '에스프레소');
  // A domain-specific smoke check detects wrong models, row mappings, or missing context.
  const arona = new Puzzle(archive, archive.resolve('아로나'));
  assert.ok(arona.guess('싯딤의 상자').rank <= 20);
  assert.ok(arona.guess('싯딤의 상자').similarity > 50);
  assert.ok(Math.abs(arona.guess('청휘석').similarity) < 15);
  const currency = new Puzzle(archive, archive.resolve('청휘석'));
  assert.ok(currency.guess('모집').rank <= 20);
  assert.ok(currency.guess('모집').similarity > 50);
  const skill = new Puzzle(archive, archive.resolve('사라져주세요사라져주세요!'));
  assert.ok(skill.guess('에리카').similarity < 10);
  // Fixed sampling catches a return to inflated raw domain scores.
  let seed = 42;
  const next = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return Math.floor(seed / 4294967296 * archive.terms.length); };
  const randomScores = Array.from({ length: 2000 }, () => archive.geometry.cosine(next(), next()) * 100).sort((a, b) => a - b);
  assert.ok(Math.abs(randomScores[1000]) < 10);
  assert.ok(randomScores[1980] < 60);
});
