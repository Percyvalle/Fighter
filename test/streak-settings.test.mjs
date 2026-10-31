import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, writeFileSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import { once } from 'node:events';
import { saveAntiStreak, validateAntiStreak } from '../server/streak-settings.mjs';
import { loadConfig } from '../server/config.mjs';
import { Session } from '../server/session.mjs';

function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'fight-streak-'));
  const path = join(directory, 'config.json');
  const previous = process.env.CONFIG_FILE;
  process.env.CONFIG_FILE = path;
  t.after(() => { if (previous === undefined) delete process.env.CONFIG_FILE; else process.env.CONFIG_FILE = previous; });
  writeFileSync(path, JSON.stringify({ game: { voteSeconds: 45 }, twitch: { enabled: false, clientSecret: 'keep-me' }, kick: { enabled: false } }));
  const cfg = loadConfig();
  const session = new Session({ cfg, hub: { send() {} }, outbox: { announce() {} }, points: {} });
  t.after(() => { clearInterval(session.ticker); session.clearTimers(); clearTimeout(session._soon); });
  return { directory, path, cfg, session };
}

test('streak settings validate percentages without coercion', () => {
  for (const bad of [null, {}, '40,25,10', [0], [100], [NaN], [3.5], ['35'], [true], Array(11).fill(20)]) {
    assert.throws(() => validateAntiStreak(bad), e => e.status === 400);
  }
  assert.deepEqual(validateAntiStreak([]), []);
  assert.deepEqual(validateAntiStreak([35, 15, 3]), [35, 15, 3]);
});

test('Apply persists only antiStreak and a fresh session loads it after restart', t => {
  const { path, cfg, session, directory } = fixture(t);
  session.streak = { side: 'fighter', n: 2 };
  session.setAntiStreak([35, 15, 3]);
  assert.deepEqual(cfg.game.antiStreak, [35, 15, 3]);
  assert.deepEqual(session.snapshot().antiStreak, [35, 15, 3]);
  assert.deepEqual(session.streak, { side: 'fighter', n: 2 });
  const saved = JSON.parse(readFileSync(path, 'utf8'));
  assert.equal(saved.twitch.clientSecret, 'keep-me');
  assert.equal(saved.game.voteSeconds, 45);
  assert.equal(saved.host, undefined); // Don't write the runtime/environment config.
  const fresh = new Session({ cfg: loadConfig(), hub: { send() {} }, outbox: {}, points: {} });
  t.after(() => clearInterval(fresh.ticker));
  assert.deepEqual(fresh.snapshot().antiStreak, [35, 15, 3]);
  assert.ok(!readdirSync(directory).some(name => name.endsWith('.tmp')));
});

test('voting/fight reject changes while idle/result/pause allow them', t => {
  const { path, session } = fixture(t);
  const before = readFileSync(path, 'utf8');
  for (const phase of ['voting', 'fight']) {
    session.phase = phase;
    assert.throws(() => session.setAntiStreak([35, 15, 3]), e => e.status === 409);
    assert.equal(readFileSync(path, 'utf8'), before);
    assert.deepEqual(session.cfg.game.antiStreak, [40, 25, 10]);
  }
  for (const phase of ['idle', 'result', 'pause']) {
    session.phase = phase;
    session.setAntiStreak([35, 15, 3]);
    assert.deepEqual(session.cfg.game.antiStreak, [35, 15, 3]);
  }
});

test('invalid or unreadable configuration cannot change the active rules', t => {
  const { path, session } = fixture(t);
  assert.throws(() => session.setAntiStreak([0]), e => e.status === 400);
  writeFileSync(path, '{broken');
  assert.throws(() => session.setAntiStreak([35, 15, 3]));
  assert.equal(readFileSync(path, 'utf8'), '{broken');
  assert.deepEqual(session.cfg.game.antiStreak, [40, 25, 10]);
});

test('disabled protection persists and separate config loads do not mutate defaults', t => {
  const { path, session } = fixture(t);
  session.setAntiStreak([]);
  assert.deepEqual(loadConfig().game.antiStreak, []);
  writeFileSync(path, '{}');
  assert.deepEqual(loadConfig().game.antiStreak, [40, 25, 10]);
});

test('new config can be created and invalid structures are left intact', t => {
  const { directory } = fixture(t);
  const path = join(directory, 'new', 'config.json');
  process.env.CONFIG_FILE = path;
  saveAntiStreak([35, 15, 3]);
  assert.deepEqual(JSON.parse(readFileSync(path, 'utf8')), { game: { antiStreak: [35, 15, 3] } });
  for (const data of ['null', '[]', '{"game":42}']) {
    writeFileSync(path, data);
    assert.throws(() => saveAntiStreak([35, 15, 3]));
    assert.equal(readFileSync(path, 'utf8'), data);
  }
});

test('HTTP command authenticates, validates, persists, and rejects mid-fight changes', { timeout: 20000 }, async t => {
  const { directory, path } = fixture(t);
  const probe = createServer();
  probe.listen(0, '127.0.0.1'); await once(probe, 'listening');
  const port = probe.address().port;
  await new Promise(resolve => probe.close(resolve));
  const child = spawn(process.execPath, ['server/index.mjs'], {
    env: { ...process.env, CONFIG_FILE: path, PORT: String(port), HOST: '127.0.0.1', NODE_ENV: 'test',
      PUBLIC_URL: `http://127.0.0.1:${port}`, TWITCH_CHANNEL: '?', KICK_CHANNEL: '?', KICK_TRANSPORT: 'ws',
      POINTS_FILE: join(directory, 'points.json'), TOKENS_FILE: join(directory, 'tokens.json'),
      FIGHT_ADMIN_USER: 'test', FIGHT_ADMIN_PASSWORD: 'test-password' },
    stdio: 'pipe', windowsHide: true,
  });
  let output = ''; child.stdout.on('data', d => output += d); child.stderr.on('data', d => output += d);
  t.after(async () => {
    if (child.exitCode === null) { const exited = once(child, 'exit'); child.kill(); await exited; }
  });
  const base = `http://127.0.0.1:${port}`;
  let ready = false;
  for (let i = 0; i < 50; i++) {
    try { if ((await fetch(base + '/healthz', { signal: AbortSignal.timeout(500) })).ok) { ready = true; break; } } catch {}
    if (child.exitCode !== null) break;
    await delay(100);
  }
  assert.ok(ready, output);
  const auth = { authorization: 'Basic ' + Buffer.from('test:test-password').toString('base64') };
  const command = (body, headers = auth) => fetch(base + '/api/cmd', {
    method: 'POST', headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
  assert.equal((await command({ name: 'antiStreak', value: [35, 15, 3] }, {})).status, 401);
  assert.equal((await command({ name: 'antiStreak', value: [0] })).status, 400);
  const applied = await command({ name: 'antiStreak', value: [35, 15, 3] });
  assert.equal(applied.status, 200);
  assert.deepEqual((await applied.json()).session.antiStreak, [35, 15, 3]);
  assert.deepEqual(loadConfig().game.antiStreak, [35, 15, 3]);
  const saved = readFileSync(path, 'utf8');
  await command({ name: 'start' });
  assert.equal((await command({ name: 'antiStreak', value: [] })).status, 409);
  await command({ name: 'go' });
  assert.equal((await command({ name: 'antiStreak', value: [] })).status, 409);
  assert.equal(readFileSync(path, 'utf8'), saved);
  await command({ name: 'skip' });
  assert.equal((await command({ name: 'antiStreak', value: [] })).status, 200);
  assert.deepEqual(loadConfig().game.antiStreak, []);
});
