/* Points: viewers' balances, betting on the fight with !1 / !2 (!3 sits it out).
   A right call doubles the balance, a wrong one wipes it. The start amount (100 by
   default) is given once, when a viewer first lands in the table — by !join or
   their first bet. Wiped by a loss, they stay at 0 and cannot bet (Session.vote
   refuses them) until the streamer grants them points.
   Kept in data/points.json next to the host, so balances survive a restart. Nothing
   but reset() (the panel's «Сбросить очки») ever removes a viewer: a file that
   fails to read is never written over, and points.json.bak keeps the previous
   save to fall back on. */
import { readFileSync, writeFileSync, existsSync, renameSync, copyFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { ROOT } from './config.mjs';
import { logger } from './log.mjs';

const log = logger('points');
// POINTS_FILE lets a test host keep its own balances away from the real ones.
const FILE = process.env.POINTS_FILE || resolve(ROOT, 'data', 'points.json');
const BAK = FILE + '.bak';

export class Points {
  constructor({ start = 100 } = {}) {
    this.start = start;
    this.players = new Map();     // key -> { display, platform, points, wins, losses, best }
    this.load();
  }

  load() {
    for (const f of [FILE, BAK]) {
      if (!existsSync(f)) continue;
      try {
        const data = JSON.parse(readFileSync(f, 'utf8'));
        for (const [k, p] of Object.entries(data.players || {})) this.players.set(k, p);
        log.info(`loaded ${this.players.size} viewer balance(s)${f === BAK ? ' from points.json.bak' : ''}`);
        return;
      } catch (e) {
        log.error(`${f === BAK ? 'points.json.bak' : 'points.json'} is unreadable: ${e.message}`);
        // Keep the broken file for a look by hand; never write over it.
        if (f === FILE) try { copyFileSync(FILE, `${FILE}.broken-${Date.now()}`); } catch {}
      }
    }
    if (existsSync(FILE)) {
      // Neither copy reads: refuse to save, or the first bet would wipe the table.
      this.readOnly = true;
      log.error('points are NOT saved until points.json is fixed and the host restarted');
    }
  }

  save() {
    if (this.readOnly) return;
    clearTimeout(this._saveTimer); this._saveTimer = null;
    // Write-then-rename, so a crash mid-write never leaves a half file behind; the
    // last good file becomes points.json.bak first.
    const tmp = FILE + '.tmp';
    try {
      mkdirSync(dirname(FILE), { recursive: true });
      writeFileSync(tmp, JSON.stringify({ version: 1, start: this.start, players: Object.fromEntries(this.players) }, null, 1));
      if (existsSync(FILE)) copyFileSync(FILE, BAK);
      renameSync(tmp, FILE);
    } catch (e) {
      log.error(`cannot save points.json: ${e.message}`);
    }
  }

  balance(key) { return this.players.get(key)?.points ?? 0; }

  /**
   * Settle a fight. `votes`: Map key -> { display, platform, choice } (1, 2 or 3);
   * `side`: the winning choice (1 or 2). Returns what changed, for chat and the panel.
   */
  settle(votes, side) {
    const won = [], lost = [];
    for (const [key, v] of votes) {
      if (v.choice !== 1 && v.choice !== 2) continue;        // !3: no bet, no change
      // Bets put viewers in the table at once (Session.vote), so a missing one is a
      // table wiped mid-fight: they start over with the start amount.
      const p = this.players.get(key) || { display: v.display, platform: v.platform, points: this.start, wins: 0, losses: 0, best: this.start };
      p.display = v.display; p.platform = v.platform;          // keep the latest nickname
      const stake = p.points;
      if (stake <= 0) { this.players.set(key, p); continue; }  // nothing to stake
      if (v.choice === side) {
        p.points = stake * 2; p.wins++;
        p.best = Math.max(p.best || 0, p.points);
        won.push({ key, display: p.display, before: stake, after: p.points });
      } else {
        p.points = 0; p.losses++;
        lost.push({ key, display: p.display, before: stake, after: 0 });
      }
      this.players.set(key, p);
    }
    if (won.length || lost.length) this.save();
    return {
      won, lost,
      paid: won.reduce((a, w) => a + (w.after - w.before), 0),
      burned: lost.reduce((a, l) => a + l.before, 0),
    };
  }

  /* !join: put a viewer in the table (with the start balance) without a bet, so
     the streamer can grant them points. Already there: just refresh the nickname. */
  join(key, display, platform) {
    const p = this.players.get(key);
    if (p) { p.display = display; p.platform = platform; return false; }
    this.players.set(key, { display, platform, points: this.start, wins: 0, losses: 0, best: this.start });
    this.saveSoon();
    return true;
  }

  /* A vote flood adds hundreds of viewers a second: write the file once for them. */
  saveSoon() {
    if (this._saveTimer) return;
    this._saveTimer = setTimeout(() => { this._saveTimer = null; this.save(); }, 1000);
  }

  /* Viewers matching a nickname (any platform, case-insensitive, a leading @
     ignored) or an exact key such as "kick:123". */
  find(nick) {
    const q = String(nick || '').trim().replace(/^@/, '').toLowerCase();
    if (!q) return [];
    return [...this.players].filter(([key, p]) => key.toLowerCase() === q || String(p.display || '').toLowerCase() === q);
  }

  /* Streamer's grant: `amount` points to one viewer (negative takes them away,
     never below 0). Only viewers who have bet before are known, so an unknown
     nickname changes nothing and returns []. */
  give(nick, amount) {
    const hits = this.find(nick);
    for (const [, p] of hits) this.adjust(p, amount);
    if (hits.length) this.save();
    return hits.map(([key, p]) => ({ key, display: p.display, platform: p.platform, points: p.points }));
  }

  /* The same for everyone in the table, wiped balances included. */
  giveAll(amount) {
    for (const p of this.players.values()) this.adjust(p, amount);
    if (this.players.size) this.save();
    return this.players.size;
  }

  adjust(p, amount) {
    p.points = Math.max(0, (p.points || 0) + amount);
    p.best = Math.max(p.best || 0, p.points);
  }

  /* Leaderboard for the OBS overlay: only viewers who have points. */
  top(n = 10) {
    return this.table(n, true);
  }

  /* Everyone in the table, the panel's view: zero balances too (joined, or wiped),
     so the streamer sees who to grant points to. */
  table(n = Infinity, onlyWithPoints = false) {
    return [...this.players].map(([key, p]) => ({ key, ...p }))
      .filter(p => !onlyWithPoints || p.points > 0)
      .sort((a, b) => b.points - a.points || b.wins - a.wins || String(a.display).localeCompare(String(b.display)))
      .slice(0, n);
  }

  reset() {
    this.players.clear();
    this.save();
    log.info('all balances reset');
  }
}
