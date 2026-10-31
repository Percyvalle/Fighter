import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import '../public/js/roster.js';
import '../public/js/fight-media.js';
import { Session } from '../server/session.mjs';

const html = readFileSync(new URL('../public/overlay.html', import.meta.url), 'utf8');
const animationCode = html.slice(html.indexOf('  function attackStart('), html.indexOf('  /* ---------- sound ---------- */'));

function animationScene() {
  const makeClip = () => ({ currentTime: 0, duration: 1, pause() { this.paused = true; },
    play() { this.paused = false; return Promise.resolve(); } });
  const makeCorner = () => {
    const classes = new Set();
    return { classList: { add: (...args) => args.forEach(c => classes.add(c)),
      remove: (...args) => args.forEach(c => classes.delete(c)), contains: c => classes.has(c) } };
  };
  const makeAnim = () => ({ ready: true, cls: 'punching', attack: makeClip(),
    crit: { cls: 'kicking', attack: makeClip() }, defeat: makeClip(), victory: makeClip() });
  const ANIM = { fighter: makeAnim(), gorilla: makeAnim() };
  const els = { fighter: makeCorner(), gorilla: makeCorner() };
  const context = createContext({ ANIM, els, performance: { now: () => 0 },
    clipFor: h => h.crit ? ANIM[h.by].crit : ANIM[h.by] });
  runInContext(animationCode, context);
  return { context, ANIM, els };
}

test('defeat stops only the loser and leaves the winner finishing their attack', async () => {
  const s = animationScene();
  runInContext(`attackStart({by: 'gorilla', crit: true})`, s.context);
  await Promise.resolve();
  assert.equal(s.ANIM.gorilla.crit.attack.paused, false);
  runInContext(`playDefeat('fighter')`, s.context);
  await Promise.resolve();
  assert.equal(s.ANIM.gorilla.crit.attack.paused, false);
  assert.ok(s.els.gorilla.classList.contains('kicking'));
  assert.ok(s.els.fighter.classList.contains('losing'));
});

test('a new attack removes the previous clip and cancellation invalidates pending play', async () => {
  const s = animationScene();
  runInContext(`attackStart({by: 'fighter'})`, s.context);
  await Promise.resolve();
  assert.ok(s.els.fighter.classList.contains('punching'));
  runInContext(`attackStart({by: 'fighter', crit: true})`, s.context);
  await Promise.resolve();
  assert.ok(!s.els.fighter.classList.contains('punching'));
  assert.ok(s.els.fighter.classList.contains('kicking'));
  runInContext(`attackStart({by: 'fighter'}); attackStop()`, s.context);
  await Promise.resolve();
  assert.ok(!s.els.fighter.classList.contains('punching'));
});

test('late-joining an attack starts at its elapsed frame', async () => {
  const s = animationScene();
  runInContext(`attackStart({by: 'fighter'}, 250)`, s.context);
  await Promise.resolve();
  assert.equal(s.ANIM.fighter.attack.currentTime, 0.25);
});

test('cancelling a pending defeat or victory cannot restore their CSS state', async () => {
  for (const action of [`playDefeat('fighter')`, `playVictory('gorilla')`]) {
    const s = animationScene();
    runInContext(`${action}; attackStop(); defeatStop()`, s.context);
    await Promise.resolve();
    assert.ok(!s.els.fighter.classList.contains('losing'));
    assert.ok(!s.els.gorilla.classList.contains('cheering'));
  }
});

test('joining during a dash keeps the original impact time', () => {
  const tasks = [], hp = [];
  const classes = () => ({ add() {}, remove() {}, toggle() {} });
  const context = createContext({
    TIMING: { contact: 170, recover: 430, recoverCrit: 650 },
    els: { fighter: { classList: classes() }, gorilla: { classList: classes() }, impact: { classList: classes() } },
    other: side => side === 'fighter' ? 'gorilla' : 'fighter',
    later: (fn, ms) => tasks.push({ fn, ms }),
    setHP: (side, value) => hp.push([side, value]), popDamage() {}, shake() {}, retrigger() {},
  });
  const code = html.slice(html.indexOf('  function blow('), html.indexOf('  const ROUND_SECONDS'));
  runInContext(code, context);
  runInContext(`blow({by:'fighter',hp:{fighter:100,gorilla:80},dmg:20}, false, 150)`, context);
  assert.equal(hp.length, 0);
  assert.equal(tasks[0].ms, 20);
  tasks[0].fn();
  assert.deepEqual(hp, [['fighter', 100], ['gorilla', 80]]);
});

test('every active roster sound has a measured duration and attack anchor', () => {
  for (const c of Object.values(Roster.CHARACTERS)) {
    for (const [kind, sounds] of Object.entries(c.sfx || {})) {
      for (const src of [sounds].flat()) {
        const timing = FightMedia.cue(src);
        assert.ok(timing.durationMs > 0, `missing duration for ${src}`);
        if (kind === 'punch' || kind === 'crit') {
          assert.ok(timing.peakMs >= 0 && timing.peakMs < timing.durationMs, `missing anchor for ${src}`);
        }
      }
    }
  }
});

test('auto-loop budgets the whole Vlad defeat and gorilla victory, in both corners', () => {
  const script = { winner: 'gorilla', reveal: 1700,
    hits: [{ at: 1000, by: 'gorilla', crit: true, ko: true }] };
  const hold = FightMedia.resultHoldMs(script, 'vlad', 'gorilla');
  assert.ok(hold > 8500 && hold < 9000, `unexpected hold ${hold}`);
  assert.equal(Session.prototype.resultHoldMs.call({ script, character: 'vlad', opponent: 'gorilla',
    cfg: { game: { resultSeconds: 6 } } }), hold);
  assert.equal(Session.prototype.resultHoldMs.call({ script, character: 'vlad', opponent: 'gorilla',
    cfg: { game: { resultSeconds: 15 } } }), 15000);
  const reverse = { ...script, winner: 'fighter', hits: [{ ...script.hits[0], by: 'fighter' }] };
  assert.equal(FightMedia.resultHoldMs(reverse, 'gorilla', 'vlad'), hold);
});
