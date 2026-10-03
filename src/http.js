'use strict';
const fs = require('fs');
const path = require('path');
const config = require('./config');
const { ApiError } = require('./errors');

const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.json': 'application/json',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon',
};

const SEC_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'same-origin',
  'Content-Security-Policy': "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'",
};

function parseCookies(req) {
  const out = {};
  for (const part of (req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function readJson(req, limit = 10_000) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { reject(new ApiError(413, 'Corpo muito grande')); req.destroy(); }
      else chunks.push(c);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch { reject(new ApiError(400, 'JSON inválido')); }
    });
    req.on('error', reject);
  });
}

function sendJson(res, status, data, extraHeaders = {}) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...SEC_HEADERS,
    ...extraHeaders,
  });
  res.end(body);
}

function serveStatic(req, res) {
  let rel = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (rel === '/') rel = '/index.html';
  const file = path.normalize(path.join(config.PUBLIC_DIR, rel));
  if (!file.startsWith(config.PUBLIC_DIR)) { res.writeHead(403); return res.end(); } // path traversal
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404, SEC_HEADERS); return res.end('Não encontrado'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', ...SEC_HEADERS });
    res.end(buf);
  });
}

// Rate limit por IP, janela fixa.
function createLimiter({ WINDOW_MS, MAX }) {
  const hits = new Map();
  setInterval(() => hits.clear(), WINDOW_MS).unref();
  return (key) => {
    const n = (hits.get(key) || 0) + 1;
    hits.set(key, n);
    if (n > MAX) throw new ApiError(429, 'Muitas requisições, aguarde um pouco', 'rate_limited');
  };
}

const sessionCookie = (token, maxAgeSec) =>
  `sid=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAgeSec}`;

module.exports = { parseCookies, readJson, sendJson, serveStatic, createLimiter, sessionCookie };
