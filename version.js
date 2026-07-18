const express = require('express');
const router = express.Router();
const db = require('../config/db');

// GET /api/version?platform=MT4 — EA checks this on startup / hourly
router.get('/', async (req, res) => {
  const platform = req.query.platform === 'MT5' ? 'MT5' : 'MT4';
  const [rows] = await db.query(
    'SELECT version, download_url, changelog FROM ea_versions WHERE platform = ? ORDER BY released_at DESC LIMIT 1',
    [platform]
  );
  if (rows.length === 0) return res.json({ version: null });
  res.json(rows[0]);
});

module.exports = router;
