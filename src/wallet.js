'use strict';
const { ApiError } = require('./errors');
const db = require('./db');

const LEDGER_MAX = 300;
const MONTHLY_MAX = 12;

function assertAmount(n) {
  if (!Number.isSafeInteger(n) || n <= 0) throw new ApiError(400, 'Valor inválido', 'bad_amount');
}

function monthKey() {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

function ensureStats(user) {
  user.stats ||= { wagered: 0, won: 0, rounds: 0 };
  user.stats.wagered ||= 0;
  user.stats.won ||= 0;
  user.stats.rounds ||= 0;
  user.stats.monthly ||= {};
  const key = monthKey();
  user.stats.monthly[key] ||= { wagered: 0, won: 0, rounds: 0 };
  const keys = Object.keys(user.stats.monthly).sort();
  while (keys.length > MONTHLY_MAX) delete user.stats.monthly[keys.shift()];
  return user.stats.monthly[key];
}

function push(user, type, amount, ref) {
  user.ledger ||= [];
  user.ledger.push({ t: Date.now(), type, amount, balance: user.balance, ref: ref || null });
  if (user.ledger.length > LEDGER_MAX) user.ledger.splice(0, user.ledger.length - LEDGER_MAX);
}

function debit(user, amount, type, ref) {
  assertAmount(amount);
  if (user.balance < amount) throw new ApiError(402, 'Saldo insuficiente', 'insufficient_funds');
  user.balance -= amount;
  user.stats ||= { wagered: 0, won: 0, rounds: 0, monthly: {} };
  user.stats.wagered = (user.stats.wagered || 0) + amount;
  const month = ensureStats(user);
  month.wagered += amount;
  month.rounds += 1;
  push(user, type, -amount, ref);
  db.save();
}

function credit(user, amount, type, ref) {
  if (!Number.isSafeInteger(amount) || amount < 0) throw new ApiError(500, 'Crédito inválido');
  if (amount === 0) return;
  user.balance += amount;
  if (type !== 'refill' && type !== 'admin_credit') {
    user.stats ||= { wagered: 0, won: 0, rounds: 0, monthly: {} };
    user.stats.won = (user.stats.won || 0) + amount;
    const month = ensureStats(user);
    month.won += amount;
  }
  push(user, type, amount, ref);
  db.save();
}

function adjustAdmin(user, delta, ref = 'admin') {
  if (!Number.isSafeInteger(delta) || delta === 0) throw new ApiError(400, 'Valor inválido', 'bad_amount');
  if (delta < 0 && user.balance < Math.abs(delta)) throw new ApiError(409, 'Saldo insuficiente para remover essa quantia', 'insufficient_balance');
  user.balance += delta;
  push(user, delta > 0 ? 'admin_credit' : 'admin_debit', delta, ref);
  db.save();
  return user.balance;
}

function migrateUser(user) {
  user.ledger ||= [];
  user.stats ||= { wagered: 0, won: 0, rounds: 0, monthly: {} };
  user.stats.monthly ||= {};
  ensureStats(user);
}

module.exports = { debit, credit, adjustAdmin, migrateUser, monthKey };
