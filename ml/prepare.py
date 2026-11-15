"""CubiCasa5K (Zenodo 2613548) -> YOLO dataset of windows, doors, toilets, sinks, showers/bathtubs.

Uses the official train/val/test split. Images: F1_scaled.png (model.svg coordinates are in its pixel space).
  python prepare.py /path/to/cubicasa5k /path/to/out
"""
import os, sys, shutil, collections
from concurrent.futures import ProcessPoolExecutor
from PIL import Image
from cc_labels import objects
from classes import CLASS_ID, NAMES, cat

Image.MAX_IMAGE_PIXELS = None

def convert(args):
    src, out, split, plan = args
    d = os.path.join(src, plan.strip('/'))
    img, svg = os.path.join(d, 'F1_scaled.png'), os.path.join(d, 'model.svg')
    if not (os.path.exists(img) and os.path.exists(svg)): return plan, None
    W, H = Image.open(img).size
    rows = []
    for cls, (x0, y0, x1, y1) in objects(open(svg, encoding='utf-8', errors='replace').read()):
        k = cat(cls)
        if k is None: continue
        # thin openings: give boxes at least 6 px so they stay learnable
        cx, cy, w, h = (x0 + x1) / 2, (y0 + y1) / 2, max(x1 - x0, 6), max(y1 - y0, 6)
        x0, x1, y0, y1 = max(0, cx - w / 2), min(W, cx + w / 2), max(0, cy - h / 2), min(H, cy + h / 2)
        if x1 - x0 < 2 or y1 - y0 < 2: continue
        rows.append(f"{CLASS_ID[k]} {(x0+x1)/2/W:.6f} {(y0+y1)/2/H:.6f} {(x1-x0)/W:.6f} {(y1-y0)/H:.6f}")
    name = plan.strip('/').replace('/', '-')  # same names as the challenge files, e.g. colorful-10052
    os.makedirs(f'{out}/images/{split}', exist_ok=True); os.makedirs(f'{out}/labels/{split}', exist_ok=True)
    dst = f'{out}/images/{split}/{name}.png'
    if not os.path.exists(dst):
        try: os.link(img, dst)
        except OSError: shutil.copy(img, dst)
    open(f'{out}/labels/{split}/{name}.txt', 'w').write('\n'.join(rows))
    return plan, len(rows)

if __name__ == '__main__':
    src, out = sys.argv[1], sys.argv[2]
    limit = int(os.environ.get('LIMIT', '0'))
    jobs = []
    for split in ('train', 'val', 'test'):
        plans = [l.strip() for l in open(os.path.join(src, f'{split}.txt')) if l.strip()]
        jobs += [(src, out, split, p) for p in (plans[:limit] if limit else plans)]
    stats = collections.Counter()
    with ProcessPoolExecutor() as ex:
        for plan, n in ex.map(convert, jobs, chunksize=16):
            stats['missing' if n is None else 'ok'] += 1
    open(f'{out}/data.yaml', 'w').write(f"path: {os.path.abspath(out)}\ntrain: images/train\nval: images/val\ntest: images/test\nnames: {NAMES}\n")
    print(dict(stats), '->', out)
