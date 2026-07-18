const express = require('express');
const router = express.Router();
const db = require('../config/db');
const { getRealtime } = require('../config/redis');
const { requireAuth } = require('../middleware/auth');

// GET /api/dashboard — every account belonging to the user, merged with
// live Redis data. This is what the dashboard polls every few seconds;
// it's cheap because the MySQL part barely changes and Redis reads are fast.
router.get('/', requireAuth, async (req, res) => {
  const [accounts] = await db.query(
    `SELECT a.id, a.account_number, a.broker, a.platform, a.nickname,
            s.lots, s.grid_step, s.take_profit, s.stop_loss, s.magic_number,
            s.max_positions, s.averaging_enabled, s.grid_enabled,
            s.hedging_enabled, s.news_filter_enabled,
            st.status
     FROM accounts a
     LEFT JOIN ea_settings s ON s.account_id = a.id
     LEFT JOIN account_status st ON st.account_id = a.id
     WHERE a.user_id = ?
     ORDER BY a.created_at DESC`,
    [req.user.id]
  );

  const merged = await Promise.all(accounts.map(async (acc) => {
    const rt = await getRealtime(acc.account_number);
    return { ...acc, online: !!rt, ...(rt || {}) };
  }));

  res.json({ accounts: merged });
});

// GET /api/dashboard/stats/:accountId — trade history aggregates for charts
router.get('/stats/:accountId', requireAuth, async (req, res) => {
  const { accountId } = req.params;
  const [owns] = await db.query('SELECT id FROM accounts WHERE id = ? AND user_id = ? LIMIT 1', [accountId, req.user.id]);
  if (owns.length === 0) return res.status(404).json({ error: 'Account not found' });

  const [daily] = await db.query(
    `SELECT DATE(closed_at) AS day, SUM(profit) AS profit
     FROM trade_history WHERE account_id = ?
     GROUP BY DATE(closed_at) ORDER BY day DESC LIMIT 30`,
    [accountId]
  );

  const [summary] = await db.query(
    `SELECT
        SUM(CASE WHEN DATE(closed_at) = CURDATE() THEN profit ELSE 0 END) AS today,
        SUM(CASE WHEN YEARWEEK(closed_at, 1) = YEARWEEK(CURDATE(), 1) THEN profit ELSE 0 END) AS this_week,
        SUM(CASE WHEN MONTH(closed_at) = MONTH(CURDATE()) AND YEAR(closed_at) = YEAR(CURDATE()) THEN profit ELSE 0 END) AS this_month,
        SUM(CASE WHEN profit > 0 THEN 1 ELSE 0 END) / NULLIF(COUNT(*), 0) * 100 AS win_rate,
        COUNT(*) AS total_trades
     FROM trade_history WHERE account_id = ?`,
    [accountId]
  );

  res.json({ daily: daily.reverse(), summary: summary[0] });
});

module.exports = router;
