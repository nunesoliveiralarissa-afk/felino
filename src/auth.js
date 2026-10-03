'use strict';
const crypto = require('crypto');
const config = require('./config');
const db = require('./db');
const fair = require('./fair');
const { ApiError } = require('./errors');

const USER_RE = /^[a-zA-Z0-9_]{3,20}$/;

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return { salt, hash };
}

function verifyPassword(password, { salt, hash }) {
  const test = crypto.scryptSync(password, salt, 64);
  const real = Buffer.from(hash, 'hex');
  return test.length === real.length && crypto.timingSafeEqual(test, real);
}

function register(username, password) {
  if (typeof username !== 'string' || !USER_RE.test(username)) {
    throw new ApiError(400, 'Usuário: 3 a 20 caracteres (letras, números e _)', 'bad_username');
  }
  if (typeof password !== 'string' || password.length < 8 || password.length > 72) {
    throw new ApiError(400, 'Senha deve ter entre 8 e 72 caracteres', 'bad_password');
  }
  if (db.findByUsername(username)) throw new ApiError(409, 'Usuário já existe', 'username_taken');
  return db.createUser({
    username,
    pass: hashPassword(password),
    balance: config.START_BALANCE,
    createdAt: Date.now(),
    lastRefill: 0,
    seeds: fair.newSeedPair(),
    stats: { wagered: 0, won: 0, rounds: 0, monthly: {} },
    ledger: [],
  });
}

function login(username, password) {
  const user = typeof username === 'string' ? db.findByUsername(username) : null;
  // Faz o hash mesmo se o usuário não existe, para não vazar por tempo de resposta.
  const ok = user
    ? verifyPassword(String(password), user.pass)
    : (hashPassword(String(password)), false);
  if (!ok) throw new ApiError(401, 'Usuário ou senha incorretos', 'bad_credentials');
  return user;
}

const tokenHash = (t) => fair.sha256(t);

function createSession(userId) {
  const token = crypto.randomBytes(32).toString('hex');
  db.sessions()[tokenHash(token)] = { userId, exp: Date.now() + config.SESSION_TTL_MS };
  db.save();
  return token;
}

function userFromToken(token) {
  if (!token) return null;
  const key = tokenHash(token);
  const s = db.sessions()[key];
  if (!s) return null;
  if (s.exp < Date.now()) { delete db.sessions()[key]; return null; }
  return db.getUser(s.userId);
}

function destroySession(token) {
  if (!token) return;
  delete db.sessions()[tokenHash(token)];
  db.save();
}

function cleanupSessions() {
  const now = Date.now();
  for (const [k, s] of Object.entries(db.sessions())) if (s.exp < now) delete db.sessions()[k];
}

module.exports = { register, login, createSession, userFromToken, destroySession, cleanupSessions };
