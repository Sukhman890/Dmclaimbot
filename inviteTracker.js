const { Events, PermissionFlagsBits } = require('discord.js');
const config = require('./config');
const db = require('./database');
const log = require('./logger');
const { parseFalconMessage } = require('./falconParser');

let falconOk = false;
let nativeOk = false;
let cache = new Map(); // invite code -> { uses, maxUses, inviterId }
let queue = Promise.resolve(); // serialises joins so concurrent joins can't be mixed up

const useFalcon = () => config.inviteSource !== 'discord';
const useNative = () => config.inviteSource !== 'falcon';

// ---------------- Falcon ----------------
function isTrustedFalcon(msg) {
  if (msg.channelId !== config.falconChannelId) return false;
  if (config.falconBotId) return msg.author?.id === config.falconBotId;
  return !!msg.author?.bot;
}
function handleFalconMessage(msg) {
  if (!isTrustedFalcon(msg)) return;
  let p;
  try { p = parseFalconMessage(msg); } catch (e) { log.error('FALCON', `Parser failure on ${msg.id}`, e); return; }
  if (!p) return;
  db.saveFalconCheck({ userId: p.userId, inviteCount: p.inviteCount, messageId: p.messageId, checkedAt: p.timestamp });
  log.info('FALCON', 'Invite update:', { USER_ID: p.userId, COUNT: p.inviteCount, MESSAGE_ID: p.messageId });
}
async function startFalcon(client) {
  try {
    const ch = await client.channels.fetch(config.falconChannelId);
    if (!ch?.isTextBased() || !ch.guild) throw new Error('not a guild text channel');
    const perms = ch.permissionsFor(ch.guild.members.me);
    if (!perms?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory])) {
      throw new Error('missing View Channel / Read Message History');
    }
    falconOk = true;
    if (!config.falconBotId) log.info('WARN', 'FALCON_BOT_ID not set: trusting any bot posting in the Falcon channel');
    log.info('STARTUP', 'Falcon channel verified');
    let before, seen = 0;
    while (seen < config.backfillLimit) {
      const batch = await ch.messages.fetch({ limit: 100, ...(before && { before }) });
      if (!batch.size) break;
      batch.forEach(handleFalconMessage);
      seen += batch.size;
      before = batch.last().id;
    }
    log.info('FALCON', `Backfilled ${seen} messages`);
  } catch (e) {
    log.error('ERROR', 'Falcon channel is inaccessible.', e);
  }
  client.on(Events.MessageCreate, handleFalconMessage);
  client.on(Events.MessageUpdate, async (_o, msg) => {
    try { handleFalconMessage(msg.partial ? await msg.fetch() : msg); } catch (e) { log.error('FALCON', 'update failed', e); }
  });
}

// ---------------- Native Discord invites ----------------
async function snapshot(guild) {
  const invites = await guild.invites.fetch();
  const m = new Map();
  invites.forEach((i) => m.set(i.code, { uses: i.uses ?? 0, maxUses: i.maxUses ?? 0, inviterId: i.inviterId ?? i.inviter?.id ?? null }));
  return m;
}

async function onJoin(member) {
  if (member.guild.id !== config.guildId || member.user.bot) return;
  const guildId = member.guild.id;
  const prior = db.getInviteRow(guildId, member.id);
  let after;
  try { after = await snapshot(member.guild); } catch (e) { log.error('INVITE', 'Could not fetch invites on join', e); return; }

  const used = [];
  for (const [code, v] of after) {
    if (v.uses > (cache.get(code)?.uses ?? 0)) used.push({ code, inviterId: v.inviterId });
  }
  if (!used.length) {
    // A max-uses invite that was just exhausted is deleted by Discord; detect it as "vanished with one use left".
    for (const [code, v] of cache) {
      if (!after.has(code) && v.maxUses > 0 && v.uses === v.maxUses - 1) used.push({ code, inviterId: v.inviterId });
    }
  }
  cache = after;

  if (prior) { // rejoin: never counted again
    if (prior.left_at) db.markRejoined(guildId, member.id);
    log.info('INVITE', `Rejoin ignored: ${member.id}`);
    return;
  }
  if (used.length === 1 && used[0].inviterId && used[0].inviterId !== member.id) {
    db.insertInvite({ guildId, code: used[0].code, inviterId: used[0].inviterId, invitedId: member.id, counted: true });
    log.info('INVITE', `Join counted: invited=${member.id} inviter=${used[0].inviterId} code=${used[0].code}`);
  } else {
    // Unattributable (vanity URL, several candidates, self): record but never count.
    db.insertInvite({ guildId, code: null, inviterId: null, invitedId: member.id, counted: false });
    log.info('INVITE', `Join not attributable (${used.length} candidates): ${member.id}`);
  }
}

async function startNative(client) {
  try {
    const guild = await client.guilds.fetch(config.guildId);
    cache = await snapshot(guild);
    nativeOk = true;
    log.info('STARTUP', `Discord invite cache loaded (${cache.size} invites)`);
  } catch (e) {
    nativeOk = false;
    log.error('ERROR', 'Native invite tracking unavailable (needs Manage Server permission)', e);
    return;
  }
  client.on(Events.InviteCreate, (i) => {
    if (i.guild?.id === config.guildId) cache.set(i.code, { uses: i.uses ?? 0, maxUses: i.maxUses ?? 0, inviterId: i.inviter?.id ?? null });
  });
  client.on(Events.GuildMemberAdd, (m) => {
    queue = queue.then(() => onJoin(m)).catch((e) => log.error('INVITE', 'join handling failed', e));
  });
  client.on(Events.GuildMemberRemove, (m) => {
    try { if (m.guild.id === config.guildId) db.markLeft(m.guild.id, m.id); } catch (e) { log.error('INVITE', 'leave handling failed', e); }
  });
}

async function start(client) {
  if (useFalcon()) await startFalcon(client);
  if (useNative()) await startNative(client);
}

// ---------------- Verified counts ----------------
function breakdown(userId) {
  const f = db.latestFalcon(userId);
  return {
    falcon: f ? f.invite_count : null,
    discord: nativeOk ? db.countValidInvitesBy(config.guildId, userId) : null,
  };
}

// Returns { count, source } or null when there is NO verified data (null is NOT zero).
function getVerified(userId) {
  const c = [];
  if (useFalcon()) {
    const f = db.latestFalcon(userId);
    if (f) c.push({ source: 'falcon', count: f.invite_count, messageId: f.message_id });
  }
  if (useNative() && nativeOk) {
    const n = db.countValidInvitesBy(config.guildId, userId);
    // In "both" mode a native 0 is not evidence (it only sees joins since install), so it isn't a verified zero.
    if (n > 0 || config.inviteSource === 'discord') c.push({ source: 'discord', count: n });
  }
  if (!c.length) return null;
  return c.sort((a, b) => b.count - a.count)[0];
}

const isAvailable = () => (config.inviteSource === 'falcon' ? falconOk : config.inviteSource === 'discord' ? nativeOk : falconOk || nativeOk);

module.exports = { start, isAvailable, getVerified, breakdown };
