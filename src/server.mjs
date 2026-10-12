import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadPacks } from './pack.mjs';
import { GameError, GameService } from './game.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const contentTypes = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.woff2': 'font/woff2' };

async function localSecret(directory) {
  if (process.env.BLUEMANTLE_SECRET) return process.env.BLUEMANTLE_SECRET;
  await mkdir(directory, { recursive: true });
  const filename = path.join(directory, 'secret');
  try { return await readFile(filename, 'utf8'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const secret = randomBytes(32).toString('hex');
  try { await writeFile(filename, secret, { flag: 'wx', mode: 0o600 }); return secret; }
  catch (error) { if (error.code !== 'EEXIST') throw error; return readFile(filename, 'utf8'); }
}

async function readBody(request) {
  if (!request.headers['content-type']?.startsWith('application/json')) throw new GameError('INVALID_BODY', 'JSON 요청이 필요합니다.', 415);
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 262144) throw new GameError('BODY_TOO_LARGE', '요청이 너무 큽니다.', 413);
    chunks.push(chunk);
  }
  try {
    const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error();
    return parsed;
  } catch { throw new GameError('INVALID_BODY', '요청 형식이 올바르지 않습니다.'); }
}

export function createApp(service, unavailable = [], staticRoot = path.join(ROOT, 'dist')) {
  return createServer(async (request, response) => {
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'same-origin');
    response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self'; connect-src 'self'; frame-ancestors 'self'; base-uri 'none'");
    const send = (status, data) => {
      response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      response.end(JSON.stringify(data));
    };
    try {
      const url = new URL(request.url, 'http://localhost');
      if (request.method === 'GET' && url.pathname === '/api/packs') return send(200, { packs: [...service.packs.values()].map(pack => pack.publicInfo()).concat(unavailable) });
      if (request.method === 'GET' && url.pathname === '/api/health') return send(service.packs.size ? 200 : 503, { ready: service.packs.size > 0, packs: service.packs.size });
      if (request.method === 'POST' && ['/api/games', '/api/guess', '/api/hint', '/api/reveal', '/api/restore'].includes(url.pathname)) {
        const body = await readBody(request);
        if (url.pathname === '/api/games') return send(200, service.open(body.packId, body.mode));
        const { puzzle } = service.resolve(body.token);
        if (url.pathname === '/api/guess') return send(200, puzzle.guess(body.word));
        if (url.pathname === '/api/hint') return send(200, puzzle.hint(body.guessedIds));
        if (url.pathname === '/api/reveal') return send(200, puzzle.reveal());
        if (!Array.isArray(body.guesses) || body.guesses.length > puzzle.pack.terms.length || body.guesses.some(g => !g || typeof g.id !== 'string' || typeof g.hint !== 'boolean' || !puzzle.pack.byId.has(g.id))) throw new GameError('INVALID_HISTORY', '저장된 기록이 올바르지 않습니다.');
        const unique = new Map(body.guesses.map(guess => [guess.id, puzzle.result(puzzle.pack.byId.get(guess.id), guess.hint)]));
        return send(200, { game: service.describe(body.token), guesses: [...unique.values()] });
      }
      const asset = url.pathname === '/' ? 'index.html' : url.pathname === '/favicon.svg' ? 'favicon.svg' : /^\/assets\/[a-zA-Z0-9_.-]+$/.test(url.pathname) ? url.pathname.slice(1) : null;
      if (request.method === 'GET' && asset && contentTypes[path.extname(asset)]) {
        try {
          const root = await realpath(staticRoot);
          const file = await realpath(path.join(root, asset));
          if (!file.startsWith(root + path.sep)) throw new GameError('NOT_FOUND', '페이지를 찾을 수 없습니다.', 404);
          const contents = await readFile(file);
          response.writeHead(200, { 'Content-Type': contentTypes[path.extname(asset)], 'Cache-Control': asset.startsWith('assets/') ? 'public, max-age=31536000, immutable' : 'no-cache' });
          return response.end(contents);
        } catch (error) {
          if (error.code !== 'ENOENT') throw error;
          return send(asset === 'index.html' ? 503 : 404, { error: { code: asset === 'index.html' ? 'FRONTEND_NOT_BUILT' : 'NOT_FOUND', message: asset === 'index.html' ? 'Run npm run build to prepare the React frontend.' : '페이지를 찾을 수 없습니다.' } });
        }
      }
      send(404, { error: { code: 'NOT_FOUND', message: '페이지를 찾을 수 없습니다.' } });
    } catch (error) {
      if (error instanceof GameError) send(error.status, { error: { code: error.code, message: error.message } });
      else { console.error(error); send(500, { error: { code: 'SERVER_ERROR', message: '잠시 후 다시 시도해 주세요.' } }); }
    }
  });
}

export async function startServer(options = {}) {
  const { packs, unavailable } = await loadPacks(options.packRoot ?? process.env.BLUEMANTLE_PACKS_DIR ?? path.join(ROOT, 'data/packs'));
  const secret = options.secret ?? await localSecret(path.join(ROOT, '.bluemantle'));
  const service = new GameService(packs, secret);
  const server = createApp(service, unavailable);
  const port = options.port ?? Number(process.env.PORT ?? 3000);
  const host = options.host ?? process.env.HOST ?? '127.0.0.1';
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, host, resolve); });
  console.log(`Bluemantle: http://${host}:${server.address().port} (${packs.size} ready packs)`);
  return server;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  startServer().catch(error => { console.error(error.message); process.exitCode = 1; });
}
