const jwt = require('jsonwebtoken');

// Protects dashboard (user-facing) endpoints. EA endpoints use license
// keys instead (see routes/license.js), not JWT.
function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Missing token' });

  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

// Jalan SETELAH requireAuth. Menolak siapa pun yang token-nya bukan role admin,
// termasuk kalau ada yang mencoba oplos token lama sebelum role-nya diturunkan.
function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access only' });
  }
  next();
}

module.exports = { requireAuth, requireAdmin };
