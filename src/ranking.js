'use strict';
const db = require('./db');

function monthKey(date = new Date()) {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

function isValidMonth(value) {
  return typeof value === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
}

function getMonthStats(user, month) {
  const row = user.stats?.monthly?.[month];
  return row || { wagered: 0, won: 0, rounds: 0 };
}

function leaderboard(month = monthKey(), limit = 50) {
  if (!isValidMonth(month)) throw new Error('Mês inválido');
  const rows = db.allUsers().map((user) => {
    const s = getMonthStats(user, month);
    return {
      username: user.username,
      wagered: s.wagered,
      won: s.won,
      net: s.won - s.wagered,
      rounds: s.rounds,
    };
  }).filter((r) => r.rounds > 0 || r.wagered > 0 || r.won > 0);

  rows.sort((a, b) => b.net - a.net || b.won - a.won || b.rounds - a.rounds || a.username.localeCompare(b.username));
  return { month, entries: rows.slice(0, Math.max(1, Math.min(limit, 100))) };
}

module.exports = { monthKey, isValidMonth, getMonthStats, leaderboard };
