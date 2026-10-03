'use strict';
const path = require('path');

module.exports = {
  PORT: Number(process.env.PORT) || 3000,
  DATA_FILE: process.env.DATA_FILE || path.join(__dirname, '..', 'data', 'db.json'),
  PUBLIC_DIR: path.join(__dirname, '..', 'public'),

  // Valores em "centavos de ficha" (inteiros, nunca float).
  START_BALANCE: 100_000, // 1.000,00 fichas
  REFILL_THRESHOLD: 1_000, // abaixo disso libera recarga grátis
  REFILL_AMOUNT: 100_000,
  REFILL_COOLDOWN_MS: 60 * 60 * 1000,

  SESSION_TTL_MS: 7 * 24 * 60 * 60 * 1000,

  TIGER: { MIN_BET: 100, MAX_BET: 50_000 },

  AVIATOR: {
    MIN_BET: 100,
    MAX_BET: 50_000,
    HOUSE_EDGE: 0.04,     // 4% -> RTP teórico de 96%
    BETTING_MS: 7_000,    // janela de apostas
    COOLDOWN_MS: 3_500,   // pausa após a queda
    TICK_MS: 100,         // frequência do stream
    GROWTH: 0.00007,      // m(t) = e^(GROWTH * t_ms)
    MAX_MULT: 1_000,      // teto de segurança
    HISTORY: 30,
  },

  RATE_LIMIT: { WINDOW_MS: 10_000, MAX: 200 },
  AUTH_RATE_LIMIT: { WINDOW_MS: 60_000, MAX: 10 },
};
