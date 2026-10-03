// Código compartilhado: chamadas à API, cabeçalho com saldo e login.
export const fmt = (c) => (c / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export async function api(path, method = 'GET', body) {
  const r = await fetch('/api/' + path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
    credentials: 'same-origin',
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(data.error || 'Erro'), { status: r.status, code: data.code });
  return data;
}

let user = null;
const listeners = new Set();
export const getUser = () => user;
export const onUser = (fn) => { listeners.add(fn); fn(user); };
export function setBalance(b) { if (user) { user.balance = b; paint(); } }

function paint() {
  const w = document.getElementById('wallet');
  if (!w) return;
  w.replaceChildren();
  if (user) {
    const bal = el('span', 'balance', `${fmt(user.balance)} fichas`);
    bal.id = 'balance';
    const name = el('span', 'muted', user.username);
    const out = el('button', '', 'Sair');
    out.onclick = async () => { await api('auth/logout', 'POST', {}); user = null; paint(); notify(); };
    w.append(name, bal);
    const adminNav = document.getElementById('adminNav');
    if (adminNav) adminNav.hidden = user.username.toLowerCase() !== 'patetola';
    if (user.balance < 1000) {
      const r = el('button', 'gold', 'Recarga grátis');
      r.onclick = async () => { try { const x = await api('wallet/refill', 'POST', {}); setBalance(x.balance); } catch (e) { alert(e.message); } };
      w.append(r);
    }
    w.append(out);
  } else {
    const adminNav = document.getElementById('adminNav');
    if (adminNav) adminNav.hidden = true;
    const b = el('button', 'primary', 'Entrar');
    b.onclick = () => openAuth();
    w.append(b);
  }
}
function notify() { listeners.forEach((fn) => fn(user)); }

function el(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text) e.textContent = text; return e; }

function openAuth() {
  const d = document.getElementById('auth');
  d.showModal();
}

function mountChrome(active) {
  const page = location.pathname.split('/').pop() || 'index.html';
  const link = (href, label) => `<a href="${href}" ${page === href ? 'aria-current="page"' : ''}>${label}</a>`;
  document.body.insertAdjacentHTML('afterbegin', `
    <div class="notice">Jogo de demonstração com fichas virtuais. Não existe depósito, saque nem dinheiro real.</div>
    <header class="top"><div class="wrap">
      <a class="brand" href="index.html">Tigrinho da Sorte</a>
      <nav class="nav">${link('index.html', 'Início')}${link('tigrinho.html', 'Tigrinho')}${link('aviator.html', 'Aviãozinho')}${link('ranking.html', 'Ranking')}<a id="adminNav" href="admin.html" hidden>Admin</a></nav>
      <div class="wallet" id="wallet"></div>
    </div></header>
    <dialog id="auth">
      <form method="dialog" id="authForm">
        <div class="tabs" role="tablist">
          <button type="button" role="tab" id="tabLogin" aria-selected="true">Entrar</button>
          <button type="button" role="tab" id="tabReg" aria-selected="false">Criar conta</button>
        </div>
        <div><label for="u">Usuário</label><input id="u" autocomplete="username" required minlength="3" maxlength="20"></div>
        <div><label for="p">Senha (mín. 8 caracteres)</label><input id="p" type="password" autocomplete="current-password" required minlength="8" maxlength="72"></div>
        <p class="toast lose" id="authErr" role="alert"></p>
        <div class="row"><button type="button" id="authCancel">Cancelar</button><button class="primary" id="authGo">Entrar</button></div>
      </form>
    </dialog>`);

  let mode = 'login';
  const setMode = (m) => {
    mode = m;
    document.getElementById('tabLogin').ariaSelected = m === 'login';
    document.getElementById('tabReg').ariaSelected = m === 'register';
    document.getElementById('authGo').textContent = m === 'login' ? 'Entrar' : 'Criar conta';
  };
  document.getElementById('tabLogin').onclick = () => setMode('login');
  document.getElementById('tabReg').onclick = () => setMode('register');
  document.getElementById('authCancel').onclick = () => document.getElementById('auth').close();
  document.getElementById('authForm').onsubmit = async (ev) => {
    ev.preventDefault();
    try {
      const r = await api(mode === 'login' ? 'auth/login' : 'auth/register', 'POST', {
        username: document.getElementById('u').value, password: document.getElementById('p').value,
      });
      user = r.user; paint(); notify();
      document.getElementById('auth').close();
      document.getElementById('authErr').textContent = '';
    } catch (e) { document.getElementById('authErr').textContent = e.message; }
  };
  document.getElementById('authForm').addEventListener('submit', (e) => e.preventDefault());
}

export async function init() {
  mountChrome();
  try { user = (await api('me')).user; } catch { user = null; }
  paint(); notify();
  return { requireLogin: () => { if (!user) { openAuth(); return false; } return true; } };
}
export { openAuth };
