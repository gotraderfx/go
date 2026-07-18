const express = require('express');
const router = express.Router();
const db = require('../config/db');
const { cacheSettings, getCachedSettings } = require('../config/redis');
const { verifyLicenseAndAccount } = require('./license');
const { requireAuth } = require('../middleware/auth');

// ------------------------------------------------------------------
// GET /api/settings?license=..&account=..&platform=.. — EA polling.
// Serves from Redis cache first (10s TTL) so frequent EA polling
// doesn't hammer MySQL; only refills from MySQL on a cache miss.
// ------------------------------------------------------------------
router.get('/', async (req, res) => {
  const { license, account, platform, hwid } = req.query;
  if (!license || !account) return res.status(400).json({ ok: false, reason: 'missing_fields' });

  const auth = await verifyLicenseAndAccount({ license, account, hwid, platform });
  if (!auth.ok) return res.status(403).json(auth);

  let settings = await getCachedSettings(account);
  if (!settings) {
    const [rows] = await db.query('SELECT * FROM ea_settings WHERE account_id = ? LIMIT 1', [auth.account_id]);
    const [statusRows] = await db.query('SELECT status FROM account_status WHERE account_id = ? LIMIT 1', [auth.account_id]);
    settings = { ...(rows[0] || {}), status: statusRows[0] ? statusRows[0].status : 'stopped' };
    await cacheSettings(account, settings);
  }

  res.json({ ok: true, settings });
});

// ------------------------------------------------------------------
// POST /api/settings — dashboard user updates parameters for an account
// (JWT-protected). Writes MySQL (low frequency: only on user edits)
// and invalidates the Redis cache so the EA picks it up on next poll.
// ------------------------------------------------------------------
router.post('/', requireAuth, async (req, res) => {
  const {
    account_id, lots, grid_step, take_profit, stop_loss, magic_number,
    max_positions, averaging_enabled, grid_enabled, hedging_enabled, news_filter_enabled,
  } = req.body;

  const [owns] = await db.query(
    'SELECT account_number FROM accounts WHERE id = ? AND user_id = ? LIMIT 1',
    [account_id, req.user.id]
  );
  if (owns.length === 0) return res.status(404).json({ error: 'Account not found' });

  await db.query(
    `UPDATE ea_settings SET
       lots = COALESCE(?, lots),
       grid_step = COALESCE(?, grid_step),
       take_profit = COALESCE(?, take_profit),
       stop_loss = ?,
       magic_number = COALESCE(?, magic_number),
       max_positions = COALESCE(?, max_positions),
       averaging_enabled = COALESCE(?, averaging_enabled),
       grid_enabled = COALESCE(?, grid_enabled),
       hedging_enabled = COALESCE(?, hedging_enabled),
       news_filter_enabled = COALESCE(?, news_filter_enabled)
     WHERE account_id = ?`,
    [lots, grid_step, take_profit, stop_loss ?? null, magic_number, max_positions,
     averaging_enabled, grid_enabled, hedging_enabled, news_filter_enabled, account_id]
  );

  // Cache invalidation: force the EA's next poll to re-read fresh values from MySQL
  await cacheSettings(owns[0].account_number, null, 1);

  res.json({ ok: true });
});

module.exports = router;
