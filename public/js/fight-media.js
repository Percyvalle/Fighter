/* Shared by the overlay and host. Times describe the prepared files in assets,
   not the original recordings. Anchors are initial RMS-based sync marks; adjust
   these after an OBS listening review without cutting or speeding up speech. */
(function (root) {
  const CONTACT_MS = 170;
  const RESULT_GAP_MS = 250;
  const audio = {
    'vlad-attack-a.mp3': { durationMs: 680, peakMs: 175, voice: true },
    'vlad-attack-c.mp3': { durationMs: 667, peakMs: 215, voice: true },
    'vlad-attack-original.mp3': { durationMs: 1140, peakMs: 475, voice: true },
    'vlad-crit-complete.ogg': { durationMs: 1322, peakMs: 955, voice: true },
    'vlad-win.ogg': { durationMs: 2089 },
    'vlad-defeat.ogg': { durationMs: 3089 },
    'gorilla-swing-1.mp3': { durationMs: 750, peakMs: 205 },
    'gorilla-swing-2.mp3': { durationMs: 870, peakMs: 275 },
    'gorilla-roar.ogg': { durationMs: 820 },
    'gorilla-yelp.ogg': { durationMs: 1050 },
    'gorilla-win.ogg': { durationMs: 2900 },
    'paver-punch-1.ogg': { durationMs: 888, peakMs: 45 },
    'paver-punch-2.ogg': { durationMs: 202, peakMs: 95 },
    'paver-punch-3.ogg': { durationMs: 310, peakMs: 45 },
    'paver-crit.ogg': { durationMs: 1463, peakMs: 605 },
    'paver-win-1.ogg': { durationMs: 1256 },
    'paver-win-2.ogg': { durationMs: 2505 },
  };
  for (const [i, ms] of [347, 398, 387, 335, 340, 320, 919].entries()) {
    audio[`vlad-hurt-${i + 1}.ogg`] = { durationMs: ms };
  }
  for (const [i, ms] of [266, 274, 468].entries()) audio[`paver-hurt-${i + 1}.ogg`] = { durationMs: ms };
  for (const [i, ms] of [880, 845, 367].entries()) audio[`vlad-punch-${i + 1}.mp3`] = { durationMs: ms, peakMs: 0 };

  const cue = src => audio[String(src).split('/').pop()] || { durationMs: 0, peakMs: 0 };
  const maxDuration = sources => Math.max(0, ...(sources || []).map(src => cue(src).durationMs));

  // Maximum remaining sound at the final contact. Use the slowest allowed rate
  // so random effect variations never shorten the host's presentation budget.
  function reactionTailMs(hit, attacker, defender) {
    const heavy = hit.crit || hit.ko;
    const sfx = attacker?.sfx || {};
    let tail = 0;
    const punches = attacker ? sfx.punch || [] : ['gorilla-swing-1.mp3', 'gorilla-swing-2.mp3'];
    for (const src of punches) {
      const c = cue(src);
      if (hit.crit && sfx.crit && c.voice) continue;
      tail = Math.max(tail, (c.durationMs - (c.peakMs || 0)) / (c.voice ? 1 : heavy ? 0.82 : 0.94));
    }
    if (hit.crit && sfx.crit) {
      const c = cue(sfx.crit);
      tail = Math.max(tail, c.durationMs - (c.peakMs || 0));
    }
    if (defender) tail = Math.max(tail, 60 + maxDuration(defender.sfx?.hurt));
    else tail = Math.max(tail, 50 + cue('gorilla-yelp.ogg').durationMs / (heavy ? 0.88 : 0.95));
    if (!attacker) {
      tail = Math.max(tail, cue('gorilla-roar.ogg').durationMs / (heavy ? 0.9 : 0.95) - 380,
        880 / (0.72 * (heavy ? 0.9 : 0.97)));
    }
    return tail;
  }

  function resultHoldMs(script, character = 'vlad', opponent = 'gorilla') {
    if (!script?.hits?.length) return 0;
    const cast = {
      fighter: root.Roster.CHARACTERS[character],
      gorilla: root.Roster.CHARACTERS[opponent],
    };
    const hit = script.hits[script.hits.length - 1];
    const loser = script.winner === 'fighter' ? 'gorilla' : 'fighter';
    const afterContact = script.reveal - hit.at - CONTACT_MS;
    const wait = Math.max(0, reactionTailMs(hit, cast[hit.by], cast[loser]) - afterContact);
    const lose = maxDuration(cast[loser]?.sfx?.lose);
    const celebrateAt = wait + (lose ? 100 + lose + RESULT_GAP_MS : 450);
    const winnerId = script.winner === 'fighter' ? character : opponent;
    const loserId = script.winner === 'fighter' ? opponent : character;
    const victory = cast[script.winner] ? maxDuration(root.Roster.winSounds(winnerId, loserId)) : 4084;
    const defeat = cast[loser]?.defeat ? Math.max(0, 150 + 5917 - afterContact) : 0;
    // A small margin covers frame boundaries and normal media startup latency.
    return Math.ceil(Math.max(celebrateAt + victory, defeat) + 350);
  }

  root.FightMedia = { CONTACT_MS, RESULT_GAP_MS, cue, resultHoldMs };
})(typeof window !== 'undefined' ? window : globalThis);
