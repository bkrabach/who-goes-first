import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve, sep, extname } from 'node:path';

const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png', '.wav': 'audio/wav', '.txt': 'text/plain; charset=utf-8' };
export function createStaticServer(directory) {
  const root = resolve(directory);
  return createServer(async (request, response) => {
  try {
    if (!['GET', 'HEAD'].includes(request.method)) { response.writeHead(405); response.end(); return; }
    const path = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    let target = resolve(root, `.${path}`);
    if (target !== root && !target.startsWith(root + sep)) throw new Error('Forbidden');
    if (path.split('/').some(segment => segment.startsWith('.') && segment !== '.')) throw new Error('Forbidden');
    if ((await stat(target)).isDirectory()) {
      if(!path.endsWith('/')){
        const url=new URL(request.url,'http://localhost');
        response.writeHead(308,{'Location':url.pathname+'/'+url.search});response.end();return;
      }
      target = resolve(target, 'index.html');
    }
    const body = await readFile(target);
    response.writeHead(200, { 'Content-Type': types[extname(target)] || 'application/octet-stream', 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff', 'Content-Length': body.length,
      'Referrer-Policy':'strict-origin-when-cross-origin',
      'Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' data: blob:; connect-src 'self'; worker-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'self'" });
    response.end(request.method === 'HEAD' ? undefined : body);
  } catch {
    response.writeHead(404, { 'Content-Type': 'text/plain' });
    response.end('Not found');
  }
  });
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const root = resolve(process.env.SERVE_DIR || fileURLToPath(new URL('../dist/', import.meta.url)));
  const port = Number(process.env.PORT || 4173);
  const host = process.env.HOST || '127.0.0.1';
  const server = createStaticServer(root);
  server.listen(port, host, () => console.log(`Who Goes First? → http://${host}:${port}\nServing ${root}`));
  for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => server.close(() => process.exit(0)));
}