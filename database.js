const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');
const config = require('./config');

fs.mkdirSync(path.dirname(path.resolve(config.databasePath)), { recursive: true });
const db = new Database(config.databasePath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// ---- SQLite initialization ----
db.exec(`
CREATE TABLE IF NOT EXISTS users (
  user_id TEXT PRIMARY KEY,
  guild_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'NEW',
  verified_invites INTEGER NOT NULL DEFAULT 0,
  initial_completed_at TEXT,
  instant_completed_at TEXT,
  final_completed_at TEXT,
  claim_eligible_at TEXT,
  last_check_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS invites (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id TEXT NOT NULL,
  invite_code TEXT,
  inviter_id TEXT,
  invited_user_id TEXT NOT NULL,
  joined_at TEXT NOT NULL,
  left_at TEXT,
  counted INTEGER NOT NULL DEFAULT 1
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_invites_member ON invites(guild_id, invited_user_id);
CREATE INDEX IF NOT EXISTS idx_invites_inviter ON invites(guild_id, inviter_id);
CREATE TABLE IF NOT EXISTS falcon_checks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  invite_count INTEGER NOT NULL,
  message_id TEXT NOT NULL,
  checked_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_falcon_msg ON falcon_checks(message_id);
CREATE INDEX IF NOT EXISTS idx_falcon_user ON falcon_checks(user_id, checked_at);
CREATE TABLE IF NOT EXISTS rewards (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'available',
  reserved_by TEXT,
  claimed_by TEXT,
  reserved_at TEXT,
  claimed_at TEXT
);
CREATE TABLE IF NOT EXISTS claim_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  event TEXT NOT NULL,
  details TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_events_user ON claim_events(user_id, event);
`);

const now = () => new Date().toISOString();
const USER_COLS = new Set([
  'status', 'verified_invites', 'initial_completed_at', 'instant_completed_at',
  'final_completed_at', 'claim_eligible_at', 'last_check_at',
]);

const getUser = (id) => db.prepare('SELECT * FROM users WHERE user_id = ?').get(id);
function createUser(id) {
  const t = now();
  db.prepare(`INSERT OR IGNORE INTO users (user_id, guild_id, status, created_at, updated_at) VALUES (?, ?, 'NEW', ?, ?)`)
    .run(id, config.guildId, t, t);
  return getUser(id);
}
function updateUser(id, fields) {
  const keys = Object.keys(fields).filter((k) => USER_COLS.has(k));
  if (!keys.length) return;
  db.prepare(`UPDATE users SET ${keys.map((k) => `${k} = ?`).join(', ')}, updated_at = ? WHERE user_id = ?`)
    .run(...keys.map((k) => fields[k]), now(), id);
}
const logEvent = (userId, event, details = null) =>
  db.prepare('INSERT INTO claim_events (user_id, event, details, created_at) VALUES (?, ?, ?, ?)').run(userId, event, details, now());
const hasEvent = (userId, event) =>
  !!db.prepare('SELECT 1 FROM claim_events WHERE user_id = ? AND event = ? LIMIT 1').get(userId, event);

// ---- Falcon ----
const saveFalconCheck = ({ userId, inviteCount, messageId, checkedAt }) =>
  db.prepare(`INSERT INTO falcon_checks (user_id, invite_count, message_id, checked_at) VALUES (?, ?, ?, ?)
              ON CONFLICT(message_id) DO UPDATE SET invite_count = excluded.invite_count,
              checked_at = excluded.checked_at, user_id = excluded.user_id`)
    .run(userId, inviteCount, messageId, checkedAt);
const latestFalcon = (userId) =>
  db.prepare('SELECT * FROM falcon_checks WHERE user_id = ? ORDER BY checked_at DESC, id DESC LIMIT 1').get(userId);

// ---- Native Discord invite tracking ----
const getInviteRow = (guildId, invitedId) =>
  db.prepare('SELECT * FROM invites WHERE guild_id = ? AND invited_user_id = ?').get(guildId, invitedId);
const insertInvite = ({ guildId, code, inviterId, invitedId, counted }) =>
  db.prepare(`INSERT OR IGNORE INTO invites (guild_id, invite_code, inviter_id, invited_user_id, joined_at, counted)
              VALUES (?, ?, ?, ?, ?, ?)`).run(guildId, code, inviterId, invitedId, now(), counted ? 1 : 0);
const markLeft = (guildId, invitedId) =>
  db.prepare('UPDATE invites SET left_at = ? WHERE guild_id = ? AND invited_user_id = ? AND left_at IS NULL').run(now(), guildId, invitedId);
const markRejoined = (guildId, invitedId) =>
  db.prepare('UPDATE invites SET left_at = NULL WHERE guild_id = ? AND invited_user_id = ?').run(guildId, invitedId);
// Counted once per invited account, and only while that account is still in the server.
const countValidInvitesBy = (guildId, inviterId) =>
  db.prepare('SELECT COUNT(*) c FROM invites WHERE guild_id = ? AND inviter_id = ? AND counted = 1 AND left_at IS NULL')
    .get(guildId, inviterId).c;

module.exports = {
  db, now, getUser, createUser, updateUser, logEvent, hasEvent,
  saveFalconCheck, latestFalcon, getInviteRow, insertInvite, markLeft, markRejoined, countValidInvitesBy,
};
