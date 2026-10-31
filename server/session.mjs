/* Session: one fight round at a time.
     idle -> voting -> fight -> result -> (pause -> voting | idle)
   A series is a set number of fights (say 20): fights are counted 1/20, 2/20 ...,
   and after the last one the loop stops even with auto-repeat on.
   Votes are bets: !1 / !2 back a fighter with the viewer's points, !3 sits the
   fight out. The winner is a coin flip made by the host, damped against long win
   streaks (roll()), and never looks at the bets, so no amount of betting can buy
   a result. */
import { randomInt } from 'node:crypto';
import { logger } from './log.mjs';
import { clampVote } from './config.mjs';
import '../public/js/fight.js';
import '../public/js/roster.js';

const log = logger('session');
const { FightScript, Roster } = globalThis;

export class Session {
  constructor({ cfg, hub, outbox, points }) {
    this.cfg = cfg; this.hub = hub; this.outbox = outbox; this.points = points;
    this.voteSeconds = cfg.game.voteSeconds;
    this.autoLoop = cfg.game.autoLoop;
    this.phase = 'idle';
    this.round = 0;
    this.endsAt = 0;            // 0 = no clock running
    this.votes = new Map();     // key -> { display, platform, choice }
    this.winner = null;         // 'fighter' | 'gorilla' at the reveal
    this.pending = null;        // winner rolled at fight start, hidden until reveal
    this.script = null;         // blow-by-blow of the current fight, see public/js/fight.js
    this.fightAt = 0;
    this.right = 0;
    this.guessed = [];
    this.wins = { fighter: 0, gorilla: 0 };
    this.streak = null;         // { side, n }: who won the last n fights in a row, see roll()
    this.history = [];
    this.settled = null;       // what the last fight did to the bettors' points
    // Series: `total` fights, `done` of them fought to a result; total 0 = no series.
    this.series = { total: 0, done: 0 };
    this.timers = [];
    this.closingSaid = false;
    // The corners: the left one is one of public/js/roster.js, the right one the
    // gorilla or another roster character in its place, both picked in the panel.
    // Vlad and the gorilla keep their names from data/config.json (game.names); the
    // others use the roster's, or game.characters.<id> if set there. The sides stay
    // 'fighter' and 'gorilla' whoever stands there: !1 is left, !2 is right.
    this.vladName = cfg.game.names.fighter;
    this.gorillaName = cfg.game.names.gorilla;
    this.character = Roster.CHARACTERS[cfg.game.character] ? cfg.game.character : Roster.DEFAULT;
    this.opponent = Roster.CHARACTERS[cfg.game.opponent] && cfg.game.opponent !== this.character ? cfg.game.opponent : 'gorilla';
    cfg.game.names.fighter = this.nameOf(this.character);
    cfg.game.names.gorilla = this.nameOf(this.opponent);
    this.ticker = setInterval(() => this.tick(), 1000);
  }

  /* ---------- clock ---------- */

  later(fn, ms) { this.timers.push(setTimeout(fn, ms)); }
  clearTimers() { this.timers.forEach(clearTimeout); this.timers = []; }

  left() { return this.endsAt ? Math.max(0, Math.ceil((this.endsAt - Date.now()) / 1000)) : 0; }

  tick() {
    if (!this.endsAt) return;
    const left = this.left();
    if (this.phase === 'voting' && left <= 10 && !this.closingSaid && this.voteSeconds > 15) {
      this.closingSaid = true;
      this.outbox.announce('voteClosing', { seconds: left, total: this.votes.size });
    }
    if (left > 0) return this.broadcast();
    this.endsAt = 0;
    if (this.phase === 'voting') this.resolve();
    else if (this.phase === 'pause') this.start();
  }

  /* ---------- transitions ---------- */

  seriesOver() { return this.series.total > 0 && this.series.done >= this.series.total; }

  start() {
    this.clearTimers();
    // Opening a vote after the last fight of a series starts the series over.
    if (this.seriesOver()) {
      this.series.done = 0;
      log.info(`series of ${this.series.total} fights: started over`);
    }
    this.round++;
    this.phase = 'voting';
    this.votes.clear();
    this.winner = this.pending = this.script = null;
    this.right = 0;
    this.guessed = [];
    this.settled = null;
    this.closingSaid = false;
    const min = this.cfg.game.minVotes;
    this.endsAt = min > 0 ? 0 : Date.now() + this.voteSeconds * 1000;
    log.info(`round ${this.round}: voting open (${this.voteSeconds}s${min ? `, waits for ${min} votes` : ''})${this.seriesTag()}`);
    this.outbox.announce('voteOpen', { names: this.cfg.game.names, seconds: this.voteSeconds, min, series: this.seriesNow() });
    this.broadcast();
  }

  /* One bet per viewer per fight: the first !1 / !2 / !3 is final, so nobody can
     hop sides while the vote runs. A viewer with 0 points has nothing to stake, so
     their vote is not taken at all — not in the panel, not in the percentages —
     until the streamer grants them points. Returns 'again' / 'broke' when refused. */
  vote({ key, display, platform, choice }) {
    if (this.phase !== 'voting') return 'phase';
    if (this.votes.has(key)) return 'again';
    // A first bet puts the viewer in the table (with the start amount) right away.
    if (this.points.join(key, display, platform)) this.broadcastPointsSoon();
    if (this.points.balance(key) <= 0) return 'broke';
    this.votes.set(key, { display, platform, choice });
    this.hub.send({ t: 'vote', round: this.round, key, display, platform, choice }, 'control');
    const min = this.cfg.game.minVotes;
    if (min > 0 && !this.endsAt && this.votes.size >= min) this.endsAt = Date.now() + this.voteSeconds * 1000;
    this.broadcastSoon();
    return 'ok';
  }

  /* Close voting now; from idle/result this fights straight away with no votes. */
  go() {
    if (this.phase === 'fight') return;
    if (this.phase !== 'voting') this.start();
    this.resolve();
  }

  resolve() {
    this.clearTimers();
    this.endsAt = 0;
    const t = this.tally();
    this.phase = 'fight';
    this.pending = this.roll();
    this.script = FightScript.make(this.pending, n => randomInt(n));
    this.fightAt = Date.now();
    // Only drives the once-a-second push (panel countdown); reveal() has its own timer.
    this.endsAt = this.fightAt + this.script.reveal;
    log.info(`round ${this.round}: fight (${t[1]}:${t[2]}, no bet ${t[3]})`);
    this.outbox.announce('fight', { names: this.cfg.game.names, v1: t[1], v2: t[2] });
    this.broadcast();
    // Chat and the panel learn the winner only at the KO, never ahead of the screen.
    this.later(() => this.reveal(), this.script.reveal);
  }

  /* The fight's winner. A fair coin, damped against streaks: whoever won the last
     `streak` fights wins again with game.antiStreak[streak-1] % (the last entry for
     longer streaks). Both sides get the same treatment, so it stays 50/50 in the
     long run; no entry ever reaches 0, so a streak is unlikely but never ruled out
     and chat cannot bet on it ending for sure. */
  roll() {
    const rep = this.cfg.game.antiStreak;
    const s = this.streak;
    if (!s || !rep.length) return randomInt(2) === 0 ? 'fighter' : 'gorilla';
    const again = randomInt(100) < rep[Math.min(s.n, rep.length) - 1];
    return again ? s.side : (s.side === 'fighter' ? 'gorilla' : 'fighter');
  }

  reveal() {
    const t = this.tally();
    const side = this.pending === 'fighter' ? 1 : 2;
    this.phase = 'result';
    this.endsAt = 0;
    this.winner = this.pending;
    this.wins[this.winner]++;
    this.streak = this.streak?.side === this.winner ? { side: this.winner, n: this.streak.n + 1 } : { side: this.winner, n: 1 };
    if (this.series.total) this.series.done++;
    const right = [...this.votes.values()].filter(v => v.choice === side);
    this.right = right.length;
    this.guessed = right.slice(0, 40).map(v => v.display);
    // Pay out: right calls double, wrong calls are wiped, !3 is untouched.
    this.settled = this.points.settle(this.votes, side);
    const crits = this.script.hits.filter(h => h.crit).length;
    const score = this.script.score;
    const bets = t[1] + t[2];
    this.record({ result: this.winner, names: { ...this.cfg.game.names }, series: this.seriesNow(), ...t, right: this.right, bets, crits, score,
      paid: this.settled.paid, burned: this.settled.burned });
    const name = this.cfg.game.names[this.winner];
    const rounds = `${score[this.winner]}:${score[this.winner === 'fighter' ? 'gorilla' : 'fighter']}`;
    log.info(`round ${this.round}: ${name} wins ${rounds}, guessed ${this.right}/${bets} bets, `
      + `+${this.settled.paid} / -${this.settled.burned} points, crits ${crits}${this.seriesTag()}`);
    this.outbox.announce('win', { name, rounds, right: this.right, bets, paid: this.settled.paid, burned: this.settled.burned });
    if (this.right) this.outbox.announce('guessed', { list: this.guessed.slice(0, 15), more: Math.max(0, this.right - 15) });
    if (this.seriesOver()) {
      log.info(`series of ${this.series.total} fights: over`);
      this.outbox.announce('seriesEnd', { total: this.series.total });
    }
    this.broadcast();
    this.broadcastPoints();
    // The winner screen stays up until the streamer opens the next vote (or cancels);
    // only the auto loop moves on by itself, and not past the last fight of a series.
    if (this.autoLoop && !this.seriesOver()) this.later(() => this.finish(), this.cfg.game.resultSeconds * 1000);
  }

  finish() {
    this.clearTimers();
    if (this.autoLoop && !this.seriesOver()) {
      const pause = this.cfg.game.pauseSeconds;
      if (!pause) return this.start();
      this.phase = 'pause';
      this.endsAt = Date.now() + pause * 1000;
    } else {
      this.phase = 'idle';
      this.endsAt = 0;
    }
    this.broadcast();
  }

  /* Cancel the round in progress; nothing is recorded. */
  skip() {
    if (this.phase === 'idle') return;
    log.info(`round ${this.round}: cancelled by streamer`);
    this.clearTimers();
    this.phase = 'idle';
    this.endsAt = 0;
    this.winner = this.pending = this.script = null;
    this.broadcast();
  }

  reset() {
    this.skip();
    this.wins = { fighter: 0, gorilla: 0 };
    this.history = [];
    this.series.done = 0;           // the series, if any, starts again from fight 1
    this.broadcast();
  }

  /* Set up a series of `n` fights from the next one on (0 switches series off).
     Not while bets are open or a fight is on: the counter would jump mid-fight. */
  setSeries(n) {
    if (this.phase === 'voting' || this.phase === 'fight') return false;
    n = Math.max(0, Math.min(500, Math.round(+n) || 0));
    this.series = { total: n, done: 0 };
    log.info(n ? `series: ${n} fights` : 'series: off');
    this.broadcast();
    return true;
  }

  /* Fight number within the series: the one whose result is up, otherwise the one
     being bet on, fought, or coming next. */
  seriesNow() {
    const { total, done } = this.series;
    if (!total) return null;
    const n = this.phase === 'result' ? done : Math.min(done + 1, total);
    return { total, done, n, over: this.seriesOver() };
  }

  seriesTag() {
    const s = this.seriesNow();
    return s ? ` [series ${s.n}/${s.total}]` : '';
  }

  resetPoints() {
    this.points.reset();
    this.broadcastPoints();
  }

  /* !join from chat: into the points table, any phase. */
  join({ key, display, platform }) {
    const fresh = this.points.join(key, display, platform);
    log.info(fresh
      ? `!join: ${display} (${platform}) added to the points table`
      : `!join: ${display} (${platform}) is already in the table (${this.points.balance(key)} points)`);
    this.broadcastPoints();
    return fresh;
  }

  /* Points granted (or taken, if negative) by the streamer from the panel. */
  givePoints(nick, amount) {
    const hits = this.points.give(nick, amount);
    if (hits.length) {
      log.info(`points: ${amount > 0 ? '+' : ''}${amount} to ${hits.map(h => `${h.display} (${h.platform}) = ${h.points}`).join(', ')}`);
      this.broadcastPoints();
    }
    return hits;
  }

  givePointsAll(amount) {
    const n = this.points.giveAll(amount);
    if (n) {
      log.info(`points: ${amount > 0 ? '+' : ''}${amount} to all ${n} viewers`);
      this.broadcastPoints();
    }
    return n;
  }

  nameOf(id) {
    const own = (this.cfg.game.characters || {})[id];
    if (own) return String(own).slice(0, 24);
    if (id === 'gorilla') return this.gorillaName;
    return id === 'vlad' ? this.vladName : Roster.CHARACTERS[id].name;
  }

  labelOf(id) {
    return id === 'gorilla' ? this.gorillaName : Roster.CHARACTERS[id].label || this.nameOf(id);
  }

  /* Swap the left corner's character (setCharacter) or the right one's (setOpponent:
     the gorilla or a roster character). Not while bets are open or a fight is on:
     viewers bet on a name. Nobody stands in both corners at once. A held winner
     screen is cleared, since its banner would name the old one. cfg.game.names is
     what chat, the panel and the overlays read, so the new name follows everywhere. */
  setCharacter(id) {
    if (!Roster.CHARACTERS[id] || id === this.character || id === this.opponent) return false;
    return this.swap('character', 'fighter', id);
  }

  setOpponent(id) {
    if ((id !== 'gorilla' && !Roster.CHARACTERS[id]) || id === this.opponent || id === this.character) return false;
    return this.swap('opponent', 'gorilla', id);
  }

  swap(corner, side, id) {
    if (this.phase === 'voting' || this.phase === 'fight') return false;
    this[corner] = id;
    this.cfg.game.names[side] = this.nameOf(id);
    log.info(`${corner}: ${this.labelOf(id)} (${id})`);
    if (this.phase === 'result') { this.clearTimers(); this.phase = 'idle'; this.endsAt = 0; }
    this.broadcast();
    return true;
  }

  setVoteSeconds(v) {
    this.voteSeconds = clampVote(v);
    this.broadcast();
  }

  setAuto(on) {
    this.autoLoop = !!on;
    if (!this.autoLoop && this.phase === 'pause') { this.phase = 'idle'; this.endsAt = 0; }
    // Switched on while a winner screen is being held: carry on from there; switched
    // off, the screen stays up again.
    if (this.phase === 'result') {
      this.clearTimers();
      if (this.autoLoop) this.later(() => this.finish(), this.cfg.game.resultSeconds * 1000);
    }
    this.broadcast();
  }

  /* ---------- views ---------- */

  tally() {
    const t = { 1: 0, 2: 0, 3: 0, total: this.votes.size };
    for (const v of this.votes.values()) t[v.choice]++;
    return t;
  }

  record(r) {
    this.history.unshift({ round: this.round, at: Date.now(), ...r });
    if (this.history.length > 20) this.history.pop();
  }

  voters() {
    return [...this.votes].map(([key, v]) => ({ key, ...v }));
  }

  snapshot() {
    const t = this.tally();
    return {
      phase: this.phase,
      round: this.round,
      names: this.cfg.game.names,
      character: this.character,
      characters: Object.keys(Roster.CHARACTERS).map(id => ({ id, name: this.nameOf(id), label: Roster.CHARACTERS[id].label })),
      opponent: this.opponent,
      gorilla: this.gorillaName,
      voteSeconds: this.voteSeconds,
      autoLoop: this.autoLoop,
      left: this.left(),
      waiting: this.phase === 'voting' && !this.endsAt,
      minVotes: this.cfg.game.minVotes,
      series: this.seriesNow(),
      votes: { 1: t[1], 2: t[2], 3: t[3] },
      total: t.total,
      // The overlay needs the script (and so the winner) to animate the fight; it
      // is only revealed in text (panel, chat) once the phase reaches 'result'.
      // `elapsed` lets an overlay that connects mid-fight pick up where it is.
      fight: this.phase === 'fight' && this.script
        ? { rounds: this.script.rounds, hits: this.script.hits, reveal: this.script.reveal, elapsed: Date.now() - this.fightAt }
        : null,
      // Final health, for an overlay that connects after the KO.
      hp: this.phase === 'result' && this.script ? this.script.hits.at(-1).hp : null,
      // Rounds won by each side, shown on the result screen and in the panel.
      score: this.phase === 'result' && this.script ? this.script.score : null,
      winner: this.winner,
      right: this.right,
      bets: t[1] + t[2],
      guessed: this.guessed,
      // Biggest moves of the last payout, for the panel and the result screen.
      settled: this.phase === 'result' && this.settled ? {
        paid: this.settled.paid, burned: this.settled.burned,
        won: this.settled.won.slice(0, 20), lost: this.settled.lost.length,
      } : null,
      wins: this.wins,
      history: this.history,
    };
  }

  /* The leaderboard goes to the points overlay (viewers with points), the whole
     table to the panel. */
  broadcastPointsSoon() {
    if (this._pointsSoon) return;
    this._pointsSoon = setTimeout(() => { this._pointsSoon = null; this.broadcastPoints(); }, 300);
  }

  broadcastPoints() {
    this.hub.send({ t: 'points', top: this.points.top(20) }, 'points');
    this.hub.send({ t: 'points', top: this.points.table() }, 'control');
  }

  broadcast() {
    clearTimeout(this._soon); this._soon = null;
    this.hub.send({ t: 'state', session: this.snapshot() });
  }

  /* A vote flood lands hundreds of votes a second; repaint at most ~6 times. */
  broadcastSoon() {
    if (this._soon) return;
    this._soon = setTimeout(() => this.broadcast(), 150);
  }
}
