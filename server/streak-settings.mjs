import { existsSync, readFileSync, writeFileSync, renameSync, mkdirSync, unlinkSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { ROOT } from './config.mjs';

export function validateAntiStreak(value) {
  if (!Array.isArray(value) || value.length > 10 || value.some(p => !Number.isInteger(p) || p < 1 || p > 99)) {
    throw Object.assign(new Error('Укажите целые проценты от 1 до 99; пустой список выключает защиту.'), { status: 400 });
  }
  return [...value];
}

// Update just this setting in the raw config, preserving credentials and other
// settings. Never overwrite an unreadable config or persist environment secrets.
export function saveAntiStreak(value) {
  const chances = validateAntiStreak(value);
  const path = resolve(ROOT, process.env.CONFIG_FILE || 'data/config.json');
  const data = existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : {};
  if (!data || Array.isArray(data) || typeof data !== 'object'
      || (data.game !== undefined && (!data.game || Array.isArray(data.game) || typeof data.game !== 'object'))) {
    throw new Error('Invalid config structure');
  }
  const next = { ...data, game: { ...data.game, antiStreak: chances } };
  const temporary = `${path}.${randomUUID()}.tmp`;
  mkdirSync(dirname(path), { recursive: true });
  try {
    writeFileSync(temporary, JSON.stringify(next, null, 2) + '\n', { encoding: 'utf8', mode: 0o600 });
    renameSync(temporary, path);
  } finally {
    if (existsSync(temporary)) unlinkSync(temporary);
  }
}
