"""Prepare the approved Mage cast as a VP9 alpha sprite (ffmpeg, Pillow, numpy)."""
from pathlib import Path
import subprocess
import numpy as np
from PIL import Image, ImageFilter

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'media/source/Anim/vlad-fireball-mage.mp4'
OUTPUT = ROOT / 'public/assets/anim/vlad-fireball.webm'
SIZE, SOURCE_FPS, FPS = 960, 24, 48
raw = subprocess.check_output(['ffmpeg', '-v', 'error', '-i', str(SOURCE),
    '-vf', 'fps=24,scale=960:960', '-frames:v', '96', '-an', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'])
frames = np.frombuffer(raw, dtype=np.uint8).reshape(-1, SIZE, SIZE, 3)
# A later clean open-palm frame supplies a silhouette for the baked flame area.
reference = frames[61].astype(float)
dominance = reference[:,:,1]-np.maximum(reference[:,:,0],reference[:,:,2])
clean = (dominance < 0) | ((reference[:,:,1]-reference.min(axis=2)) < 45)
hand_mask = np.asarray(Image.fromarray((clean*255).astype('uint8')).filter(ImageFilter.MaxFilter(11)).filter(ImageFilter.GaussianBlur(1))).astype(float)/255
cutouts = []
for i, rgb in enumerate(frames):
    source_t = i / SOURCE_FPS
    f = rgb.astype(float)
    dominance = f[:,:,1] - np.maximum(f[:,:,0], f[:,:,2])
    green = f[:,:,1] - f.min(axis=2) > 45
    alpha = np.where(green, np.clip((30-dominance)/35, 0, 1), 1)
    if 1.65 < source_t < 2.7:
        alpha[:360,770:] *= hand_mask[:360,770:]
    # Unmix the green matte instead of leaving a green fringe around the glow.
    background = np.median(f[np.r_[0:20, 940:960], :, :].reshape(-1,3), axis=0)
    f = np.clip((f-(1-alpha[:,:,None])*background)/np.maximum(.05, alpha[:,:,None]), 0, 255)
    f[:,:,1] = np.minimum(f[:,:,1], np.maximum(f[:,:,0], f[:,:,2])+5)
    if 1.65 < source_t < 2.6:
        alpha *= np.clip((959-np.arange(SIZE))/60, 0, 1)[None,:]
    # Remove isolated keying noise and soften only the silhouette, keeping face
    # and clothing details sharp. Work on alpha before any time interpolation.
    matte = Image.fromarray((alpha*255).astype('uint8'))
    matte = matte.filter(ImageFilter.MedianFilter(3)).filter(ImageFilter.MinFilter(3)).filter(ImageFilter.GaussianBlur(.65))
    alpha = np.asarray(matte).astype(float)/255
    cutout = Image.fromarray(np.dstack((f, alpha*255)).astype('uint8'))
    cutouts.append(cutout.convert('RGBa')) # Premultiplied: no green/black interpolation fringes.

encoder = subprocess.Popen(['ffmpeg', '-v', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'rgba',
    '-s', '1536x1285', '-r', str(FPS), '-i', '-', '-an', '-c:v', 'libvpx-vp9',
    '-pix_fmt', 'yuva420p', '-b:v', '0', '-crf', '19', '-auto-alt-ref', '0',
    '-deadline', 'good', '-cpu-used', '4', str(OUTPUT)], stdin=subprocess.PIPE)
for i in range(5*FPS):
    t = i / FPS
    # Long anticipation, then a 120ms arm throw, followed by normal-speed recovery.
    source_t = (t if t < .8 else .8+(t-.8)*.8/1.92 if t < 2.72 else
                1.6+(t-2.72)*.25/.12 if t < 2.84 else 1.85+t-2.84)
    position = min(len(cutouts)-1, source_t*SOURCE_FPS)
    lo = int(position)
    cutout = Image.blend(cutouts[lo], cutouts[min(lo+1,len(cutouts)-1)], position-lo)
    # Match the existing still's standing height and feet; allow the palm to
    # extend beyond the still's width without reducing the character's scale.
    cutout = cutout.resize((1421,1421), Image.Resampling.LANCZOS).convert('RGBA')
    canvas = Image.new('RGBA', (1536,1285))
    canvas.alpha_composite(cutout, (-90,-85))
    encoder.stdin.write(canvas.tobytes())
encoder.stdin.close()
if encoder.wait():
    raise RuntimeError('VP9 alpha encode failed')
print(OUTPUT)
