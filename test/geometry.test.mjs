import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { SemanticSpace } from '../src/geometry.mjs';
import { TopicPack } from '../src/pack.mjs';
import { GameService, Puzzle } from '../src/game.mjs';
import { fixturePack } from './helpers.mjs';
import { connectionIds, projectConnections } from '../web/connection-map.mjs';

function ringPack() {
  const template = fixturePack();
  const vectors = [], terms = [];
  for (let i = 0; i < 6; i++) {
    const angle = i * Math.PI / 3, norm = Math.sqrt(101);
    vectors.push(10 / norm, Math.cos(angle) / norm, Math.sin(angle) / norm);
    terms.push({ id: `direction-${i}`, label: `방향${i}`, description: 'test direction', category: 'fruit' });
  }
  return new TopicPack(template.manifest, terms, new Float32Array(vectors), 'ring');
}

test('centering removes shared domain similarity while keeping distinct directions', () => {
  const pack = ringPack(), puzzle = new Puzzle(pack, 0);
  assert.ok(pack.vectors[0] * pack.vectors[3] > .98);
  assert.equal(puzzle.guess('방향1').similarity, 50);
  assert.equal(puzzle.guess('방향5').similarity, 50);
  assert.equal(puzzle.guess('방향3').similarity, -100);
  const relation = puzzle.connections(['direction-1', 'direction-5']);
  assert.equal(relation.similarities[0][1], -50);
  assert.deepEqual(puzzle.connections(relation.ids), new Puzzle(pack, 3).connections(relation.ids));
  assert.deepEqual(Object.keys(relation).sort(), ['ids', 'similarities']);
});

test('degenerate and centroid vectors produce finite scores instead of invented directions', () => {
  const geometry = new SemanticSpace(new Float32Array([1, 0, 1, 0, 1, 0]), 2);
  assert.equal(geometry.cosine(0, 1), 0);
  const projection = projectConnections([[0, 0], [0, 0]]);
  assert.equal(projection.coverage, 0);
  assert.ok(projection.points.flat().every(Number.isFinite));
});

test('connection comparisons validate IDs, uniqueness and a bounded matrix', () => {
  const puzzle = new Puzzle(fixturePack(), 0);
  for (const ids of [null, ['missing'], ['apple', 'apple'], [3], Array(33).fill('apple')]) assert.throws(() => puzzle.connections(ids), { code: 'INVALID_CONNECTIONS' });
  assert.deepEqual(puzzle.connections([]), { ids: [], similarities: [] });
  const { similarities } = puzzle.connections(['apple', 'juice', 'bread']);
  assert.equal(similarities[0][1], similarities[1][0]);
  assert.ok(similarities[0][1] > similarities[0][2]);
});

test('a 2D projection retains pair distances for planar input, including equal target scores', () => {
  const puzzle = new Puzzle(ringPack(), 0);
  const similarities = puzzle.connections(puzzle.pack.terms.map(t => t.id)).similarities;
  const { points, coverage } = projectConnections(similarities);
  assert.ok(Math.abs(coverage - 1) < .0001);
  const distance = (a, b) => Math.hypot(points[a][0] - points[b][0], points[a][1] - points[b][1]);
  assert.ok(Math.abs(distance(0, 1) - distance(0, 5)) < .0001);
  assert.ok(distance(1, 5) > distance(0, 1) * 1.7);
  assert.deepEqual(projectConnections(similarities), { points, coverage });
  assert.ok(projectConnections([[100, 100], [100, 100]]).points.flat().every(Number.isFinite));
});

test('large histories keep recent exploration and best leads in chronological order', () => {
  const guesses = Array.from({ length: 100 }, (_, i) => ({ id: String(i), rank: i + 1 }));
  const ids = connectionIds(guesses);
  assert.equal(ids.length, 32);
  assert.deepEqual(ids.slice(0, 16), guesses.slice(0, 16).map(g => g.id));
  assert.deepEqual(ids.slice(16), guesses.slice(-16).map(g => g.id));
});

test('scoring upgrades reject old tokens and separate incompatible local histories', () => {
  const pack = fixturePack(), service = new GameService(new Map([['fruit', pack]]), 'secret');
  const current = service.open('fruit');
  const payload = JSON.parse(Buffer.from(current.token.split('.')[0], 'base64url'));
  delete payload.scoringVersion;
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const old = `${body}.${createHmac('sha256', 'secret').update(body).digest('hex')}`;
  assert.throws(() => service.resolve(old), { code: 'RULES_CHANGED' });
  assert.notEqual(current.token, old);
  assert.equal(current.scoring.method, 'corpus-centered-cosine');
});
