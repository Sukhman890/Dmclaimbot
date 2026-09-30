const { SlashCommandBuilder, MessageFlags, PermissionFlagsBits } = require('discord.js');
const config = require('./config');
const db = require('./database');
const log = require('./logger');
const rewards = require('./rewardManager');
const tracker = require('./inviteTracker');
const claims = require('./claimManager');

const userOpt = (b, required = true) => b.addUserOption((o) => o.setName('user').setDescription('User').setRequired(required));
const mk = (n, d) => new SlashCommandBuilder().setName(n).setDescription(d).setDMPermission(false);

const definitions = [
  userOpt(mk('progress', "Show verified invite progress (yours, or another user's if admin)"), false),
  userOpt(mk('invites', 'Admin: show verified invites')),
  userOpt(mk('claim-status', 'Admin: show claim status')),
  mk('reward-add', 'Admin: add a reward code').addStringOption((o) => o.setName('code').setDescription('Code').setRequired(true)),
  mk('reward-stock', 'Admin: show reward inventory'),
  mk('reward-remove', 'Admin: remove an unclaimed reward').addIntegerOption((o) => o.setName('id').setDescription('Reward ID').setRequired(true)),
  userOpt(mk('reset', 'Admin: reset a user (refused after a claim)')),
].map((c) => c.toJSON());

function isAdmin(i) {
  const m = i.member;
  if (!m) return false;
  if (m.permissions?.has(PermissionFlagsBits.Administrator)) return true;
  if (config.adminRoleId) return !!m.roles?.cache?.has(config.adminRoleId);
  return !!m.permissions?.has(PermissionFlagsBits.ManageGuild);
}

function stageInfo(c) {
  const { requiredInvites: R, instantInvites: I, finalInvites: F } = config;
  if (c < R) return { stage: `Initial ${R} invites`, needs: R - c };
  if (c < I) return { stage: `Instant claim (${I - R} extra)`, needs: I - c };
  if (c < F) return { stage: `Final ${F - I} invites`, needs: F - c };
  return { stage: 'Complete', needs: 0 };
}

async function handle(i) {
  if (!i.isChatInputCommand()) return;
  const reply = (content) => i.reply({ content, flags: MessageFlags.Ephemeral });
  const n = i.commandName;
  try {
    const target = i.options.getUser('user') || i.user;
    const adminOnly = n !== 'progress' || target.id !== i.user.id;
    if (adminOnly && !isAdmin(i)) return reply('You do not have permission to use this command.');

    if (n === 'reward-add') {
      const id = rewards.add(i.options.getString('code', true));
      log.info('ADMIN', `${i.user.id} added reward #${id}`);
      return reply(`Added reward #${id}.`);
    }
    if (n === 'reward-stock') {
      const s = rewards.stock();
      const list = rewards.listUnclaimed().map((r) => `#${r.id} ${r.status} (${log.maskCode(r.code)})`).join('\n');
      return reply(`Available: ${s.available} | Reserved: ${s.reserved} | Claimed: ${s.claimed}\n${list}`);
    }
    if (n === 'reward-remove') {
      return reply(rewards.remove(i.options.getInteger('id', true)) ? 'Removed.' : 'Not found or already claimed.');
    }

    const u = db.getUser(target.id);
    const ver = tracker.getVerified(target.id);
    const count = ver ? ver.count : null;

    if (n === 'progress') {
      if (count === null) return reply(`No verified invite data for ${target} yet.`);
      const s = stageInfo(count);
      return reply(`${target}\nVerified invites: ${count}\nStage: ${s.stage}\nStill needed: ${s.needs}\nStatus: ${u?.status ?? 'NEW'}`);
    }
    if (!u) return reply(`${target} has no claim record.`);

    if (n === 'invites') {
      const b = tracker.breakdown(target.id);
      const s = stageInfo(count ?? 0);
      const elig = u.status === 'CLAIMED' ? 'Claimed' : u.status === 'FINAL_ELIGIBLE' || claims.isTwoWeekClaimEligible(u) ? 'Eligible' : 'Not yet';
      return reply([
        `User: ${target}`,
        `Verified invites: ${count === null ? 'no verified data' : `${count} (${ver.source})`}`,
        `Falcon: ${b.falcon ?? 'n/a'} | Discord tracker: ${b.discord ?? 'n/a'}`,
        `Stage: ${s.stage}`,
        `Needs: ${s.needs}`,
        `Status: ${u.status}`,
        `Claim eligibility: ${elig}`,
      ].join('\n'));
    }
    if (n === 'claim-status') {
      const r = rewards.forUser(target.id);
      const twoWeek = u.initial_completed_at
        ? new Date(Date.parse(u.initial_completed_at) + config.waitDays * 86400000).toISOString()
        : 'n/a (initial requirement not reached)';
      return reply([
        `User: ${target}`,
        `Initial requirement: ${config.requiredInvites}`,
        `Verified invites: ${count ?? 'no verified data'}`,
        `Instant requirement: ${config.instantInvites}`,
        `Final requirement: ${config.finalInvites}`,
        `Status: ${u.status}`,
        `2-week eligibility date: ${twoWeek}`,
        `Reward status: ${r ? `#${r.id} ${r.status}` : 'none'}`,
      ].join('\n'));
    }
    if (n === 'reset') {
      if (claims.hasClaimed(target.id)) return reply('That user already claimed a reward; reset refused to prevent double claims.');
      rewards.releaseAllFor(target.id);
      db.updateUser(target.id, {
        status: claims.STATUS.W3, verified_invites: 0, initial_completed_at: null, instant_completed_at: null,
        final_completed_at: null, claim_eligible_at: null,
      });
      db.db.prepare(`DELETE FROM claim_events WHERE user_id=? AND event IN ('three_message_sent','eight_message_sent')`).run(target.id);
      db.logEvent(target.id, 'admin_reset', `by=${i.user.id}`);
      return reply('Reset.');
    }
  } catch (e) {
    log.error('ERROR', `Command ${n} failed`, e);
    const msg = String(e.message).includes('UNIQUE') ? 'that code already exists' : 'command failed, see logs';
    return (i.replied || i.deferred ? i.followUp({ content: `Error: ${msg}`, flags: MessageFlags.Ephemeral }) : reply(`Error: ${msg}`)).catch(() => {});
  }
}

async function register(client) {
  const guild = await client.guilds.fetch(config.guildId);
  await guild.commands.set(definitions);
}

module.exports = { handle, register };
