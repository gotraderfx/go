const express = require('express');
const router = express.Router();
const db = require('../config/db');
const { setRealtime, getRealtime } = require('../config/redis');
const { verifyLicenseAndAccount } = require('./license');
const { requireAuth } = require('../middleware/auth');

// ------------------------------------------------------------------
// POST /api/account/update  — called by the EA every 2-5 seconds.
// Realtime numbers go to Redis ONLY. Nothing here writes to MySQL,
// so this endpoint can be hit thousands of times a minute without
// putting load on the database or tripping host abuse limits.
// ------------------------------------------------------------------
router.post('/update', async (req, res) => {
  const {
    license, account, platform, hwid,
    balance, equity, profit, margin, free_margin,
    positions, spread, ping, server, version,
  } = req.body;

  if (!license || !account) return res.status(400).json({ ok: false, reason: 'missing_fields' });

  const auth = await verifyLicenseAndAccount({ license, account, hwid, platform });
  if (!auth.ok) return res.status(403).json(auth);

  await setRealtime(account, {
    account, platform, balance, equity, profit, margin, free_margin,
    positions, spread, ping, server, version,
    online: true,
    updated_at: Date.now(),
  });

  return res.json({ ok: true });
});

// ------------------------------------------------------------------
// GET /api/account/:accountNumber — dashboard reads realtime + status
// (JWT-protected; used by the frontend polling loop)
// ------------------------------------------------------------------
router.get('/:accountNumber', requireAuth, async (req, res) => {
  const { accountNumber } = req.params;

  const [rows] = await db.query(
    `SELECT a.id, a.account_number, a.broker, a.platform, a.nickname,
            s.status
     FROM accounts a
     LEFT JOIN account_status s ON s.account_id = a.id
     WHERE a.account_number = ? AND a.user_id = ? LIMIT 1`,
    [accountNumber, req.user.id]
  );
  if (rows.length === 0) return res.status(404).json({ error: 'Account not found' });

  const realtime = await getRealtime(accountNumber);

  res.json({
    ...rows[0],
    online: !!realtime,
    ...(realtime || {}),
  });
});

module.exports = router;
