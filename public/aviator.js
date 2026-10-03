import { api, init, onUser, setBalance, getUser, fmt } from './app.js';

const $ = (id) => document.getElementById(id);
const { requireLogin } = await init();
const cfg = (await api('config')).aviator;

let state = null;      // último snapshot do servidor
let mine = null;       // minha aposta na rodada
let t0 = 0;            // relógio local do início do voo (ressincronizado a cada tick)
let points = [];       // trajetória para o gráfico
let serverMult = 1;

const fmtX = (m) => m.toFixed(2) + 'x';
const clientMult = () => Math.min(Math.floor(Math.exp(cfg.GROWTH * (performance.now() - t0)) * 100) / 100, state?.phase === 'flying' ? Infinity : serverMult);

// ---------- stream em tempo real ----------
const es = new EventSource('/api/aviator/stream');
es.addEventListener('state', (e) => {
  const prev = state;
  state = JSON.parse(e.data);
  if (!prev || prev.id !== state.id) { mine = null; points = []; $('msg').textContent = ''; }
  if (state.phase === 'flying') { serverMult = state.multiplier; t0 = performance.now() - Math.log(Math.max(serverMult, 1)) / cfg.GROWTH; }
  if (state.phase === 'crashed') { serverMult = state.multiplier; if (mine && !mine.cashedAt) $('msg').textContent = 'O avião caiu. Aposta perdida.'; }
  syncMine(); renderHistory(); renderBets(state.bets); paintAction();
});
es.addEventListener('tick', (e) => {
  const d = JSON.parse(e.data);
  serverMult = d.m; t0 = performance.now() - Math.log(Math.max(d.m, 1)) / cfg.GROWTH;
  renderBets(d.bets); syncMine();
});
es.addEventListener('bets', (e) => renderBets(JSON.parse(e.data).bets));

function syncMine() {
  const u = getUser();
  if (!u || !state) return;
  const b = state.bets.find((x) => x.user === u.username);
  if (b) {
    mine = { ...(mine || {}), amount: b.amount, cashedAt: b.cashedAt, payout: b.payout };
    if (b.cashedAt && state.phase !== 'betting') $('msg').textContent = `Retirado em ${fmtX(b.cashedAt)} — ganhou ${fmt(b.payout)}`;
    if (b.cashedAt) refreshBalance();
  }
  paintAction();
}
let balTimer;
function refreshBalance() { clearTimeout(balTimer); balTimer = setTimeout(async () => { try { setBalance((await api('me')).user.balance); } catch {} }, 150); }

// ---------- ação do jogador ----------
function paintAction() {
  const btn = $('act'); if (!state) return;
  const inRound = mine && !mine.cashedAt;
  if (state.phase === 'betting') {
    btn.textContent = inRound ? 'Aposta feita' : 'Apostar'; btn.disabled = !!mine; btn.className = 'primary';
  } else if (state.phase === 'flying' && inRound) {
    btn.textContent = 'Retirar'; btn.disabled = false; btn.className = 'gold';
  } else {
    btn.textContent = state.phase === 'flying' ? 'Aguarde a próxima rodada' : 'Apostar'; btn.disabled = true; btn.className = 'primary';
  }
}
$('act').onclick = async () => {
  if (!requireLogin()) return;
  $('msg').textContent = '';
  try {
    if (state.phase === 'betting') {
      const amount = Math.round(Number($('amount').value) * 100);
      const auto = $('autoc').value ? Number($('autoc').value) : undefined;
      const r = await api('aviator/bet', 'POST', { amount, autoCashout: auto });
      mine = { amount: r.amount, auto: r.auto }; setBalance(r.balance); $('msg').textContent = 'Aposta feita. Boa sorte!';
    } else {
      const r = await api('aviator/cashout', 'POST', {});
      mine.cashedAt = r.multiplier; setBalance(r.balance); $('msg').textContent = `Retirado em ${fmtX(r.multiplier)} — ganhou ${fmt(r.payout)}`;
    }
  } catch (e) { $('msg').textContent = e.message; }
  paintAction();
};
onUser(() => { mine = null; syncMine(); paintAction(); });

// ---------- listas ----------
function renderBets(bets) {
  $('bets').replaceChildren(...bets.map((b) => {
    const d = document.createElement('div');
    const a = document.createElement('span'); a.textContent = `${b.user} · ${fmt(b.amount)}`;
    const c = document.createElement('span');
    c.textContent = b.cashedAt ? `${fmtX(b.cashedAt)} (+${fmt(b.payout)})` : '—'; if (b.cashedAt) c.className = 'good';
    d.append(a, c); return d;
  }));
  if (!bets.length) $('bets').textContent = 'Ninguém apostou ainda.';
}
function renderHistory() {
  $('history').replaceChildren(...state.history.map((h) => {
    const b = document.createElement('button'); b.className = 'chip ' + (h.crash >= 2 ? 'hi' : 'lo'); b.textContent = fmtX(h.crash);
    b.onclick = () => verify(h); return b;
  }));
}

// ---------- verificação no navegador (Web Crypto) ----------
async function verify(h) {
  const enc = new TextEncoder();
  const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(h.seed)))].map((x) => x.toString(16).padStart(2, '0')).join('');
  const key = await crypto.subtle.importKey('raw', enc.encode(h.seed), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = new DataView(await crypto.subtle.sign('HMAC', key, enc.encode(`aviator:${h.id}:0`)));
  const r = ((mac.getUint32(0) & 0xfffff) * 2 ** 32 + mac.getUint32(4)) / 2 ** 52;
  const point = Math.min(Math.max(Math.floor((100 * (1 - cfg.HOUSE_EDGE)) / (1 - r)) / 100, 1), cfg.MAX_MULT);
  $('verify').textContent = `Rodada #${h.id}\nSeed: ${h.seed}\nHash publicado: ${h.seedHash}\nSHA-256(seed): ${hash} ${hash === h.seedHash ? '✓' : '✗'}\nQueda recalculada: ${fmtX(point)} ${point === h.crash ? '✓ igual ao servidor' : '✗ diferente'}`;
  $('verify').style.whiteSpace = 'pre-wrap';
  $('verify').closest('details').open = true;
}

// ---------- desenho ----------
const cv = $('cv'), ctx = cv.getContext('2d');
function draw() {
  const W = cv.width, H = cv.height;
  ctx.clearRect(0, 0, W, H);
  const phase = state?.phase;
  const m = phase === 'flying' ? clientMult() : phase === 'crashed' ? serverMult : 1;
  if (phase === 'flying') points.push([performance.now() - t0, m]);

  const tMax = Math.max(8000, points.length ? points[points.length - 1][0] * 1.1 : 0);
  const mMax = Math.max(2, m * 1.15);
  const X = (t) => 30 + (t / tMax) * (W - 80);
  const Y = (v) => H - 30 - ((v - 1) / (mMax - 1)) * (H - 80);

  ctx.strokeStyle = 'rgba(255,255,255,.07)'; ctx.lineWidth = 1;
  for (let i = 1; i < 5; i++) { ctx.beginPath(); ctx.moveTo(0, H - 30 - i * (H - 80) / 4); ctx.lineTo(W, H - 30 - i * (H - 80) / 4); ctx.stroke(); }

  if (points.length > 1) {
    ctx.beginPath(); ctx.moveTo(X(points[0][0]), Y(points[0][1]));
    for (const [t, v] of points) ctx.lineTo(X(t), Y(v));
    ctx.strokeStyle = phase === 'crashed' ? '#d23a22' : '#eab544'; ctx.lineWidth = 4; ctx.stroke();
    const [lt, lv] = points[points.length - 1];
    ctx.lineTo(X(lt), H - 30); ctx.lineTo(X(points[0][0]), H - 30); ctx.fillStyle = 'rgba(210,58,34,.15)'; ctx.fill();
    ctx.font = '34px serif'; ctx.fillText(phase === 'crashed' ? '💥' : '✈️', X(lt) - 14, Y(lv) - 6);
  }

  const mult = $('mult');
  if (phase === 'betting') {
    const s = Math.max(0, Math.ceil((state.nextAt - Date.now()) / 1000));
    mult.className = 'mult'; mult.innerHTML = `<span>${s}s<small>Apostas abertas</small></span>`;
  } else if (phase === 'crashed') {
    mult.className = 'mult crashed'; mult.innerHTML = `<span>${fmtX(serverMult)}<small>O avião caiu</small></span>`;
  } else if (phase === 'flying') {
    mult.className = 'mult'; mult.textContent = fmtX(m);
  }
  requestAnimationFrame(draw);
}
draw();
fetch('/api/aviator/state').then((r) => r.json()).then(() => {});
