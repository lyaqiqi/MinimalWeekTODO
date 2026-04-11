/* ── Auth module ──────────────────────────────────────────────────────────── */

const Auth = {
  TOKEN_KEY: 'wp_auth_token',

  getToken() {
    return localStorage.getItem(this.TOKEN_KEY);
  },

  setToken(token) {
    localStorage.setItem(this.TOKEN_KEY, token);
  },

  clearToken() {
    localStorage.removeItem(this.TOKEN_KEY);
  },

  isLoggedIn() {
    return !!this.getToken();
  },

  async login(email, password) {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || '登录失败');
    this.setToken(data.access_token);
    return data;
  },

  async register(email, password) {
    const res = await fetch('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || '注册失败');
    // If email confirmation required, session may be null
    if (!data.access_token) throw new Error(data.error || '注册成功，请查收确认邮件后登录');
    this.setToken(data.access_token);
    return data;
  },

  async logout() {
    const token = this.getToken();
    if (token) {
      await fetch('/api/auth/logout', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` },
      }).catch(() => {});
    }
    this.clearToken();
  },
};

/* ── Page visibility helpers ─────────────────────────────────────────────── */

function showAuthPage() {
  document.getElementById('auth-page').hidden = false;
  document.getElementById('app-container').hidden = true;
}

function showAppPage() {
  document.getElementById('auth-page').hidden = true;
  document.getElementById('app-container').hidden = false;
}

/* ── Auth form setup (runs on DOMContentLoaded) ──────────────────────────── */

document.addEventListener('DOMContentLoaded', async () => {
  if (Auth.isLoggedIn()) {
    showAppPage();
    // app.js defers to auth.js for the initial init() call
    if (typeof init === 'function') init();
    return;
  }
  showAuthPage();
  _setupAuthForms();
});

function _setupAuthForms() {
  // Tab switching
  document.getElementById('auth-tab-login').addEventListener('click', () => {
    _setAuthTab('login');
  });
  document.getElementById('auth-tab-register').addEventListener('click', () => {
    _setAuthTab('register');
  });

  // Login form
  document.getElementById('auth-login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const email    = document.getElementById('login-email').value.trim();
    const password = document.getElementById('login-password').value;
    const errEl    = document.getElementById('login-error');
    const btn      = e.target.querySelector('button[type=submit]');
    errEl.textContent = '';
    btn.disabled = true;
    try {
      await Auth.login(email, password);
      showAppPage();
      if (typeof init === 'function') init();
    } catch (err) {
      errEl.textContent = err.message;
    } finally {
      btn.disabled = false;
    }
  });

  // Register form
  document.getElementById('auth-register-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const email    = document.getElementById('register-email').value.trim();
    const password = document.getElementById('register-password').value;
    const errEl    = document.getElementById('register-error');
    const btn      = e.target.querySelector('button[type=submit]');
    errEl.textContent = '';
    btn.disabled = true;
    try {
      await Auth.register(email, password);
      showAppPage();
      if (typeof init === 'function') init();
    } catch (err) {
      errEl.textContent = err.message;
      btn.disabled = false;
    }
  });
}

function _setAuthTab(tab) {
  const isLogin = tab === 'login';
  document.getElementById('auth-tab-login').classList.toggle('active', isLogin);
  document.getElementById('auth-tab-register').classList.toggle('active', !isLogin);
  document.getElementById('auth-login-form').hidden = !isLogin;
  document.getElementById('auth-register-form').hidden = isLogin;
}
