/* CommandRouter: turns chat votes (!1 / !2 / !3) into session votes, enforcing
   roles and rate limits, and !join into a place in the points table. Chat does
   nothing else; the round is driven from the panel. */

class Buckets {
  constructor(burst, windowMs) { this.burst = burst; this.windowMs = windowMs; this.m = new Map(); }
  take(key) {
    const now = Date.now();
    let b = this.m.get(key);
    if (!b || now - b.t0 >= this.windowMs) { b = { t0: now, n: 0 }; this.m.set(key, b); }
    if (b.n >= this.burst) return false;
    b.n++;
    if (this.m.size > 5000) for (const [k, v] of this.m) if (now - v.t0 > this.windowMs) this.m.delete(k);
    return true;
  }
}

export class CommandRouter {
  constructor({ cfg, session }) {
    this.cfg = cfg; this.session = session;
    this.buckets = new Buckets(cfg.limits.userBurst, cfg.limits.userWindowMs);
    this.dropped = { rateUser: 0, phase: 0, perms: 0, again: 0, broke: 0 };
  }

  allowed(roles, allow) {
    if (!allow || allow.includes('everyone')) return true;
    return allow.some(r => roles[r]);
  }

  handle(m) {
    const C = this.cfg.commands;
    const text = m.text.toLowerCase();
    if (!text.startsWith(C.prefix)) return;
    const body = text.slice(C.prefix.length).trim();
    if (!body) return;
    const [verb] = body.split(/\s+/);

    // !1 / !2 / !3 — only the exact command, so "!1000" or "!2x" is not a vote
    if (verb === '1' || verb === '2' || verb === '3') {
      if (!this.allowed(m.roles, C.voteRoles)) { this.dropped.perms++; return; }
      if (this.session.phase !== 'voting') { this.dropped.phase++; return; }
      if (!this.buckets.take(m.key)) { this.dropped.rateUser++; return; }
      // refused: a second bet in the same fight, or no points to stake
      const r = this.session.vote({ key: m.key, display: m.display, platform: m.platform, choice: +verb });
      if (r in this.dropped) this.dropped[r]++;
      return;
    }

    // !join — into the points table with no bet, at any time
    if (verb === 'join') {
      if (!this.buckets.take(m.key)) { this.dropped.rateUser++; return; }
      this.session.join({ key: m.key, display: m.display, platform: m.platform });
    }
  }
}
