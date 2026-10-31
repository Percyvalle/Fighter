/* Fight script: the blow-by-blow of a whole fight, Mortal Kombat style — rounds of
   ~10 s each until someone has won ROUNDS_TO_WIN of them. The fight's winner is
   rolled before any of this is built; the script only decides how it gets there.
   Shared by the host (which rolls the winner and sends the script to every overlay)
   and the overlay's demo mode. A plain script on purpose: the overlay loads it with
   <script src> so the demo also works when opened straight from disk, and the host
   imports it for its side effect. */
(function (root) {
  const SIDES = ['fighter', 'gorilla'];

  // The match
  const ROUNDS_TO_WIN = 2;  // best of three
  const INTRO_MS = 1200;    // "ROUND N" on screen, then the gong and "FIGHT!"
  const BETWEEN_MS = 1500;  // after a round's KO, before the next "ROUND N"

  // One round
  const HITS = 7;           // exchanges, the last one is the KO
  const FIRST_MS = 1000;    // after the "FIGHT!" flash
  const STEP_MS = 1300;     // between exchanges
  const JITTER_MS = 150;
  const KO_HOLD_MS = 700;   // the KO lands, then the round is over
  const NEUTRAL_HITS = 4;

  // Crits: any blow, the KO included, can crit. A crit takes a visibly bigger bite
  // than every ordinary blow of the same round, so viewers can tell them apart.
  const CRIT_PCT = 18;
  const MAX_CRITS = 3;      // per round, so they stay special
  const NORMAL_MAX = 30;    // no ordinary blow takes more than ~a third of the bar
  const CRIT_MIN = 26;
  const CRIT_MAX = 48;
  const CRIT_GAP = 4;       // a crit beats the round's biggest ordinary blow by at least this

  const other = side => side === 'fighter' ? 'gorilla' : 'fighter';

  /* One round won by `winner`; times are from that round's "FIGHT!". */
  function makeRound(winner, rand) {
    // The opening is sampled without consulting the winner. Both fighters land
    // twice and finish within KO reach, so either can still take this round.
    let opening;
    do {
      const by = [SIDES[0], SIDES[0], SIDES[1], SIDES[1]];
      for (let i = by.length - 1; i > 0; i--) {
        const j = rand(i + 1);
        [by[i], by[j]] = [by[j], by[i]];
      }
      opening = by.map(side => {
        const crit = rand(100) < CRIT_PCT;
        return { by: side, crit, dmg: crit ? 34 + rand(9) : 23 + rand(8) };
      });
    } while (SIDES.some(side => {
      const left = 100 - opening.filter(h => h.by === other(side)).reduce((n, h) => n + h.dmg, 0);
      return left < 35 || left > 52;
    }) || opening.filter(h => h.crit).length > MAX_CRITS);

    const loser = other(winner);
    const left = 100 - opening.filter(h => h.by === winner).reduce((n, h) => n + h.dmg, 0);
    const topNormal = Math.max(0, ...opening.filter(h => !h.crit).map(h => h.dmg));
    const critCount = opening.filter(h => h.crit).length;
    // Pick the two finishing blows together. A normal KO takes 12–22 HP;
    // a critical KO may finish from farther out. Every critical blow still
    // exceeds every ordinary blow in this round by at least CRIT_GAP.
    const finishes = [];
    for (const firstCrit of [false, true]) for (const koCrit of [false, true]) {
      if (critCount + Number(firstCrit) + Number(koCrit) > MAX_CRITS) continue;
      for (let ko = koCrit ? CRIT_MIN : 12; ko <= (koCrit ? 40 : 22); ko++) {
        const first = left - ko;
        if (first < (firstCrit ? CRIT_MIN : 8) || first > (firstCrit ? CRIT_MAX : NORMAL_MAX)) continue;
        const normalTop = Math.max(topNormal, firstCrit ? 0 : first, koCrit ? 0 : ko);
        if (opening.some(h => h.crit && h.dmg < normalTop + CRIT_GAP)) continue;
        if (firstCrit && first < normalTop + CRIT_GAP) continue;
        if (koCrit && ko < normalTop + CRIT_GAP) continue;
        finishes.push({ first, firstCrit, ko, koCrit });
      }
    }
    const wantedFirstCrit = rand(100) < CRIT_PCT;
    const wantedKoCrit = rand(100) < CRIT_PCT;
    const preferred = finishes.filter(f => f.firstCrit === wantedFirstCrit && f.koCrit === wantedKoCrit);
    const fallback = finishes.filter(f => !f.firstCrit && !f.koCrit);
    const finish = (preferred.length ? preferred : fallback.length ? fallback : finishes)[rand((preferred.length || fallback.length || finishes.length))];
    const lastSide = opening[NEUTRAL_HITS - 1].by;
    const middle = { by: loser, crit: false, dmg: 8 + rand(13) };
    const end = [{ by: winner, crit: finish.firstCrit, dmg: finish.first }, middle,
      { by: winner, crit: finish.koCrit, dmg: finish.ko }];
    if (lastSide === winner) [end[0], end[1]] = [end[1], end[0]];
    const blows = [...opening, ...end];
    const hp = { fighter: 100, gorilla: 100 };
    const hits = blows.map(({ by, dmg, crit }, i) => {
      hp[other(by)] = Math.max(0, hp[other(by)] - dmg);
      const jitter = i === HITS - 1 ? 0 : rand(2 * JITTER_MS + 1) - JITTER_MS;
      return { at: FIRST_MS + i * STEP_MS + jitter, by, dmg, crit, hp: { ...hp }, ko: i === HITS - 1 };
    });

    return { hits, length: hits[hits.length - 1].at + KO_HOLD_MS };
  }

  /**
   * The whole fight. Times are ms from the start of the fight.
   *   rounds[i]: { n, winner, start ("ROUND N"), fight ("FIGHT!"), ko, end, score after it }
   *   hits:      every blow of every round in order, `round` = index into rounds,
   *              `hp` = health within that round (bars refill between rounds)
   *   reveal:    the last round's end — the fight's winner banner
   * @param {'fighter'|'gorilla'} winner
   * @param {(n:number)=>number} rand integer in [0, n)
   */
  function make(winner, rand) {
    // Whether the loser takes a round is a fair coin too, and so is which one: a
    // 2:1 fight comes out as L W W or W L W — the deciding round is always the winner's.
    const order = [];
    const lostRounds = rand(ROUNDS_TO_WIN);   // 0 .. ROUNDS_TO_WIN-1
    for (let i = 0; i < ROUNDS_TO_WIN - 1; i++) order.push(winner);
    for (let i = 0; i < lostRounds; i++) order.splice(rand(order.length + 1), 0, other(winner));
    order.push(winner);

    const score = { fighter: 0, gorilla: 0 };
    const rounds = [], hits = [];
    let t = 0;
    order.forEach((roundWinner, i) => {
      const r = makeRound(roundWinner, rand);
      const fight = t + INTRO_MS;
      for (const h of r.hits) hits.push({ ...h, at: fight + h.at, round: i });
      score[roundWinner]++;
      rounds.push({
        n: i + 1, winner: roundWinner, start: t, fight,
        ko: fight + r.hits[r.hits.length - 1].at, end: fight + r.length, score: { ...score },
      });
      t = fight + r.length + BETWEEN_MS;
    });

    return { winner, rounds, hits, score, reveal: rounds[rounds.length - 1].end };
  }

  root.FightScript = { make, ROUNDS_TO_WIN };
})(typeof window !== 'undefined' ? window : globalThis);
