// Redis client — this is where ALL high-frequency data lives:
//   - balance, equity, margin, free_margin, floating profit
//   - open position count, spread, ping, server
//   - "online" heartbeat (key auto-expires -> account shows offline)
//
// Every EA "heartbeat" (every 2-5s) does a Redis SET with a TTL.
// Nothing here ever touches MySQL, so thousands of accounts pinging
// every few seconds will NOT overload a shared-hosting database or
// trigger a host's abuse/DDoS throttling.
require('dotenv').config();
const Redis = require('ioredis');

const redis = new Redis({
  host: process.env.REDIS_HOST || '127.0.0.1',
  port: process.env.REDIS_PORT || 6379,
  password: process.env.REDIS_PASSWORD || undefined,
});

const REALTIME_TTL = parseInt(process.env.REALTIME_TTL || '15', 10);

function accountKey(accountNumber) {
  return `account:${accountNumber}:realtime`;
}

async function setRealtime(accountNumber, data) {
  await redis.set(accountKey(accountNumber), JSON.stringify(data), 'EX', REALTIME_TTL);
}

async function getRealtime(accountNumber) {
  const raw = await redis.get(accountKey(accountNumber));
  return raw ? JSON.parse(raw) : null;
}

// Settings cache to avoid hitting MySQL on every single EA poll (EA polls every 2-5s)
function settingsKey(accountNumber) {
  return `account:${accountNumber}:settings`;
}
async function cacheSettings(accountNumber, settings, ttlSeconds = 10) {
  await redis.set(settingsKey(accountNumber), JSON.stringify(settings), 'EX', ttlSeconds);
}
async function getCachedSettings(accountNumber) {
  const raw = await redis.get(settingsKey(accountNumber));
  return raw ? JSON.parse(raw) : null;
}

module.exports = {
  redis,
  setRealtime,
  getRealtime,
  cacheSettings,
  getCachedSettings,
  REALTIME_TTL,
};
