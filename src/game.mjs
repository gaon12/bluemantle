import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { sha256 } from './pack.mjs';

export class GameError extends Error {
  constructor(code, message, status = 400) { super(message); this.code = code; this.status = status; }
}

const formats = new Map();
export function dateInTimezone(now, timezone) {
  if (!formats.has(timezone)) formats.set(timezone, new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }));
  const parts = Object.fromEntries(formats.get(timezone).formatToParts(now).map(part => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function nextMidnight(now, timezone) {
  const date = dateInTimezone(now, timezone);
  let low = now.getTime(), high = low + 36 * 60 * 60 * 1000;
  while (high - low > 1) {
    const middle = Math.floor((low + high) / 2);
    if (dateInTimezone(new Date(middle), timezone) === date) low = middle;
    else high = middle;
  }
  return new Date(high).toISOString();
}

const hmac = (secret, value) => createHmac('sha256', secret).update(value).digest('hex');

export function dailyAnswer(pack, date, secret) {
  const day = Math.floor(Date.parse(`${date}T00:00:00Z`) / 86400000);
  if (!Number.isFinite(day)) throw new GameError('INVALID_DATE', '올바르지 않은 날짜입니다.');
  // One seeded permutation: every eligible term occurs once per cycle.
  const order = pack.answerIndices.map(index => ({ index, key: hmac(secret, `order:${pack.fingerprint}:${pack.terms[index].id}`) }))
    .sort((a, b) => a.key.localeCompare(b.key));
  return order[((day % order.length) + order.length) % order.length].index;
}

export class Puzzle {
  constructor(pack, answerIndex) {
    this.pack = pack;
    this.answerIndex = answerIndex;
    this.scores = new Float64Array(pack.terms.length);
    const order = [];
    for (let i = 0; i < pack.terms.length; i++) {
      let score = 0;
      for (let j = 0; j < pack.dimensions; j++) score += pack.vectors[i * pack.dimensions + j] * pack.vectors[answerIndex * pack.dimensions + j];
      this.scores[i] = Math.max(-1, Math.min(1, score));
      order.push(i);
    }
    order.sort((a, b) => {
      if (a === answerIndex) return -1;
      if (b === answerIndex) return 1;
      return this.scores[b] - this.scores[a] || pack.terms[a].id.localeCompare(pack.terms[b].id);
    });
    this.order = order;
    this.ranks = new Uint32Array(order.length);
    order.forEach((index, position) => { this.ranks[index] = position + 1; });
  }

  result(index, hint = false) {
    const correct = index === this.answerIndex;
    return {
      id: this.pack.terms[index].id, word: this.pack.terms[index].label,
      similarity: correct ? 100 : Math.min(99.99, Math.round(this.scores[index] * 10000) / 100),
      rank: this.ranks[index], correct, hint,
    };
  }

  guess(word) {
    if (typeof word !== 'string' || !word.trim() || word.length > 120) throw new GameError('INVALID_GUESS', '1~120자의 단어를 입력해 주세요.');
    const index = this.pack.resolve(word);
    if (index === undefined) throw new GameError('UNKNOWN_WORD', '아직 사전에 없는 단어예요. 다른 표기나 단어를 시도해 보세요.', 422);
    return this.result(index);
  }

  hint(guessedIds) {
    if (!Array.isArray(guessedIds) || guessedIds.length > this.pack.terms.length || guessedIds.some(id => !this.pack.byId.has(id))) throw new GameError('INVALID_HISTORY', '추측 기록이 올바르지 않습니다.');
    const seen = new Set(guessedIds.map(id => this.pack.byId.get(id)));
    if (seen.has(this.answerIndex)) throw new GameError('ALREADY_SOLVED', '이미 정답을 찾았어요.', 409);
    let best = this.pack.terms.length + 1;
    for (const index of seen) best = Math.min(best, this.ranks[index]);
    const target = Math.max(2, Math.floor(best / 2));
    let candidate = this.order.slice(target - 1, best - 1).find(index => index !== this.answerIndex && !seen.has(index));
    candidate ??= this.order.slice(1, best - 1).find(index => !seen.has(index));
    if (candidate === undefined) throw new GameError('NO_MORE_HINTS', '가장 가까운 단어까지 도달했어요. 이제 정답을 찾아보세요.', 409);
    return this.result(candidate, true);
  }

  reveal() {
    const answer = this.pack.terms[this.answerIndex];
    return { ...this.result(this.answerIndex), description: answer.description, category: this.pack.manifest.categories[answer.category] };
  }
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
    const payload = { packId, fingerprint: pack.fingerprint, mode, date, nonce: mode === 'daily' ? '' : randomBytes(12).toString('hex') };
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
      endsAt: payload.mode === 'daily' ? nextMidnight(this.clock(), pack.manifest.timezone) : null,
      serverTime: this.clock().toISOString() };
  }
}
