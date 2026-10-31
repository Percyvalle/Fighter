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
  const MAX_STREAK = 2;     // blows in a row by the same side
  // Least blows per side, the round winner's KO included, so it swings both ways.
  const MIN_WINNER = 3;
  const MIN_LOSER = 2;

  // Crits: any blow, the KO included, can crit. A crit takes a visibly bigger bite
  // than every ordinary blow of the same round, so viewers can tell them apart.
  const CRIT_PCT = 18;      // chance per blow: ~1.2 crits a round, about 3 rounds in 4 have one
  const MAX_CRITS = 3;      // per round, so they stay special
  const NORMAL_MAX = 30;    // no ordinary blow takes more than ~a third of the bar
  const CRIT_MIN = 26;
  const CRIT_MAX = 48;
  const CRIT_GAP = 4;       // a crit beats the round's biggest ordinary blow by at least this
  const CRIT_WEIGHT = 3;    // share of the damage budget a crit draws vs an ordinary blow

  const other = side => side === 'fighter' ? 'gorilla' : 'fighter';

  /* Split `total` into integer parts of at least `min` each, sized by `mult`. */
  function split(total, mult, min, rand) {
    const k = mult.length;
    // Wide weights, so two blows rarely come out the same number.
    const w = mult.map(m => (4 + rand(9)) * m);
    const sum = w.reduce((a, b) => a + b, 0);
    const spare = total - k * min;
    const parts = w.map(x => min + Math.floor(spare * x / sum));
    parts[k - 1] += total - parts.reduce((a, b) => a + b, 0);
    return parts;
  }

  function plausible(hits) {
    const normal = hits.filter(h => !h.crit).map(h => h.dmg);
    const crits = hits.filter(h => h.crit).map(h => h.dmg);
    const top = Math.max(0, ...normal);
    return top <= NORMAL_MAX
      && crits.every(d => d >= CRIT_MIN && d <= CRIT_MAX && d >= top + CRIT_GAP);
  }

  /* One round won by `winner`; times are from that round's "FIGHT!". */
  function makeRound(winner, rand) {
    // Crits are rolled once, up front: re-rolling them inside the rejection loop
    // would quietly favour crit-heavy rounds, since those fit the damage budget easier.
    let crit;
    do {
      crit = Array.from({ length: HITS }, () => rand(100) < CRIT_PCT);
    } while (crit.filter(Boolean).length > MAX_CRITS);

    // Rejection sampling: cheap (a handful of tries on average) and keeps every blow plausible.
    for (;;) {
      const s = attempt(winner, rand, crit);
      if (plausible(s.hits)) return s;
    }
  }

  function attempt(winner, rand, crit) {
    const loser = other(winner);

    // Who lands each blow. The last is always the winner's KO; each side lands at
    // least MIN_WINNER / MIN_LOSER, and nobody lands more than MAX_STREAK in a row
    // (the KO included), so the round swings both ways instead of one side pummelling.
    let by;
    do {
      by = [...Array.from({ length: HITS - 1 }, () => SIDES[rand(2)]), winner];
    } while (by.filter(s => s === winner).length < MIN_WINNER || by.filter(s => s === loser).length < MIN_LOSER
      || by.some((s, i) => i >= MAX_STREAK && by.slice(i - MAX_STREAK, i).every(p => p === s)));

    const winnerLeft = 15 + rand(31);
    // The KO finishes a loser who is already low, rather than one-shotting a full bar;
    // a critical KO may finish from further out.
    const ko = crit[HITS - 1] ? 26 + rand(15) : 12 + rand(11);
    const multOf = side => by.map((s, i) => [s, i]).filter(([s, i]) => s === side && i < HITS - 1)
      .map(([, i]) => crit[i] ? CRIT_WEIGHT : 1);
    const toLoser = [...split(100 - ko, multOf(winner), 8, rand), ko];
    const toWinner = split(100 - winnerLeft, multOf(loser), 6, rand);

    const hp = { fighter: 100, gorilla: 100 };
    const hits = by.map((side, i) => {
      const dmg = side === winner ? toLoser.shift() : toWinner.shift();
      hp[other(side)] = Math.max(0, hp[other(side)] - dmg);
      const jitter = i === HITS - 1 ? 0 : rand(2 * JITTER_MS + 1) - JITTER_MS;
      return { at: FIRST_MS + i * STEP_MS + jitter, by: side, dmg, crit: crit[i], hp: { ...hp }, ko: i === HITS - 1 };
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
