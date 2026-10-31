/* Approval previews only. Does not change roster.js or game audio assets.
   node scripts/prepare-vlad-review.mjs "path/to/Влад Звуки" */
import { spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

if (!process.argv[2]) throw new Error('Pass the source sound directory');
const source = resolve(process.argv[2], 'Звук удара 2.ogg');
const output = resolve(dirname(fileURLToPath(import.meta.url)), '../docs/audio-review/vlad-attack2');
mkdirSync(output, { recursive: true });
const candidates = [
  // Tentative divisions around low-energy gaps, NOT verified word boundaries.
  { id: 'a', start: 0.48, end: 1.18, tempo: 1.05 },
  { id: 'b', start: 1.18, end: 2.34, tempo: 1.7 },
  { id: 'c', start: 2.34, end: 3.28, tempo: 1.4 },
];

function run(args) {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', source, ...args], { stdio: 'inherit' });
  if (r.error) throw r.error;
  if (r.status !== 0) throw new Error('FFmpeg failed');
}

// Reference retains the entire source, including silence.
run(['-c:a', 'libmp3lame', '-b:a', '128k', resolve(output, 'source.mp3')]);
for (const { id, start, end, tempo } of candidates) {
  for (const [version, speed] of [['natural', 1], ['fit', tempo]]) {
    const duration = (end - start) / speed;
    const filters = [
      `atrim=start=${start}:end=${end}`, 'asetpts=PTS-STARTPTS',
      `atempo=${speed}`, 'volume=0.8dB',
      'afade=t=in:d=0.005', `afade=t=out:st=${duration - 0.015}:d=0.015`,
    ];
    const name = `${id}-${version}.mp3`;
    run(['-af', filters.join(','), '-c:a', 'libmp3lame', '-b:a', '128k', resolve(output, name)]);
    console.log(`${name}: source ${start.toFixed(2)}–${end.toFixed(2)}s, tempo ${speed}x, target ${duration.toFixed(3)}s`);
  }
}

run(['-filter_complex', 'showwavespic=s=1200x220:colors=0x52cfc7:scale=sqrt', '-frames:v', '1', resolve(output, 'waveform.png')]);
