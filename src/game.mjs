import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { sha256 } from './pack.mjs';
import { SCORING_VERSION } from './geometry.mjs';
import { GameError, Puzzle, dateInTimezone, nextMidnight } from './puzzle.mjs';
export { GameError, Puzzle, dateInTimezone, nextMidnight } from './puzzle.mjs';

const hmac = (secret, value) => createHmac('sha256', secret).update(value).digest('hex');

export function dailyAnswer(pack, date, secret) {
  const day = Math.floor(Date.parse(`${date}T00:00:00Z`) / 86400000);
  if (!Number.isFinite(day)) throw new GameError('INVALID_DATE', '올바르지 않은 날짜입니다.');
  // One seeded permutation: every eligible term occurs once per cycle.
  const order = pack.answerIndices.map(index => ({ index, key: hmac(secret, `order:${pack.fingerprint}:${pack.terms[index].id}`) }))
    .sort((a, b) => a.key.localeCompare(b.key));
  return order[((day % order.length) + order.length) % order.length].index;
}

/** Signed, stateless game tokens; embeddings and the answer stay on the server. */
export class GameService {
  constructor(packs, secret, clock = () => new Date()) {
    this.packs = packs;
    this.secret = secret;
    this.clock = clock;
    this.cache = new Map();
  }

  open(packId, mode = 'daily') {
    const pack = this.packs.get(packId);
    if (!pack) throw new GameError('UNKNOWN_PACK', '선택한 주제를 사용할 수 없습니다.', 404);
    if (!['daily', 'practice'].includes(mode)) throw new GameError('INVALID_MODE', '올바르지 않은 게임 모드입니다.');
    const date = dateInTimezone(this.clock(), pack.manifest.timezone);
    const payload = { packId, fingerprint: pack.fingerprint, scoringVersion: SCORING_VERSION, mode, date, nonce: mode === 'daily' ? '' : randomBytes(12).toString('hex') };
    const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
    return this.describe(`${body}.${hmac(this.secret, body)}`);
  }

  resolve(token) {
    if (typeof token !== 'string' || token.length > 2048) throw new GameError('INVALID_GAME', '게임을 다시 시작해 주세요.', 401);
    const parts = token.split('.');
    if (parts.length !== 2 || !/^[0-9a-f]{64}$/.test(parts[1])) throw new GameError('INVALID_GAME', '게임을 다시 시작해 주세요.', 401);
    const expected = Buffer.from(hmac(this.secret, parts[0]), 'hex');
    if (!timingSafeEqual(expected, Buffer.from(parts[1], 'hex'))) throw new GameError('INVALID_GAME', '게임을 다시 시작해 주세요.', 401);
    let payload;
    try { payload = JSON.parse(Buffer.from(parts[0], 'base64url').toString()); }
    catch { throw new GameError('INVALID_GAME', '게임을 다시 시작해 주세요.', 401); }
    const pack = this.packs.get(payload.packId);
    if (!pack || payload.fingerprint !== pack.fingerprint) throw new GameError('PACK_CHANGED', '주제 데이터가 업데이트되었어요. 새 게임을 시작해 주세요.', 409);
    if (payload.scoringVersion !== SCORING_VERSION) throw new GameError('RULES_CHANGED', '점수 계산 방식이 업데이트되었어요. 새 게임을 시작해 주세요.', 409);
    if (!['daily', 'practice'].includes(payload.mode) || !/^\d{4}-\d{2}-\d{2}$/.test(payload.date) || (payload.mode === 'daily' ? payload.nonce !== '' : !/^[0-9a-f]{24}$/.test(payload.nonce))) throw new GameError('INVALID_GAME', '게임을 다시 시작해 주세요.', 401);
    if (payload.mode === 'daily' && payload.date !== dateInTimezone(this.clock(), pack.manifest.timezone)) throw new GameError('DAY_CHANGED', '새로운 하루의 문제가 열렸어요. 오늘의 문제를 시작해 주세요.', 409);
    const key = sha256(token);
    if (!this.cache.has(key)) {
      const index = payload.mode === 'daily' ? dailyAnswer(pack, payload.date, this.secret)
        : pack.answerIndices[parseInt(hmac(this.secret, `practice:${pack.fingerprint}:${payload.nonce}`).slice(0, 12), 16) % pack.answerIndices.length];
      if (this.cache.size >= 64) this.cache.delete(this.cache.keys().next().value);
      this.cache.set(key, new Puzzle(pack, index));
    }
    return { payload, pack, puzzle: this.cache.get(key), puzzleId: key.slice(0, 24) };
  }

  describe(token) {
    const { payload, pack, puzzleId } = this.resolve(token);
    return { token, puzzleId, pack: pack.publicInfo(), mode: payload.mode, date: payload.date,
      scoring: { version: SCORING_VERSION, method: 'corpus-centered-cosine', minimum: -100, maximum: 100 },
      endsAt: payload.mode === 'daily' ? nextMidnight(this.clock(), pack.manifest.timezone) : null,
      serverTime: this.clock().toISOString() };
  }
}
