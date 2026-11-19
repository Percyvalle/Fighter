import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Session } from '../server/session.mjs';
import { loadConfig } from '../server/config.mjs';
import { validateArena } from '../server/arena-settings.mjs';

function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'fight-arena-'));
  const path = join(directory, 'config.json');
  const previous = process.env.CONFIG_FILE;
  process.env.CONFIG_FILE = path;
  t.after(() => {
    if (previous === undefined) delete process.env.CONFIG_FILE;
    else process.env.CONFIG_FILE = previous;
  });
  writeFileSync(path, JSON.stringify({ game: { voteSeconds: 45 }, twitch: { clientSecret: 'preserve' } }));
  const session = new Session({ cfg: loadConfig(), hub: { send() {} }, outbox: {}, points: {} });
  t.after(() => { clearInterval(session.ticker); session.clearTimers(); clearTimeout(session._soon); });
  return { path, session };
}

test('arena selection persists without overwriting other configuration and survives restart', t => {
  const { path, session } = fixture(t);
  assert.equal(session.snapshot().arena, 'temple');
  assert.ok(session.snapshot().arenas.some(a => a.id === 'sunset'));
  session.setArena('sunset');
  const saved = JSON.parse(readFileSync(path, 'utf8'));
  assert.equal(saved.game.arena, 'sunset');
  assert.equal(saved.game.voteSeconds, 45);
  assert.equal(saved.twitch.clientSecret, 'preserve');
  const fresh = new Session({ cfg: loadConfig(), hub: {}, outbox: {}, points: {} });
  t.after(() => clearInterval(fresh.ticker));
  assert.equal(fresh.snapshot().arena, 'sunset');
  session.setArena('temple');
  assert.equal(loadConfig().game.arena, 'temple');
});

test('invalid arenas and mid-fight changes cannot alter saved or active selection', t => {
  const { path, session } = fixture(t);
  const before = readFileSync(path, 'utf8');
  for (const value of [null, {}, 'constructor', '__proto__', '../bg.jpg', 'missing']) {
    assert.throws(() => validateArena(value), e => e.status === 400);
  }
  for (const phase of ['voting', 'fight']) {
    session.phase = phase;
    assert.throws(() => session.setArena('sunset'), e => e.status === 409);
    assert.equal(session.arena, 'temple');
    assert.equal(readFileSync(path, 'utf8'), before);
  }
  session.phase = 'result';
  session.setArena('sunset');
  assert.equal(session.phase, 'result');
  assert.equal(session.arena, 'sunset');
});

test('failed save leaves current arena intact and unknown configured arenas fall back safely', t => {
  const { path, session } = fixture(t);
  writeFileSync(path, '{broken');
  assert.throws(() => session.setArena('sunset'));
  assert.equal(session.arena, 'temple');
  assert.equal(readFileSync(path, 'utf8'), '{broken');
  writeFileSync(path, '{"game":{"arena":"constructor"}}');
  const fresh = new Session({ cfg: loadConfig(), hub: {}, outbox: {}, points: {} });
  t.after(() => clearInterval(fresh.ticker));
  assert.equal(fresh.arena, 'temple');
});
