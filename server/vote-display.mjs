// Small public summary for the OBS overlay. The control panel keeps the full list.
export function voteDisplay(votes, limit = 6) {
  const recent = { 1: [], 2: [] };
  const platforms = { twitch: 0, kick: 0 };
  for (const { display, platform, choice } of votes.values()) {
    if (choice !== 1 && choice !== 2) continue;
    const list = recent[choice];
    list.push({ display, platform });
    if (list.length > limit) list.shift();
    if (platform === 'twitch' || platform === 'kick') platforms[platform]++;
  }
  return { recent, platforms };
}
