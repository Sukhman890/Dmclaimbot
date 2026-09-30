require('dotenv').config();

const num = (k, d) => {
  const v = process.env[k];
  if (v === undefined || v === '') return d;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) { console.error(`[ERROR] Env ${k} must be a non-negative number`); process.exit(1); }
  return n;
};
const snowflake = /^\d{17,20}$/;
const inviteSource = (process.env.INVITE_SOURCE || 'both').toLowerCase();
const errors = [];
if (!['falcon', 'discord', 'both'].includes(inviteSource)) errors.push('INVITE_SOURCE must be falcon, discord or both');
for (const k of ['DISCORD_TOKEN', 'GUILD_ID']) if (!process.env[k]) errors.push(`${k} is required`);
if (process.env.GUILD_ID && !snowflake.test(process.env.GUILD_ID)) errors.push('GUILD_ID is not a valid Discord ID');
if (inviteSource !== 'discord' && !snowflake.test(process.env.FALCON_CHANNEL_ID || '')) errors.push('FALCON_CHANNEL_ID must be a valid Discord ID (or set INVITE_SOURCE=discord)');
for (const k of ['FALCON_BOT_ID', 'ADMIN_ROLE_ID']) if (process.env[k] && !snowflake.test(process.env[k])) errors.push(`${k} is not a valid Discord ID`);
if (errors.length) { errors.forEach((e) => console.error(`[ERROR] ${e}`)); process.exit(1); }

module.exports = {
  token: process.env.DISCORD_TOKEN,
  guildId: process.env.GUILD_ID,
  falconChannelId: process.env.FALCON_CHANNEL_ID || null,
  falconBotId: process.env.FALCON_BOT_ID || null,
  adminRoleId: process.env.ADMIN_ROLE_ID || null,
  inviteSource,
  requiredInvites: num('REQUIRED_INVITES', 3),
  instantInvites: num('INSTANT_INVITES', 8),
  finalInvites: num('FINAL_INVITES', 11),
  waitDays: num('WAIT_DAYS', 14),
  cooldownSeconds: num('CHECK_COOLDOWN_SECONDS', 10),
  databasePath: process.env.DATABASE_PATH || './data/database.sqlite',
  rewardCodes: (process.env.REWARD_CODES || '').split(/[\s,;]+/).filter(Boolean),
  backfillLimit: num('FALCON_BACKFILL_LIMIT', 500),
};
