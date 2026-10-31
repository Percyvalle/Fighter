import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { isPublicRoute, validBasicAuth } from '../server/access.mjs';

test('OBS resources are public, control requests require authentication', () => {
  for (const path of ['/overlay.html', '/points.html', '/assets/bg.jpg', '/js/fight.js', '/healthz']) {
    assert.equal(isPublicRoute('GET', path), true);
  }
  assert.equal(isPublicRoute('GET', '/events', 'overlay'), true);
  assert.equal(isPublicRoute('GET', '/events', 'points'), true);
  assert.equal(isPublicRoute('GET', '/events', 'control'), false);
  assert.equal(isPublicRoute('GET', '/events'), false);
  assert.equal(isPublicRoute('GET', '/'), false);
  assert.equal(isPublicRoute('GET', '/control.html'), false);
  assert.equal(isPublicRoute('GET', '/api/state'), false);
  assert.equal(isPublicRoute('POST', '/api/cmd'), false);
  assert.equal(isPublicRoute('POST', '/webhooks/kick'), true);
});

test('control password rejects missing and incorrect credentials', () => {
  const header = value => `Basic ${Buffer.from(value).toString('base64')}`;
  assert.equal(validBasicAuth(header('streamer:secret'), 'streamer', 'secret'), true);
  assert.equal(validBasicAuth(header('streamer:wrong'), 'streamer', 'secret'), false);
  assert.equal(validBasicAuth(header('other:secret'), 'streamer', 'secret'), false);
  assert.equal(validBasicAuth('', 'streamer', 'secret'), false);
  assert.equal(validBasicAuth(header('streamer:secret'), 'streamer', ''), false);
});
