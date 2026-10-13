import { BrowserGameService } from './browser-game.mjs';
import { loadBrowserPack } from './browser-pack.mjs';
import { GameError } from '../src/puzzle.mjs';

let catalog, base, service;
const packs = new Map();
async function getPack(id) {
  const entry = catalog.packs.find(pack => pack.manifest.id === id);
  if (!entry) throw new GameError('UNKNOWN_PACK', '선택한 주제를 사용할 수 없습니다.', 404);
  if (!packs.has(id)) packs.set(id, loadBrowserPack(entry, base));
  try { return await packs.get(id); }
  catch (error) { packs.delete(id); throw error; }
}

self.onmessage = async ({ data: { id, route, body, catalog: initial, base: initialBase } }) => {
  try {
    if (route === 'initialize') {
      catalog = initial; base = initialBase; service = new BrowserGameService(getPack);
      self.postMessage({ id, result: { packs: catalog.packs.map(entry => entry.info) } });
      return;
    }
    const result = await service.request(route, body);
    self.postMessage({ id, result });
  } catch (error) {
    self.postMessage({ id, error: { code: error.code ?? 'GAME_ERROR', message: error.message } });
  }
};
