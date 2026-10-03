import { api, init, onUser, setBalance, getUser, fmt } from './app.js';

const $ = (id) => document.getElementById(id);
const STEPS = [100, 500, 1000, 2500, 5000, 10000, 25000, 50000];
let step = 1, cfg, busy = false, auto = false;
const cells = []; // cells[rolo][linha]

const { requireLogin } = await init();
cfg = await api('config');
const ICON = Object.fromEntries(Object.entries(cfg.tiger.symbols).map(([k, v]) => [k, v.icon]));
const CODES = Object.keys(ICON);

// monta a máquina
for (let r = 0; r < 3; r++) {
  const reel = document.createElement('div'); reel.className = 'reel';
  cells[r] = [];
  for (let l = 0; l < 3; l++) {
    const c = document.createElement('div'); c.className = 'cell'; c.textContent = ICON[CODES[(r * 3 + l) % CODES.length]];
    reel.append(c); cells[r][l] = c;
  }
  $('machine').append(reel);
}
$('paytable').innerHTML = Object.entries(cfg.tiger.paytable)
  .map(([k, m]) => `<tr><td>${ICON[k]} ${cfg.tiger.symbols[k].name}</td><td>${m}x</td></tr>`).join('');

const paintBet = () => { $('betOut').textContent = fmt(STEPS[step]); };
$('betDown').onclick = () => { step = Math.max(0, step - 1); paintBet(); };
$('betUp').onclick = () => { step = Math.min(STEPS.length - 1, step + 1); paintBet(); };
paintBet();

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

async function animate(grid) {
  const reels = [...document.querySelectorAll('.reel')];
  reels.forEach((r) => r.classList.add('spinning'));
  const timers = reels.map((_, r) => setInterval(() => {
    for (let l = 0; l < 3; l++) cells[r][l].textContent = ICON[CODES[Math.floor(Math.random() * CODES.length)]];
  }, 70));
  for (let r = 0; r < 3; r++) {
    await wait(reduced ? 0 : 450 + r * 350);
    clearInterval(timers[r]);
    reels[r].classList.remove('spinning');
    for (let l = 0; l < 3; l++) cells[r][l].textContent = ICON[grid[r][l]];
  }
}

async function spin() {
  if (busy || !requireLogin()) return false;
  busy = true; $('spin').disabled = true; $('msg').textContent = '';
  document.querySelectorAll('.cell.hit').forEach((c) => c.classList.remove('hit'));
  try {
    const res = await api('tiger/spin', 'POST', { bet: STEPS[step] });
    await animate(res.grid);
    for (const w of res.wins) cfg.tiger.lines[w.line].forEach((row, reel) => cells[reel][row].classList.add('hit'));
    setBalance(res.balance);
    $('nonce').textContent = res.nonce + 1;
    $('result').className = 'result ' + (res.payout > 0 ? 'win' : '');
    $('result').textContent = res.payout > 0 ? `Ganhou ${fmt(res.payout)} (${res.multiplier}x)` : 'Sem prêmio desta vez';
    return true;
  } catch (e) {
    $('msg').textContent = e.message; auto = false; paintAuto();
    return false;
  } finally { busy = false; $('spin').disabled = false; }
}
$('spin').onclick = spin;

function paintAuto() { $('auto').textContent = 'Auto: ' + (auto ? 'ligado' : 'desligado'); $('auto').setAttribute('aria-pressed', auto); }
$('auto').onclick = async () => {
  auto = !auto; paintAuto();
  while (auto) { const ok = await spin(); if (!ok) break; await wait(700); }
};

// provably fair
async function loadFair() {
  if (!getUser()) { $('hash').textContent = 'Entre para ver'; return; }
  const f = await api('fair');
  $('hash').textContent = f.serverSeedHash; $('cseed').value = f.clientSeed; $('nonce').textContent = f.nonce;
}
$('rotate').onclick = async () => {
  if (!requireLogin()) return;
  const cs = $('cseed').value.trim();
  try {
    const r = await api('fair/rotate', 'POST', cs ? { clientSeed: cs } : {});
    $('revealed').textContent = `Seed revelado: ${r.revealed.serverSeed}\nHash: ${r.revealed.serverSeedHash}\nSeed do cliente: ${r.revealed.clientSeed}\nGiros: 0 a ${r.revealed.lastNonce}\n\nCada giro: HMAC-SHA256(seed, "seedCliente:giro:0"). Bytes 0, 1 e 2 mod 32 = parada dos rolos.`;
    $('revealed').style.whiteSpace = 'pre-wrap';
    await loadFair();
  } catch (e) { $('msg').textContent = e.message; }
};
onUser(loadFair);
