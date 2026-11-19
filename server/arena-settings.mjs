import { existsSync, readFileSync, writeFileSync, renameSync, mkdirSync, unlinkSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { ROOT } from './config.mjs';
import '../public/js/arenas.js';

export function validateArena(value) {
  if (!globalThis.Arenas.has(value)) {
    throw Object.assign(new Error('Выберите арену из списка.'), { status: 400 });
  }
  return value;
}

// Preserve the raw configuration, including settings not present in this session.
export function saveArena(value) {
  const arena = validateArena(value);
  const path = resolve(ROOT, process.env.CONFIG_FILE || 'data/config.json');
  const data = existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : {};
  if (!data || Array.isArray(data) || typeof data !== 'object'
      || (data.game !== undefined && (!data.game || Array.isArray(data.game) || typeof data.game !== 'object'))) {
    throw new Error('Invalid config structure');
  }
  const next = { ...data, game: { ...data.game, arena } };
  const temporary = `${path}.${randomUUID()}.tmp`;
  mkdirSync(dirname(path), { recursive: true });
  try {
    writeFileSync(temporary, JSON.stringify(next, null, 2) + '\n', { encoding: 'utf8', mode: 0o600 });
    renameSync(temporary, path);
  } finally {
    if (existsSync(temporary)) unlinkSync(temporary);
  }
}
