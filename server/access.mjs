import { timingSafeEqual } from 'node:crypto';

export function isPublicRoute(method, path, role) {
  if (method === 'POST' && path === '/webhooks/kick') return true;
  if (method !== 'GET') return false;
  if (path === '/events') return role === 'overlay' || role === 'points';
  return ['/overlay.html', '/points.html', '/healthz', '/readyz',
    '/auth/twitch/callback', '/auth/kick/callback'].includes(path)
    || path.startsWith('/assets/') || path.startsWith('/js/');
}

export function validBasicAuth(header, user, password) {
  if (!user || !password || !/^Basic /i.test(header || '')) return false;
  let credentials;
  try { credentials = Buffer.from(header.slice(6), 'base64').toString('utf8'); }
  catch { return false; }
  const expected = Buffer.from(`${user}:${password}`);
  const received = Buffer.from(credentials);
  return expected.length === received.length && timingSafeEqual(expected, received);
}
