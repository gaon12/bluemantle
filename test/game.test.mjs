import test from 'node:test';
import assert from 'node:assert/strict';
import { dailyAnswer, dateInTimezone, nextMidnight, Puzzle, GameService } from '../src/game.mjs';
import { normalize } from '../src/pack.mjs';
import { SemanticSpace } from '../src/geometry.mjs';
import { fixturePack } from './helpers.mjs';

test('Unicode, whitespace and registered aliases resolve to one term', () => {
  const pack = fixturePack();
  assert.equal(normalize(' ＡＰＰＬＥ . '), 'apple');
  assert.equal(pack.resolve('ＡＰＰＬＥ'), pack.resolve('애플'));
  assert.equal(pack.resolve('사과 주스'), pack.resolve('사과쥬스'));
  assert.notEqual(normalize('학생(수영복)'), normalize('학생'));
});

test('similarity ranks the whole vocabulary and exact alias matches win', () => {
  const puzzle = new Puzzle(fixturePack(), 0);
  assert.deepEqual(puzzle.guess('APPLE'), { id: 'apple', word: '사과', similarity: 100, rank: 1, correct: true, hint: false });
  assert.equal(puzzle.guess('사과쥬스').rank, 2);
  assert.ok(puzzle.guess('빵').similarity < 0);
  assert.equal(new Set(puzzle.ranks).size, 4);
  assert.throws(() => puzzle.guess('unknown'), { code: 'UNKNOWN_WORD', status: 422 });
  assert.throws(() => puzzle.guess(''), { code: 'INVALID_GUESS' });
});

test('identical vectors do not turn a different word into the answer', () => {
  const pack = fixturePack();
  pack.vectors.set(pack.vectors.slice(0, 3), 3);
  pack.geometry = new SemanticSpace(pack.vectors, pack.dimensions);
  const puzzle = new Puzzle(pack, 0);
  assert.equal(puzzle.guess('배').correct, false);
  assert.equal(puzzle.guess('배').similarity, 99.99);
  assert.equal(puzzle.guess('사과').rank, 1);
  assert.equal(puzzle.guess('배').rank, 2);
});

test('hints improve rank, never reveal the answer, and stop at the nearest neighbor', () => {
  const puzzle = new Puzzle(fixturePack(), 0);
  const first = puzzle.hint(['bread']);
  assert.ok(first.rank < puzzle.guess('빵').rank);
  assert.equal(first.correct, false);
  assert.equal(first.hint, true);
  assert.throws(() => puzzle.hint(['juice']), { code: 'NO_MORE_HINTS' });
  assert.throws(() => puzzle.hint(['apple']), { code: 'ALREADY_SOLVED' });
  assert.throws(() => puzzle.hint(['missing']), { code: 'INVALID_HISTORY' });
});

test('daily answers are stable and include all eligible terms once per cycle', () => {
  const pack = fixturePack();
  const answers = ['2026-10-12', '2026-10-13', '2026-10-14'].map(date => dailyAnswer(pack, date, 'secret'));
  assert.equal(new Set(answers).size, 3);
  assert.ok(answers.every(index => pack.terms[index].answer !== false));
  assert.equal(dailyAnswer(pack, '2026-10-12', 'secret'), answers[0]);
});

test('Seoul dates change at Korean midnight independent of the host timezone', () => {
  assert.equal(dateInTimezone(new Date('2026-10-12T14:59:59Z'), 'Asia/Seoul'), '2026-10-12');
  assert.equal(dateInTimezone(new Date('2026-10-12T15:00:00Z'), 'Asia/Seoul'), '2026-10-13');
  assert.equal(nextMidnight(new Date('2026-10-12T14:59:59Z'), 'Asia/Seoul'), '2026-10-12T15:00:00.000Z');
});

test('next midnight handles DST days rather than adding 24 hours', () => {
  assert.equal(nextMidnight(new Date('2026-11-01T04:00:00Z'), 'America/New_York'), '2026-11-02T05:00:00.000Z');
  assert.equal(nextMidnight(new Date('2026-03-08T05:00:00Z'), 'America/New_York'), '2026-03-09T04:00:00.000Z');
});

test('daily games survive service restarts with the same secret; tokens expose no answer', () => {
  const pack = fixturePack();
  const packs = new Map([['fruit', pack]]);
  const clock = () => new Date('2026-10-12T00:00:00Z');
  const first = new GameService(packs, 'secret', clock);
  const second = new GameService(packs, 'secret', clock);
  const game = first.open('fruit');
  assert.deepEqual(game, second.open('fruit'));
  assert.deepEqual(first.resolve(game.token).puzzle.reveal(), second.resolve(game.token).puzzle.reveal());
  const publicJSON = JSON.stringify(game);
  assert.ok(!publicJSON.includes('answerIndex') && !publicJSON.includes('vectors'));
  assert.equal(Object.hasOwn(game, 'answer'), false);
});

test('tampered tokens and yesterday’s daily games are rejected', () => {
  const pack = fixturePack();
  let now = new Date('2026-10-12T14:59:59Z');
  const service = new GameService(new Map([['fruit', pack]]), 'secret', () => now);
  const game = service.open('fruit');
  assert.throws(() => service.resolve(game.token + 'x'), { code: 'INVALID_GAME' });
  assert.throws(() => service.resolve(`x${game.token.slice(1)}`), { code: 'INVALID_GAME' });
  now = new Date('2026-10-12T15:00:00Z');
  assert.throws(() => service.resolve(game.token), { code: 'DAY_CHANGED' });
  assert.notEqual(service.open('fruit').puzzleId, game.puzzleId);
});

test('topic switching is isolated, with no special-case category/model logic', () => {
  const fruit = fixturePack('fruit');
  const cosmos = fixturePack('cosmos');
  cosmos.manifest.name = '우주';
  const service = new GameService(new Map([['fruit', fruit], ['cosmos', cosmos]]), 'secret');
  const a = service.open('fruit');
  const b = service.open('cosmos');
  assert.notEqual(a.puzzleId, b.puzzleId);
  assert.equal(service.resolve(b.token).pack.manifest.name, '우주');
  assert.throws(() => service.open('missing'), { code: 'UNKNOWN_PACK' });
  assert.throws(() => service.open('fruit', 'bad-mode'), { code: 'INVALID_MODE' });
  assert.notEqual(service.open('cosmos', 'practice').puzzleId, service.open('cosmos', 'practice').puzzleId);
});

test('replacing a pack invalidates its previous game tokens', () => {
  const pack = fixturePack();
  const service = new GameService(new Map([['fruit', pack]]), 'secret');
  const token = service.open('fruit').token;
  pack.fingerprint = 'new-content';
  assert.throws(() => service.resolve(token), { code: 'PACK_CHANGED' });
});

test('secret rotation changes puzzle identity instead of restoring incompatible history', () => {
  const pack = fixturePack();
  const packs = new Map([['fruit', pack]]);
  const clock = () => new Date('2026-10-12T00:00:00Z');
  const first = new GameService(packs, 'old-secret', clock).open('fruit');
  const second = new GameService(packs, 'new-secret', clock).open('fruit');
  assert.notEqual(first.puzzleId, second.puzzleId);
});
