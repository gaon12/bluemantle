import { MAX_CONNECTION_WORDS } from './geometry.mjs';

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

export class Puzzle {
  constructor(pack, answerIndex) {
    this.pack = pack;
    this.answerIndex = answerIndex;
    this.scores = new Float64Array(pack.terms.length);
    const order = [];
    for (let i = 0; i < pack.terms.length; i++) {
      this.scores[i] = pack.geometry.cosine(i, answerIndex);
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

  connections(ids) {
    if (!Array.isArray(ids) || ids.length > MAX_CONNECTION_WORDS || new Set(ids).size !== ids.length || ids.some(id => typeof id !== 'string' || !this.pack.byId.has(id))) throw new GameError('INVALID_CONNECTIONS', `서로 다른 등록 용어 ${MAX_CONNECTION_WORDS}개까지 비교할 수 있어요.`);
    const indices = ids.map(id => this.pack.byId.get(id));
    // Only relations between requested guesses; no target, category axes or vectors.
    const similarities = indices.map(a => indices.map(b => Math.round(this.pack.geometry.cosine(a, b) * 10000) / 100));
    return { ids, similarities };
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

