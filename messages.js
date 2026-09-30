// All user-facing text lives here.
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

const CHECKING = [
  'one sec, lemme check ur invites on the bot...',
  'checking rq...',
  'lemme check Falcon rq...',
];

module.exports = {
  pick,
  checking: () => pick(CHECKING),
  FIRST_DM: `🎁 Invite 3 people to the server and the giftcard code is yours!\n\nJust come back when you've got the 3 invites.`,
  COOLDOWN: `give me a sec, i'm already checking your invites 😭`,
  BOT_IDENTITY: `yeah, I'm the claim bot 🤖`,
  ALREADY_CLAIMED: `your reward has already been claimed for this account.`,
  FALCON_UNAVAILABLE: `Falcon verification is currently unavailable.`,
  FALCON_NO_DATA: `I couldn't verify your invites from Falcon right now. Try again in a moment.`,
  GENERIC_ERROR: `something went wrong on my end, try again in a moment.`,
  mismatch: (n) => `I checked Falcon and it's currently showing ${n} valid invites.`,
  zero: `you're at 0 invites rn. You need 3 more.`,
  one: `showing 1 invite(s) lol, just need 2 more`,
  two: `showing 2 invite(s), just need 1 more`,
  threeOk: `checked and u got 3 valid invites. you're good! 🎉`,
  THREE_DONE: `🧑‍🌾 Thanks for INVITING! I appreciate you for giving your time.\n\n💫 Either wait \`2 weeks\` to claim or get **__5 EXTRA INVITES__** to the server for an **INSTANT CLAIM**. ⚡\n\n> ❤️ - We have this system to prevent people from abusing our systems because it has happened several times.`,
  towardEight: (c) =>
    c === 3 ? `you're at 3 valid invites — get to 8 total for the instant claim, or wait 2 weeks. ⚡`
    : c === 6 ? `showing 6 rn lol, get to 8 and i lock ur payout in`
    : `checked and u got ${c}, need 8 to reserve ur prize. almost there bro`,
  EIGHT_DONE: `👋 hey, sorry for the delay!\njust checked ur invites on the bot and everything looks good! great job\nyou're so close to getting the reward. we only have a few left in stock but i saved one just for u! before i send it tho, could u invite **3 more people** to the server? ❄️\ni wanna be fair, but with so many ppl messaging me, im giving it to whoever does this extra step! once ur done, dm me back and i'll send it immediately, no waiting!`,
  eightStill: `you're at 8 valid invites — 3 more and you're done. ❄️`,
  PREFIX_9: `one sec, checking ur invites...`,
  PREFIX_10: `checking rq...`,
  nine: `you're at 9 valid invites rn — just 2 more and ur good. ❄️`,
  ten: `you're at 10 valid invites — just 1 more and i'll finish your claim. ⚡`,
  FINAL_VERIFYING: `👋 one sec, lemme verify the final invites...`,
  ELEVEN_DONE: `everything checks out! you've got 11 valid invites. 🎉\n\nyour final invite requirement is complete. i'll process your reward now.`,
  TWO_WEEK_DONE: `🎉 Your 2-week waiting period is complete.\n\nI've verified your claim and you're now eligible for the reward.`,
  OUT_OF_STOCK: `Your claim is verified, but rewards are temporarily out of stock. Your eligibility has been saved and your claim will not be lost.`,
  reward: (code) => `🎁 here's your giftcard code:\n\`${code}\`\n\nenjoy!`,
};
