const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const db = require('../config/db');
const { getRealtime } = require('../config/redis');
const { requireAuth, requireAdmin } = require('../middleware/auth');

// Semua route di file ini wajib login sebagai admin
router.use(requireAuth, requireAdmin);

// ------------------------------------------------------------------
// GET /api/admin/stats — ringkasan untuk halaman utama admin
// ------------------------------------------------------------------
router.get('/stats', async (req, res) => {
  const [[users]] = await db.query("SELECT COUNT(*) AS c FROM users WHERE role = 'user'");
  const [[licensesActive]] = await db.query("SELECT COUNT(*) AS c FROM licenses WHERE status = 'active'");
  const [[licensesTotal]] = await db.query('SELECT COUNT(*) AS c FROM licenses');
  const [[accountsTotal]] = await db.query('SELECT COUNT(*) AS c FROM accounts');

  res.json({
    total_users: users.c,
    active_licenses: licensesActive.c,
    total_licenses: licensesTotal.c,
    total_accounts: accountsTotal.c,
  });
});

// ------------------------------------------------------------------
// GET /api/admin/users — daftar semua user + jumlah lisensi masing-masing
// ------------------------------------------------------------------
router.get('/users', async (req, res) => {
  const [rows] = await db.query(
    `SELECT u.id, u.name, u.email, u.role, u.status, u.created_at,
            COUNT(l.id) AS license_count
     FROM users u
     LEFT JOIN licenses l ON l.user_id = u.id
     GROUP BY u.id
     ORDER BY u.created_at DESC`
  );
  res.json({ users: rows });
});

// PATCH /api/admin/users/:id — suspend/aktifkan user (tidak bisa suspend diri sendiri)
router.patch('/users/:id', async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;
  if (!['active', 'suspended'].includes(status)) {
    return res.status(400).json({ error: 'Status tidak valid' });
  }
  if (Number(id) === req.user.id) {
    return res.status(400).json({ error: 'Tidak bisa mengubah status akun sendiri' });
  }
  await db.query('UPDATE users SET status = ? WHERE id = ?', [status, id]);
  res.json({ ok: true });
});

// ------------------------------------------------------------------
// GET /api/admin/licenses — semua lisensi + nama/email pemiliknya
// ------------------------------------------------------------------
router.get('/licenses', async (req, res) => {
  const [rows] = await db.query(
    `SELECT l.id, l.license_key, l.status, l.hwid, l.max_accounts, l.expires_at,
            l.created_at, u.id AS user_id, u.name AS user_name, u.email AS user_email,
            COUNT(a.id) AS accounts_used
     FROM licenses l
     JOIN users u ON u.id = l.user_id
     LEFT JOIN accounts a ON a.license_id = l.id
     GROUP BY l.id
     ORDER BY l.created_at DESC`
  );
  res.json({ licenses: rows });
});

// POST /api/admin/licenses — buat lisensi baru untuk seorang user
router.post('/licenses', async (req, res) => {
  const { user_id, max_accounts, expires_at } = req.body;
  if (!user_id) return res.status(400).json({ error: 'user_id wajib diisi' });

  const [userRows] = await db.query('SELECT id FROM users WHERE id = ? LIMIT 1', [user_id]);
  if (userRows.length === 0) return res.status(404).json({ error: 'User tidak ditemukan' });

  const licenseKey = crypto.randomBytes(8).toString('hex').toUpperCase(); // e.g. 9F3A7B21C4E0D6F8

  const [result] = await db.query(
    `INSERT INTO licenses (license_key, user_id, max_accounts, expires_at)
     VALUES (?, ?, ?, ?)`,
    [licenseKey, user_id, max_accounts || 1, expires_at || null]
  );

  res.json({ ok: true, license: { id: result.insertId, license_key: licenseKey } });
});

// PATCH /api/admin/licenses/:id — ubah status/kuota/expiry lisensi
router.patch('/licenses/:id', async (req, res) => {
  const { id } = req.params;
  const { status, max_accounts, expires_at } = req.body;

  if (status && !['active', 'suspended', 'expired'].includes(status)) {
    return res.status(400).json({ error: 'Status tidak valid' });
  }

  await db.query(
    `UPDATE licenses SET
       status = COALESCE(?, status),
       max_accounts = COALESCE(?, max_accounts),
       expires_at = COALESCE(?, expires_at)
     WHERE id = ?`,
    [status || null, max_accounts || null, expires_at || null, id]
  );
  res.json({ ok: true });
});

// DELETE /api/admin/licenses/:id/hwid — lepas ikatan hwid (mis. user ganti PC/VPS)
router.delete('/licenses/:id/hwid', async (req, res) => {
  await db.query('UPDATE licenses SET hwid = NULL WHERE id = ?', [req.params.id]);
  res.json({ ok: true });
});

// ------------------------------------------------------------------
// GET /api/admin/accounts — semua akun EA (semua user) + status online
// ------------------------------------------------------------------
router.get('/accounts', async (req, res) => {
  const [rows] = await db.query(
    `SELECT a.id, a.account_number, a.platform, a.broker, a.nickname, a.created_at,
            u.name AS user_name, u.email AS user_email,
            l.license_key, st.status
     FROM accounts a
     JOIN users u ON u.id = a.user_id
     JOIN licenses l ON l.id = a.license_id
     LEFT JOIN account_status st ON st.account_id = a.id
     ORDER BY a.created_at DESC`
  );

  const merged = await Promise.all(rows.map(async (acc) => {
    const rt = await getRealtime(acc.account_number);
    return { ...acc, online: !!rt, ...(rt || {}) };
  }));

  res.json({ accounts: merged });
});

// ------------------------------------------------------------------
// Versi EA (MT4/MT5) — dipakai EA untuk cek update
// ------------------------------------------------------------------
router.get('/versions', async (req, res) => {
  const [rows] = await db.query('SELECT * FROM ea_versions ORDER BY released_at DESC');
  res.json({ versions: rows });
});

router.post('/versions', async (req, res) => {
  const { platform, version, download_url, changelog } = req.body;
  if (!['MT4', 'MT5'].includes(platform) || !version) {
    return res.status(400).json({ error: 'platform (MT4/MT5) dan version wajib diisi' });
  }
  await db.query(
    'INSERT INTO ea_versions (platform, version, download_url, changelog) VALUES (?, ?, ?, ?)',
    [platform, version, download_url || null, changelog || null]
  );
  res.json({ ok: true });
});

module.exports = router;
