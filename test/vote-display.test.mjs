import assert from 'node:assert/strict';
import test from 'node:test';
import { voteDisplay } from '../server/vote-display.mjs';

test('overlay keeps only recent names while counting every vote', () => {
  const votes = new Map();
  for (let i = 0; i < 120; i++) {
    votes.set(`kick:${i}`, { display: `viewer${i}`, platform: 'kick', choice: i % 5 < 3 ? 1 : 2 });
  }
  votes.set('twitch:skip', { display: 'skipper', platform: 'twitch', choice: 3 });

  const display = voteDisplay(votes);
  assert.equal(display.recent[1].length, 6);
  assert.equal(display.recent[2].length, 6);
  assert.deepEqual(display.platforms, { twitch: 0, kick: 120 });
  assert.equal(display.recent[1].at(-1).display, 'viewer117');
  assert.equal(display.recent[2].at(-1).display, 'viewer119');
  assert.ok(display.recent[1].every(v => v.platform === 'kick'));
});

test('platform counts include both sides but not abstentions', () => {
  const votes = new Map([
    ['a', { display: 'Alice', platform: 'twitch', choice: 1 }],
    ['b', { display: 'Bob', platform: 'kick', choice: 2 }],
    ['c', { display: 'Cora', platform: 'kick', choice: 3 }],
  ]);
  assert.deepEqual(voteDisplay(votes).platforms, { twitch: 1, kick: 1 });
});
