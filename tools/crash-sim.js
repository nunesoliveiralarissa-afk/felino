'use strict';
// Simula 2 milhões de rodadas do Aviãozinho: confirma o RTP do ponto de queda.
const fair = require('../src/fair');
const { crashPointFromSeed } = require('../src/games/aviator');
const N = 2_000_000, target = Number(process.argv[2]) || 2;
let wins = 0, instant = 0;
for (let i = 0; i < N; i++) {
  const c = crashPointFromSeed(fair.newServerSeed(), i);
  if (c <= 1.0) instant++;
  if (c >= target) wins++;
}
console.log(`rodadas: ${N}`);
console.log(`cashout fixo em ${target}x -> RTP ≈ ${(wins / N * target * 100).toFixed(2)}% (teórico 96%)`);
console.log(`quedas em 1.00x: ${(instant / N * 100).toFixed(2)}%`);
