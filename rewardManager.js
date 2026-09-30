const { db, now } = require('./database');
const log = require('./logger');

const reserveTx = db.transaction((userId) => {
  const mine = db.prepare(`SELECT * FROM rewards WHERE status='reserved' AND reserved_by=? LIMIT 1`).get(userId);
  if (mine) return mine;
  const r = db.prepare(`SELECT * FROM rewards WHERE status='available' ORDER BY id LIMIT 1`).get();
  if (!r) return null;
  db.prepare(`UPDATE rewards SET status='reserved', reserved_by=?, reserved_at=? WHERE id=? AND status='available'`)
    .run(userId, now(), r.id);
  return { ...r, status: 'reserved', reserved_by: userId };
});

// Atomic (IMMEDIATE) so two users can never get the same code.
const reserve = (userId) => {
  const r = reserveTx.immediate(userId);
  if (r) log.info('REWARD', `Reward reserved for ${userId}`);
  return r;
};
const confirm = (id, userId) => {
  db.prepare(`UPDATE rewards SET status='claimed', claimed_by=?, claimed_at=? WHERE id=?`).run(userId, now(), id);
  log.info('REWARD', `Reward claimed by ${userId}`);
};
const release = (id) =>
  db.prepare(`UPDATE rewards SET status='available', reserved_by=NULL, reserved_at=NULL WHERE id=? AND status='reserved'`).run(id);

// Seeds inventory from the REWARD_CODES variable. Codes already in the DB (available, reserved OR claimed)
// are skipped, so a redeploy never re-adds a claimed code.
function seedFromEnv(codes) {
  const ins = db.prepare('INSERT OR IGNORE INTO rewards (code) VALUES (?)');
  let added = 0;
  db.transaction(() => { for (const c of new Set(codes)) added += ins.run(c).changes; })();
  log.info('REWARD', `Seeded ${added} new code(s) from REWARD_CODES (${codes.length} in variable)`);
  return added;
}
const add = (code) => db.prepare('INSERT INTO rewards (code) VALUES (?)').run(code.trim()).lastInsertRowid;
const remove = (id) => db.prepare(`DELETE FROM rewards WHERE id=? AND status!='claimed'`).run(id).changes > 0;
const stock = () => {
  const rows = db.prepare('SELECT status, COUNT(*) c FROM rewards GROUP BY status').all();
  const o = { available: 0, reserved: 0, claimed: 0 };
  for (const r of rows) o[r.status] = r.c;
  return o;
};
const listUnclaimed = () => db.prepare(`SELECT id, status, code FROM rewards WHERE status!='claimed' ORDER BY id LIMIT 25`).all();
const forUser = (userId) =>
  db.prepare(`SELECT id, status FROM rewards WHERE claimed_by=? OR reserved_by=? ORDER BY id DESC LIMIT 1`).get(userId, userId);
const hasClaimed = (userId) =>
  !!db.prepare(`SELECT 1 FROM rewards WHERE claimed_by=? AND status='claimed'`).get(userId);
const releaseAllFor = (userId) =>
  db.prepare(`UPDATE rewards SET status='available', reserved_by=NULL, reserved_at=NULL WHERE reserved_by=? AND status='reserved'`).run(userId);

module.exports = { seedFromEnv, reserve, confirm, release, add, remove, stock, listUnclaimed, forUser, hasClaimed, releaseAllFor };
