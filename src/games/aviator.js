'use strict';
// Aviãozinho (crash). O servidor roda o loop das rodadas e é a ÚNICA fonte de verdade:
//  - ponto de queda definido ANTES da rodada (via HMAC do seed da rodada, com hash publicado);
//  - multiplicador calculado pelo relógio do servidor (m = e^(g*t));
//  - cashout validado contra o relógio do servidor, nunca contra o que o cliente "viu".
const config = require('../config');
const fair = require('../fair');
const wallet = require('../wallet');
const db = require('../db');
const { ApiError } = require('../errors');

const A = config.AVIATOR;
const clients = new Set(); // respostas SSE abertas

const game = {
  id: 0,
  phase: 'waiting',   // betting | flying | crashed
  seed: null,
  seedHash: null,
  crashPoint: 1,
  phaseStart: 0,
  bets: new Map(),    // userId -> { user, amount, auto, cashedAt, payout }
  history: [],
  timer: null,
};

// Ponto de queda com margem da casa: P(crash >= x) = (1 - edge) / x
function crashPointFromSeed(seed, roundId) {
  const r = fair.floatFromBytes(fair.hmac(seed, 'aviator', roundId, 0));
  const point = Math.floor((100 * (1 - A.HOUSE_EDGE)) / (1 - r)) / 100;
  return Math.min(Math.max(point, 1), A.MAX_MULT);
}

const multAt = (ms) => Math.floor(Math.exp(A.GROWTH * ms) * 100) / 100;
const msToReach = (m) => Math.log(m) / A.GROWTH;

function currentMultiplier() {
  if (game.phase === 'flying') {
    return Math.min(multAt(Date.now() - game.phaseStart), game.crashPoint);
  }
  return game.phase === 'crashed' ? game.crashPoint : 1;
}

function publicBets() {
  return [...game.bets.values()].map((b) => ({
    user: b.user.username,
    amount: b.amount,
    cashedAt: b.cashedAt || null,
    payout: b.payout || 0,
  }));
}

function snapshot() {
  return {
    id: game.id,
    phase: game.phase,
    multiplier: currentMultiplier(),
    seedHash: game.seedHash,
    seed: game.phase === 'crashed' ? game.seed : null, // revelado só após a queda
    nextAt: game.phase === 'betting' ? game.phaseStart + A.BETTING_MS : null,
    bets: publicBets(),
    history: game.history,
  };
}

function broadcast(event, data) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of clients) res.write(payload);
}

function startBetting() {
  game.id += 1;
  game.phase = 'betting';
  game.seed = fair.newServerSeed();
  game.seedHash = fair.sha256(game.seed);
  game.crashPoint = crashPointFromSeed(game.seed, game.id);
  game.phaseStart = Date.now();
  game.bets = new Map();
  broadcast('state', snapshot());
  game.timer = setTimeout(startFlying, A.BETTING_MS);
}

function startFlying() {
  game.phase = 'flying';
  game.phaseStart = Date.now();
  for (const b of game.bets.values()) b.user.stats.rounds += 1;
  broadcast('state', snapshot());
  tick();
}

function tick() {
  const elapsed = Date.now() - game.phaseStart;
  const m = multAt(elapsed);

  if (m >= game.crashPoint) return crash();

  // Auto-cashout executa no servidor, exatamente no alvo (não no tick).
  for (const b of game.bets.values()) {
    if (!b.cashedAt && b.auto && m >= b.auto) settle(b, b.auto);
  }
  broadcast('tick', { m, bets: publicBets() });

  // Agenda o próximo tick, antecipando o instante exato da queda se for antes.
  const toCrash = msToReach(game.crashPoint) - elapsed;
  game.timer = setTimeout(tick, Math.max(1, Math.min(A.TICK_MS, toCrash)));
}

function crash() {
  game.phase = 'crashed';
  game.phaseStart = Date.now();
  // Auto-cashouts com alvo <= ponto de queda que ainda não foram liquidados
  for (const b of game.bets.values()) {
    if (!b.cashedAt && b.auto && b.auto <= game.crashPoint) settle(b, b.auto);
  }
  game.history.unshift({ id: game.id, crash: game.crashPoint, seed: game.seed, seedHash: game.seedHash });
  game.history.length = Math.min(game.history.length, A.HISTORY);
  db.save();
  broadcast('state', snapshot());
  game.timer = setTimeout(startBetting, A.COOLDOWN_MS);
}

function settle(bet, at) {
  const payout = Math.floor(bet.amount * at);
  bet.cashedAt = at;
  bet.payout = payout;
  wallet.credit(bet.user, payout, 'aviator_win', `aviator:${game.id}`);
}

// ---- ações do jogador ----
function placeBet(user, amount, autoCashout) {
  if (game.phase !== 'betting') throw new ApiError(409, 'Apostas fechadas nesta rodada', 'betting_closed');
  if (game.bets.has(user.id)) throw new ApiError(409, 'Você já apostou nesta rodada', 'already_bet');
  if (!Number.isSafeInteger(amount) || amount < A.MIN_BET || amount > A.MAX_BET) {
    throw new ApiError(400, `Aposta entre ${A.MIN_BET} e ${A.MAX_BET}`, 'bad_bet');
  }
  let auto = null;
  if (autoCashout != null) {
    auto = Number(autoCashout);
    if (!Number.isFinite(auto) || auto < 1.01 || auto > A.MAX_MULT) {
      throw new ApiError(400, 'Auto-cashout deve ser entre 1.01x e 1000x', 'bad_auto');
    }
    auto = Math.floor(auto * 100) / 100;
  }
  wallet.debit(user, amount, 'aviator_bet', `aviator:${game.id}`);
  game.bets.set(user.id, { user, amount, auto, cashedAt: null, payout: 0 });
  broadcast('bets', { bets: publicBets() });
  return { roundId: game.id, amount, auto, balance: user.balance };
}

function cashOut(user) {
  const bet = game.bets.get(user.id);
  if (!bet) throw new ApiError(404, 'Sem aposta nesta rodada', 'no_bet');
  if (bet.cashedAt) throw new ApiError(409, 'Aposta já retirada', 'already_cashed');
  if (game.phase !== 'flying') throw new ApiError(409, 'O avião não está voando', 'not_flying');

  // Recalcula no relógio do servidor: se já passou do ponto de queda, perdeu.
  const elapsed = Date.now() - game.phaseStart;
  const m = multAt(elapsed);
  if (m >= game.crashPoint) throw new ApiError(409, 'Tarde demais: o avião caiu', 'too_late');

  settle(bet, m);
  broadcast('bets', { bets: publicBets() });
  return { multiplier: m, payout: bet.payout, balance: user.balance };
}

function subscribe(res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write(`retry: 1500\nevent: state\ndata: ${JSON.stringify(snapshot())}\n\n`);
  clients.add(res);
  res.on('close', () => clients.delete(res));
}

function myBet(user) {
  const b = game.bets.get(user.id);
  return b ? { roundId: game.id, amount: b.amount, auto: b.auto, cashedAt: b.cashedAt, payout: b.payout } : null;
}

function start() {
  startBetting();
  setInterval(() => { for (const res of clients) res.write(': ping\n\n'); }, 15_000).unref();
}

const meta = () => ({ ...A });

module.exports = { start, subscribe, placeBet, cashOut, myBet, snapshot, meta, crashPointFromSeed };
