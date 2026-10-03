'use strict';
// Testes de integração sem dependências: node tools/test.js
process.env.DATA_FILE = require('path').join(require('os').tmpdir(), `tigrinho-test-${Date.now()}.json`);
process.env.PORT = '0';
const assert = require('assert');
const server = require('../server');
const fair = require('../src/fair');
const tiger = require('../src/games/tiger');
const aviator = require('../src/games/aviator');

let base, cookie = '';
async function api(method, path, body) {
  const r = await fetch(base + path, {
    method, headers: { 'Content-Type': 'application/json', cookie },
    body: body ? JSON.stringify(body) : undefined,
  });
  const sc = r.headers.get('set-cookie');
  if (sc) cookie = sc.split(';')[0];
  return { status: r.status, data: await r.json() };
}
const ok = (name) => console.log('  ✓', name);

(async () => {
  await new Promise((r) => server.listen(0, r));
  base = `http://127.0.0.1:${server.address().port}`;

  // auth
  assert.equal((await api('POST', '/api/tiger/spin', { bet: 500 })).status, 401); ok('spin exige login');
  assert.equal((await api('POST', '/api/auth/register', { username: 'a', password: '12345678' })).status, 400); ok('valida usuário');
  const reg = await api('POST', '/api/auth/register', { username: 'tester', password: 'senha-forte-123' });
  assert.equal(reg.status, 200); assert.equal(reg.data.user.balance, 100000); ok('registro + saldo inicial');
  assert.equal((await api('POST', '/api/auth/register', { username: 'TESTER', password: 'senha-forte-123' })).status, 409); ok('usuário duplicado');

  // tigrinho: validação de aposta
  for (const bet of [0, -500, 501, 1.5, '500', 999999, null]) {
    assert.equal((await api('POST', '/api/tiger/spin', { bet })).status, 400, `bet=${bet}`);
  }
  ok('rejeita apostas inválidas');

  // tigrinho: conservação de saldo + determinismo/provably fair
  const hash0 = (await api('GET', '/api/fair')).data;
  let expected = 100000, last;
  for (let i = 0; i < 50; i++) {
    const s = await api('POST', '/api/tiger/spin', { bet: 1000 });
    assert.equal(s.status, 200);
    expected = expected - 1000 + s.data.payout;
    assert.equal(s.data.balance, expected);
    assert.equal(s.data.nonce, i);
    last = s.data;
  }
  ok('saldo bate após 50 giros');

  const rot = await api('POST', '/api/fair/rotate', { clientSeed: 'meu-seed' });
  const { serverSeed, serverSeedHash, clientSeed, lastNonce } = rot.data.revealed;
  assert.equal(fair.sha256(serverSeed), serverSeedHash);
  assert.equal(serverSeedHash, hash0.serverSeedHash);
  assert.equal(lastNonce, 49);
  const stops = tiger.stopsFromSeeds(serverSeed, clientSeed, 49);
  assert.deepEqual(stops, last.stops);
  assert.deepEqual(tiger.gridFromStops(stops), last.grid);
  ok('provably fair: hash confere e giro é reproduzível');

  // aviator
  const st = (await api('GET', '/api/aviator/state')).data;
  assert.ok(['betting', 'flying', 'crashed'].includes(st.phase));
  assert.equal(st.seed === null || st.phase === 'crashed', true); ok('seed da rodada oculto até a queda');
  const { crashPointFromSeed } = aviator;
  assert.equal(typeof crashPointFromSeed('x', 1), 'number');

  // espera abrir janela de apostas
  for (let i = 0; i < 80; i++) {
    if ((await api('GET', '/api/aviator/state')).data.phase === 'betting') break;
    await new Promise((r) => setTimeout(r, 250));
  }
  const bal = (await api('GET', '/api/me')).data.user.balance;
  const bet = await api('POST', '/api/aviator/bet', { amount: 1000, autoCashout: 1.5 });
  assert.equal(bet.status, 200); assert.equal(bet.data.balance, bal - 1000);
  assert.equal((await api('POST', '/api/aviator/bet', { amount: 1000 })).status, 409); ok('aposta única por rodada');
  assert.equal((await api('POST', '/api/aviator/cashout')).status, 409); ok('cashout bloqueado antes de voar');

  console.log('\nTudo certo.');
  process.exit(0);
})().catch((e) => { console.error('FALHOU:', e); process.exit(1); });
