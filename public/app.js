// Camada compartilhada do frontend: API, sessão, saldo e chrome visual.
export const fmt = (c) => (c / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export async function api(path, method = 'GET', body) {
  const r = await fetch('/api/' + path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
    credentials: 'same-origin',
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(data.error || 'Ocorreu um erro'), { status: r.status, code: data.code });
  return data;
}

let user = null;
const listeners = new Set();
export const getUser = () => user;
export const onUser = (fn) => { listeners.add(fn); fn(user); };
export function setBalance(b) { if (user) { user.balance = b; paint(); } }

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

function notify() { listeners.forEach((fn) => fn(user)); }

function paint() {
  const w = document.getElementById('wallet');
  if (!w) return;
  w.replaceChildren();

  if (!user) {
    const b = el('button', 'primary login-btn', 'Entrar');
    b.onclick = () => openAuth();
    w.append(b);
    return;
  }

  const walletBox = el('div', 'wallet-balance');
  walletBox.innerHTML = '<span class="wallet-label">SALDO</span>';
  const bal = el('strong', 'balance', `${fmt(user.balance)} fichas`);
  bal.id = 'balance';
  walletBox.append(bal);

  const name = el('span', 'user-name', user.username);
  const out = el('button', 'icon-btn', 'Sair');
  out.title = 'Sair da conta';
  out.onclick = async () => {
    try { await api('auth/logout', 'POST', {}); } finally { user = null; paint(); notify(); }
  };

  w.append(walletBox, name);
  if (user.balance < 1000) {
    const r = el('button', 'gold refill-btn', '↻ Recarga grátis');
    r.onclick = async () => {
      try {
        const x = await api('wallet/refill', 'POST', {});
        setBalance(x.balance);
        showToast('Recarga realizada com sucesso.');
      } catch (e) { showToast(e.message, true); }
    };
    w.append(r);
  }
  w.append(out);
}

function showToast(message, error = false) {
  const t = document.getElementById('globalToast');
  if (!t) return;
  t.textContent = message;
  t.className = `global-toast show${error ? ' error' : ''}`;
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => t.classList.remove('show'), 2800);
}

function openAuth() {
  const d = document.getElementById('auth');
  if (d && !d.open) d.showModal();
}

function mountChrome() {
  const page = location.pathname.split('/').pop() || 'index.html';
  const link = (href, label, icon) =>
    `<a href="${href}" ${page === href ? 'aria-current="page"' : ''}><span>${icon}</span>${label}</a>`;

  document.body.insertAdjacentHTML('afterbegin', `
    <div class="notice"><span>◆</span> AMBIENTE DE DEMONSTRAÇÃO <b>•</b> fichas virtuais, sem dinheiro real</div>
    <header class="top">
      <div class="wrap top-inner">
        <a class="brand" href="index.html"><span class="brand-mark">🐯</span><span>Tigrinho <small>DA SORTE</small></span></a>
        <nav class="nav" aria-label="Navegação principal">
          ${link('index.html', 'Início', '⌂')}
          ${link('tigrinho.html', 'Tigrinho', '🐯')}
          ${link('aviator.html', 'Aviãozinho', '✈')}
        </nav>
        <div class="wallet" id="wallet"></div>
        <button class="mobile-nav" aria-label="Abrir menu">☰</button>
      </div>
    </header>
    <div id="globalToast" class="global-toast" role="status"></div>
    <dialog id="auth">
      <form method="dialog" id="authForm" class="auth-card">
        <button type="button" class="dialog-close" id="authX" aria-label="Fechar">×</button>
        <div class="auth-brand">🐯</div>
        <span class="eyebrow">BEM-VINDO À ARENA</span>
        <h2 id="authTitle">Entrar</h2>
        <p class="muted">Use uma conta local para testar os jogos.</p>
        <div class="tabs" role="tablist">
          <button type="button" role="tab" id="tabLogin" aria-selected="true">Entrar</button>
          <button type="button" role="tab" id="tabReg" aria-selected="false">Criar conta</button>
        </div>
        <div class="field"><label for="u">Usuário</label><input id="u" autocomplete="username" required minlength="3" maxlength="20" placeholder="Seu usuário"></div>
        <div class="field"><label for="p">Senha <span>mín. 8 caracteres</span></label><input id="p" type="password" autocomplete="current-password" required minlength="8" maxlength="72" placeholder="••••••••"></div>
        <p class="toast lose" id="authErr" role="alert"></p>
        <button class="primary btn-wide" id="authGo">Entrar na arena <span>→</span></button>
        <p class="auth-foot">Somente fichas virtuais • projeto de demonstração</p>
      </form>
    </dialog>
  `);

  let mode = 'login';
  const setMode = (m) => {
    mode = m;
    const login = m === 'login';
    document.getElementById('tabLogin').ariaSelected = login;
    document.getElementById('tabReg').ariaSelected = !login;
    document.getElementById('authGo').innerHTML = login ? 'Entrar na arena <span>→</span>' : 'Criar minha conta <span>→</span>';
    document.getElementById('authTitle').textContent = login ? 'Entrar' : 'Criar conta';
    document.getElementById('authErr').textContent = '';
  };
  document.getElementById('tabLogin').onclick = () => setMode('login');
  document.getElementById('tabReg').onclick = () => setMode('register');
  document.getElementById('authCancel')?.remove();
  document.getElementById('authX').onclick = () => document.getElementById('auth').close();

  const mobileNav = document.querySelector('.mobile-nav');
  if (mobileNav) mobileNav.onclick = () => {
    const nav = document.querySelector('.nav');
    if (!nav) return;
    nav.classList.toggle('mobile-open');
  };

  document.getElementById('authForm').onsubmit = async (ev) => {
    ev.preventDefault();
    const button = document.getElementById('authGo');
    button.disabled = true;
    try {
      const r = await api(mode === 'login' ? 'auth/login' : 'auth/register', 'POST', {
        username: document.getElementById('u').value.trim(),
        password: document.getElementById('p').value,
      });
      user = r.user; paint(); notify();
      document.getElementById('auth').close();
      document.getElementById('authErr').textContent = '';
      showToast(`Olá, ${user.username}! Conta conectada.`);
    } catch (e) {
      document.getElementById('authErr').textContent = e.message;
    } finally { button.disabled = false; }
  };
}

export async function init() {
  mountChrome();
  try { user = (await api('me')).user; } catch { user = null; }
  paint(); notify();
  return {
    requireLogin: () => {
      if (!user) { openAuth(); return false; }
      return true;
    }
  };
}
export { openAuth };
