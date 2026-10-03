'use strict';
const { ApiError } = require('./errors');
const db = require('./db');

const LEDGER_MAX = 300;

function assertAmount(n) {
  if (!Number.isSafeInteger(n) || n <= 0) throw new ApiError(400, 'Valor inválido', 'bad_amount');
}

function push(user, type, amount, ref) {
  user.ledger.push({ t: Date.now(), type, amount, balance: user.balance, ref: ref || null });
  if (user.ledger.length > LEDGER_MAX) user.ledger.splice(0, user.ledger.length - LEDGER_MAX);
}

function debit(user, amount, type, ref) {
  assertAmount(amount);
  if (user.balance < amount) throw new ApiError(402, 'Saldo insuficiente', 'insufficient_funds');
  user.balance -= amount;
  user.stats.wagered += amount;
  push(user, type, -amount, ref);
  db.save();
}

function credit(user, amount, type, ref) {
  if (!Number.isSafeInteger(amount) || amount < 0) throw new ApiError(500, 'Crédito inválido');
  if (amount === 0) return;
  user.balance += amount;
  if (type !== 'refill') user.stats.won += amount;
  push(user, type, amount, ref);
  db.save();
}

module.exports = { debit, credit };
