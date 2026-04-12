/* ── Supabase JS client (for OAuth) ────────────────────────────────────────── */

let _supabaseClient = null;

function getSupabaseClient() {
  if (_supabaseClient) return _supabaseClient;
  if (!window.SUPABASE_URL || !window.SUPABASE_ANON_KEY) return null;
  _supabaseClient = supabase.createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY);
  return _supabaseClient;
}

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
    if (!res.ok) throw new Error(data.error || 'Sign in failed');
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
    if (!res.ok) throw new Error(data.error || 'Sign up failed');
    // If email confirmation required, session may be null
    if (!data.access_token) throw new Error(data.error || 'Sign up successful — please check your email to confirm');
    this.setToken(data.access_token);
    return data;
  },

  async signInWithOAuth(provider) {
    const client = getSupabaseClient();
    if (!client) throw new Error('OAuth not configured');
    const { error } = await client.auth.signInWithOAuth({
      provider,
      options: {
        redirectTo: window.location.origin + '/',
      },
    });
    if (error) throw new Error(error.message);
    // Supabase redirects the browser — execution stops here
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
    // Also sign out the Supabase JS session if present
    const client = getSupabaseClient();
    if (client) await client.auth.signOut().catch(() => {});
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

/* ── OAuth callback handler ──────────────────────────────────────────────── */

async function _handleOAuthCallback() {
  // Supabase puts the session in the URL hash after OAuth redirect
  const client = getSupabaseClient();
  if (!client) return false;

  // getSession() resolves the hash fragment automatically
  const { data } = await client.auth.getSession();
  if (data?.session?.access_token) {
    Auth.setToken(data.session.access_token);
    // Clean the hash from the URL without reloading
    history.replaceState(null, '', window.location.pathname);
    return true;
  }
  return false;
}

/* ── Auth form setup (runs on DOMContentLoaded) ──────────────────────────── */

document.addEventListener('DOMContentLoaded', async () => {
  // Check for OAuth redirect callback first
  if (window.location.hash.includes('access_token') || window.location.hash.includes('error')) {
    const resolved = await _handleOAuthCallback();
    if (resolved && Auth.isLoggedIn()) {
      showAppPage();
      if (typeof init === 'function') init();
      return;
    }
  }

  if (Auth.isLoggedIn()) {
    showAppPage();
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

  // OAuth: Google
  document.getElementById('btn-oauth-google').addEventListener('click', async () => {
    const btn = document.getElementById('btn-oauth-google');
    btn.disabled = true;
    btn.textContent = 'Redirecting…';
    try {
      await Auth.signInWithOAuth('google');
    } catch (err) {
      btn.disabled = false;
      btn.innerHTML = `<svg viewBox="0 0 24 24" width="18" height="18"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05"/><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/></svg> Continue with Google`;
      alert('Google sign-in unavailable: ' + err.message);
    }
  });

  // OAuth: GitHub
  document.getElementById('btn-oauth-github').addEventListener('click', async () => {
    const btn = document.getElementById('btn-oauth-github');
    btn.disabled = true;
    btn.textContent = 'Redirecting…';
    try {
      await Auth.signInWithOAuth('github');
    } catch (err) {
      btn.disabled = false;
      btn.innerHTML = `<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z"/></svg> Continue with GitHub`;
      alert('GitHub sign-in unavailable: ' + err.message);
    }
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
