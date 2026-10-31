import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const isolatedDir = mkdtempSync(join(tmpdir(), 'fight-tests-'));
process.env.POINTS_FILE = join(isolatedDir, 'points.json');

const [{ Points }, { CommandRouter }, { parseIrc }, { readiness }] = await Promise.all([
  import('../server/points.mjs'),
  import('../server/router.mjs'),
  import('../server/adapters/twitch.mjs'),
  import('../server/health.mjs'),
]);
await import('../public/js/fight.js');
const { FightScript } = globalThis;

function rng(seed) {
  let state = seed >>> 0;
  return n => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return Math.floor((state / 0x100000000) * n);
  };
}

test('fight scripts always end in the requested winner with a valid best-of-three score', () => {
  for (let i = 0; i < 100; i++) {
    const winner = i % 2 ? 'fighter' : 'gorilla';
    const script = FightScript.make(winner, rng(i + 1));
    assert.equal(script.winner, winner);
    assert.equal(script.score[winner], 2);
    assert.ok(script.rounds.length === 2 || script.rounds.length === 3);
    assert.equal(script.hits.length, script.rounds.length * 7);
    assert.ok(script.hits.every(hit => hit.hp.fighter >= 0 && hit.hp.gorilla >= 0));
  }
});

test('round openings reveal no information about the requested winner', () => {
  for (let seed = 1; seed <= 500; seed++) {
    const fighter = FightScript.make('fighter', rng(seed));
    const gorilla = FightScript.make('gorilla', rng(seed));
    const opening = script => script.hits.slice(0, 4).map(({ by, dmg, crit, hp }) => ({ by, dmg, crit, hp }));
    assert.deepEqual(opening(fighter), opening(gorilla));
    for (const script of [fighter, gorilla]) {
      for (const round of script.rounds) {
        const hits = script.hits.filter(hit => hit.round === round.n - 1);
        const topNormal = Math.max(...hits.filter(hit => !hit.crit).map(hit => hit.dmg));
        assert.equal(hits.at(-1).by, round.winner);
        assert.equal(hits.at(-1).hp[round.winner === 'fighter' ? 'gorilla' : 'fighter'], 0);
        assert.ok(hits.slice(0, 4).every(hit => hit.hp.fighter >= 35 && hit.hp.gorilla >= 35));
        assert.ok(hits[3].hp.fighter <= 52 && hits[3].hp.gorilla <= 52);
        assert.ok(hits.slice(0, -1).every(hit => hit.hp.fighter > 0 && hit.hp.gorilla > 0));
        assert.ok(hits.every((hit, i) => i < 2 || hits[i - 1].by !== hit.by || hits[i - 2].by !== hit.by));
        assert.ok(hits.filter(hit => hit.crit).length <= 3);
        assert.ok(hits.filter(hit => hit.crit).every(hit => hit.dmg >= topNormal + 4));
      }
    }
  }
});

test('points double a winning stake and wipe a losing stake', () => {
  const points = new Points({ start: 100 });
  points.join('twitch:alice', 'Alice', 'twitch');
  points.join('twitch:bob', 'Bob', 'twitch');

  const result = points.settle(new Map([
    ['twitch:alice', { display: 'Alice', platform: 'twitch', choice: 1 }],
    ['twitch:bob', { display: 'Bob', platform: 'twitch', choice: 2 }],
  ]), 1);

  assert.equal(result.paid, 100);
  assert.equal(result.burned, 100);
  assert.equal(points.balance('twitch:alice'), 200);
  assert.equal(points.balance('twitch:bob'), 0);
  points.save();
});

test('command router enforces phase, roles and one vote per viewer', () => {
  const calls = [];
  const session = {
    phase: 'voting',
    vote(message) { calls.push(['vote', message]); return calls.length === 1 ? 'ok' : 'again'; },
    join(message) { calls.push(['join', message]); },
  };
  const cfg = {
    commands: { prefix: '!', voteRoles: ['mod'] },
    limits: { userBurst: 3, userWindowMs: 10000 },
  };
  const router = new CommandRouter({ cfg, session });
  const base = { key: 'twitch:alice', display: 'Alice', platform: 'twitch', roles: { mod: true } };

  router.handle({ ...base, text: '!1' });
  router.handle({ ...base, text: '!2' });
  router.handle({ ...base, text: '!join' });
  assert.equal(calls.length, 3);
  assert.equal(calls[0][0], 'vote');
  assert.equal(calls[2][0], 'join');
  assert.equal(router.dropped.again, 1);

  router.handle({ ...base, key: 'twitch:bob', text: '!1', roles: {} });
  assert.equal(router.dropped.perms, 1);
});

test('Twitch IRC parser normalizes identity and roles', () => {
  const message = parseIrc('@badges=moderator/1,subscriber/0;display-name=Alice;mod=1;user-id=42 :alice!x PRIVMSG #fight :!1');
  assert.deepEqual(message, {
    userId: '42',
    display: 'Alice',
    text: '!1',
    roles: { broadcaster: false, mod: true, vip: false, sub: true },
  });
  assert.equal(parseIrc(':alice!x JOIN #fight'), null);
});

test('readiness is healthy with no adapters or connected adapters', () => {
  assert.equal(readiness({}).ok, true);
  assert.equal(readiness({ kick: { status: 'connected' } }).ok, true);
  assert.equal(readiness({ kick: { status: 'connecting' } }).ok, false);
  assert.equal(readiness({ kick: { status: 'error', detail: 'not authorized' } }).ready, false);
});
