/* Configuration: data/config.json (optional) <- defaults, with env overrides on top.
   Secrets live in data/config.json or the environment; they never reach the browser. */
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { logger } from './log.mjs';

const log = logger('config');
export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const DEFAULTS = {
  // 7778, не 7777: так файтинг и Метеоритный дождь могут работать одновременно.
  // Redirect URL в приложении Twitch/Kick должен быть на этом же порту.
  port: 7778,
  host: '127.0.0.1',
  // Public origin used by OAuth callbacks and server deployment.
  // Leave empty for the local desktop mode.
  publicUrl: '',
  // Хост обслуживает только свою машину (проверка заголовка Host). Сюда можно
  // дописать имена, под которыми вы открываете панель или оверлей сами — напр.
  // LAN-адрес машины с OBS.
  allowedHosts: [],

  game: {
    names: { fighter: 'ВЛАД', gorilla: 'ГОРИЛЛА' },
    character: 'vlad',      // кто стоит слева при запуске: id из public/js/roster.js
    opponent: 'gorilla',    // кто стоит справа: 'gorilla' или id из public/js/roster.js
    characters: {},         // свои имена персонажей: { "fighter2": "ИМЯ" }
    voteSeconds: 30,        // сколько идёт голосование перед боем
    resultSeconds: 6,       // минимум: длинные реплики/анимации продлевают показ
    autoLoop: false,        // после результата сразу открывать новое голосование
    pauseSeconds: 10,       // пауза между раундами в autoLoop
    minVotes: 0,            // таймер голосования стоит, пока не наберётся столько голосов
    // Против длинных серий: шанс (%) что победит тот же, кто выиграл 1, 2, 3+ боя
    // подряд. В сумме всё равно 50/50. [] — обычная монетка 50/50.
    antiStreak: [40, 25, 10],
  },

  // Bets: !1 / !2 stake the viewer's whole balance — a right call doubles it, a
  // wrong one wipes it; !3 sits the fight out. `start` is given once, when a viewer
  // first lands in the table (!join or first bet); wiped, they stay at 0 until the
  // streamer grants points (panel, "Очки зрителей"). 0: no start amount at all.
  points: {
    start: 100,
  },

  commands: {
    prefix: '!',
    voteRoles: ['everyone'],  // кто может голосовать, напр. ['sub','vip','mod','broadcaster']
  },

  limits: {
    userBurst: 3,           // commands allowed per user...
    userWindowMs: 10000,    // ...within this window
    dedupeMs: 2000,         // ignore an identical message from the same user
  },

  // off | minimal | verbose
  replies: 'minimal',

  twitch: {
    enabled: true,
    channel: '',
    clientId: '',
    clientSecret: '',
    transport: 'auto',
  },

  kick: {
    enabled: true,
    channel: '',
    clientId: '',
    clientSecret: '',
    transport: 'ws',
    chatroomId: 0,
    pusherKey: '',
    pusherCluster: 'us2',
    publicUrl: '',
    relayUrl: '',
  },
};

function deepMerge(base, over) {
  if (over === undefined || over === null) return base;
  if (Array.isArray(base) || typeof base !== 'object') return over;
  const out = { ...base };
  for (const k of Object.keys(over)) out[k] = deepMerge(base[k], over[k]);
  return out;
}

function fromEnv(cfg) {
  const e = process.env;
  const set = (path, val, cast) => {
    if (val === undefined || val === '') return;
    const parts = path.split('.');
    let o = cfg;
    for (const p of parts.slice(0, -1)) o = o[p];
    o[parts.at(-1)] = cast ? cast(val) : val;
  };
  set('port', e.PORT, Number);
  set('host', e.HOST);
  set('publicUrl', e.PUBLIC_URL);
  set('game.character', e.GAME_CHARACTER);
  set('game.opponent', e.GAME_OPPONENT);
  set('twitch.channel', e.TWITCH_CHANNEL);
  set('twitch.clientId', e.TWITCH_CLIENT_ID);
  set('twitch.clientSecret', e.TWITCH_CLIENT_SECRET);
  set('twitch.transport', e.TWITCH_TRANSPORT);
  set('kick.channel', e.KICK_CHANNEL);
  set('kick.clientId', e.KICK_CLIENT_ID);
  set('kick.clientSecret', e.KICK_CLIENT_SECRET);
  set('kick.transport', e.KICK_TRANSPORT);
  set('kick.relayUrl', e.KICK_RELAY_URL);
  set('kick.chatroomId', e.KICK_CHATROOM_ID, Number);
  return cfg;
}

export const clampVote = v => Math.max(5, Math.min(600, +v || 30));

export function loadConfig() {
  let file = {};
  const path = resolve(ROOT, process.env.CONFIG_FILE || 'data/config.json');
  if (existsSync(path)) {
    try { file = JSON.parse(readFileSync(path, 'utf8')); }
    catch (e) { log.error(`${path} is not valid JSON: ${e.message}`); process.exit(1); }
  } else {
    log.warn(`${path} not found — running on defaults (no channels configured)`);
  }
  const cfg = fromEnv(deepMerge(structuredClone(DEFAULTS), file));

  cfg.host = String(cfg.host || DEFAULTS.host).trim();
  cfg.publicUrl = String(cfg.publicUrl || '').trim().replace(/\/+$/, '');
  if (cfg.publicUrl && !/^https?:\/\//i.test(cfg.publicUrl)) {
    log.warn('publicUrl must start with http:// or https:// - ignored');
    cfg.publicUrl = '';
  }

  const g = cfg.game;
  g.voteSeconds = clampVote(g.voteSeconds);
  g.resultSeconds = Math.max(3, Math.min(60, +g.resultSeconds || 6));
  g.pauseSeconds = Math.max(0, Math.min(600, +g.pauseSeconds || 0));
  g.minVotes = Math.max(0, Math.min(1000, g.minVotes | 0));
  g.autoLoop = !!g.autoLoop;
  g.antiStreak = (Array.isArray(g.antiStreak) ? g.antiStreak : [])
    .map(p => Math.max(1, Math.min(99, Math.round(+p) || 50))).slice(0, 10);
  cfg.points.start = Math.max(0, Math.min(1e9, Math.round(+cfg.points.start) || 0));
  g.names.fighter = String(g.names.fighter || 'FIGHTER').slice(0, 24);
  g.names.gorilla = String(g.names.gorilla || 'ГОРИЛЛА').slice(0, 24);

  // A nickname left as the example's placeholder (or any non-login text) is not a
  // channel: anonymous IRC would happily "join" it and look connected.
  cfg.twitch.channel = String(cfg.twitch.channel || '').trim().replace(/^@/, '');
  if (cfg.twitch.channel && !/^[a-z0-9_]{3,25}$/i.test(cfg.twitch.channel)) {
    log.warn(`twitch.channel "${cfg.twitch.channel}" is not a Twitch login (latin letters, digits, _ ; 3-25) - Twitch is off`);
    cfg.twitch.channel = '';
  }
  cfg.kick.channel = String(cfg.kick.channel || '').trim().replace(/^@/, '');
  if (cfg.kick.channel && !/^[a-z0-9_-]{1,40}$/i.test(cfg.kick.channel)) {
    log.warn(`kick.channel "${cfg.kick.channel}" is not a Kick channel name - ignored`);
    cfg.kick.channel = '';
  }
  if (!cfg.twitch.channel) cfg.twitch.enabled = false;
  // With the relay the channel comes from the link flow, so none is configured here.
  if (!cfg.kick.channel && cfg.kick.transport !== 'relay') cfg.kick.enabled = false;
  return cfg;
}

/* Browser-safe view of the config — strips every credential. */
export function publicConfig(cfg) {
  return {
    publicUrl: cfg.publicUrl,
    game: cfg.game,
    commands: cfg.commands,
    replies: cfg.replies,
    twitch: { enabled: cfg.twitch.enabled, channel: cfg.twitch.channel, transport: cfg.twitch.transport },
    kick: { enabled: cfg.kick.enabled, channel: cfg.kick.channel, transport: cfg.kick.transport },
  };
}
