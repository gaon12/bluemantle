import { GameError, Puzzle, dateInTimezone, nextMidnight } from '../src/puzzle.mjs';
import { SCORING_VERSION } from '../src/geometry.mjs';
import { digest } from './browser-pack.mjs';

const RULES = `browser-daily-v1:${SCORING_VERSION}`;

// A public seeded shuffle gives everyone the same daily answer without a server.
async function answerOrder(pack) {
  let seed = parseInt((await digest(`bluemantle:daily-v1:${pack.fingerprint}`)).slice(0, 8), 16);
  const random = () => {
    let value = seed += 0x6d2b79f5;
    value = Math.imul(value ^ value >>> 15, value | 1);
    value ^= value + Math.imul(value ^ value >>> 7, value | 61);
    return ((value ^ value >>> 14) >>> 0) / 4294967296;
  };
  const order = [...pack.answerIndices];
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  return order;
}

export class BrowserGameService {
  constructor(getPack, clock = () => new Date()) {
    this.getPack = getPack; this.clock = clock; this.cache = new Map(); this.orders = new Map();
  }

  async open(packId, mode = 'daily') {
    if (!['daily', 'practice'].includes(mode)) throw new GameError('INVALID_MODE', '올바르지 않은 게임 모드입니다.');
    const pack = await this.getPack(packId);
    const date = dateInTimezone(this.clock(), pack.manifest.timezone);
    const nonce = mode === 'daily' ? '' : Array.from(crypto.getRandomValues(new Uint8Array(12)), v => v.toString(16).padStart(2, '0')).join('');
    return this.describe(JSON.stringify({ packId, fingerprint: pack.fingerprint, rules: RULES, mode, date, nonce }));
  }

  async resolve(token) {
    let payload;
    try {
      if (typeof token !== 'string' || token.length > 2048) throw new Error();
      payload = JSON.parse(token);
      if (!payload || typeof payload.packId !== 'string' || typeof payload.fingerprint !== 'string'
        || !['daily', 'practice'].includes(payload.mode) || !/^\d{4}-\d{2}-\d{2}$/.test(payload.date)
        || !Number.isFinite(Date.parse(`${payload.date}T00:00:00Z`))
        || (payload.mode === 'daily' ? payload.nonce !== '' : !/^[0-9a-f]{24}$/.test(payload.nonce))) throw new Error();
    } catch { throw new GameError('INVALID_GAME', '게임을 다시 시작해 주세요.'); }
    const pack = await this.getPack(payload.packId);
    if (payload.fingerprint !== pack.fingerprint) throw new GameError('PACK_CHANGED', '주제 데이터가 업데이트되었어요. 새 게임을 시작해 주세요.', 409);
    if (payload.rules !== RULES) throw new GameError('RULES_CHANGED', '점수 계산 방식이 업데이트되었어요. 새 게임을 시작해 주세요.', 409);
    if (payload.mode === 'daily' && payload.date !== dateInTimezone(this.clock(), pack.manifest.timezone)) throw new GameError('DAY_CHANGED', '새로운 하루의 문제가 열렸어요. 오늘의 문제를 시작해 주세요.', 409);
    // Canonicalize restored tokens so equivalent JSON has one game identity.
    const canonical = JSON.stringify({ packId: payload.packId, fingerprint: payload.fingerprint, rules: RULES, mode: payload.mode, date: payload.date, nonce: payload.nonce });
    const key = await digest(canonical);
    if (!this.cache.has(key)) {
      let answer;
      if (payload.mode === 'daily') {
        if (!this.orders.has(pack.fingerprint)) this.orders.set(pack.fingerprint, answerOrder(pack));
        const order = await this.orders.get(pack.fingerprint), day = Math.floor(Date.parse(`${payload.date}T00:00:00Z`) / 86400000);
        answer = order[((day % order.length) + order.length) % order.length];
      } else {
        answer = pack.answerIndices[parseInt((await digest(`practice:${pack.fingerprint}:${payload.nonce}`)).slice(0, 12), 16) % pack.answerIndices.length];
      }
      if (this.cache.size >= 16) this.cache.delete(this.cache.keys().next().value);
      this.cache.set(key, new Puzzle(pack, answer));
    }
    return { payload, pack, puzzle: this.cache.get(key), puzzleId: `browser-${key.slice(0, 24)}`, token: canonical };
  }

  async describe(token) {
    const { payload, pack, puzzleId, token: canonical } = await this.resolve(token);
    return { token: canonical, puzzleId, pack: pack.publicInfo(), mode: payload.mode, date: payload.date,
      scoring: { version: SCORING_VERSION, method: 'corpus-centered-cosine', minimum: -100, maximum: 100 },
      endsAt: payload.mode === 'daily' ? nextMidnight(this.clock(), pack.manifest.timezone) : null, serverTime: this.clock().toISOString() };
  }

  async request(route, body = {}) {
    if (route === '/api/games') return this.open(body.packId, body.mode);
    const { puzzle } = await this.resolve(body.token);
    if (route === '/api/guess') return puzzle.guess(body.word);
    if (route === '/api/hint') return puzzle.hint(body.guessedIds);
    if (route === '/api/reveal') return puzzle.reveal();
    if (route === '/api/connections') return puzzle.connections(body.ids);
    if (route === '/api/restore') {
      if (!Array.isArray(body.guesses) || body.guesses.length > puzzle.pack.terms.length
        || body.guesses.some(g => !g || typeof g.id !== 'string' || typeof g.hint !== 'boolean' || !puzzle.pack.byId.has(g.id))) throw new GameError('INVALID_HISTORY', '저장된 기록이 올바르지 않습니다.');
      const unique = new Map(body.guesses.map(g => [g.id, puzzle.result(puzzle.pack.byId.get(g.id), g.hint)]));
      return { game: await this.describe(body.token), guesses: [...unique.values()] };
    }
    throw new GameError('NOT_FOUND', '요청을 찾을 수 없습니다.', 404);
  }
}
