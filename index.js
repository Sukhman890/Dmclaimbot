const { Client, GatewayIntentBits, Partials, Events } = require('discord.js');
const config = require('./config');
require('./database'); // initialises SQLite on load
const log = require('./logger');
const tracker = require('./inviteTracker');
const dm = require('./dmHandler');
const commands = require('./commands');
const claims = require('./claimManager');

log.info('STARTUP', 'Database initialized');
// Reward codes come from the REWARD_CODES variable and/or a codes.txt file (one per line, # comments allowed).
(() => {
  const fs = require('fs');
  const codes = [...config.rewardCodes];
  const file = process.env.REWARD_CODES_FILE || './codes.txt';
  try {
    if (fs.existsSync(file)) {
      codes.push(...fs.readFileSync(file, 'utf8').split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#')));
    }
    if (codes.length) require('./rewardManager').seedFromEnv(codes);
  } catch (e) { log.error('ERROR', 'Reward seeding failed', e); }
})();

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,     // privileged: Server Members Intent
    GatewayIntentBits.GuildInvites,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.MessageContent,   // privileged: Message Content Intent
  ],
  partials: [Partials.Channel, Partials.Message],
});

client.once(Events.ClientReady, async () => {
  log.info('STARTUP', 'Discord connected');
  // Register handlers first so a Falcon/invite-tracking problem can never stop DMs from working.
  client.on(Events.MessageCreate, (m) => {
    if (!m.author.bot && !m.guild) log.info('DM', `Message received from ${m.author.id}`);
    return dm.onMessage(m);
  });
  client.on(Events.InteractionCreate, commands.handle);
  try { await client.guilds.fetch(config.guildId); } catch (e) { log.error('ERROR', 'Configured guild not accessible', e); }
  try { await tracker.start(client); } catch (e) { log.error('ERROR', 'Invite tracker failed to start', e); }
  try { await commands.register(client); } catch (e) { log.error('ERROR', 'Slash command registration failed', e); }
  setInterval(() => claims.sweepTwoWeek(client).catch((e) => log.error('ERROR', 'sweep failed', e)), 3600 * 1000);
  claims.sweepTwoWeek(client).catch(() => {});
  log.info('STARTUP', 'Claim system ready');
});

client.on(Events.Error, (e) => log.error('ERROR', 'Client error', e));
process.on('unhandledRejection', (e) => log.error('ERROR', 'Unhandled rejection', e));
process.on('uncaughtException', (e) => log.error('ERROR', 'Uncaught exception', e));

client.login(config.token).catch((e) => { log.error('ERROR', 'Login failed (check DISCORD_TOKEN)', e); process.exit(1); });
