// Extracts a (userId, inviteCount) pair from a Falcon message. Returns null if it can't do so
// unambiguously. It NEVER guesses.

// ===================================================================
// FALCON MESSAGE FORMAT CONFIGURATION
// Edit these patterns to match what Falcon actually posts in your channel.
// The first capture group must be the value. Test against real messages!
// ===================================================================
const FORMAT = {
  // Places to find the Discord user ID (mentions are always checked as well).
  userIdPatterns: [
    /<@!?(\d{17,20})>/g,
    /\bID[:\s]+(\d{17,20})\b/gi,
    /\((\d{17,20})\)/g,
  ],
  // Verified invite TOTAL for that user. First match wins.
  countPatterns: [
    /\b(?:total|valid|verified)\s+invites?\s*[:=\-]\s*(\d+)/i,
    /\binvites?\s*[:=\-]\s*(\d+)/i,
    /\b(\d+)\s+(?:total\s+|valid\s+|verified\s+)*invites?\b/i,
  ],
  usernamePatterns: [/\busername[:\s]+@?([\w.]{2,32})/i],
};
// ===================================================================

function collectText(message) {
  const parts = [message.content || ''];
  for (const e of message.embeds || []) {
    parts.push(e.title, e.description, e.author?.name, e.footer?.text);
    for (const f of e.fields || []) parts.push(`${f.name}: ${f.value}`);
  }
  return parts.filter(Boolean).join('\n');
}

function parseFalconMessage(message) {
  const text = collectText(message);
  if (!text) return null;

  const ids = new Set();
  for (const u of message.mentions?.users?.values?.() || []) ids.add(u.id);
  for (const re of FORMAT.userIdPatterns) {
    for (const m of text.matchAll(new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g'))) ids.add(m[1]);
  }
  // Zero or several distinct users = ambiguous.
  if (ids.size !== 1) return null;
  const userId = [...ids][0];

  let inviteCount = null;
  for (const re of FORMAT.countPatterns) {
    const m = text.match(re);
    if (m) { inviteCount = parseInt(m[1], 10); break; }
  }
  if (inviteCount === null || Number.isNaN(inviteCount)) return null;

  let username = null;
  for (const re of FORMAT.usernamePatterns) {
    const m = text.match(re);
    if (m) { username = m[1]; break; }
  }

  return {
    userId,
    username,
    inviteCount,
    timestamp: new Date(message.editedTimestamp ?? message.createdTimestamp).toISOString(),
    messageId: message.id,
  };
}

module.exports = { parseFalconMessage };
