'use strict';
// Fortune Tiger-like: 3 rolos x 3 linhas, 5 linhas de pagamento, Tigre = coringa.
// Todo o resultado é decidido AQUI no servidor; o front só anima o que recebe.
const config = require('../config');
const fair = require('../fair');
const wallet = require('../wallet');
const db = require('../db');
const { ApiError } = require('../errors');

const SYMBOLS = {
  T: { name: 'Tigre', icon: '🐯', wild: true },
  G: { name: 'Saco de ouro', icon: '💰' },
  E: { name: 'Envelope', icon: '🧧' },
  O: { name: 'Laranja', icon: '🍊' },
  L: { name: 'Lanterna', icon: '🏮' },
  F: { name: 'Fogos', icon: '🧨' },
};

// Multiplicador pago por linha (sobre a fração da aposta daquela linha).
const PAYTABLE = { T: 100, G: 45, E: 15, O: 8, L: 5, F: 2 };

// 5 linhas: cada item é a linha (0..2) usada em cada rolo.
const LINES = [
  [1, 1, 1],
  [0, 0, 0],
  [2, 2, 2],
  [0, 1, 2],
  [2, 1, 0],
];

// Composição de cada fita (32 posições). Ordem embaralhada de forma determinística.
const COUNTS = { T: 3, G: 3, E: 5, O: 6, L: 7, F: 8 };
function buildStrip(seed) {
  const list = [];
  for (const [s, n] of Object.entries(COUNTS)) for (let i = 0; i < n; i++) list.push(s);
  let x = seed;
  const rnd = () => ((x = (x * 1664525 + 1013904223) >>> 0) / 2 ** 32);
  for (let i = list.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [list[i], list[j]] = [list[j], list[i]];
  }
  return list;
}
const STRIPS = [buildStrip(11), buildStrip(23), buildStrip(37)];
const STRIP_LEN = STRIPS[0].length; // 32 -> 256 % 32 == 0, sem viés de módulo

function gridFromStops(stops) {
  // grid[rolo][linha]
  return STRIPS.map((strip, r) => [
    strip[(stops[r] + STRIP_LEN - 1) % STRIP_LEN],
    strip[stops[r]],
    strip[(stops[r] + 1) % STRIP_LEN],
  ]);
}

// Retorna soma dos multiplicadores das linhas vencedoras + detalhes.
function evaluate(grid) {
  let total = 0;
  const wins = [];
  LINES.forEach((line, idx) => {
    const syms = line.map((row, reel) => grid[reel][row]);
    const base = syms.find((s) => s !== 'T') || 'T';
    if (syms.every((s) => s === base || s === 'T')) {
      const mult = PAYTABLE[base];
      total += mult;
      wins.push({ line: idx, symbol: base, mult });
    }
  });
  return { sumMult: total, wins };
}

// payout = bet * (soma dos multiplicadores) / nº de linhas
const payoutFor = (bet, sumMult) => Math.floor((bet * sumMult) / LINES.length);

function stopsFromSeeds(serverSeed, clientSeed, nonce) {
  const h = fair.hmac(serverSeed, clientSeed, nonce, 0);
  return [h[0] % STRIP_LEN, h[1] % STRIP_LEN, h[2] % STRIP_LEN];
}

function spin(user, bet) {
  const { MIN_BET, MAX_BET } = config.TIGER;
  if (!Number.isSafeInteger(bet) || bet < MIN_BET || bet > MAX_BET || bet % LINES.length !== 0) {
    throw new ApiError(400, `Aposta deve ser múltipla de 5, entre ${MIN_BET} e ${MAX_BET}`, 'bad_bet');
  }
  const s = user.seeds;
  const nonce = s.nonce;

  wallet.debit(user, bet, 'tiger_bet', `tiger:${nonce}`);
  s.nonce += 1;

  const stops = stopsFromSeeds(s.serverSeed, s.clientSeed, nonce);
  const grid = gridFromStops(stops);
  const { sumMult, wins } = evaluate(grid);
  const payout = payoutFor(bet, sumMult);
  wallet.credit(user, payout, 'tiger_win', `tiger:${nonce}`);

  user.stats.rounds += 1;
  db.save();

  return {
    nonce,
    bet,
    grid,        // grid[rolo][linha] com códigos de símbolo
    stops,
    wins,
    multiplier: Number((sumMult / LINES.length).toFixed(2)),
    payout,
    balance: user.balance,
    serverSeedHash: s.serverSeedHash,
    clientSeed: s.clientSeed,
  };
}

function meta() {
  return { symbols: SYMBOLS, paytable: PAYTABLE, lines: LINES, strips: STRIPS, ...config.TIGER };
}

module.exports = { spin, meta, evaluate, gridFromStops, payoutFor, stopsFromSeeds, STRIPS, STRIP_LEN, LINES, PAYTABLE, COUNTS };
