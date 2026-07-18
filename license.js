const express = require('express');
const router = express.Router();
const db = require('../config/db');

// Called by the EA on startup (and periodically) to confirm it's allowed to run.
// Checks: license exists / active / not expired / hwid matches / account belongs to license.
router.post('/verify', async (req, res) => {
  const { license, account, hwid, platform } = req.body;
  if (!license || !account) {
    return res.status(400).json({ ok: false, reason: 'missing_fields' });
  }

  try {
    const result = await verifyLicenseAndAccount({ license, account, hwid, platform });
    if (!result.ok) return res.status(403).json(result);
    return res.json(result);
  } catch (err) {
    console.error('license/verify error', err);
    return res.status(500).json({ ok: false, reason: 'server_error' });
  }
});

// Shared helper: every EA-facing route (account update, settings, commands)
// should call this first so a revoked/expired license immediately cuts the EA off.
async function verifyLicenseAndAccount({ license, account, hwid, platform }) {
  const [rows] = await db.query(
    `SELECT l.id AS license_id, l.status, l.hwid AS bound_hwid, l.expires_at,
            l.max_accounts, l.user_id
     FROM licenses l WHERE l.license_key = ? LIMIT 1`,
    [license]
  );

  if (rows.length === 0) return { ok: false, reason: 'license_not_found' };
  const lic = rows[0];

  if (lic.status !== 'active') return { ok: false, reason: `license_${lic.status}` };
  if (lic.expires_at && new Date(lic.expires_at) < new Date()) {
    return { ok: false, reason: 'license_expired' };
  }
  if (lic.bound_hwid && hwid && lic.bound_hwid !== hwid) {
    return { ok: false, reason: 'hwid_mismatch' };
  }

  // Auto-bind hwid on first use if not yet bound
  if (!lic.bound_hwid && hwid) {
    await db.query('UPDATE licenses SET hwid = ? WHERE id = ?', [hwid, lic.license_id]);
  }

  // Find or auto-register the account under this license
  const [accRows] = await db.query(
    'SELECT id FROM accounts WHERE account_number = ? AND platform = ? LIMIT 1',
    [account, platform || 'MT4']
  );

  let accountId;
  if (accRows.length === 0) {
    const [countRows] = await db.query(
      'SELECT COUNT(*) AS c FROM accounts WHERE license_id = ?',
      [lic.license_id]
    );
    if (countRows[0].c >= lic.max_accounts) {
      return { ok: false, reason: 'account_limit_reached' };
    }
    const [insert] = await db.query(
      `INSERT INTO accounts (user_id, license_id, account_number, platform)
       VALUES (?, ?, ?, ?)`,
      [lic.user_id, lic.license_id, account, platform || 'MT4']
    );
    accountId = insert.insertId;
    await db.query('INSERT INTO ea_settings (account_id) VALUES (?)', [accountId]);
    await db.query('INSERT INTO account_status (account_id, status) VALUES (?, "stopped")', [accountId]);
  } else {
    accountId = accRows[0].id;
  }

  return { ok: true, account_id: accountId, user_id: lic.user_id };
}

module.exports = { router, verifyLicenseAndAccount };
