# Discord Reward Bot (official bot account, discord.js v14)

DM claim bot. Invite counts come only from verified sources (Falcon's messages and/or Discord's own invite data). Whatever a user types never changes their count. The bot uses a normal bot token; it never uses user tokens or self-bots.

## 1. Discord Developer Portal
1. https://discord.com/developers/applications -> **New Application**.
2. **Bot** tab -> Reset Token -> copy it into `DISCORD_TOKEN`.
3. Under **Privileged Gateway Intents** enable **Server Members Intent** and **Message Content Intent**. (Presence intent not needed.)
4. **OAuth2 -> URL Generator**: scopes `bot` + `applications.commands`. Permissions: View Channels, Send Messages, Read Message History, Embed Links, plus **Manage Server** (only needed for native invite tracking; Discord requires it to list invites). No Administrator.
5. Open the URL and add the bot to your server.
6. In the Falcon private channel, give the bot role **View Channel** + **Read Message History**.
7. Enable Developer Mode in Discord, right-click to copy `GUILD_ID`, `FALCON_CHANNEL_ID`, Falcon's user ID (`FALCON_BOT_ID`) and your admin role ID (`ADMIN_ROLE_ID`).

## 2. Configure & run
```
npm install
cp .env.example .env   # fill it in
npm start
```
Expected logs: `Database initialized`, `Discord connected`, `Falcon channel verified`, `Claim system ready`.

## 3. Invite sources (`INVITE_SOURCE`)
- `falcon`: only Falcon's posted counts.
- `discord`: the bot's own tracking (needs Manage Server). It only sees joins **after it was added**, counts each invited account once, and only while they remain in the server. Rejoins are never counted again. Joins it can't attribute to exactly one invite (vanity URL, ambiguous) are recorded but not counted.
- `both` (default): uses the highest available count. A native count of 0 is not treated as a verified zero, so missing Falcon data still shows "couldn't verify".

## 4. Falcon parser
Edit the `FALCON MESSAGE FORMAT CONFIGURATION` block in `falconParser.js` to match Falcon's real output (this is the only place that may need changes). It returns `null` when a message has zero/several user IDs or no count, and never guesses. It assumes Falcon reports the inviter's **total** verified invites. Missing data is reported as a verification failure, never as 0.

## 5. Flow & states
`NEW -> WAITING_FOR_3 -> THREE_COMPLETED -> WAITING_FOR_8 -> EIGHT_COMPLETED -> WAITING_FOR_FINAL_3 -> FINAL_ELIGIBLE -> CLAIMED`. States only move forward and persist in SQLite. After 3 invites the 14-day timer starts (`initial_completed_at`); once it elapses the user becomes `FINAL_ELIGIBLE` without needing 8/11 (an hourly job handles users who never DM again). Rewards come only from the inventory you add; codes are reserved in a transaction, marked claimed only after the DM succeeds, and never logged in full.

## 6. Commands (slash, server only)
`/progress [user]`, `/invites user`, `/claim-status user`, `/reward-add code`, `/reward-stock`, `/reward-remove id`, `/reset user`. Everything except viewing your own `/progress` requires `ADMIN_ROLE_ID` (or Manage Server if unset, or Administrator). `/reset` refuses users who already claimed.

## 7. Railway
1. New Project -> Deploy from GitHub repo (or `railway up`).
2. Variables: add everything from `.env.example`.
3. **Add a Volume** mounted at `/data` and set `DATABASE_PATH=/data/database.sqlite`. Without it SQLite resets on every redeploy (users, invite history, rewards, claims).
4. Start command: `npm start`. Check the logs for the startup lines above and that the bot shows online.

**PostgreSQL for production:** add Railway's Postgres plugin, replace `better-sqlite3` with `pg` in `database.js`/`rewardManager.js` (keep the same exported functions), make async, and reserve rewards with `SELECT ... FOR UPDATE SKIP LOCKED` in one transaction.

## Loading reward codes from Railway
Put real codes (from the issuer) in a Railway variable `REWARD_CODES`, separated by commas, spaces or new lines. They're loaded into the DB on every startup; codes already in the DB (available, reserved or claimed) are skipped. Important:
- The **volume is required**. Without it the DB resets on redeploy, claimed codes look new again, and they'd be handed out a second time.
- After codes are claimed, remove them from the variable (or keep it; it's safe only with the volume).
- Railway variables are visible to anyone with project access, and are not a secret vault. `/reward-add` remains available for adding codes without touching variables.

## Loading codes from GitHub (codes.txt)
Copy `codes.txt.example` to `codes.txt` (one real code per line). On startup the bot loads it together with `REWARD_CODES`. To ship it via GitHub + Railway you must delete `codes.txt` from `.gitignore` and use a **private** repo. In a public repo anyone can read and use your codes. Already-claimed codes are never re-added (needs the volume).

## Notes
- User-facing text lives in `messages.js`.
- Reward codes are stored in plaintext in the DB; protect the volume/backups.
- Users with DMs closed can't receive rewards; the code is returned to stock and the error logged.
