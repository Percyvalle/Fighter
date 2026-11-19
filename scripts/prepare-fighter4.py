"""Prepare the gold Vlad skin (requires ffmpeg, Pillow, numpy and scipy)."""
from pathlib import Path
import subprocess
import tempfile
import numpy as np
from PIL import Image
from scipy import ndimage

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'media/source/Anim/f4-punch.mp4'
OUTPUT = ROOT / 'public/assets/anim'
STILL = Image.open(ROOT / 'public/assets/fighter4.png').convert('RGBA')


def cutout(rgb):
    # Only remove near-black connected to the frame edge, preserving dark clothes.
    dark = rgb.max(axis=2) <= 14
    seed = np.zeros_like(dark)
    seed[[0, -1], :] = dark[[0, -1], :]
    seed[:, [0, -1]] = dark[:, [0, -1]]
    background = ndimage.binary_propagation(seed, mask=dark)
    alpha = ndimage.gaussian_filter((~background).astype(float), 0.55)
    colour = np.clip((rgb.astype(float) - 5 * (1 - alpha[:, :, None])) /
                     np.maximum(alpha[:, :, None], 0.01), 0, 255)
    return Image.fromarray(np.dstack((colour, alpha * 255)).astype('uint8'))


def encode(frames, path):
    with tempfile.TemporaryDirectory(prefix='fight-f4-') as folder:
        for i, frame in enumerate(frames):
            frame.save(Path(folder) / f'{i:03}.png')
        subprocess.run(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-y',
                        '-framerate', '24', '-i', str(Path(folder) / '%03d.png'),
                        '-an', '-c:v', 'libvpx-vp9', '-pix_fmt', 'yuva420p',
                        '-b:v', '0', '-crf', '28', '-auto-alt-ref', '0',
                        str(path)], check=True)


raw = subprocess.check_output(['ffmpeg', '-hide_banner', '-loglevel', 'error',
                               '-i', str(SOURCE), '-f', 'rawvideo', '-pix_fmt',
                               'rgb24', '-an', '-'])
frames = np.frombuffer(raw, dtype=np.uint8).reshape(-1, 720, 1280, 3)
first = cutout(frames[0])
sx0, sy0, sx1, sy1 = first.getbbox()
tx0, ty0, tx1, ty1 = STILL.getbbox()
scale = (ty1 - ty0) / (sy1 - sy0)
offset = (round((tx0 + tx1) / 2 - (sx0 + sx1) / 2 * scale),
          round(ty1 - sy1 * scale))


def aligned(rgb):
    image = cutout(rgb)
    image = image.resize((round(image.width * scale), round(image.height * scale)),
                         Image.Resampling.LANCZOS)
    canvas = Image.new('RGBA', STILL.size)
    canvas.paste(image, offset)
    return canvas


forward = [aligned(frames[i]) for i in [44, 46, 48, 50, 52, 54, 56, 58, 60, 61]]
attack = forward + [forward[-1]] * 2 + forward[-2::-1]
attack += [Image.blend(forward[0], STILL, weight) for weight in [0.33, 0.67, 1]]
OUTPUT.mkdir(parents=True, exist_ok=True)
encode([STILL] * 24, OUTPUT / 'f4-idle.webm')
encode(attack, OUTPUT / 'f4-punch.webm')
print(f'Prepared {len(attack)} attack frames, contact at 375 ms, scale {scale:.4f}, offset {offset}')
