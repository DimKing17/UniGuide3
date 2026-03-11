// ═══════════════════════════════════════════════════════════════
//  UniGuide — Auth & Cloud Data Layer
//  Firebase Authentication + Firestore + localStorage fallback
//  Config is loaded from firebase-config.js (auto-generated)
// ═══════════════════════════════════════════════════════════════

// firebase-config.js must be loaded before this script.
// It sets: FIREBASE_CONFIG (object) and FIREBASE_CONFIGURED (bool)

let _auth = null;
let _db   = null;
let _user = null;
let _ready = false;
let _readyCallbacks = [];

function _onReady(cb) {
  if (_ready) cb();
  else _readyCallbacks.push(cb);
}

// ── Load Firebase SDK from CDN then initialise ─────────────────
(function loadFirebase() {
  if (typeof FIREBASE_CONFIGURED === 'undefined' || !FIREBASE_CONFIGURED) {
    console.warn('UniGuide: Firebase not configured — running in localStorage-only mode.');
    _ready = true;
    _readyCallbacks.forEach(cb => cb());
    _readyCallbacks = [];
    _updateNavUI();
    return;
  }
  const ver  = '10.12.0';
  const base = `https://www.gstatic.com/firebasejs/${ver}`;
  const mods = ['firebase-app-compat.js','firebase-auth-compat.js','firebase-firestore-compat.js'];
  let loaded = 0;
  mods.forEach(mod => {
    const s = document.createElement('script');
    s.src = `${base}/${mod}`;
    s.onload = () => { if (++loaded === mods.length) _initFirebase(); };
    s.onerror = () => { console.warn('UniGuide: Failed to load', mod); _fallback(); };
    document.head.appendChild(s);
  });
})();

function _fallback() {
  _ready = true;
  _readyCallbacks.forEach(cb => cb());
  _readyCallbacks = [];
  _updateNavUI();
}

function _initFirebase() {
  try {
    firebase.initializeApp(FIREBASE_CONFIG);
    _auth = firebase.auth();
    _db   = firebase.firestore();
    _db.enablePersistence({ synchronizeTabs: true }).catch(() => {});
    _auth.onAuthStateChanged(user => {
      _user = user || null;
      _ready = true;
      _readyCallbacks.forEach(cb => cb());
      _readyCallbacks = [];
      _updateNavUI();
      if (_user) _migrateLocalToCloud();
    });
  } catch(e) {
    console.warn('UniGuide: Firebase init failed —', e.message);
    _fallback();
  }
}

// ════════════════════════════════════════════════════════════════
//  AUTH FUNCTIONS
// ════════════════════════════════════════════════════════════════

async function ugSignUp(email, password, displayName, extraProfile) {
  if (!_auth) throw new Error('Firebase not configured');
  const cred = await _auth.createUserWithEmailAndPassword(email, password);
  if (displayName) {
    await cred.user.updateProfile({ displayName });
  }
  const profile = {
    displayName: displayName || '',
    email,
    createdAt: firebase.firestore.FieldValue.serverTimestamp(),
    ...(extraProfile || {})
  };
  await _db.collection('users').doc(cred.user.uid).set(profile, { merge: true });
  return cred.user;
}

async function ugLogIn(email, password) {
  if (!_auth) throw new Error('Firebase not configured');
  const cred = await _auth.signInWithEmailAndPassword(email, password);
  return cred.user;
}

async function ugLogOut() {
  if (_auth) await _auth.signOut();
  _user = null;
  _updateNavUI();
  window.location.href = 'index.html';
}

async function ugResetPassword(email) {
  if (!_auth) throw new Error('Firebase not configured');
  await _auth.sendPasswordResetEmail(email);
}

function ugCurrentUser()  { return _user; }
function ugIsLoggedIn()   { return !!_user; }
function ugIsConfigured() { return typeof FIREBASE_CONFIGURED !== 'undefined' && FIREBASE_CONFIGURED; }

// ── Save/Load user profile fields to Firestore ─────────────────
async function ugSaveProfile(fields) {
  if (!_user || !_db) {
    try { localStorage.setItem('ugProfile', JSON.stringify(fields)); } catch(e) {}
    return;
  }
  try {
    await _db.collection('users').doc(_user.uid).set(fields, { merge: true });
    try { localStorage.setItem('ugProfile', JSON.stringify(fields)); } catch(e) {}
  } catch(e) { console.warn('ugSaveProfile error:', e.message); }
}

async function ugLoadProfile() {
  if (_user && _db) {
    try {
      const doc = await _db.collection('users').doc(_user.uid).get();
      if (doc.exists) return doc.data();
    } catch(e) { console.warn('ugLoadProfile error:', e.message); }
  }
  try { return JSON.parse(localStorage.getItem('ugProfile') || 'null'); } catch(e) { return null; }
}

// ════════════════════════════════════════════════════════════════
//  DUAL-MODE DATA LAYER  (Firestore or localStorage)
// ════════════════════════════════════════════════════════════════

async function ugSave(key, data) {
  try { localStorage.setItem(key, JSON.stringify(data)); } catch(e) {}
  if (_user && _db) {
    try {
      await _db.collection('users').doc(_user.uid)
        .collection('data').doc(key)
        .set({ value: JSON.stringify(data), updatedAt: firebase.firestore.FieldValue.serverTimestamp() });
    } catch(e) { console.warn('ugSave Firestore error:', e.message); }
  }
}

async function ugLoad(key, fallback) {
  if (_user && _db) {
    try {
      const doc = await _db.collection('users').doc(_user.uid)
        .collection('data').doc(key).get();
      if (doc.exists) {
        const val = JSON.parse(doc.data().value);
        try { localStorage.setItem(key, JSON.stringify(val)); } catch(e) {}
        return val;
      }
    } catch(e) { console.warn('ugLoad Firestore error:', e.message); }
  }
  try {
    const raw = localStorage.getItem(key);
    if (raw !== null) return JSON.parse(raw);
  } catch(e) {}
  return fallback !== undefined ? fallback : null;
}

async function ugRemove(key) {
  try { localStorage.removeItem(key); } catch(e) {}
  if (_user && _db) {
    try {
      await _db.collection('users').doc(_user.uid).collection('data').doc(key).delete();
    } catch(e) {}
  }
}

// ── Migrate localStorage → Firestore on first login ────────────
async function _migrateLocalToCloud() {
  if (!_user || !_db) return;
  const migKey = 'ug_migrated_' + _user.uid;
  if (localStorage.getItem(migKey)) return;
  const keys = ['savedPrograms','ugProfile','selectedMajors','essay_index'];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k && (k.startsWith('essay_') || k.startsWith('cl_') || k.startsWith('mc_'))) {
      if (!keys.includes(k)) keys.push(k);
    }
  }
  for (const key of keys) {
    const raw = localStorage.getItem(key);
    if (raw) {
      try {
        await _db.collection('users').doc(_user.uid)
          .collection('data').doc(key)
          .set({ value: raw, updatedAt: firebase.firestore.FieldValue.serverTimestamp() }, { merge: true });
      } catch(e) {}
    }
  }
  localStorage.setItem(migKey, '1');
}

// ════════════════════════════════════════════════════════════════
//  NAV UI
// ════════════════════════════════════════════════════════════════

function _updateNavUI() {
  const lo  = document.getElementById('nav-logged-out');
  const li  = document.getElementById('nav-logged-in');
  const nm  = document.getElementById('nav-user-name');
  const av  = document.getElementById('nav-avatar');
  if (!lo || !li) return;
  if (_user) {
    lo.style.display = 'none';
    li.style.display = 'flex';
    const name = _user.displayName || _user.email.split('@')[0];
    if (nm) nm.textContent = name;
    if (av) av.textContent = name.charAt(0).toUpperCase();
    setTimeout(_patchNavForProfile, 50);
    const profileTab = document.getElementById('auth-tab-profile');
    if (profileTab) profileTab.style.display = '';
  } else {
    lo.style.display = 'flex';
    li.style.display = 'none';
  }
}

// ════════════════════════════════════════════════════════════════
//  AUTH MODAL — open/close/tabs
// ════════════════════════════════════════════════════════════════

function ugOpenAuth(tab) {
  _ensureAuthModal();
  const modal = document.getElementById('authModal');
  if (!modal) return;
  modal.style.display = 'flex';
  document.body.style.overflow = 'hidden';
  _switchAuthTab(tab || 'login');
  _clearAuthMessages();
}

function ugCloseAuth() {
  const modal = document.getElementById('authModal');
  if (!modal) return;
  modal.style.display = 'none';
  document.body.style.overflow = '';
}

function _switchAuthTab(tab) {
  ['login','signup','reset','profile'].forEach(t => {
    const panel = document.getElementById('auth-panel-' + t);
    const btn   = document.getElementById('auth-tab-' + t);
    if (panel) panel.style.display = t === tab ? 'block' : 'none';
    if (btn) btn.classList.toggle('active', t === tab);
  });
  if (tab === 'profile') _loadProfilePanel();
}

function _clearAuthMessages() {
  const e = document.getElementById('authError');
  const s = document.getElementById('authSuccess');
  if (e) e.textContent = '';
  if (s) s.textContent = '';
}

function _setAuthError(msg) {
  const e = document.getElementById('authError');
  const s = document.getElementById('authSuccess');
  if (e) e.textContent = msg;
  if (s) s.textContent = '';
}

function _setAuthSuccess(msg) {
  const e = document.getElementById('authError');
  const s = document.getElementById('authSuccess');
  if (s) s.textContent = msg;
  if (e) e.textContent = '';
}

// ════════════════════════════════════════════════════════════════
//  FORM HANDLERS
// ════════════════════════════════════════════════════════════════

async function _handleLogin(e) {
  e.preventDefault();
  if (!ugIsConfigured()) { _setAuthError('Authentication is not configured for this app.'); return; }
  const btn   = document.getElementById('auth-login-btn');
  const email = document.getElementById('auth-login-email').value.trim();
  const pass  = document.getElementById('auth-login-pass').value;
  _clearAuthMessages();
  if (!email || !pass) { _setAuthError('Please enter your email and password.'); return; }
  btn.disabled = true; btn.textContent = 'Signing in…';
  try {
    await ugLogIn(email, pass);
    _setAuthSuccess('Signed in successfully!');
    setTimeout(() => { ugCloseAuth(); _updateNavUI(); }, 900);
  } catch(err) {
    _setAuthError(_friendlyError(err.code));
  }
  btn.disabled = false; btn.textContent = 'Sign In';
}

async function _handleSignup(e) {
  e.preventDefault();
  if (!ugIsConfigured()) { _setAuthError('Authentication is not configured for this app.'); return; }
  const btn   = document.getElementById('auth-signup-btn');
  const email = document.getElementById('auth-signup-email').value.trim();
  const pass  = document.getElementById('auth-signup-pass').value;
  const pass2 = document.getElementById('auth-signup-pass2').value;
  const name  = (document.getElementById('auth-signup-name').value || '').trim();
  _clearAuthMessages();
  if (!email) { _setAuthError('Email is required.'); return; }
  if (!pass)  { _setAuthError('Password is required.'); return; }
  if (pass.length < 6) { _setAuthError('Password must be at least 6 characters.'); return; }
  if (pass !== pass2) { _setAuthError('Passwords do not match.'); return; }

  const extraProfile = {
    ...(document.getElementById('auth-signup-grade').value   ? { grade:     document.getElementById('auth-signup-grade').value }   : {}),
    ...(document.getElementById('auth-signup-province').value ? { province:  document.getElementById('auth-signup-province').value } : {}),
    ...(document.getElementById('auth-signup-city').value.trim() ? { city:  document.getElementById('auth-signup-city').value.trim() } : {}),
    ...(document.getElementById('auth-signup-major').value.trim() ? { intendedMajor: document.getElementById('auth-signup-major').value.trim() } : {}),
    ...(document.getElementById('auth-signup-ethnicity').value ? { ethnicity: document.getElementById('auth-signup-ethnicity').value } : {}),
  };

  btn.disabled = true; btn.textContent = 'Creating account…';
  try {
    await ugSignUp(email, pass, name, extraProfile);
    _setAuthSuccess('Account created! Welcome' + (name ? ', ' + name : '') + '!');
    setTimeout(() => { ugCloseAuth(); _updateNavUI(); }, 1200);
  } catch(err) {
    _setAuthError(_friendlyError(err.code));
  }
  btn.disabled = false; btn.textContent = 'Create Account';
}

async function _handleReset(e) {
  e.preventDefault();
  if (!ugIsConfigured()) { _setAuthError('Authentication is not configured for this app.'); return; }
  const email = document.getElementById('auth-reset-email').value.trim();
  _clearAuthMessages();
  if (!email) { _setAuthError('Please enter your email address.'); return; }
  try {
    await ugResetPassword(email);
    _setAuthSuccess('Reset link sent! Check your inbox (and spam folder).');
  } catch(err) {
    _setAuthError(_friendlyError(err.code));
  }
}

async function _handleProfileSave(e) {
  e.preventDefault();
  if (!_user) return;
  const btn = document.getElementById('auth-profile-save-btn');
  btn.disabled = true; btn.textContent = 'Saving…';
  const fields = {
    displayName:    (document.getElementById('prof-name').value     || '').trim(),
    grade:          document.getElementById('prof-grade').value     || '',
    province:       document.getElementById('prof-province').value  || '',
    city:           (document.getElementById('prof-city').value     || '').trim(),
    intendedMajor:  (document.getElementById('prof-major').value    || '').trim(),
    ethnicity:      document.getElementById('prof-ethnicity').value || '',
    updatedAt:      new Date().toISOString(),
  };
  try {
    await ugSaveProfile(fields);
    if (fields.displayName) {
      await _user.updateProfile({ displayName: fields.displayName });
    }
    _updateNavUI();
    _setAuthSuccess('Profile saved!');
  } catch(err) {
    _setAuthError('Could not save profile. Please try again.');
  }
  btn.disabled = false; btn.textContent = 'Save Profile';
}

async function _loadProfilePanel() {
  if (!_user) return;
  document.getElementById('prof-email-display').textContent = _user.email;
  try {
    const profile = await ugLoadProfile();
    if (profile) {
      const set = (id, val) => { const el = document.getElementById(id); if (el && val) el.value = val; };
      set('prof-name',      profile.displayName  || _user.displayName || '');
      set('prof-grade',     profile.grade        || '');
      set('prof-province',  profile.province     || '');
      set('prof-city',      profile.city         || '');
      set('prof-major',     profile.intendedMajor|| '');
      set('prof-ethnicity', profile.ethnicity    || '');
    }
  } catch(e) {}
}

// ════════════════════════════════════════════════════════════════
//  ERROR MESSAGES
// ════════════════════════════════════════════════════════════════

function _friendlyError(code) {
  const map = {
    'auth/email-already-in-use':    'An account with this email already exists. Try signing in instead.',
    'auth/invalid-email':           'Please enter a valid email address.',
    'auth/weak-password':           'Password must be at least 6 characters.',
    'auth/user-not-found':          'No account found with this email. Check for typos or sign up.',
    'auth/wrong-password':          'Incorrect password. Try again or use "Forgot password?"',
    'auth/too-many-requests':       'Too many attempts — please wait a few minutes and try again.',
    'auth/invalid-credential':      'Incorrect email or password. Check for typos and try again.',
    'auth/network-request-failed':  'Network error. Please check your internet connection.',
    'auth/user-disabled':           'This account has been disabled. Contact support.',
    'auth/operation-not-allowed':   'Email/password login is not enabled. Contact the site admin.',
    'auth/popup-closed-by-user':    'Sign-in popup was closed. Please try again.',
    'auth/missing-password':        'Please enter a password.',
    'auth/missing-email':           'Please enter your email address.',
  };
  return map[code] || 'Something went wrong. Please try again. (Code: ' + (code || 'unknown') + ')';
}

// ════════════════════════════════════════════════════════════════
//  INJECT AUTH MODAL
// ════════════════════════════════════════════════════════════════

function _ensureAuthModal() {
  if (document.getElementById('authModal')) return;

  const PROVINCES = ['Alberta','British Columbia','Manitoba','New Brunswick',
    'Newfoundland and Labrador','Northwest Territories','Nova Scotia','Nunavut',
    'Ontario','Prince Edward Island','Quebec','Saskatchewan','Yukon'];
  const provOptions = PROVINCES.map(p => `<option value="${p}">${p}</option>`).join('');

  const GRADES = ['Grade 9','Grade 10','Grade 11','Grade 12','First Year University',
    'Second Year University','Third Year University','Fourth Year University+'];
  const gradeOptions = GRADES.map(g => `<option value="${g}">${g}</option>`).join('');

  const ETHNICITIES = ['Prefer not to say','Indigenous / First Nations / Métis / Inuit',
    'Black / African / Caribbean','East Asian','South Asian','Southeast Asian',
    'Middle Eastern / North African','Latin American / Hispanic','White / European',
    'Mixed / Multiracial','Other'];
  const ethOptions = ETHNICITIES.map(et => `<option value="${et}">${et}</option>`).join('');

  const notConfiguredBanner = ugIsConfigured() ? '' : `
    <div style="background:#fff8e1;border:1px solid #f5c842;border-radius:9px;padding:11px 14px;margin-bottom:14px;font-size:.83rem;color:#7a5c00;line-height:1.5;">
      <strong>⚠️ Auth not fully set up.</strong> Firebase secrets are not yet configured. Login/signup will not work until they are added.
    </div>`;

  const html = `
  <div id="authModal" style="display:none;position:fixed;inset:0;z-index:9000;background:rgba(0,0,0,.55);align-items:center;justify-content:center;padding:16px;" onclick="if(event.target===this)ugCloseAuth()">
    <div style="background:#fff;border-radius:18px;max-width:520px;width:100%;max-height:92vh;overflow-y:auto;position:relative;box-shadow:0 16px 64px rgba(0,0,0,.28);padding:32px 28px 28px;">
      <button onclick="ugCloseAuth()" style="position:absolute;top:14px;right:18px;background:none;border:none;font-size:1.4rem;cursor:pointer;color:#6B7A99;line-height:1;">✕</button>

      <div style="font-size:1.25rem;font-weight:900;color:#1A2A4A;margin-bottom:20px;">Uni<span style="color:#C8102E;">Guide</span> 🍁</div>

      ${notConfiguredBanner}

      <!-- Tabs -->
      <div style="display:flex;gap:4px;margin-bottom:22px;background:#F4F7FC;border-radius:10px;padding:4px;" id="authTabBar">
        <button id="auth-tab-login"   onclick="_switchAuthTab('login')"   class="auth-tab active">Sign In</button>
        <button id="auth-tab-signup"  onclick="_switchAuthTab('signup')"  class="auth-tab">Sign Up</button>
        <button id="auth-tab-reset"   onclick="_switchAuthTab('reset')"   class="auth-tab">Reset Password</button>
        <button id="auth-tab-profile" onclick="_switchAuthTab('profile')" class="auth-tab" style="display:none;">Profile</button>
      </div>

      <div id="authError"   style="display:none;background:#fde8ec;color:#9e0c23;border:1px solid #f7aab8;border-radius:8px;padding:10px 14px;margin-bottom:14px;font-size:.88rem;"></div>
      <div id="authSuccess" style="display:none;background:#e6f7f0;color:#1a7a52;border:1px solid #88d5b5;border-radius:8px;padding:10px 14px;margin-bottom:14px;font-size:.88rem;"></div>

      <!-- ── SIGN IN ── -->
      <div id="auth-panel-login">
        <form onsubmit="_handleLogin(event)" novalidate>
          <div style="margin-bottom:14px;">
            <label style="display:block;font-size:.82rem;font-weight:700;color:#6B7A99;margin-bottom:5px;text-transform:uppercase;letter-spacing:.5px;">Email</label>
            <input type="email" id="auth-login-email" placeholder="you@example.com" autocomplete="email"
              style="width:100%;padding:11px 14px;border:1.5px solid #DDE3F0;border-radius:9px;font-size:.95rem;outline:none;transition:border-color .15s;"
              onfocus="this.style.borderColor='#1A2A4A'" onblur="this.style.borderColor='#DDE3F0'"/>
          </div>
          <div style="margin-bottom:20px;">
            <label style="display:block;font-size:.82rem;font-weight:700;color:#6B7A99;margin-bottom:5px;text-transform:uppercase;letter-spacing:.5px;">Password</label>
            <input type="password" id="auth-login-pass" placeholder="Your password" autocomplete="current-password"
              style="width:100%;padding:11px 14px;border:1.5px solid #DDE3F0;border-radius:9px;font-size:.95rem;outline:none;transition:border-color .15s;"
              onfocus="this.style.borderColor='#1A2A4A'" onblur="this.style.borderColor='#DDE3F0'"/>
          </div>
          <button type="submit" id="auth-login-btn" style="width:100%;padding:13px;background:#C8102E;color:#fff;border:none;border-radius:10px;font-size:1rem;font-weight:800;cursor:pointer;transition:background .15s;" onmouseover="this.style.background='#9e0c23'" onmouseout="this.style.background='#C8102E'">Sign In</button>
        </form>
        <p style="text-align:center;margin-top:16px;font-size:.85rem;color:#6B7A99;">
          No account? <a href="#" onclick="_switchAuthTab('signup');return false;" style="color:#C8102E;font-weight:700;">Sign up free</a>
          &nbsp;·&nbsp;
          <a href="#" onclick="_switchAuthTab('reset');return false;" style="color:#6B7A99;">Forgot password?</a>
        </p>
      </div>

      <!-- ── SIGN UP ── -->
      <div id="auth-panel-signup" style="display:none;">
        <form onsubmit="_handleSignup(event)" novalidate>
          <!-- Required -->
          <div style="font-size:.74rem;font-weight:800;text-transform:uppercase;letter-spacing:1.5px;color:#C8102E;margin-bottom:12px;">Required</div>
          <div style="margin-bottom:13px;">
            <label style="display:block;font-size:.82rem;font-weight:700;color:#6B7A99;margin-bottom:5px;text-transform:uppercase;letter-spacing:.5px;">Email</label>
            <input type="email" id="auth-signup-email" placeholder="you@example.com" autocomplete="email"
              style="width:100%;padding:11px 14px;border:1.5px solid #DDE3F0;border-radius:9px;font-size:.95rem;outline:none;"
              onfocus="this.style.borderColor='#1A2A4A'" onblur="this.style.borderColor='#DDE3F0'"/>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:13px;">
            <div>
              <label style="display:block;font-size:.82rem;font-weight:700;color:#6B7A99;margin-bottom:5px;text-transform:uppercase;letter-spacing:.5px;">Password</label>
              <input type="password" id="auth-signup-pass" placeholder="Min. 6 characters" autocomplete="new-password"
                style="width:100%;padding:11px 14px;border:1.5px solid #DDE3F0;border-radius:9px;font-size:.95rem;outline:none;"
                onfocus="this.style.borderColor='#1A2A4A'" onblur="this.style.borderColor='#DDE3F0'"/>
            </div>
            <div>
              <label style="display:block;font-size:.82rem;font-weight:700;color:#6B7A99;margin-bottom:5px;text-transform:uppercase;letter-spacing:.5px;">Confirm</label>
              <input type="password" id="auth-signup-pass2" placeholder="Repeat password" autocomplete="new-password"
                style="width:100%;padding:11px 14px;border:1.5px solid #DDE3F0;border-radius:9px;font-size:.95rem;outline:none;"
                onfocus="this.style.borderColor='#1A2A4A'" onblur="this.style.borderColor='#DDE3F0'"/>
            </div>
          </div>

          <!-- Optional -->
          <div style="font-size:.74rem;font-weight:800;text-transform:uppercase;letter-spacing:1.5px;color:#1A2A4A;margin:18px 0 6px;">
            Optional <span style="font-weight:400;color:#6B7A99;text-transform:none;letter-spacing:0;font-size:.78rem;">— helps personalise your experience</span>
          </div>
          <div style="background:#F4F7FC;border-radius:10px;padding:16px;margin-bottom:4px;">
            <div style="margin-bottom:11px;">
              <label style="display:block;font-size:.80rem;font-weight:700;color:#6B7A99;margin-bottom:4px;">Your Name</label>
              <input type="text" id="auth-signup-name" placeholder="e.g. Alex (optional)" autocomplete="name"
                style="width:100%;padding:10px 13px;border:1.5px solid #DDE3F0;border-radius:8px;font-size:.90rem;outline:none;background:#fff;"
                onfocus="this.style.borderColor='#1A2A4A'" onblur="this.style.borderColor='#DDE3F0'"/>
            </div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:11px;">
              <div>
                <label style="display:block;font-size:.80rem;font-weight:700;color:#6B7A99;margin-bottom:4px;">Current Grade</label>
                <select id="auth-signup-grade" style="width:100%;padding:10px 13px;border:1.5px solid #DDE3F0;border-radius:8px;font-size:.88rem;background:#fff;color:#1A2A4A;">
                  <option value="">Select…</option>
                  ${gradeOptions}
                </select>
              </div>
              <div>
                <label style="display:block;font-size:.80rem;font-weight:700;color:#6B7A99;margin-bottom:4px;">Province</label>
                <select id="auth-signup-province" style="width:100%;padding:10px 13px;border:1.5px solid #DDE3F0;border-radius:8px;font-size:.88rem;background:#fff;color:#1A2A4A;">
                  <option value="">Select…</option>
                  ${provOptions}
                </select>
              </div>
            </div>
            <div style="margin-bottom:11px;">
              <label style="display:block;font-size:.80rem;font-weight:700;color:#6B7A99;margin-bottom:4px;">City / Town</label>
              <input type="text" id="auth-signup-city" placeholder="e.g. Toronto"
                style="width:100%;padding:10px 13px;border:1.5px solid #DDE3F0;border-radius:8px;font-size:.90rem;outline:none;background:#fff;"
                onfocus="this.style.borderColor='#1A2A4A'" onblur="this.style.borderColor='#DDE3F0'"/>
            </div>
            <div style="margin-bottom:11px;">
              <label style="display:block;font-size:.80rem;font-weight:700;color:#6B7A99;margin-bottom:4px;">Intended Major / Field</label>
              <input type="text" id="auth-signup-major" placeholder="e.g. Computer Science, Nursing"
                style="width:100%;padding:10px 13px;border:1.5px solid #DDE3F0;border-radius:8px;font-size:.90rem;outline:none;background:#fff;"
                onfocus="this.style.borderColor='#1A2A4A'" onblur="this.style.borderColor='#DDE3F0'"/>
            </div>
            <div>
              <label style="display:block;font-size:.80rem;font-weight:700;color:#6B7A99;margin-bottom:4px;">Race / Ethnicity</label>
              <select id="auth-signup-ethnicity" style="width:100%;padding:10px 13px;border:1.5px solid #DDE3F0;border-radius:8px;font-size:.88rem;background:#fff;color:#1A2A4A;">
                <option value="">Prefer not to say</option>
                ${ethOptions}
              </select>
            </div>
          </div>

          <button type="submit" id="auth-signup-btn" style="width:100%;padding:13px;background:#C8102E;color:#fff;border:none;border-radius:10px;font-size:1rem;font-weight:800;cursor:pointer;margin-top:16px;transition:background .15s;" onmouseover="this.style.background='#9e0c23'" onmouseout="this.style.background='#C8102E'">Create Account</button>
        </form>
        <p style="text-align:center;margin-top:14px;font-size:.85rem;color:#6B7A99;">
          Already have an account? <a href="#" onclick="_switchAuthTab('login');return false;" style="color:#C8102E;font-weight:700;">Sign in</a>
        </p>
      </div>

      <!-- ── RESET PASSWORD ── -->
      <div id="auth-panel-reset" style="display:none;">
        <p style="color:#6B7A99;font-size:.90rem;margin-bottom:18px;line-height:1.6;">Enter the email address you used to sign up and we'll send you a link to reset your password.</p>
        <form onsubmit="_handleReset(event)" novalidate>
          <div style="margin-bottom:20px;">
            <label style="display:block;font-size:.82rem;font-weight:700;color:#6B7A99;margin-bottom:5px;text-transform:uppercase;letter-spacing:.5px;">Email</label>
            <input type="email" id="auth-reset-email" placeholder="you@example.com" autocomplete="email"
              style="width:100%;padding:11px 14px;border:1.5px solid #DDE3F0;border-radius:9px;font-size:.95rem;outline:none;"
              onfocus="this.style.borderColor='#1A2A4A'" onblur="this.style.borderColor='#DDE3F0'"/>
          </div>
          <button type="submit" style="width:100%;padding:13px;background:#1A2A4A;color:#fff;border:none;border-radius:10px;font-size:1rem;font-weight:800;cursor:pointer;transition:background .15s;" onmouseover="this.style.background='#243558'" onmouseout="this.style.background='#1A2A4A'">Send Reset Link</button>
        </form>
        <p style="text-align:center;margin-top:16px;font-size:.85rem;">
          <a href="#" onclick="_switchAuthTab('login');return false;" style="color:#6B7A99;">← Back to sign in</a>
        </p>
      </div>

      <!-- ── PROFILE ── -->
      <div id="auth-panel-profile" style="display:none;">
        <div style="background:#F4F7FC;border-radius:10px;padding:12px 16px;margin-bottom:18px;font-size:.88rem;color:#6B7A99;">
          Signed in as <strong id="prof-email-display" style="color:#1A2A4A;"></strong>
          &nbsp;<a href="#" onclick="ugLogOut();ugCloseAuth();return false;" style="color:#C8102E;font-size:.80rem;font-weight:700;">Log out</a>
        </div>
        <form onsubmit="_handleProfileSave(event)" novalidate>
          <div style="font-size:.74rem;font-weight:800;text-transform:uppercase;letter-spacing:1.5px;color:#1A2A4A;margin-bottom:12px;">
            Your Profile <span style="font-weight:400;color:#6B7A99;text-transform:none;letter-spacing:0;font-size:.78rem;">— all fields optional</span>
          </div>
          <div style="margin-bottom:12px;">
            <label style="display:block;font-size:.80rem;font-weight:700;color:#6B7A99;margin-bottom:4px;">Display Name</label>
            <input type="text" id="prof-name" placeholder="e.g. Alex"
              style="width:100%;padding:10px 13px;border:1.5px solid #DDE3F0;border-radius:8px;font-size:.90rem;outline:none;"
              onfocus="this.style.borderColor='#1A2A4A'" onblur="this.style.borderColor='#DDE3F0'"/>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:12px;">
            <div>
              <label style="display:block;font-size:.80rem;font-weight:700;color:#6B7A99;margin-bottom:4px;">Grade / Year</label>
              <select id="prof-grade" style="width:100%;padding:10px 13px;border:1.5px solid #DDE3F0;border-radius:8px;font-size:.88rem;background:#fff;color:#1A2A4A;">
                <option value="">Select…</option>
                ${gradeOptions}
              </select>
            </div>
            <div>
              <label style="display:block;font-size:.80rem;font-weight:700;color:#6B7A99;margin-bottom:4px;">Province</label>
              <select id="prof-province" style="width:100%;padding:10px 13px;border:1.5px solid #DDE3F0;border-radius:8px;font-size:.88rem;background:#fff;color:#1A2A4A;">
                <option value="">Select…</option>
                ${provOptions}
              </select>
            </div>
          </div>
          <div style="margin-bottom:12px;">
            <label style="display:block;font-size:.80rem;font-weight:700;color:#6B7A99;margin-bottom:4px;">City / Town</label>
            <input type="text" id="prof-city" placeholder="e.g. Toronto"
              style="width:100%;padding:10px 13px;border:1.5px solid #DDE3F0;border-radius:8px;font-size:.90rem;outline:none;"
              onfocus="this.style.borderColor='#1A2A4A'" onblur="this.style.borderColor='#DDE3F0'"/>
          </div>
          <div style="margin-bottom:12px;">
            <label style="display:block;font-size:.80rem;font-weight:700;color:#6B7A99;margin-bottom:4px;">Intended Major / Field</label>
            <input type="text" id="prof-major" placeholder="e.g. Computer Science, Nursing"
              style="width:100%;padding:10px 13px;border:1.5px solid #DDE3F0;border-radius:8px;font-size:.90rem;outline:none;"
              onfocus="this.style.borderColor='#1A2A4A'" onblur="this.style.borderColor='#DDE3F0'"/>
          </div>
          <div style="margin-bottom:18px;">
            <label style="display:block;font-size:.80rem;font-weight:700;color:#6B7A99;margin-bottom:4px;">Race / Ethnicity</label>
            <select id="prof-ethnicity" style="width:100%;padding:10px 13px;border:1.5px solid #DDE3F0;border-radius:8px;font-size:.88rem;background:#fff;color:#1A2A4A;">
              <option value="">Prefer not to say</option>
              ${ethOptions}
            </select>
          </div>
          <button type="submit" id="auth-profile-save-btn" style="width:100%;padding:13px;background:#1A2A4A;color:#fff;border:none;border-radius:10px;font-size:1rem;font-weight:800;cursor:pointer;transition:background .15s;" onmouseover="this.style.background='#243558'" onmouseout="this.style.background='#1A2A4A'">Save Profile</button>
        </form>
      </div>

    </div>
  </div>`;

  document.body.insertAdjacentHTML('beforeend', html);

  // Wire error/success boxes to auto-show/hide on content change
  ['authError','authSuccess'].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    const obs = new MutationObserver(() => {
      el.style.display = el.textContent.trim() ? 'block' : 'none';
    });
    obs.observe(el, { childList: true, characterData: true, subtree: true });
    el.style.display = 'none';
  });
}

// ── Show profile tab for logged-in users ──────────────────────
function _patchNavForProfile() {
  const nm = document.getElementById('nav-user-name');
  if (nm && !nm._profilePatched) {
    nm.style.cursor = 'pointer';
    nm.title = 'View your profile';
    nm.addEventListener('click', () => { window.location.href = 'profile.html'; });
    nm._profilePatched = true;
  }
}

// ── Style the auth tabs ────────────────────────────────────────
(function injectAuthStyles() {
  const style = document.createElement('style');
  style.textContent = `
    .auth-tab {
      flex: 1; padding: 8px 6px; font-size: .80rem; font-weight: 700;
      background: transparent; border: none; border-radius: 7px;
      color: #6B7A99; cursor: pointer; transition: all .15s;
    }
    .auth-tab.active { background: #fff; color: #1A2A4A; box-shadow: 0 1px 6px rgba(26,42,74,.12); }
    .auth-tab:hover:not(.active) { color: #1A2A4A; }
    #authTabBar { display: flex; }
  `;
  document.head.appendChild(style);
})();

// ── Auto-show profile tab when logged in ──────────────────────
document.addEventListener('DOMContentLoaded', () => {
  _onReady(() => {
    if (_user) {
      const profileTab = document.getElementById('auth-tab-profile');
      if (profileTab) profileTab.style.display = '';
    }
  });
});

// Run _ensureAuthModal early so the modal is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', _ensureAuthModal);
} else {
  _ensureAuthModal();
}
