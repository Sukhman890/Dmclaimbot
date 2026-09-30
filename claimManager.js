const config = require('./config');
const db = require('./database');
const log = require('./logger');
const M = require('./messages');
const rewards = require('./rewardManager');
const tracker = require('./inviteTracker');

const STATUS = {
  NEW: 'NEW', W3: 'WAITING_FOR_3', T3: 'THREE_COMPLETED', W8: 'WAITING_FOR_8',
  E8: 'EIGHT_COMPLETED', WF3: 'WAITING_FOR_FINAL_3', FINAL: 'FINAL_ELIGIBLE', CLAIMED: 'CLAIMED',
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const DAY = 86400000;

function isTwoWeekClaimEligible(user, nowMs = Date.now()) {
  if (!user?.initial_completed_at) return false;
  return nowMs >= Date.parse(user.initial_completed_at) + config.waitDays * DAY;
}

function hasClaimed(userId) {
  const u = db.getUser(userId);
  return u?.status === STATUS.CLAIMED || rewards.hasClaimed(userId) || db.hasEvent(userId, 'reward_claimed');
}

// Marks the user eligible and delivers a reward from the admin-supplied inventory only.
async function finalize(userId, send, { twoWeek = false } = {}) {
  if (hasClaimed(userId)) return send(M.ALREADY_CLAIMED);
  const u = db.getUser(userId);
  if (u.status !== STATUS.FINAL) {
    const t = db.now();
    db.updateUser(userId, { status: STATUS.FINAL, claim_eligible_at: t, ...(twoWeek ? {} : { final_completed_at: t }) });
    db.logEvent(userId, twoWeek ? 'eligible_two_week' : 'eligible_final_invites');
    if (twoWeek) await send(M.TWO_WEEK_DONE);
  }
  const reward = rewards.reserve(userId);
  if (!reward) {
    log.info('REWARD', `Out of stock for ${userId}`);
    return send(M.OUT_OF_STOCK);
  }
  try {
    await send(M.reward(reward.code));
  } catch (e) {
    rewards.release(reward.id); // DM failed: return the code to stock
    log.error('ERROR', `Reward DM failed for ${userId} (${log.maskCode(reward.code)})`, e);
    throw e;
  }
  rewards.confirm(reward.id, userId);
  db.updateUser(userId, { status: STATUS.CLAIMED });
  db.logEvent(userId, 'reward_claimed', `reward_id=${reward.id}`);
}

// State only ever moves forward; the verified count decides how far, timestamps decide the 14-day path.
async function handleCheck(userId, text, send) {
  if (hasClaimed(userId)) return send(M.ALREADY_CLAIMED);
  let user = db.getUser(userId);

  if (user.status !== STATUS.FINAL && isTwoWeekClaimEligible(user)) return finalize(userId, send, { twoWeek: true });
  if (user.status === STATUS.FINAL) return finalize(userId, send);

  if (!tracker.isAvailable()) return send(M.FALCON_UNAVAILABLE);
  const ver = tracker.getVerified(userId);
  if (!ver) {
    await send(M.checking());
    log.error('ERROR', `Invite verification failed: no data for ${userId}`);
    return send(M.FALCON_NO_DATA);
  }
  const count = ver.count;
  log.info('INVITE', `${userId} verified count: ${count} (${ver.source})`);
  db.updateUser(userId, { verified_invites: count, last_check_at: db.now() });

  const { requiredInvites: R, instantInvites: I, finalInvites: F } = config;
  const prefix = count === 9 ? M.PREFIX_9 : count === 10 ? M.PREFIX_10 : M.checking();
  await send(prefix);

  // User-typed numbers are never used, only contradicted.
  const claimed = text && text.match(/\b(\d{1,3})\s*(?:valid\s+)?invites?\b/i);
  if (claimed && parseInt(claimed[1], 10) !== count) await send(M.mismatch(count));

  let advanced = false;
  const gap = () => sleep(600);
  const set = (status, extra = {}) => { db.updateUser(userId, { status, ...extra }); user = db.getUser(userId); };

  if ([STATUS.NEW, STATUS.W3].includes(user.status)) {
    if (count < R) {
      return send(count === 0 ? M.zero : count === 1 ? M.one : count === 2 ? M.two : `you're at ${count} valid invites, need ${R - count} more.`);
    }
    set(STATUS.T3, { initial_completed_at: db.now() });
    log.info('CLAIM', `${userId} completed initial requirement`);
    await send(M.threeOk);
    if (!db.hasEvent(userId, 'three_message_sent')) {
      await gap();
      await send(M.THREE_DONE);
      db.logEvent(userId, 'three_message_sent');
    }
    set(STATUS.W8);
    advanced = true;
  }

  if ([STATUS.T3, STATUS.W8].includes(user.status)) {
    if (count < I) {
      if (!advanced) await send(M.towardEight(count));
      return;
    }
    set(STATUS.E8, { instant_completed_at: db.now() });
    log.info('CLAIM', `${userId} reached 8`);
    if (advanced) await gap();
    if (!db.hasEvent(userId, 'eight_message_sent')) {
      await send(M.EIGHT_DONE);
      db.logEvent(userId, 'eight_message_sent');
    }
    set(STATUS.WF3);
    advanced = true;
  }

  if ([STATUS.E8, STATUS.WF3].includes(user.status)) {
    if (count < F) {
      if (!advanced) await send(count === 10 ? M.ten : count === 9 ? M.nine : M.eightStill);
      return;
    }
    log.info('CLAIM', `${userId} reached 11`);
    await send(M.FINAL_VERIFYING);
    await gap();
    await send(M.ELEVEN_DONE);
    return finalize(userId, send);
  }
}

// Hourly: users whose 14 days are up are processed even if they never DM again.
async function sweepTwoWeek(client) {
  const rows = db.db.prepare(`SELECT * FROM users WHERE initial_completed_at IS NOT NULL AND status IN (?,?,?,?)`)
    .all(STATUS.T3, STATUS.W8, STATUS.E8, STATUS.WF3);
  for (const u of rows) {
    if (!isTwoWeekClaimEligible(u)) continue;
    try {
      const dm = await (await client.users.fetch(u.user_id)).createDM();
      await finalize(u.user_id, (t) => dm.send(t), { twoWeek: true });
    } catch (e) {
      log.error('ERROR', `Two-week sweep failed for ${u.user_id}`, e);
    }
  }
}

module.exports = { STATUS, handleCheck, finalize, isTwoWeekClaimEligible, sweepTwoWeek, hasClaimed };
