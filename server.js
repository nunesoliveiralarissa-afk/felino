'use strict';
const http = require('http');
const config = require('./src/config');
const db = require('./src/db');
const auth = require('./src/auth');
const fair = require('./src/fair');
const wallet = require('./src/wallet');
const tiger = require('./src/games/tiger');
const aviator = require('./src/games/aviator');
const { ApiError } = require('./src/errors');
const H = require('./src/http');
const ranking = require('./src/ranking');

db.load();
for (const u of db.allUsers()) wallet.migrateUser(u);
aviator.start();
setInterval(auth.cleanupSessions, 60 * 60 * 1000).unref();

const limitGeneral = H.createLimiter(config.RATE_LIMIT);
const limitAuth = H.createLimiter(config.AUTH_RATE_LIMIT);

const publicUser = (u) => ({
  username: u.username,
  balance: u.balance,
  stats: u.stats,
  serverSeedHash: u.seeds.serverSeedHash,
  clientSeed: u.seeds.clientSeed,
  nonce: u.seeds.nonce,
});

// ---------- rotas ----------
// handler(ctx) -> objeto JSON. ctx: { req, res, body, user, ip }
const routes = {
  'GET /api/config': () => ({
    tiger: tiger.meta(),
    aviator: aviator.meta(),
    refill: { threshold: config.REFILL_THRESHOLD, amount: config.REFILL_AMOUNT },
    currency: 'fichas virtuais (sem valor monetário)',
  }),

  'POST /api/auth/register': ({ body, res, ip }) => {
    limitAuth(ip);
    const user = auth.register(body.username, body.password);
    const token = auth.createSession(user.id);
    res.setHeader('Set-Cookie', H.sessionCookie(token, config.SESSION_TTL_MS / 1000));
    return { user: publicUser(user) };
  },

  'POST /api/auth/login': ({ body, res, ip }) => {
    limitAuth(ip);
    const user = auth.login(body.username, body.password);
    const token = auth.createSession(user.id);
    res.setHeader('Set-Cookie', H.sessionCookie(token, config.SESSION_TTL_MS / 1000));
    return { user: publicUser(user) };
  },

  'POST /api/auth/logout': ({ req, res }) => {
    auth.destroySession(H.parseCookies(req).sid);
    res.setHeader('Set-Cookie', H.sessionCookie('', 0));
    return { ok: true };
  },

  'GET /api/me': ({ user }) => ({ user: user ? publicUser(user) : null }),

  'GET /api/ranking': ({ query }) => ranking.leaderboard(query.month || ranking.monthKey()),

  'GET /api/wallet/history': ({ user }) => {
    need(user);
    return { ledger: user.ledger.slice(-50).reverse() };
  },

  'POST /api/wallet/refill': ({ user }) => {
    need(user);
    const wait = user.lastRefill + config.REFILL_COOLDOWN_MS - Date.now();
    if (user.balance >= config.REFILL_THRESHOLD) throw new ApiError(409, 'Recarga só com saldo baixo', 'not_eligible');
    if (wait > 0) throw new ApiError(429, `Aguarde ${Math.ceil(wait / 60000)} min`, 'cooldown');
    user.lastRefill = Date.now();
    wallet.credit(user, config.REFILL_AMOUNT, 'refill');
    return { balance: user.balance };
  },

  'GET /api/admin/overview': ({ user }) => {
    needAdmin(user);
    return {
      admin: user.username,
      users: db.allUsers().map((u) => ({ username: u.username, balance: u.balance, createdAt: u.createdAt, stats: u.stats })),
      ranking: ranking.leaderboard(ranking.monthKey()),
    };
  },

  'POST /api/admin/wallet': ({ user, body }) => {
    needAdmin(user);
    if (typeof body.username !== 'string') throw new ApiError(400, 'Usuário inválido', 'bad_username');
    const target = db.findByUsername(body.username);
    if (!target) throw new ApiError(404, 'Usuário não encontrado', 'user_not_found');
    const amount = Number(body.amount);
    if (!Number.isSafeInteger(amount) || amount === 0) throw new ApiError(400, 'Informe um valor inteiro diferente de zero', 'bad_amount');
    if (amount < 0 && target.id === user.id) throw new ApiError(400, 'O administrador não pode remover o próprio saldo por este painel', 'self_debit');
    const balance = wallet.adjustAdmin(target, amount, `admin:${user.username}`);
    return { username: target.username, balance };
  },

  // ----- Tigrinho -----
  'POST /api/tiger/spin': ({ user, body }) => {
    need(user);
    return tiger.spin(user, body.bet);
  },

  // ----- Provably fair -----
  'GET /api/fair': ({ user }) => {
    need(user);
    const s = user.seeds;
    return { serverSeedHash: s.serverSeedHash, clientSeed: s.clientSeed, nonce: s.nonce };
  },

  'POST /api/fair/rotate': ({ user, body }) => {
    need(user);
    const cs = body.clientSeed;
    if (cs != null && (typeof cs !== 'string' || !/^[\w-]{1,64}$/.test(cs))) {
      throw new ApiError(400, 'clientSeed: até 64 caracteres [A-Za-z0-9_-]', 'bad_seed');
    }
    const old = user.seeds;
    user.seeds = fair.newSeedPair(cs || old.clientSeed);
    db.save();
    return {
      revealed: { serverSeed: old.serverSeed, serverSeedHash: old.serverSeedHash, clientSeed: old.clientSeed, lastNonce: old.nonce - 1 },
      next: { serverSeedHash: user.seeds.serverSeedHash, clientSeed: user.seeds.clientSeed, nonce: 0 },
    };
  },

  // ----- Aviãozinho -----
  'GET /api/aviator/state': ({ user }) => ({ ...aviator.snapshot(), mine: user ? aviator.myBet(user) : null }),
  'POST /api/aviator/bet': ({ user, body }) => {
    need(user);
    return aviator.placeBet(user, body.amount, body.autoCashout);
  },
  'POST /api/aviator/cashout': ({ user }) => {
    need(user);
    return aviator.cashOut(user);
  },
};

function need(user) {
  if (!user) throw new ApiError(401, 'Faça login para jogar', 'unauthorized');
}

function needAdmin(user) {
  need(user);
  if (String(user.username).toLowerCase() !== String(config.ADMIN_USERNAME).toLowerCase()) {
    throw new ApiError(403, 'Acesso restrito ao administrador', 'forbidden');
  }
}

// ---------- servidor ----------
const server = http.createServer(async (req, res) => {
  const requestUrl = new URL(req.url, 'http://x');
  const { pathname, searchParams } = requestUrl;
  const query = Object.fromEntries(searchParams.entries());
  const ip = req.socket.remoteAddress;

  try {
    if (!pathname.startsWith('/api/')) return H.serveStatic(req, res);

    limitGeneral(ip);
    const user = auth.userFromToken(H.parseCookies(req).sid);

    // Stream em tempo real do Aviãozinho (Server-Sent Events)
    if (req.method === 'GET' && pathname === '/api/aviator/stream') return aviator.subscribe(res);

    const handler = routes[`${req.method} ${pathname}`];
    if (!handler) throw new ApiError(404, 'Rota não encontrada', 'not_found');

    // CSRF: cookie SameSite=Strict + exigência de JSON em escritas
    if (req.method === 'POST' && !(req.headers['content-type'] || '').startsWith('application/json') && Number(req.headers['content-length'] || 0) > 0) {
      throw new ApiError(415, 'Use application/json');
    }
    const body = req.method === 'POST' ? await H.readJson(req) : {};
    H.sendJson(res, 200, await handler({ req, res, body, user, ip, query }));
  } catch (e) {
    if (!(e instanceof ApiError)) console.error(e);
    const err = e instanceof ApiError ? e : new ApiError(500, 'Erro interno');
    if (!res.headersSent) H.sendJson(res, err.status, { error: err.message, code: err.code });
  }
});

if (require.main === module) {
  server.listen(config.PORT, () => console.log(`🐯 Tigrinho rodando em http://localhost:${config.PORT}`));
}
module.exports = server;
