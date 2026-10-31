/* Local host for the fighting stream game.
   Wiring order: config -> hub -> outbox -> session -> bus -> router -> adapters.
   Binds to the loopback interface only; credentials never leave this process. */
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { resolve, extname, normalize } from 'node:path';
import { loadConfig, publicConfig, ROOT } from './config.mjs';
import { logger, recent, onLog } from './log.mjs';
import { Hub } from './hub.mjs';
import { Outbox } from './outbox.mjs';
import { Session } from './session.mjs';
import { ChatBus } from './bus.mjs';
import { CommandRouter } from './router.mjs';
import { Points } from './points.mjs';
import { TwitchAdapter } from './adapters/twitch.mjs';
import { KickAdapter } from './adapters/kick.mjs';
import { KickWebhookAdapter } from './adapters/kick-webhook.mjs';
import { RelayAdapter } from './adapters/relay.mjs';
import { hasTokens, clearTokens } from './oauth/store.mjs';
import { authorizeUrl, handleCallback } from './oauth/flows.mjs';
import { readiness } from './health.mjs';
import { isPublicRoute, validBasicAuth } from './access.mjs';

const log = logger('host');
const cfg = loadConfig();
const adminUser = process.env.FIGHT_ADMIN_USER || '';
const adminPassword = process.env.FIGHT_ADMIN_PASSWORD || '';
if (cfg.publicUrl && process.env.NODE_ENV === 'production' && (!adminUser || !adminPassword)) {
  throw new Error('set FIGHT_ADMIN_USER and FIGHT_ADMIN_PASSWORD for a public deployment');
}

const hub = new Hub();
const outbox = new Outbox({ cfg });
const points = new Points({ start: cfg.points.start });
const session = new Session({ cfg, hub, outbox, points });
const bus = new ChatBus(cfg);
const router = new CommandRouter({ cfg, session });
bus.on('message', m => router.handle(m));

/* ---------- adapters ---------- */

const adapters = new Map();
function addAdapter(name, Klass) {
  const a = new Klass({ cfg, bus });
  a.onStatus = () => hub.send({ t: 'status', adapters: adapterInfo() }, 'control');
  adapters.set(name, a);
  outbox.register(name, a);
  a.connect().catch(e => a.scheduleReconnect(e.message));
}
if (cfg.twitch.enabled) addAdapter('twitch', TwitchAdapter);
if (cfg.kick.enabled) {
  const K = cfg.kick.transport === 'relay' ? RelayAdapter
    : cfg.kick.transport === 'webhook' ? KickWebhookAdapter
    : KickAdapter;
  addAdapter('kick', K);
}
if (!adapters.size) log.warn('no chat platform configured - use the control panel to inject test messages');

function adapterInfo() {
  const out = {};
  for (const [k, a] of adapters) out[k] = { ...a.info(), authorized: hasTokens(k) };
  for (const k of ['twitch', 'kick']) {
    if (!out[k]) out[k] = { platform: k, status: 'off', detail: cfg[k].channel ? 'disabled' : 'no channel configured', writable: false, authorized: hasTokens(k) };
  }
  return out;
}

/* ---------- static files ---------- */

const PUBLIC = resolve(ROOT, 'public');
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.wav': 'audio/wav',
  '.webm': 'video/webm',
  '.mp4': 'video/mp4',
  '.ico': 'image/x-icon',
};

async function serveStatic(req, res, pathname) {
  const rel = pathname === '/' ? '/control.html' : pathname;
  // normalize() collapses any ".." before we join, so the path cannot escape public/.
  const file = resolve(PUBLIC, '.' + normalize(decodeURIComponent(rel)).replace(/\\/g, '/'));
  if (!file.startsWith(PUBLIC)) return send(res, 403, 'text/plain', 'forbidden');
  try {
    const s = await stat(file);
    if (!s.isFile()) throw new Error('not a file');
    const body = await readFile(file);
    res.writeHead(200, {
      'content-type': MIME[extname(file).toLowerCase()] || 'application/octet-stream',
      'cache-control': 'no-cache',
    });
    res.end(body);
  } catch {
    send(res, 404, 'text/plain', 'not found');
  }
}

function send(res, code, type, body) {
  res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store' });
  res.end(body);
}
const json = (res, code, obj) => send(res, code, 'application/json; charset=utf-8', JSON.stringify(obj));

/* Raw bytes, because a webhook signature is computed over the exact body. */
function readRaw(req, limit = 256 * 1024) {
  return new Promise((ok, fail) => {
    let n = 0;
    const parts = [];
    req.on('data', c => {
      n += c.length;
      if (n > limit) { fail(new Error('body too large')); req.destroy(); return; }
      parts.push(c);
    });
    req.on('end', () => ok(Buffer.concat(parts)));
    req.on('error', fail);
  });
}

function readBody(req, limit = 64 * 1024) {
  return readRaw(req, limit).then(buf => {
    if (!buf.length) return {};
    try { return JSON.parse(buf.toString('utf8')); }
    catch { throw new Error('invalid JSON body'); }
  });
}

/* ---------- who may drive the host ---------- */

/* Всё, кроме вебхука Kick, обслуживается только для своей машины: проверяем
   Host (закрывает туннель и DNS rebinding) и Origin у POST (закрывает переход
   стримера по ссылке из чата, которая иначе молча постучится на 127.0.0.1). */
const LOOPBACK = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);

function hostName(value) {
  const h = String(value || '').trim().toLowerCase();
  if (h.startsWith('[')) return h.slice(0, h.indexOf(']') + 1);
  return h.split(':')[0];
}

function configuredPublicHost() {
  if (!cfg.publicUrl) return '';
  try { return hostName(new URL(cfg.publicUrl).host); } catch { return ''; }
}

function hostAllowed(value) {
  if (!value) return false;
  const name = hostName(value);
  if (LOOPBACK.has(name)) return true;
  if (cfg.host && name === String(cfg.host).toLowerCase() && !['0.0.0.0', '::'].includes(cfg.host)) return true;
  if (name === configuredPublicHost()) return true;
  return Array.isArray(cfg.allowedHosts) && cfg.allowedHosts.some(a => hostName(a) === name);
}

function originAllowed(value) {
  if (!value || value === 'null') return true;     // обычный fetch со своей же страницы Origin не шлёт
  try { return hostAllowed(new URL(value).host); } catch { return false; }
}

function isLocalRequest(req) {
  return hostAllowed(req.headers.host) && originAllowed(req.headers.origin);
}

/* ---------- http ---------- */

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const p = url.pathname;

  try {
    if (p !== '/webhooks/kick' && !isLocalRequest(req)) {
      log.warn(`отклонён внешний запрос ${req.method} ${p} (host=${req.headers.host || '-'}${req.headers.origin ? ', origin=' + req.headers.origin : ''})`);
      return send(res, 403, 'text/plain', 'forbidden: host is not configured for this origin');
    }

    if (adminUser && adminPassword && !isPublicRoute(req.method, p, url.searchParams.get('role'))
        && !validBasicAuth(req.headers.authorization, adminUser, adminPassword)) {
      res.writeHead(401, {
        'www-authenticate': 'Basic realm="Fighter control", charset="UTF-8"',
        'cache-control': 'no-store',
      });
      res.end('authentication required');
      return;
    }

    if (req.method === 'GET' && p === '/healthz') {
      return json(res, 200, { ok: true, service: 'fight-host' });
    }

    if (req.method === 'GET' && p === '/readyz') {
      const state = readiness(adapterInfo());
      return json(res, state.ok ? 200 : 503, state);
    }

    if (req.method === 'GET' && p === '/events') {
      const asked = url.searchParams.get('role');
      const role = asked === 'overlay' || asked === 'points' ? asked : 'control';
      const hello = role === 'overlay' ? { t: 'hello', session: session.snapshot() }
        // the leaderboard overlay needs nothing but the table
        : role === 'points' ? { t: 'hello', top: points.top(20), names: cfg.game.names }
        : { t: 'hello', session: session.snapshot(), voters: session.voters(), top: points.table(),
            adapters: adapterInfo(), config: publicConfig(cfg), log: recent(60) };
      hub.attach(res, role, hello);
      return;
    }

    if (req.method === 'GET' && p === '/api/state') {
      return json(res, 200, {
        ok: true,
        session: session.snapshot(),
        top: points.table(),
        viewers: points.players.size,
        adapters: adapterInfo(),
        overlays: hub.count('overlay'),
        dropped: router.dropped,
        chatCounts: bus.counts,
      });
    }

    if (req.method === 'POST' && p === '/api/cmd') {
      const b = await readBody(req);
      switch (b.name) {
        case 'start': session.start(); break;
        case 'go': session.go(); break;
        case 'skip': session.skip(); break;
        case 'reset': session.reset(); break;
        case 'resetPoints': session.resetPoints(); break;
        /* Grant points: to one viewer by nickname, or to everyone in the table. */
        case 'givePoints':
        case 'givePointsAll': {
          const amount = Math.round(+b.value);
          if (!Number.isFinite(amount) || !amount || Math.abs(amount) > 1e9) return json(res, 400, { ok: false, error: 'нужно целое число очков, не 0' });
          if (b.name === 'givePointsAll') return json(res, 200, { ok: true, count: session.givePointsAll(amount), top: points.table() });
          const hits = session.givePoints(String(b.nick || ''), amount);
          if (!hits.length) return json(res, 404, { ok: false, error: 'такого зрителя нет в таблице — пусть напишет !join в чат (или сделает ставку)' });
          return json(res, 200, { ok: true, hits, top: points.table() });
        }
        case 'character': session.setCharacter(String(b.value || '')); break;
        case 'opponent': session.setOpponent(String(b.value || '')); break;
        case 'series': session.setSeries(b.value); break;
        case 'voteSeconds': session.setVoteSeconds(b.value); break;
        case 'auto': session.setAuto(b.value); break;
        case 'antiStreak': {
          try { session.setAntiStreak(b.value); }
          catch (e) {
            if (!e.status) log.error(`cannot save anti-streak settings: ${e.message}`);
            return json(res, e.status || 500, { ok: false, error: e.status ? e.message : 'Не удалось сохранить настройки. Проверьте доступ к файлу конфигурации.' });
          }
          break;
        }
        case 'say': if (b.platform) outbox.say(b.platform, String(b.value || '').slice(0, 400)); break;
        case 'reconnect': {
          const a = adapters.get(b.platform);
          if (a) { a.stopped = false; a.attempt = 0; a.connect().catch(e => a.scheduleReconnect(e.message)); }
          break;
        }
        /* Relay transport: hand the streamer a one-time link to authorize Kick. */
        case 'link': {
          const a = adapters.get(b.platform || 'kick');
          if (!a || typeof a.linkUrl !== 'function') return json(res, 400, { ok: false, error: 'this transport has no link flow' });
          try { return json(res, 200, { ok: true, url: await a.linkUrl() }); }
          catch (e) { return json(res, 502, { ok: false, error: e.message }); }
        }
        /* Relay transport: bind a channel by slug, read-only. */
        case 'claim': {
          const a = adapters.get(b.platform || 'kick');
          if (!a || typeof a.claim !== 'function') return json(res, 400, { ok: false, error: 'this transport has no claim flow' });
          const slug = String(b.value || '').trim();
          if (!slug) return json(res, 400, { ok: false, error: 'нужен слаг канала' });
          try { return json(res, 200, { ok: true, agent: await a.claim(slug) }); }
          catch (e) { return json(res, 502, { ok: false, error: e.message }); }
        }
        case 'unlink': {
          const a = adapters.get(b.platform || 'kick');
          if (a && typeof a.unlink === 'function') await a.unlink();
          break;
        }
        case 'logout': {
          clearTokens(b.platform);
          hub.send({ t: 'status', adapters: adapterInfo() }, 'control');
          break;
        }
        default: return json(res, 400, { ok: false, error: `unknown command "${b.name}"` });
      }
      return json(res, 200, { ok: true, session: session.snapshot() });
    }

    /* Kick pushes chat here. The adapter verifies the signature itself; a non-200
       tells Kick to retry, so never answer 200 for something we failed to handle. */
    if (req.method === 'POST' && p === '/webhooks/kick') {
      const a = adapters.get('kick');
      if (!a || typeof a.receive !== 'function') return send(res, 404, 'text/plain', 'no kick webhook adapter');
      const raw = await readRaw(req);
      const status = a.receive(req.headers, raw);
      return send(res, status, 'text/plain', status === 200 ? 'ok' : 'rejected');
    }

    /* Synthetic chat message - lets the whole pipeline be tested with no live chat. */
    if (req.method === 'POST' && p === '/api/chat/inject') {
      const b = await readBody(req);
      bus.push({
        platform: b.platform || 'local',
        userId: b.userId || b.display || 'tester',
        display: b.display || 'tester',
        text: b.text || '',
        roles: b.roles || { broadcaster: true, mod: true },
      });
      return json(res, 200, { ok: true });
    }

    if (req.method === 'GET' && (p === '/auth/twitch' || p === '/auth/kick')) {
      const platform = p.endsWith('twitch') ? 'twitch' : 'kick';
      try {
        res.writeHead(302, { location: authorizeUrl(cfg, platform) });
        res.end();
      } catch (e) {
        send(res, 400, 'text/html; charset=utf-8', page('Не получилось начать авторизацию', e.message));
      }
      return;
    }

    if (req.method === 'GET' && (p === '/auth/twitch/callback' || p === '/auth/kick/callback')) {
      const platform = p.includes('twitch') ? 'twitch' : 'kick';
      try {
        const who = await handleCallback(cfg, platform, url.searchParams);
        const a = adapters.get(platform);
        if (a) { a.stopped = false; a.attempt = 0; a.connect().catch(e => a.scheduleReconnect(e.message)); }
        hub.send({ t: 'status', adapters: adapterInfo() }, 'control');
        send(res, 200, 'text/html; charset=utf-8', page(`${platform} подключён`, `Аккаунт: ${who}. Можно закрыть вкладку.`, true));
      } catch (e) {
        log.error(`${platform} callback failed: ${e.message}`);
        send(res, 400, 'text/html; charset=utf-8', page(`${platform}: ошибка авторизации`, e.message));
      }
      return;
    }

    if (req.method === 'GET') return serveStatic(req, res, p);
    send(res, 405, 'text/plain', 'method not allowed');
  } catch (e) {
    log.error(`${req.method} ${p}: ${e.message}`);
    json(res, 500, { ok: false, error: e.message });
  }
});

function page(title, body, ok) {
  return `<title>${title}</title><meta charset="utf-8">
<style>body{background:#0a0506;color:#fff1ea;font:15px/1.6 Rubik,Segoe UI,Arial,sans-serif;display:grid;place-items:center;height:100vh;margin:0;text-align:center}
.card{border:1px solid #3a1a1a;background:#160b0c;border-radius:14px;padding:28px 34px;max-width:60ch}
h1{font-size:19px;margin:0 0 10px;color:${ok ? '#7ff0c4' : '#ff8a00'}}p{margin:0;color:#b89a92}a{color:#ff8a00}</style>
<div class="card"><h1>${title}</h1><p>${body}</p><p style="margin-top:14px"><a href="/">← к панели</a></p></div>`;
}

/* Stream the log into the control panel. */
onLog(rec => hub.send({ t: 'log', rec }, 'control'));

server.listen(cfg.port, cfg.host, () => {
  const base = cfg.publicUrl || `http://${cfg.host}:${cfg.port}`;
  if (cfg.kick.enabled && cfg.kick.transport === 'webhook') {
    const pub = cfg.kick.publicUrl ? cfg.kick.publicUrl.replace(/\/+$/, '') : '<адрес туннеля>';
    log.info(`kick webhook URL (впишите в приложение Kick): ${pub}/webhooks/kick`);
  }
  console.log('');
  log.info(`panel    ${base}/`);
  log.info(`overlay  ${base}/overlay.html?obs=1   <- OBS Browser Source, 1920x1080`);
  log.info(`points   ${base}/points.html          <- OBS Browser Source, leaderboard`);
  log.info(`channels twitch:${cfg.twitch.channel || '-'}  kick:${cfg.kick.channel || '-'}`);
  console.log('');
});

/* Viewers who joined in the last second are not on disk yet: save on every way out.
   Closing the fight.bat window is SIGHUP on Windows, Ctrl+Break is SIGBREAK; 'exit'
   also covers a crash. */
let saved = false;
const saveOnce = () => { if (!saved) { saved = true; points.save(); } };
process.on('exit', saveOnce);
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGBREAK']) {
  process.on(sig, () => {
    log.info('shutting down');
    saveOnce();
    for (const a of adapters.values()) a.stop();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 1500);
  });
}
