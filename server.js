require('dotenv').config();
const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');

const app = express();
app.use(cors());
app.use(express.json());

// Generous limit for EA heartbeat traffic (many accounts polling every few seconds),
// stricter default for everything else.
const eaLimiter = rateLimit({ windowMs: 60 * 1000, max: 60, standardHeaders: true });
const apiLimiter = rateLimit({ windowMs: 60 * 1000, max: 120, standardHeaders: true });

app.use('/api/account', eaLimiter, require('./routes/account'));
app.use('/api/settings', eaLimiter, require('./routes/settings'));
app.use('/api/commands', eaLimiter, require('./routes/commands'));
app.use('/api/version', apiLimiter, require('./routes/version'));
app.use('/api/license', apiLimiter, require('./routes/license').router);
app.use('/api/auth', apiLimiter, require('./routes/auth'));
app.use('/api/dashboard', apiLimiter, require('./routes/dashboard'));
app.use('/api/admin', apiLimiter, require('./routes/admin'));

app.get('/', (req, res) => res.json({ ok: true, service: 'EA Cloud Dashboard API' }));

process.on('uncaughtException', (err) => {
  console.error('UNCAUGHT EXCEPTION:', err);
});
process.on('unhandledRejection', (err) => {
  console.error('UNHANDLED REJECTION:', err);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => console.log(`EA Cloud Dashboard API running on port ${PORT}`));
