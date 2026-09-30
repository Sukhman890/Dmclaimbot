const config = require('./config');
const last = new Map();
const busy = new Set();

function tryStart(userId) {
  if (busy.has(userId)) return false;
  if (Date.now() - (last.get(userId) || 0) < config.cooldownSeconds * 1000) return false;
  busy.add(userId);
  last.set(userId, Date.now());
  return true;
}
function finish(userId) {
  busy.delete(userId);
  last.set(userId, Date.now());
}
module.exports = { tryStart, finish };
