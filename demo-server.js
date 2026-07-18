/**
 * DEMO SERVER — untuk mencoba login & dashboard TANPA setup MySQL/Redis.
 * Semua data disimpan di memory (hilang tiap restart). Jangan dipakai di
 * produksi — cuma untuk demo/testing UI secara instan.
 *
 * Jalankan:  npm run demo   (atau: node demo-server.js)
 * Lalu buka frontend seperti biasa (mis. node ../frontend/serve.js) dan login
 * pakai kredensial di bawah ini.
 *
 * ============ AKUN DEMO ============
 *  Admin : admin@demo.com   / Admin123!   → login di /admin/index.html
 *  User  : user@demo.com    / User123!    → login di /index.html
 * ====================================
 */
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const app = express();
app.use(cors());
app.use(express.json());

const JWT_SECRET = process.env.JWT_SECRET || 'demo_secret_ganti_di_produksi';
// PENTING untuk hosting terkelola (Hostinger Node.js App, Render, Railway, dst):
// platform-platform ini MENENTUKAN port lewat env var PORT sendiri — app HARUS
// dengar di situ, bukan di port tetap. Kalau app keukeuh pakai port sendiri
// (mis. 3000) padahal platform menyuruh dengar di port lain, app akan
// dianggap gagal start / auto-restart terus oleh platform.
const PORT = process.env.PORT || process.env.DEMO_PORT || 3000;

// Supaya crash tidak "diam-diam mati" tanpa jejak di log Hostinger — selalu
// cetak errornya dulu sebelum proses berhenti.
process.on('uncaughtException', (err) => {
  console.error('UNCAUGHT EXCEPTION:', err);
});
process.on('unhandledRejection', (err) => {
  console.error('UNHANDLED REJECTION:', err);
});

// ------------------------------------------------------------------
// Seed data (in-memory)
// ------------------------------------------------------------------
const users = [
  { id: 1, name: 'Demo Admin', email: 'admin@demo.com', password_hash: bcrypt.hashSync('Admin123!', 10), role: 'admin', status: 'active', created_at: new Date('2026-06-01') },
  { id: 2, name: 'Demo User', email: 'user@demo.com', password_hash: bcrypt.hashSync('User123!', 10), role: 'user', status: 'active', created_at: new Date('2026-06-15') },
];
let nextUserId = 3;

const licenses = [
  { id: 1, license_key: 'DEMO1234ABCD5678', user_id: 2, status: 'active', hwid: 'HWID-DEMO-VPS-01', max_accounts: 3, expires_at: new Date('2026-12-31'), created_at: new Date('2026-06-15') },
];
let nextLicenseId = 2;

const accounts = [
  { id: 1, user_id: 2, license_id: 1, account_number: '1000101', platform: 'MT4', broker: 'DemoBroker Ltd', nickname: 'Scalper Grid EA', created_at: new Date('2026-06-16') },
  { id: 2, user_id: 2, license_id: 1, account_number: '1000102', platform: 'MT5', broker: 'DemoBroker Ltd', nickname: 'Trend Follower EA', created_at: new Date('2026-06-18') },
];
let nextAccountId = 3;

const eaSettings = {
  1: { account_id: 1, lots: 0.10, grid_step: 150, take_profit: 300, stop_loss: 0, magic_number: 10011, max_positions: 5, averaging_enabled: 1, grid_enabled: 1, hedging_enabled: 0, news_filter_enabled: 1 },
  2: { account_id: 2, lots: 0.05, grid_step: 0, take_profit: 200, stop_loss: 100, magic_number: 10012, max_positions: 1, averaging_enabled: 0, grid_enabled: 0, hedging_enabled: 0, news_filter_enabled: 1 },
};

const accountStatus = { 1: 'running', 2: 'paused' };

const commands = []; // { id, account_id, command, payload, status, created_at, acked_at }
let nextCommandId = 1;

const tradeHistory = [
  { account_id: 1, profit: 42.5, closed_at: new Date(Date.now() - 1 * 86400000) },
  { account_id: 1, profit: -15.2, closed_at: new Date(Date.now() - 2 * 86400000) },
  { account_id: 1, profit: 60.0, closed_at: new Date(Date.now() - 3 * 86400000) },
  { account_id: 2, profit: 12.0, closed_at: new Date(Date.now() - 1 * 86400000) },
];

const eaVersions = [
  { id: 1, platform: 'MT4', version: '1.2.0', download_url: 'https://example.com/ea-mt4-1.2.0.ex4', changelog: 'Perbaikan bug grid step', released_at: new Date('2026-07-01') },
  { id: 2, platform: 'MT5', version: '1.1.0', download_url: 'https://example.com/ea-mt5-1.1.0.ex5', changelog: 'Rilis awal MT5', released_at: new Date('2026-06-20') },
];
let nextVersionId = 3;

// Data realtime palsu (biasanya datang dari Redis lewat heartbeat EA asli)
function fakeRealtime(accountNumber) {
  const isOnline = accountNumber !== '1000102'; // satu akun sengaja dibuat offline utk contoh
  if (!isOnline) return null;
  const base = accountNumber === '1000101' ? 5230.4 : 1000;
  const jitter = (Math.sin(Date.now() / 5000) * 12).toFixed(2);
  return {
    balance: base,
    equity: (base + Number(jitter)).toFixed(2),
    profit: jitter,
    margin: 120.0,
    free_margin: base - 120,
    positions: 2,
    spread: 1.2,
    ping: 34,
    server: 'DemoBroker-Live',
    online: true,
    updated_at: Date.now(),
  };
}

// ------------------------------------------------------------------
// Middleware
// ------------------------------------------------------------------
function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Missing token' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}
function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== 'admin') return res.status(403).json({ error: 'Admin access only' });
  next();
}

// ------------------------------------------------------------------
// Auth
// ------------------------------------------------------------------
app.post('/api/auth/register', (req, res) => {
  const { name, email, password } = req.body;
  if (!name || !email || !password) return res.status(400).json({ error: 'Missing fields' });
  if (users.some(u => u.email === email)) return res.status(409).json({ error: 'Email already registered' });

  const user = { id: nextUserId++, name, email, password_hash: bcrypt.hashSync(password, 10), role: 'user', status: 'active', created_at: new Date() };
  users.push(user);
  const token = jwt.sign({ id: user.id, email, role: 'user' }, JWT_SECRET, { expiresIn: '7d' });
  res.json({ token, user: { id: user.id, name, email } });
});

app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body;
  const user = users.find(u => u.email === email);
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }
  if (user.status === 'suspended') return res.status(403).json({ error: 'Akun ditangguhkan' });
  const token = jwt.sign({ id: user.id, email: user.email, role: user.role }, JWT_SECRET, { expiresIn: '7d' });
  res.json({ token, user: { id: user.id, name: user.name, email: user.email, role: user.role } });
});

app.post('/api/auth/login-admin', (req, res) => {
  const { email, password } = req.body;
  const user = users.find(u => u.email === email);
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }
  if (user.role !== 'admin') return res.status(403).json({ error: 'Akun ini bukan admin' });
  if (user.status === 'suspended') return res.status(403).json({ error: 'Akun ditangguhkan' });
  const token = jwt.sign({ id: user.id, email: user.email, role: user.role }, JWT_SECRET, { expiresIn: '12h' });
  res.json({ token, user: { id: user.id, name: user.name, email: user.email, role: user.role } });
});

// ------------------------------------------------------------------
// Dashboard (user)
// ------------------------------------------------------------------
app.get('/api/dashboard', requireAuth, (req, res) => {
  const mine = accounts.filter(a => a.user_id === req.user.id).map(a => {
    const rt = fakeRealtime(a.account_number);
    const s = eaSettings[a.id] || {};
    return { ...a, ...s, status: accountStatus[a.id] || 'stopped', online: !!rt, ...(rt || {}) };
  });
  res.json({ accounts: mine });
});

app.get('/api/dashboard/stats/:accountId', requireAuth, (req, res) => {
  const accountId = Number(req.params.accountId);
  const owns = accounts.find(a => a.id === accountId && a.user_id === req.user.id);
  if (!owns) return res.status(404).json({ error: 'Account not found' });

  const rows = tradeHistory.filter(t => t.account_id === accountId);
  const today = new Date().toDateString();
  const summary = {
    today: rows.filter(t => t.closed_at.toDateString() === today).reduce((s, t) => s + t.profit, 0),
    this_week: rows.reduce((s, t) => s + t.profit, 0),
    this_month: rows.reduce((s, t) => s + t.profit, 0),
    win_rate: rows.length ? (rows.filter(t => t.profit > 0).length / rows.length) * 100 : 0,
    total_trades: rows.length,
  };
  const daily = rows.map(t => ({ day: t.closed_at.toISOString().slice(0, 10), profit: t.profit }));
  res.json({ daily, summary });
});

// ------------------------------------------------------------------
// Settings (user)
// ------------------------------------------------------------------
app.post('/api/settings', requireAuth, (req, res) => {
  const { account_id } = req.body;
  const owns = accounts.find(a => a.id === Number(account_id) && a.user_id === req.user.id);
  if (!owns) return res.status(404).json({ error: 'Account not found' });
  eaSettings[account_id] = { ...eaSettings[account_id], ...req.body };
  res.json({ ok: true });
});

// ------------------------------------------------------------------
// Commands (user)
// ------------------------------------------------------------------
app.post('/api/commands', requireAuth, (req, res) => {
  const { account_id, command, payload } = req.body;
  const owns = accounts.find(a => a.id === Number(account_id) && a.user_id === req.user.id);
  if (!owns) return res.status(404).json({ error: 'Account not found' });

  if (['start', 'stop', 'pause'].includes(command)) {
    accountStatus[account_id] = { start: 'running', stop: 'stopped', pause: 'paused' }[command];
  }
  commands.push({ id: nextCommandId++, account_id: Number(account_id), command, payload, status: 'pending', created_at: new Date() });
  res.json({ ok: true });
});

// ------------------------------------------------------------------
// Admin
// ------------------------------------------------------------------
app.get('/api/admin/stats', requireAuth, requireAdmin, (req, res) => {
  res.json({
    total_users: users.filter(u => u.role === 'user').length,
    active_licenses: licenses.filter(l => l.status === 'active').length,
    total_licenses: licenses.length,
    total_accounts: accounts.length,
  });
});

app.get('/api/admin/users', requireAuth, requireAdmin, (req, res) => {
  const list = users.map(u => ({
    ...u,
    password_hash: undefined,
    license_count: licenses.filter(l => l.user_id === u.id).length,
  }));
  res.json({ users: list });
});

app.patch('/api/admin/users/:id', requireAuth, requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  if (id === req.user.id) return res.status(400).json({ error: 'Tidak bisa mengubah status akun sendiri' });
  const user = users.find(u => u.id === id);
  if (!user) return res.status(404).json({ error: 'User tidak ditemukan' });
  user.status = req.body.status;
  res.json({ ok: true });
});

app.get('/api/admin/licenses', requireAuth, requireAdmin, (req, res) => {
  const list = licenses.map(l => {
    const u = users.find(x => x.id === l.user_id);
    return {
      ...l,
      user_name: u?.name,
      user_email: u?.email,
      accounts_used: accounts.filter(a => a.license_id === l.id).length,
    };
  });
  res.json({ licenses: list });
});

app.post('/api/admin/licenses', requireAuth, requireAdmin, (req, res) => {
  const { user_id, max_accounts, expires_at } = req.body;
  if (!users.some(u => u.id === Number(user_id))) return res.status(404).json({ error: 'User tidak ditemukan' });
  const license = {
    id: nextLicenseId++,
    license_key: require('crypto').randomBytes(8).toString('hex').toUpperCase(),
    user_id: Number(user_id),
    status: 'active',
    hwid: null,
    max_accounts: max_accounts || 1,
    expires_at: expires_at ? new Date(expires_at) : null,
    created_at: new Date(),
  };
  licenses.push(license);
  res.json({ ok: true, license: { id: license.id, license_key: license.license_key } });
});

app.patch('/api/admin/licenses/:id', requireAuth, requireAdmin, (req, res) => {
  const license = licenses.find(l => l.id === Number(req.params.id));
  if (!license) return res.status(404).json({ error: 'Not found' });
  const { status, max_accounts, expires_at } = req.body;
  if (status) license.status = status;
  if (max_accounts) license.max_accounts = max_accounts;
  if (expires_at) license.expires_at = new Date(expires_at);
  res.json({ ok: true });
});

app.delete('/api/admin/licenses/:id/hwid', requireAuth, requireAdmin, (req, res) => {
  const license = licenses.find(l => l.id === Number(req.params.id));
  if (license) license.hwid = null;
  res.json({ ok: true });
});

app.get('/api/admin/accounts', requireAuth, requireAdmin, (req, res) => {
  const list = accounts.map(a => {
    const u = users.find(x => x.id === a.user_id);
    const l = licenses.find(x => x.id === a.license_id);
    const rt = fakeRealtime(a.account_number);
    return {
      ...a,
      user_name: u?.name,
      user_email: u?.email,
      license_key: l?.license_key,
      status: accountStatus[a.id] || 'stopped',
      online: !!rt,
      ...(rt || {}),
    };
  });
  res.json({ accounts: list });
});

app.get('/api/admin/versions', requireAuth, requireAdmin, (req, res) => {
  res.json({ versions: eaVersions });
});

app.post('/api/admin/versions', requireAuth, requireAdmin, (req, res) => {
  const { platform, version, download_url, changelog } = req.body;
  if (!['MT4', 'MT5'].includes(platform) || !version) {
    return res.status(400).json({ error: 'platform (MT4/MT5) dan version wajib diisi' });
  }
  eaVersions.unshift({ id: nextVersionId++, platform, version, download_url: download_url || null, changelog: changelog || null, released_at: new Date() });
  res.json({ ok: true });
});

app.get('/', (req, res) => res.json({ ok: true, service: 'EA Cloud Dashboard API (DEMO MODE, in-memory)' }));

app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n🟢 EA Cloud Dashboard DEMO API jalan di port ${PORT} (0.0.0.0)`);
  console.log(`   (Data in-memory saja — hilang saat server di-restart)\n`);
  console.log('   Login User  → user@demo.com  / User123!');
  console.log('   Login Admin → admin@demo.com / Admin123!\n');
});
