let initialization;
export async function browserRequest(route, body) {
  if (!initialization) {
    initialization = createClient().catch(error => { initialization = null; throw error; });
  }
  const client = await initialization;
  return route === '/api/packs' ? client.info : client.call(route, body);
}

async function createClient() {
  let worker;
  try {
    const base = new URL(import.meta.env.BASE_URL, location.origin);
    const response = await fetch(new URL('packs/catalog.json', base), { cache: 'no-cache', signal: AbortSignal.timeout(30000) });
    if (!response.ok) throw new Error('Catalog unavailable');
    const catalog = await response.json();
    if (catalog.schemaVersion !== 1 || !Array.isArray(catalog.packs) || !catalog.packs.length) throw new Error('Invalid catalog');
    worker = new Worker(new URL('./game-worker.mjs', import.meta.url), { type: 'module' });
    const pending = new Map(); let sequence = 0, failed = false;
    const fail = () => {
      failed = true; worker.terminate(); initialization = null;
      for (const item of pending.values()) item.reject(Object.assign(new Error('게임 계산을 시작하지 못했어요. 다시 연결해 주세요.'), { code: 'WORKER_ERROR' }));
      pending.clear();
    };
    worker.onerror = fail; worker.onmessageerror = fail;
    worker.onmessage = ({ data }) => {
      const item = pending.get(data.id);
      if (!item) return;
      pending.delete(data.id);
      if (data.error) item.reject(Object.assign(new Error(data.error.message), { code: data.error.code }));
      else item.resolve(data.result);
    };
    const call = (route, body, extra = {}) => new Promise((resolve, reject) => {
      if (failed) { reject(Object.assign(new Error('게임을 다시 연결해 주세요.'), { code: 'WORKER_ERROR' })); return; }
      const id = ++sequence;
      const timeout = setTimeout(() => { pending.delete(id); reject(new Error('주제 데이터 로딩이 오래 걸리고 있어요. 다시 시도해 주세요.')); }, 120000);
      pending.set(id, { resolve: value => { clearTimeout(timeout); resolve(value); }, reject: error => { clearTimeout(timeout); reject(error); } });
      worker.postMessage({ id, route, body, ...extra });
    });
    const info = await call('initialize', undefined, { catalog, base: base.href });
    return { info, call };
  } catch (error) {
    worker?.terminate();
    throw Object.assign(new Error('게임 데이터를 불러오지 못했어요. 인터넷 연결을 확인하고 다시 연결해 주세요.'), { code: error.code ?? 'NETWORK_ERROR' });
  }
}
