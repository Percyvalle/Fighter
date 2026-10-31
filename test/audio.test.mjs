import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { Script, createContext, runInContext } from 'node:vm';
import test from 'node:test';
import '../public/js/roster.js';
import '../public/js/fight-media.js';

const html = readFileSync(new URL('../public/overlay.html', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const section = (start, end) => {
  const a = html.indexOf(start), b = html.indexOf(end, a);
  assert.ok(a >= 0 && b > a, `missing overlay section: ${start}`);
  return html.slice(a, b);
};

function audioScene(search = '', autoEnd = false) {
  const scheduled = [], played = [], victories = [];
  let now = 0;
  const later = (fn, ms) => scheduled.push({ fn, ms, due: now + ms });
  class Audio {
    constructor(src) { this.src = src; this.currentTime = 0; this.listeners = new Map(); this.playbackRate = 1; }
    cloneNode() { return new Audio(this.src); }
    addEventListener(type, fn) { this.listeners.set(type, fn); }
    removeEventListener(type, fn) { if (this.listeners.get(type) === fn) this.listeners.delete(type); }
    emit(type) { this.listeners.get(type)?.(); }
    play() {
      this.startedAt = now;
      played.push(this);
      if (autoEnd) later(() => { if (!this.paused) this.emit('ended'); }, FightMedia.cue(this.src).durationMs / this.playbackRate);
      return Promise.resolve();
    }
    pause() { this.paused = true; }
  }
  const context = createContext({
    Audio, URLSearchParams, location: { search }, FightMedia, Roster,
    CAST: { fighter: Roster.CHARACTERS.vlad, gorilla: Roster.CHARACTERS.fighter2 },
    TIMING: { contact: 170 },
    other: side => side === 'fighter' ? 'gorilla' : 'fighter',
    later,
    pending: [], clearTimeout() {},
    showResult() {}, shake() {}, stopMusic() {}, setPips() {},
    playVictory(side) { victories.push({ side, startedAt: now }); }, duckMusic() {},
  });
  context.characterId = side => Object.entries(Roster.CHARACTERS)
    .find(([, character]) => character === context.CAST[side])?.[0] || 'gorilla';
  runInContext(section('  /* ---------- sound ---------- */', '  /* Fight music:'), context);
  runInContext(section('  function endRound(', '  /**\n   * Play a fight script'), context);
  runInContext(section('  function clearPending()', '  // Restart a CSS animation'), context);
  function advanceTo(target) {
    for (;;) {
      const task = scheduled.filter(t => !t.ran && t.due <= target).sort((a, b) => a.due - b.due)[0];
      if (!task) break;
      now = task.due;
      task.ran = true;
      task.fn();
    }
    now = target;
  }
  return { context, scheduled, played, victories, advanceTo };
}

// Advance short scheduled actions; the 15s stalled-audio fallback is explicit.
function advance(scene) {
  for (const task of scene.scheduled) {
    if (!task.ran && task.ms < 15000) { task.ran = true; task.fn(); }
  }
}

test('Vlad has playable assets for every sound category', () => {
  const sfx = Roster.CHARACTERS.vlad.sfx;
  for (const field of ['punch', 'hurt', 'win', 'lose', 'crit']) {
    for (const path of [sfx[field]].flat()) {
      const url = new URL(`../public/${path}`, import.meta.url);
      assert.ok(existsSync(url), `missing ${path}`);
      const header = readFileSync(url);
      if (path.endsWith('.mp3')) assert.equal(header.subarray(0, 3).toString(), 'ID3');
      else assert.equal(header.subarray(0, 4).toString(), 'OggS');
    }
  }
});

test('final result schedules victory and defeat reactions for the correct corners', () => {
  const scene = audioScene();
  runInContext('endRound({winner: "gorilla", score: {}}, true, {})', scene.context);
  advance(scene);
  assert.ok(scene.played.some(a => a.src === 'assets/sfx/vlad-defeat.ogg'));
  assert.ok(!scene.played.some(a => a.src === 'assets/sfx/vlad-win.ogg'));

  const victory = audioScene();
  runInContext('endRound({winner: "fighter", score: {}}, true, {})', victory.context);
  advance(victory);
  assert.ok(victory.played.some(a => a.src === 'assets/sfx/vlad-win.ogg'));
  assert.ok(!victory.played.some(a => a.src === 'assets/sfx/vlad-defeat.ogg'));
});

test('Vlad sounds follow him into the right corner', () => {
  const scene = audioScene();
  runInContext('CAST.gorilla = CAST.fighter; preloadVoice("gorilla"); endRound({winner: "gorilla", score: {}}, true, {})', scene.context);
  advance(scene);
  scene.played[0].emit('ended');
  advance(scene);
  assert.ok(scene.played.some(a => a.src === 'assets/sfx/vlad-win.ogg'));
});

test('Paver uses the gorilla-specific victory line only against the gorilla', () => {
  for (const paver of ['fighter2', 'fighter3']) {
    for (const [opponent, expected] of [
      ['gorilla', 'paver-win-2.ogg'],
      ['vlad', 'paver-win-1.ogg'],
      ['fighter2', 'paver-win-1.ogg'],
    ]) {
      if (paver === opponent) continue;
      const scene = audioScene('', true);
      runInContext(`
        CAST.fighter = Roster.CHARACTERS[${JSON.stringify(paver)}];
        CAST.gorilla = Roster.CHARACTERS[${JSON.stringify(opponent)}] || null;
        preloadVoice('fighter'); preloadVoice('gorilla');
        playResultVoices('fighter');
      `, scene.context);
      scene.advanceTo(10000);
      assert.ok(scene.played.some(a => a.src === `assets/sfx/${expected}`), `${paver} vs ${opponent}`);
      assert.ok(!scene.played.some(a => /paver-win-/.test(a.src) && !a.src.endsWith(expected)));
    }
  }
});

test('mute suppresses reactions and cancellation stops a playing reaction', () => {
  const muted = audioScene('?mute=1');
  runInContext('endRound({winner: "fighter", score: {}}, true, {})', muted.context);
  assert.equal(muted.scheduled.length, 0);
  const scene = audioScene();
  runInContext('playVoice(VOICE.fighter.crit.cloneNode(), 0.95, 0)', scene.context);
  scene.scheduled[0].fn();
  runInContext('clearPending()', scene.context);
  assert.equal(scene.played[0].paused, true);
  assert.equal(scene.played[0].currentTime, 0);
});

test('overlay inline scripts have valid syntax', () => {
  for (const match of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)) {
    new Script(match[1]);
  }
});

test('loser finishes before winner speaks, with a 250ms gap', () => {
  const scene = audioScene();
  runInContext('endRound({winner: "gorilla", score: {}}, true, {})', scene.context);
  advance(scene);
  assert.equal(scene.played.length, 1);
  assert.equal(scene.played[0].src, 'assets/sfx/vlad-defeat.ogg');
  scene.played[0].emit('ended');
  assert.equal(scene.played.length, 1);
  assert.equal(scene.scheduled.at(-1).ms, 250);
  advance(scene);
  assert.equal(scene.played.length, 2);
  assert.match(scene.played[1].src, /paver-win-/);
  assert.equal(scene.played[0].paused, true);
});

test('gorilla victory roar also waits for the loser', () => {
  const scene = audioScene();
  runInContext('CAST.gorilla = null; preloadVoice("gorilla"); endRound({winner: "gorilla", score: {}}, true, {})', scene.context);
  advance(scene);
  assert.equal(scene.played.length, 1);
  scene.played[0].emit('ended');
  advance(scene);
  assert.equal(scene.played[1].src, 'assets/sfx/gorilla-win.ogg');
});

test('cancelling during defeat or the gap cannot start the winner later', () => {
  for (const inGap of [false, true]) {
    const scene = audioScene();
    runInContext('endRound({winner: "gorilla", score: {}}, true, {})', scene.context);
    advance(scene);
    if (inGap) scene.played[0].emit('ended');
    runInContext('clearPending()', scene.context);
    scene.played[0].emit('ended');
    for (const task of scene.scheduled) if (!task.ran) { task.ran = true; task.fn(); }
    assert.equal(scene.played.length, 1);
  }
});

test('failed or stalled defeat audio advances the queue once', () => {
  for (const failed of [true, false]) {
    const scene = audioScene();
    runInContext('endRound({winner: "gorilla", score: {}}, true, {})', scene.context);
    advance(scene);
    if (failed) scene.played[0].emit('error');
    scene.scheduled.find(task => task.ms === 15000).fn();
    advance(scene);
    assert.equal(scene.played.length, 2);
    assert.equal(scene.played[0].paused, true);
  }
});

test('all three Vlad attack accents align to contact without changing voice speed', () => {
  const scene = audioScene('', true);
  const sources = Roster.CHARACTERS.vlad.sfx.punch;
  assert.equal(sources.length, 3);
  for (const i of sources.keys()) {
    runInContext(`
      Math.random = () => (${i} + 0.5) / ${sources.length};
      schedulePunch({by: 'fighter', ko: ${i === sources.length - 1}}, (fn, ms) => later(fn, ms + ${i * 2000}));
    `, scene.context);
  }
  scene.advanceTo(6000);
  const attacks = scene.played.filter(a => /vlad-attack-/.test(a.src));
  assert.deepEqual(attacks.map(a => a.src), sources);
  for (const [i, a] of attacks.entries()) {
    assert.equal(a.playbackRate, 1);
    assert.equal(a.preservesPitch, true);
    assert.equal(a.startedAt + FightMedia.cue(a.src).peakMs, 170 + i * 2000);
  }
  assert.ok(scene.scheduled.some(t => t.ms < 0), 'late accents must be allowed to start before the dash');
});

test('Vlad crit uses one spoken line anchored independently of the video', () => {
  const scene = audioScene('', true);
  runInContext(`Math.random = () => 0.99; schedulePunch({by: 'fighter', crit: true}, (fn, ms) => later(fn, ms + 1000))`, scene.context);
  scene.advanceTo(4000);
  const crit = scene.played.find(a => /vlad-crit-complete/.test(a.src));
  assert.ok(crit);
  assert.equal(crit.startedAt + FightMedia.cue(crit.src).peakMs, 1170);
  assert.ok(!scene.played.some(a => /vlad-attack-/.test(a.src)));
});

test('final hurt finishes intact before defeat and victory, including the gap', () => {
  const scene = audioScene('', true);
  runInContext(`
    playVoice(clip('assets/sfx/vlad-hurt-7.ogg'), 0.5, 0);
  `, scene.context);
  scene.advanceTo(470);
  runInContext(`playResultVoices('gorilla')`, scene.context);
  scene.advanceTo(918);
  assert.equal(scene.played.length, 1);
  assert.notEqual(scene.played[0].paused, true);
  scene.advanceTo(1019);
  const defeat = scene.played.find(a => /vlad-defeat/.test(a.src));
  assert.equal(defeat.startedAt, 1019);
  scene.advanceTo(4358);
  const win = scene.played.find(a => /paver-win/.test(a.src));
  assert.equal(win.startedAt, 1019 + 3089 + 250);
});

test('cancelling while waiting for final hurt cannot launch result voices', () => {
  const scene = audioScene('', true);
  runInContext(`playVoice(clip('assets/sfx/vlad-hurt-7.ogg'), 0.5, 0)`, scene.context);
  scene.advanceTo(100);
  runInContext(`playResultVoices('gorilla'); clearPending()`, scene.context);
  scene.advanceTo(20000);
  assert.equal(scene.played.length, 1);
  assert.equal(scene.played[0].paused, true);
});

test('cancellation also stops punch effects, not just character reactions', () => {
  const scene = audioScene();
  runInContext(`schedulePunch({by: 'gorilla'}, later)`, scene.context);
  advance(scene);
  const punch = scene.played.find(a => /paver-punch/.test(a.src));
  assert.ok(punch);
  runInContext(`clearPending()`, scene.context);
  assert.equal(punch.paused, true);
});

test('all character pairs finish KO voices and celebrations within the host hold', () => {
  const characters = Object.keys(Roster.CHARACTERS);
  for (const left of characters) for (const right of [...characters, 'gorilla']) {
    if (left === right) continue;
    for (const winner of ['fighter', 'gorilla']) for (const crit of [false, true]) {
      const scene = audioScene('', true);
      const hit = { at: 1000, by: winner, crit, ko: true };
      const script = { winner, reveal: 1700, hits: [hit] };
      runInContext(`
        CAST.fighter = Roster.CHARACTERS[${JSON.stringify(left)}];
        CAST.gorilla = Roster.CHARACTERS[${JSON.stringify(right)}] || null;
        preloadVoice('fighter'); preloadVoice('gorilla');
        schedulePunch(${JSON.stringify(hit)}, (fn, ms) => later(fn, ms + 1000));
      `, scene.context);
      scene.advanceTo(script.reveal);
      runInContext(`playResultVoices(${JSON.stringify(winner)})`, scene.context);
      const deadline = script.reveal + Math.max(6000, FightMedia.resultHoldMs(script, left, right));
      scene.advanceTo(deadline);
      const label = `${left}/${right}, winner=${winner}, crit=${crit}`;
      assert.ok(scene.played.every(a => a.paused), `audio still playing: ${label}`);
      assert.equal(scene.victories.length, 1, `missing celebration: ${label}`);
      if (right === 'gorilla' && winner === 'gorilla') {
        assert.ok(scene.victories[0].startedAt + 4084 <= deadline, `victory video cut: ${label}`);
      }
    }
  }
});
