/* Usage: node scripts/prepare-vlad-sfx.mjs "path/to/Влад Звуки"
   Requires ffmpeg. Only generates named assets; source recordings stay intact. */
import { spawnSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const source = process.argv[2];
if (!source) throw new Error('Pass the directory containing Влад Звуки as the first argument');
const output = resolve(dirname(fileURLToPath(import.meta.url)), '../public/assets/sfx');
// Ordinary attacks use only approved review variants A and C. Their MP3 encoding,
// tempo and fades match the approved audio-review variants.
// atempo fits speech into the action without pitch shift.
// Hurt recordings have long silent gaps between separate reactions.
const cuts = [
  ['Звук удара 2.ogg', 'vlad-attack-a', 0.48, 1.18, 0.8, 1.05, true],
  ['Звук удара 2.ogg', 'vlad-attack-c', 2.34, 3.28, 0.8, 1.4, true],
  ['Крит Удар.ogg', 'vlad-crit-complete', 0.40, 2.24, -0.7, 1.4],
  ['Получение урона.ogg', 'vlad-hurt-1', 0.55, 0.90, 10.1],
  ['Получение урона.ogg', 'vlad-hurt-2', 1.43, 1.83, 10.1],
  ['Получение урона.ogg', 'vlad-hurt-3', 2.73, 3.12, 10.1],
  ['Получение урона 1.ogg', 'vlad-hurt-4', 0.61, 0.95, 4.3],
  ['Получение урона 1.ogg', 'vlad-hurt-5', 1.85, 2.19, 4.3],
  ['Получение урона 1.ogg', 'vlad-hurt-6', 3.52, 3.84, 4.3],
  ['Получение урона 2.ogg', 'vlad-hurt-7', 0.81, 1.73, 1.2],
  ['Звук Победы.ogg', 'vlad-win', 0.61, 2.70, 0.6],
  ['Звук поражения.ogg', 'vlad-defeat', 0.47, 3.56, 0.1],
];

for (const [file, name, start, end, gain, tempo = 1, approved = false] of cuts) {
  const duration = (end - start) / tempo;
  const fadeIn = approved ? 0.005 : 0.008;
  const fadeOut = approved ? 0.015 : 0.025;
  const extension = approved ? 'mp3' : 'ogg';
  const result = spawnSync('ffmpeg', [
    '-hide_banner', '-loglevel', 'error', '-y', '-i', resolve(source, file),
    '-af', `atrim=start=${start}:end=${end},asetpts=PTS-STARTPTS,atempo=${tempo},volume=${gain}dB,afade=t=in:d=${fadeIn},afade=t=out:st=${duration - fadeOut}:d=${fadeOut}`,
    '-c:a', approved ? 'libmp3lame' : 'libopus', '-b:a', approved ? '128k' : '96k', resolve(output, `${name}.${extension}`),
  ], { stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`ffmpeg failed for ${file}`);
  console.log(`${name}.${extension} (${duration.toFixed(2)}s)`);
}
