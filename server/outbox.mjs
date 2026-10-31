/* Chat replies. Never per-vote — a busy chat would flood itself and burn the
   platform rate limits. Only round announcements, queued and paced. */
import { logger } from './log.mjs';

const log = logger('outbox');

const pct = (a, b) => b ? Math.round(a / b * 100) : 0;

const TEXT = {
  voteOpen: d => (d.series ? `Бой ${d.series.n}/${d.series.total}. ` : '') + `🥊 ${d.names.fighter} против ${d.names.gorilla}! Ставки: !1 — ${d.names.fighter}, !2 — ${d.names.gorilla}, !3 — без ставки. Выбор один раз, поменять нельзя. Угадал — очки ×2, не угадал — все очки сгорают. `
    + (d.min > 0 ? `Отсчёт ${d.seconds} с пойдёт, как наберётся голосов: ${d.min}.` : `Голосование ${d.seconds} с.`),
  voteClosing: d => `🥊 ${d.seconds} с до боя — голосов: ${d.total}. Успевайте !1 / !2`,
  fight: d => `🥊 FIGHT! ${d.names.fighter} ${d.v1} : ${d.v2} ${d.names.gorilla}`,
  win: d => `🏆 Победил ${d.name} со счётом ${d.rounds}! ` + (d.bets
    ? `Угадали ${d.right} из ${d.bets} (${pct(d.right, d.bets)}%): +${d.paid} очков, сгорело ${d.burned}.`
    : 'Ставок не было.'),
  seriesEnd: d => `🏁 Серия из ${d.total} боёв окончена! Итоги — в таблице очков.`,
  guessed: d => `🎯 Угадали: ${d.list.join(', ')}${d.more ? ` и ещё ${d.more}` : ''}`,
};

/* Which announcements each verbosity level lets through. */
const LEVELS = {
  off: [],
  minimal: ['voteOpen', 'win', 'seriesEnd'],
  verbose: Object.keys(TEXT),
};

export class Outbox {
  constructor({ cfg }) {
    this.cfg = cfg;
    this.adapters = new Map();        // platform -> adapter with .say(text)
    this.queue = [];
    this.timer = null;
    this.sentWindow = [];             // timestamps, for the shared pacing guard
  }

  register(platform, adapter) { this.adapters.set(platform, adapter); }

  announce(kind, data) {
    const allow = LEVELS[this.cfg.replies] || LEVELS.minimal;
    if (!allow.includes(kind)) return;
    const render = TEXT[kind];
    if (!render) return;
    let text;
    try { text = render(data || {}); } catch (e) { return log.warn(`cannot render ${kind}: ${e.message}`); }
    for (const platform of this.adapters.keys()) this.queue.push({ platform, text });
    this.drain();
  }

  say(platform, text) { this.queue.push({ platform, text }); this.drain(); }

  drain() {
    if (this.timer) return;
    const step = () => {
      // Twitch allows ~20 messages per 30s for a non-mod account; stay far under.
      const now = Date.now();
      this.sentWindow = this.sentWindow.filter(t => now - t < 30000);
      if (!this.queue.length || this.sentWindow.length >= 12) {
        this.timer = null;
        if (this.queue.length) this.timer = setTimeout(step, 2000);
        return;
      }
      const item = this.queue.shift();
      const a = this.adapters.get(item.platform);
      if (a && a.canSay && a.canSay()) {
        this.sentWindow.push(now);
        Promise.resolve(a.say(item.text)).catch(e => log.warn(`${item.platform} send failed: ${e.message}`));
      } else if (a) {
        log.debug(`${item.platform}: reply skipped (no write access)`);
      }
      this.timer = setTimeout(step, 1200);
    };
    this.timer = setTimeout(step, 50);
  }
}
