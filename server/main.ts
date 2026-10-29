// Production server: serves the built game from dist/ and runs multiplayer on the same port.
//   npm run build && npm start          (PORT=8080 npm start to change the port)
// GET /health returns room and player counts as JSON (for uptime checks).
// /api/leaderboard serves the leaderboards (see leaderboard.ts).

import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { attachGameServer, handleApi } from './server';

const ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '../dist');
const PORT = Number(process.env.PORT) || 3000;
/** Listen address: 0.0.0.0 for everyone, or 127.0.0.1 when a reverse proxy sits in front. */
const HOST = process.env.HOST || '0.0.0.0';

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2',
};

const http = createServer((req, res) => {
  let url: string;
  try { url = decodeURIComponent((req.url ?? '/').split('?')[0]); } catch { res.writeHead(400).end(); return; }
  if (url.startsWith('/api/')) {
    if (!handleApi(req, res)) res.writeHead(404).end();
    return;
  }
  if (url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(game.stats()));
    return;
  }
  // Stay inside dist/.
  let file = normalize(join(ROOT, url));
  if (!file.startsWith(ROOT)) { res.writeHead(403).end(); return; }
  if (!existsSync(file) || statSync(file).isDirectory()) file = join(file, 'index.html');
  if (!existsSync(file)) { res.writeHead(404).end('Not found'); return; }
  res.writeHead(200, { 'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream' });
  createReadStream(file).pipe(res);
});

const game = attachGameServer(http);
http.listen(PORT, HOST, () => console.log(`Nightfall Bastion on http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}`));
