// Tiny static server: serves dist/ under a URL prefix. Usage: node e2e/serve-subpath.mjs <port> <prefix>
import { createServer } from 'node:http';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const [, , portArg = '4180', prefix = '/sub/orbits/'] = process.argv;
const dist = fileURLToPath(new URL('../dist/', import.meta.url));
const TYPES = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.woff': 'font/woff', '.woff2': 'font/woff2',
  '.ttf': 'font/ttf', '.png': 'image/png', '.ico': 'image/x-icon',
};

// dist/ must be the build produced by the first webServer in playwright.config.ts. Playwright starts webServer entries
// in order and waits for each URL to respond before starting the next, so by the time this runs `npm run build` has
// finished and dist/ is fresh. Do not poll/wait here: that could mask (or serve) a stale dist/. Fail loudly instead.
if (!existsSync(join(dist, 'index.html'))) {
  console.error(`${dist}index.html not found: run the build first (playwright.config.ts orders this server after it).`);
  process.exit(1);
}

createServer((req, res) => {
  const path = decodeURIComponent((req.url ?? '/').split('?')[0]);
  if (!path.startsWith(prefix)) {
    res.writeHead(404).end('not found (outside prefix)');
    return;
  }
  let rel = normalize(path.slice(prefix.length));
  if (rel.startsWith('..')) {
    res.writeHead(403).end();
    return;
  }
  let file = join(dist, rel);
  if (existsSync(file) && statSync(file).isDirectory()) file = join(file, 'index.html');
  if (!existsSync(file)) {
    res.writeHead(404).end('not found');
    return;
  }
  res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' });
  res.end(readFileSync(file));
}).listen(Number(portArg), () => console.log(`serving ${dist} at :${portArg}${prefix}`));
