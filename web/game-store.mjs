import { connectionIds } from './connection-map.mjs';
import { browserRequest } from './browser-client.mjs';

export async function request(route, data) {
  if (import.meta.env?.VITE_STATIC_GAME === 'true') return browserRequest(route, data);
  let response;
  try { response = await fetch(route, { ...(data === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }), signal: AbortSignal.timeout(15000) }); }
  catch { throw Object.assign(new Error('서버에 연결하지 못했어요. 잠시 후 다시 시도해 주세요.'), { code: 'NETWORK_ERROR' }); }
  const result = await response.json();
  if (!response.ok) throw Object.assign(new Error(result.error?.message ?? '잠시 후 다시 시도해 주세요.'), { code: result.error?.code });
  return result;
}
const browserStorage = {
  get(key) { try { return JSON.parse(globalThis.localStorage.getItem(key)); } catch { return null; } },
  set(key, value) { try { globalThis.localStorage.setItem(key, JSON.stringify(value)); } catch { /* Play without storage. */ } },
};
const historyKey = game => `bluemantle:${game.pack.id}:${game.mode}:${game.puzzleId}`;
export const isFinished = state => state.gaveUp || state.guesses.some(guess => guess.correct);

export class GameStore {
  constructor(client = request, storage = browserStorage, clock = () => Date.now()) {
    this.client = client; this.storage = storage; this.clock = clock; this.listeners = new Set(); this.revision = 0;
    this.state = { packs: [], game: null, guesses: [], connections: null, connectionsError: false, gaveUp: false, answer: null, busy: true, status: '게임 데이터를 불러오고 있어요.', statusKind: '', expired: false, countdown: '—', sort: 'rank', offset: 0, fatal: false };
  }
  getSnapshot = () => this.state;
  subscribe = listener => { this.listeners.add(listener); return () => this.listeners.delete(listener); };
  update(patch) { this.state = { ...this.state, ...patch }; for (const listener of this.listeners) listener(); }
  message(status, statusKind = '') { this.update({ status, statusKind }); }
  save() {
    const { game, guesses, gaveUp } = this.state;
    if (!game) return;
    this.storage.set(historyKey(game), { guesses: guesses.map(({ id, hint }) => ({ id, hint })), gaveUp });
    this.storage.set('bluemantle:preferences', { packId: game.pack.id, mode: game.mode });
    if (game.mode === 'practice') this.storage.set(`bluemantle:last-practice:${game.pack.id}`, { token: game.token, key: historyKey(game) });
  }
  async initialize() {
    this.update({ busy: true, fatal: false });
    try {
      const { packs } = await this.client('/api/packs');
      const ready = packs.filter(pack => pack.ready); this.update({ packs: ready });
      if (!ready.length) throw new Error('아직 준비된 주제가 없어요. 데이터 준비가 끝나면 다시 연결해 주세요.');
      const preferences = this.storage.get('bluemantle:preferences');
      const pack = ready.find(p => p.id === preferences?.packId) ?? ready[0];
      await this.begin(pack.id, preferences?.mode === 'practice' ? 'practice' : 'daily');
    } catch (error) { this.update({ busy: false, fatal: true, status: error.message, statusKind: 'error' }); }
  }
  async begin(packId, mode = 'daily', fresh = false) {
    const revision = ++this.revision;
    this.update({ busy: true, status: '새로운 연결을 불러오고 있어요.', statusKind: '' });
    try {
      let game = null, restored = null;
      if (mode === 'practice' && !fresh) {
        const previous = this.storage.get(`bluemantle:last-practice:${packId}`);
        if (previous?.token && previous?.key) {
          try { restored = await this.client('/api/restore', { token: previous.token, guesses: this.storage.get(previous.key)?.guesses ?? [] }); game = restored.game; }
          catch { /* A replaced pack starts a fresh game. */ }
        }
      }
      game ??= await this.client('/api/games', { packId, mode });
      const saved = this.storage.get(historyKey(game));
      if (!restored && Array.isArray(saved?.guesses)) {
        try { restored = await this.client('/api/restore', { token: game.token, guesses: saved.guesses }); }
        catch { /* Discard malformed history. */ }
      }
      const guesses = restored?.guesses ?? [], gaveUp = !!saved?.gaveUp;
      const answer = gaveUp || guesses.some(g => g.correct) ? await this.client('/api/reveal', { token: game.token }) : null;
      if (revision !== this.revision) return;
      this.update({ game, guesses, connections: null, connectionsError: false, gaveUp, answer, expired: false, fatal: false, offset: Date.parse(game.serverTime) - this.clock(), status: answer ? '저장된 결과를 불러왔어요.' : guesses.length ? '지난 추측에 이어서 연결을 찾아보세요.' : '선생님, 떠오르는 단어로 시작해 볼까요?', statusKind: '' });
      this.save(); this.tick();
      await this.loadConnections();
    } catch (error) { if (revision === this.revision) this.update({ fatal: !this.state.game, status: error.message, statusKind: 'error' }); }
    finally { if (revision === this.revision) this.update({ busy: false }); }
  }
  async handleError(error) {
    this.message(error.message, 'error');
    if (error.code === 'DAY_CHANGED') this.update({ expired: true });
    if (['INVALID_GAME', 'PACK_CHANGED', 'RULES_CHANGED'].includes(error.code) && this.state.game) await this.begin(this.state.game.pack.id, this.state.game.mode, true);
  }
  async loadConnections() {
    const { game, guesses } = this.state;
    if (!game || guesses.length < 2) { this.update({ connections: null, connectionsError: false }); return; }
    const revision = this.revision, ids = connectionIds(guesses);
    this.update({ connections: null, connectionsError: false });
    try {
      const connections = await this.client('/api/connections', { token: game.token, ids });
      if (revision === this.revision && this.state.guesses === guesses) this.update({ connections });
    } catch {
      if (revision === this.revision && this.state.guesses === guesses) this.update({ connectionsError: true });
    }
  }
  async addGuess(result) {
    if (this.state.guesses.some(g => g.id === result.id)) { this.message('이미 추측한 단어예요. 다른 연결을 떠올려 보세요.'); return false; }
    this.update({ guesses: [...this.state.guesses, result] }); this.save();
    this.message(result.correct ? `${this.state.guesses.length}번의 추측으로 정답을 찾았어요!` : result.hint ? '더 가까운 단어를 찾았어요. 여기서 연결을 이어가 보세요.' : `${result.word} · ${result.rank.toLocaleString('ko-KR')}위. 다음 연결을 찾아보세요.`, result.correct ? 'success' : '');
    if (result.correct) this.update({ answer: await this.client('/api/reveal', { token: this.state.game.token }) });
    await this.loadConnections();
    return true;
  }
  async submit(word) {
    if (this.state.busy || !this.state.game || isFinished(this.state) || this.state.expired) return false;
    if (!word.trim()) { this.message('단어를 먼저 입력해 주세요.', 'error'); return false; }
    this.update({ busy: true });
    try { return await this.addGuess(await this.client('/api/guess', { token: this.state.game.token, word: word.trim() })); }
    catch (error) { await this.handleError(error); return false; }
    finally { this.update({ busy: false }); }
  }
  async hint() {
    if (this.state.busy || !this.state.game || isFinished(this.state) || this.state.expired) return;
    this.update({ busy: true });
    try { await this.addGuess(await this.client('/api/hint', { token: this.state.game.token, guessedIds: this.state.guesses.map(g => g.id) })); }
    catch (error) { await this.handleError(error); }
    finally { this.update({ busy: false }); }
  }
  async reveal() {
    if (this.state.busy || !this.state.game) return;
    this.update({ busy: true });
    try { this.update({ answer: await this.client('/api/reveal', { token: this.state.game.token }), gaveUp: true }); this.save(); this.message('오늘의 연결을 발견했어요. 다른 문제에도 도전해 보세요.'); }
    catch (error) { await this.handleError(error); }
    finally { this.update({ busy: false }); }
  }
  toggleSort() { this.update({ sort: this.state.sort === 'rank' ? 'recent' : 'rank' }); }
  tick() {
    const { game, offset } = this.state;
    if (!game) return;
    if (game.mode === 'practice') { if (this.state.countdown !== '제한 없음') this.update({ countdown: '제한 없음' }); return; }
    const seconds = Math.max(0, Math.ceil((Date.parse(game.endsAt) - (this.clock() + offset)) / 1000));
    const countdown = [Math.floor(seconds / 3600), Math.floor(seconds / 60) % 60, seconds % 60].map(n => String(n).padStart(2, '0')).join(':');
    if (countdown !== this.state.countdown) this.update({ countdown });
    if (seconds === 0 && !this.state.expired) this.update({ expired: true, status: '새로운 하루의 문제가 열렸어요. 새 문제를 시작해 주세요.' });
  }
  shareText(origin) {
    const { game, guesses, gaveUp } = this.state;
    if (!game || !isFinished(this.state)) return '';
    const emoji = guesses.slice(-8).map(g => g.correct ? '🟩' : g.rank <= 10 ? '🟧' : g.rank <= 100 ? '🟨' : '🟦').join('');
    return [`Bluemantle · ${game.pack.name}`, game.mode === 'daily' ? game.date : '연습 모드', `${guesses.length}회 추측 · 힌트 ${guesses.filter(g => g.hint).length}회${gaveUp ? ' · 정답 확인' : ' · 성공'}`, emoji, origin].filter(Boolean).join('\n');
  }
}
export const gameStore = new GameStore();
