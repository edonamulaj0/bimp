"""Score a trained detector on the challenge's count questions, fairly.

Thresholds are tuned on CubiCasa's val split; the score is reported on its test split only (plans the model never
trained on). Images: F1_original.png (the files in the challenge dataset are these, renamed).
  python evaluate.py best.pt /path/to/cubicasa5k questions.jsonl [out.json]
"""
import json, re, sys, collections
import numpy as np
from ultralytics import YOLO
from classes import NAMES

QUESTIONS = {  # English wording; the Finnish twin of each question has the same answer
    'window': r'^How many windows', 'door': r'^How many doors', 'toilet': r'toilet bowls',
    'sink': r'sinks and wash basins', 'shower_bath': r'showers and bathtubs',
}

def answers(path):
    out = collections.defaultdict(dict)
    for line in open(path):
        r = json.loads(line)
        if '/cubicasa5k/' not in r['path']: continue
        name = r['path'].rsplit('/', 1)[-1][:-4]
        for k, pat in QUESTIONS.items():
            if re.search(pat, r['question']): out[name][k] = int(r['answer'])
    return out

def confidences(model, src, split, imgsz):
    """Per plan: for each class, the sorted confidences of its detections (so any threshold can be applied later)."""
    plans = [l.strip().strip('/') for l in open(f'{src}/{split}.txt') if l.strip()]
    res = {}
    for i in range(0, len(plans), 16):
        batch = plans[i:i + 16]
        preds = model.predict([f'{src}/{p}/F1_original.png' for p in batch], imgsz=imgsz, conf=0.05, iou=0.5, max_det=600, verbose=False)
        for p, pr in zip(batch, preds):
            c = collections.defaultdict(list)
            for cls, conf in zip(pr.boxes.cls.tolist(), pr.boxes.conf.tolist()): c[NAMES[int(cls)]].append(conf)
            res[p.replace('/', '-')] = c
    return res

def accuracy(conf, ans, k, t):
    hits = [len([c for c in conf[n][k] if c >= t]) == a[k] for n, a in ans.items() if n in conf and k in a]
    return (sum(hits) / len(hits), len(hits)) if hits else (None, 0)

if __name__ == '__main__':
    weights, src, qpath = sys.argv[1:4]
    imgsz = 1024
    model, ans = YOLO(weights), answers(qpath)
    val, test = confidences(model, src, 'val', imgsz), confidences(model, src, 'test', imgsz)
    grid = np.round(np.arange(0.1, 0.9, 0.025), 3)
    report = {}
    for k in QUESTIONS:
        best = max(grid, key=lambda t: accuracy(val, ans, k, t)[0] or 0)
        acc, n = accuracy(test, ans, k, best)
        report[k] = {'threshold': float(best), 'val_exact': accuracy(val, ans, k, best)[0], 'test_exact': acc, 'test_questions': n}
        print(f"{k:12} threshold {best:.3f}  val {report[k]['val_exact']:.3f}  test {acc:.3f} on {n} plans")
    if len(sys.argv) > 4: json.dump(report, open(sys.argv[4], 'w'), indent=2)
