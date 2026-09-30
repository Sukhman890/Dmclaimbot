const db = require('./database');
const log = require('./logger');
const M = require('./messages');
const cooldown = require('./cooldown');
const claims = require('./claimManager');

const IDENTITY_RE = /\b(are|r)\s+(you|u)\s+(a\s+|an\s+)?(human|bot|real|person|robot|ai)\b|\bhuman\s*\?/i;

async function onMessage(message) {
  if (message.author.bot || message.guild) return; // DMs only
  const userId = message.author.id;
  const send = (t) => message.channel.send(t);
  try {
    let user = db.getUser(userId);
    if (!user) {
      user = db.createUser(userId);
      db.logEvent(userId, 'first_dm');
      log.info('DM', `New claim: ${userId}`);
      await send(M.FIRST_DM);
      db.updateUser(userId, { status: claims.STATUS.W3 });
      return;
    }
    if (IDENTITY_RE.test(message.content)) return void (await send(M.BOT_IDENTITY));
    if (!cooldown.tryStart(userId)) return void (await send(M.COOLDOWN));
    try {
      await claims.handleCheck(userId, message.content, send);
    } finally {
      cooldown.finish(userId);
    }
  } catch (e) {
    log.error('ERROR', `DM handling failed for ${userId}`, e);
    send(M.GENERIC_ERROR).catch(() => {}); // e.g. user has DMs closed; never crash
  }
}

module.exports = { onMessage };
