import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { Script, createContext, runInContext } from 'node:vm';
import test from 'node:test';
import '../public/js/roster.js';

const html = readFileSync(new URL('../public/overlay.html', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const section = (start, end) => {
  const a = html.indexOf(start), b = html.indexOf(end, a);
  assert.ok(a >= 0 && b > a, `missing overlay section: ${start}`);
  return html.slice(a, b);
};

function audioScene(search = '') {
  const scheduled = [], played = [];
  class Audio {
    constructor(src) { this.src = src; this.currentTime = 0; this.listeners = new Map(); }
    cloneNode() { return new Audio(this.src); }
    addEventListener(type, fn) { this.listeners.set(type, fn); }
    removeEventListener(type, fn) { if (this.listeners.get(type) === fn) this.listeners.delete(type); }
    emit(type) { this.listeners.get(type)?.(); }
    play() { played.push(this); return Promise.resolve(); }
    pause() { this.paused = true; }
  }
  const context = createContext({
    Audio, URLSearchParams, location: { search },
    CAST: { fighter: Roster.CHARACTERS.vlad, gorilla: Roster.CHARACTERS.fighter2 },
    TIMING: { contact: 170 },
    other: side => side === 'fighter' ? 'gorilla' : 'fighter',
    later: (fn, ms) => scheduled.push({ fn, ms }),
    pending: [], clearTimeout() {},
    showResult() {}, shake() {}, stopMusic() {}, setPips() {}, playVictory() {},
  });
  runInContext(section('  /* ---------- sound ---------- */', '  /* Fight music:'), context);
  runInContext(section('  function endRound(', '  /**\n   * Play a fight script'), context);
  runInContext(section('  function clearPending()', '  // Restart a CSS animation'), context);
  return { context, scheduled, played };
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
