/* Tiny static file server for Jubilados Club.  node server.js  →  http://localhost:5173
   Also forwards POST /rpc to Robinhood Chain, for a browser that will not talk
   to the RPC directly. The game tries the chain first and only falls back here. */
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const PORT = process.env.PORT || 5173;
const RPC = process.env.RPC || 'https://rpc.mainnet.chain.robinhood.com';
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.md': 'text/markdown; charset=utf-8'
};

function forwardRpc(req, res) {
  let body = '';
  req.on('data', c => { body += c; if (body.length > 1e6) req.destroy(); });
  req.on('end', () => {
    const u = new URL(RPC);
    const up = (u.protocol === 'https:' ? https : http).request({
      hostname: u.hostname, port: u.port || (u.protocol === 'https:' ? 443 : 80), path: u.pathname,
      method: 'POST', headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) }
    }, r => {
      res.writeHead(r.statusCode || 502, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      r.pipe(res);
    });
    up.on('error', e => { res.writeHead(502, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: { message: 'upstream: ' + e.message } })); });
    up.end(body);
  });
}

http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/rpc' && req.method === 'POST') { forwardRpc(req, res); return; }
  if (p === '/') p = '/index.html';
  /* Resolve, then compare on a separator boundary — a bare prefix test would
     also accept a sibling directory whose name merely starts with ours. */
  const file = path.resolve(ROOT, path.normalize(p).replace(/^([/\\])+/, ''));
  if (file !== ROOT && !file.startsWith(ROOT + path.sep)) { res.writeHead(403).end('no'); return; }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain' }).end('404 ' + p); return; }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-store'
    });
    res.end(data);
  });
}).listen(PORT, '127.0.0.1', () => console.log('JUBILADOS CLUB on http://localhost:' + PORT + '  (rpc → ' + RPC + ')'));
