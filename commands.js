const express = require('express');
const router = express.Router();
const db = require('../config/db');
const { verifyLicenseAndAccount } = require('./license');
const { requireAuth } = require('../middleware/auth');

const ALLOWED_COMMANDS = new Set([
  'start', 'stop', 'pause', 'emergency_stop',
  'close_all', 'close_buy', 'close_sell',
  'disable_averaging', 'disable_grid', 'disable_hedging', 'enable_news_filter',
]);

// ------------------------------------------------------------------
// GET /api/commands?license=..&account=..&platform=.. — EA polls for
// one pending command at a time. Low frequency by nature (only exists
// when a user actually clicks a button), so plain MySQL is fine here.
// ------------------------------------------------------------------
router.get('/', async (req, res) => {
  const { license, account, platform, hwid } = req.query;
  if (!license || !account) return res.status(400).json({ ok: false, reason: 'missing_fields' });

  const auth = await verifyLicenseAndAccount({ license, account, hwid, platform });
  if (!auth.ok) return res.status(403).json(auth);

  const [rows] = await db.query(
    `SELECT id, command, payload FROM commands
     WHERE account_id = ? AND status = 'pending'
     ORDER BY created_at ASC LIMIT 1`,
    [auth.account_id]
  );

  if (rows.length === 0) return res.json({ ok: true, command: null });
  res.json({ ok: true, command: rows[0].command, payload: rows[0].payload, command_id: rows[0].id });
});

// ------------------------------------------------------------------
// POST /api/commands/ack — EA confirms it executed the command
// ------------------------------------------------------------------
router.post('/ack', async (req, res) => {
  const { license, account, platform, hwid, command_id, status } = req.body;
  const auth = await verifyLicenseAndAccount({ license, account, hwid, platform });
  if (!auth.ok) return res.status(403).json(auth);

  await db.query(
    `UPDATE commands SET status = ?, acked_at = NOW() WHERE id = ? AND account_id = ?`,
    [status === 'failed' ? 'failed' : 'done', command_id, auth.account_id]
  );
  res.json({ ok: true });
});

// ------------------------------------------------------------------
// POST /api/commands — dashboard queues a new command (JWT-protected)
// ------------------------------------------------------------------
router.post('/', requireAuth, async (req, res) => {
  const { account_id, command, payload } = req.body;
  if (!ALLOWED_COMMANDS.has(command)) return res.status(400).json({ error: 'Unknown command' });

  const [owns] = await db.query(
    'SELECT id FROM accounts WHERE id = ? AND user_id = ? LIMIT 1',
    [account_id, req.user.id]
  );
  if (owns.length === 0) return res.status(404).json({ error: 'Account not found' });

  // start/stop/pause also update account_status directly so /api/settings
  // (which the EA polls far more often) reflects it immediately
  if (['start', 'stop', 'pause'].includes(command)) {
    const map = { start: 'running', stop: 'stopped', pause: 'paused' };
    await db.query(
      `INSERT INTO account_status (account_id, status) VALUES (?, ?)
       ON DUPLICATE KEY UPDATE status = VALUES(status)`,
      [account_id, map[command]]
    );
  }

  await db.query(
    'INSERT INTO commands (account_id, command, payload) VALUES (?, ?, ?)',
    [account_id, command, payload ? JSON.stringify(payload) : null]
  );

  res.json({ ok: true });
});

module.exports = router;
