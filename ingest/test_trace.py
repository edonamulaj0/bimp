"""Checks /trace and PDF page selection on the fixture drawings. Run: python3 ingest/test_trace.py"""
import json
import random
import subprocess
import sys
import tempfile
from pathlib import Path

import pymupdf

import service

ROOMS = [(0, 0, 6.5, 5), (6.5, 0, 12, 4), (6.5, 4, 12, 5.2), (0, 5, 4.5, 9), (4.5, 5, 6.5, 7.5), (4.5, 7.5, 6.5, 9), (6.5, 5.2, 9.5, 9), (9.5, 5.2, 12, 9)]
here = Path(__file__).parent
fail = 0


def check(name, ok, got=""):
    global fail
    fail += not ok
    print(f"{'ok  ' if ok else 'FAIL'} {name} {got}")


with tempfile.TemporaryDirectory() as tmp:
    subprocess.run([sys.executable, str(here / "make_fixtures.py"), tmp], check=True, stdout=subprocess.DEVNULL)
    random.seed(1)
    for name, fn in (("plan-vector.pdf", service.analyze_pdf), ("plan-scan.png", service.analyze_image)):
        an = fn(Path(tmp, name).read_bytes())
        k = an["width"] / 1190.55                      # px per point: the sheet is A3, the house starts at (120, 90) pt
        x0, y0, m = 120 * k, 90 * k, 28.3465 * k       # px per metre at 1:100
        # outlines as a language model reads them: every corner up to 25 cm off
        rough = [[[x0 + (a + random.uniform(-.25, .25)) * m, y0 + (b + random.uniform(-.25, .25)) * m] for a, b in ((rx0, ry0), (rx1, ry0), (rx1, ry1), (rx0, ry1))]
                 for rx0, ry0, rx1, ry1 in ROOMS]
        out = service.trace_rooms(json.dumps({"png": an["render_png"], "rooms": rough, "close": []}).encode())
        check(f"{name}: every room traced", all(out["rooms"]), out["match"])
        worst = 0.0
        for (rx0, ry0, rx1, ry1), poly in zip(ROOMS, out["rooms"]):
            xs, ys = [(p[0] - x0) / m for p in poly or []], [(p[1] - y0) / m for p in poly or []]
            if poly:  # the traced outline is the inside face: within the 9 cm wall stroke of the centre line
                worst = max(worst, abs(min(xs) - rx0), abs(max(xs) - rx1), abs(min(ys) - ry0), abs(max(ys) - ry1))
        check(f"{name}: outlines within 8 cm of the wall centre lines: the inside face of a 9 cm wall, give or take two pixels (read ones were up to 25 cm off)", worst < 0.08, round(worst, 3))
    # a room that matches no enclosed space keeps its outline as read
    an = service.analyze_image(Path(tmp, "plan-scan.png").read_bytes())
    out = service.trace_rooms(json.dumps({"png": an["render_png"], "rooms": [[[5, 5], [60, 5], [60, 60], [5, 60]]], "close": []}).encode())
    check("a room on empty paper is not traced", out["rooms"] == [None])
    # a plan with open doorways and windows, furniture and a label, and NO openings given: rooms leak into each other,
    # so each edge is fitted to the wall face beside it instead. Outlines are read up to 22 px off, furniture 13 px.
    import base64

    import cv2
    import numpy as np
    W, H, t = 1600, 1100, 10
    img = np.full((H, W), 255, np.uint8)
    X, Y = [200, 700, 1100, 1400], [150, 600, 950]
    box = lambda x0, y0, x1, y1, g, c: cv2.rectangle(img, (min(x0, x1) - t // 2 - g, min(y0, y1) - t // 2 - g), (max(x0, x1) + t // 2 + g, max(y0, y1) + t // 2 + g), c, -1)
    for x in X:
        box(x, Y[0], x, Y[2], 0, 0)
    for y in Y:
        box(X[0], y, X[3], y, 0, 0)
    for x0, y0, x1, y1 in [(700, 300, 700, 390), (1100, 700, 1100, 790), (400, 600, 490, 600), (850, 600, 940, 600), (1200, 600, 1290, 600)]:  # doors
        box(x0, y0, x1, y1, 1, 255)
        cv2.line(img, (x0, y0), (x0 + 90, y0) if x0 == x1 else (x0, y0 + 90), 0, 2)
        cv2.ellipse(img, (x0, y0), (90, 90), 0, 0, 90, 0, 1)
    for x0, y0, x1, y1 in [(350, 150, 550, 150), (200, 700, 200, 850), (1400, 250, 1400, 450)]:  # windows
        box(x0, y0, x1, y1, 1, 255)
        for d in (-4, 0, 4):
            cv2.line(img, (x0, y0 + d), (x1, y0 + d), 0, 1) if y0 == y1 else cv2.line(img, (x0 + d, y0), (x0 + d, y1), 0, 1)
    furn = [(230, 180, 430, 330), (760, 420, 900, 560), (240, 880, 330, 930)]
    for x0, y0, x1, y1 in furn:
        cv2.rectangle(img, (x0, y0), (x1, y1), 0, 2)
        cv2.line(img, (x0, y0 + 20), (x1, y0 + 20), 0, 1)
    cv2.putText(img, "Living", (420, 400), cv2.FONT_HERSHEY_SIMPLEX, 1, 0, 2)
    truth = [(X[0], Y[0], X[1], Y[1]), (X[1], Y[0], X[2], Y[1]), (X[2], Y[0], X[3], Y[1]), (X[0], Y[1], X[2], Y[2]), (X[2], Y[1], X[3], Y[2])]
    png = base64.b64encode(cv2.imencode(".png", img)[1]).decode()
    for seed in (1, 2, 3):
        random.seed(seed)
        rough = [[[a + random.uniform(-22, 22), b + random.uniform(-22, 22)] for a, b in ((x0, y0), (x1, y0), (x1, y1), (x0, y1))] for x0, y0, x1, y1 in truth]
        boxes = [[v + random.uniform(-13, 13) for v in f] for f in furn]
        out = service.trace_rooms(json.dumps({"png": png, "rooms": rough, "close": [], "boxes": boxes}).encode())
        worst = max(abs(v) for tr, r in zip(truth, out["rooms"]) if r for v in (
            min(p[0] for p in r) - tr[0] - t / 2, min(p[1] for p in r) - tr[1] - t / 2, max(p[0] for p in r) - tr[2] + t / 2, max(p[1] for p in r) - tr[3] + t / 2))
        check(f"open plan, reading {seed}: every room fitted to its wall faces within 2 px (read up to 22 px off)", all(out["rooms"]) and worst <= 2, (out["how"], round(worst, 1)))
        off = [max(abs(v - w) for v, w in zip(b, f)) for f, b in zip(furn, out["boxes"]) if b]
        check(f"open plan, reading {seed}: furniture tightened onto its lines within 3 px", len(off) >= 2 and max(off) <= 3, off)
        check(f"open plan, reading {seed}: outside walls measured at 10 px, give or take one", out["exterior_px"] is not None and abs(out["exterior_px"] - t) <= 1.5, out["exterior_px"])
    # the same house with walls drawn as two thin lines with hatching between them, a worktop along one wall, and
    # handwriting over the rooms: nothing may be bent or kinked, and the open rooms are still moved onto their walls
    img = np.full((H, W), 255, np.uint8)
    t = 14

    def hatched(x0, y0, x1, y1):
        a, b = (min(x0, x1) - t // 2, min(y0, y1) - t // 2), (max(x0, x1) + t // 2, max(y0, y1) + t // 2)
        cv2.rectangle(img, a, b, 0, 1)
        for d in range(-t, max(b[0] - a[0], b[1] - a[1]) + t, 6):
            cv2.line(img, (a[0] + d, b[1]), (a[0] + d + t, a[1]), 0, 1) if b[0] - a[0] > b[1] - a[1] else cv2.line(img, (a[0], a[1] + d + t), (b[0], a[1] + d), 0, 1)
    for x in X:
        hatched(x, Y[0], x, Y[2])
    for y in Y:
        hatched(X[0], y, X[3], y)
    for x0, y0, x1, y1 in [(700, 300, 700, 390), (1100, 700, 1100, 790), (400, 600, 490, 600), (850, 600, 940, 600)]:
        cv2.rectangle(img, (min(x0, x1) - t // 2 - 1, min(y0, y1) - t // 2 - 1), (max(x0, x1) + t // 2 + 1, max(y0, y1) + t // 2 + 1), 255, -1)
        cv2.line(img, (x0, y0), (x0 + 90, y0) if x0 == x1 else (x0, y0 + 90), 0, 2)
        cv2.ellipse(img, (x0, y0), (90, 90), 0, 0, 90, 0, 1)
    rng = np.random.default_rng(2)
    for _ in range(6):
        cv2.polylines(img, [(rng.random((12, 2)) * [160, 90] + [rng.integers(250, 1200), rng.integers(200, 850)]).astype(np.int32)], False, 0, 3)
    cv2.rectangle(img, (215, 165), (690, 225), 0, 2)
    png = base64.b64encode(cv2.imencode(".png", img)[1]).decode()
    for seed in (1, 2, 3):
        random.seed(seed)
        rough = [[[a + random.uniform(-20, 20), b + random.uniform(-20, 20)] for a, b in ((x0, y0), (x1, y0), (x1, y1), (x0, y1))] for x0, y0, x1, y1 in truth]
        out = service.trace_rooms(json.dumps({"png": png, "rooms": rough, "close": []}).encode())
        square = all(r and len(r) == 4 and all(min(abs(r[i][0] - r[(i + 1) % 4][0]), abs(r[i][1] - r[(i + 1) % 4][1])) < 0.01 for i in range(4)) for r in out["rooms"])
        worst = max(abs(v) for tr, r in zip(truth, out["rooms"]) if r for v in (
            min(p[0] for p in r) - tr[0] - t / 2, min(p[1] for p in r) - tr[1] - t / 2, max(p[0] for p in r) - tr[2] + t / 2, max(p[1] for p in r) - tr[3] + t / 2))
        check(f"hatched walls, reading {seed}: every room stays a square-cornered rectangle, no kinks or bent walls", square, out["how"])
        # known limit: the worktop drawn 8 px inside the top wall can be taken for that wall's face
        check(f"hatched walls, reading {seed}: walls within 10 px of their face (read up to 20 px off)", worst <= 10, round(worst, 1))
    # furniture boxes: read a third of a box off, they land on the rectangle drawn; one read on empty paper is flagged
    W, H = 1200, 900
    img = np.full((H, W), 255, np.uint8)
    cv2.rectangle(img, (100, 100), (1100, 800), 0, 12)
    cv2.rectangle(img, (106, 300), (166, 620), 0, 2)          # a worktop against the left wall
    for cy in (340, 380):
        cv2.circle(img, (136, cy), 12, 0, 1)
    cv2.rectangle(img, (500, 400), (760, 540), 0, 2)          # a table in the room
    png = base64.b64encode(cv2.imencode(".png", img)[1]).decode()
    out = service.trace_rooms(json.dumps({"png": png, "rooms": [], "close": [], "boxes": [[125, 330, 185, 650], [470, 440, 730, 580], [850, 200, 950, 280]]}).encode())
    off = lambda got, want: max(abs(a - b) for a, b in zip(got, want)) if got else 999
    check("furniture: a worktop read 30 px off lands on its outline", off(out["boxes"][0], [106, 300, 166, 620]) <= 3, out["boxes"][0])
    check("furniture: a table read 40 px off lands on its outline", off(out["boxes"][1], [500, 400, 760, 540]) <= 3, out["boxes"][1])
    check("furniture: one read where nothing is drawn is flagged, the drawn ones are not", out["blank"] == [False, False, True], out["blank"])

    # curved walls: a room with a half-round end (radius 250 to the wall's centre line), read as a few slanted edges
    def bow(filled, bay=False):
        img = np.full((1000, 1400), 255, np.uint8)
        t = 12 if filled else 2
        for a, b in (((200, 200), (800, 200)), ((200, 700), (800, 700)), ((200, 200), (200, 700))):
            cv2.line(img, a, b, 0, t)
        if bay:                                               # three straight facets, not a curve
            cv2.polylines(img, [np.array([[800, 200], [1000, 300], [1000, 600], [800, 700]], np.int32)], False, 0, t)
        else:
            cv2.ellipse(img, (800, 450), (250, 250), 0, -90, 90, 0, t)
        cv2.rectangle(img, (400, 690), (490, 710), 255, -1)   # a doorway with its leaf and swing, reported by nobody
        cv2.line(img, (400, 700), (400, 610), 0, 1)
        cv2.ellipse(img, (400, 700), (90, 90), 0, -90, 0, 0, 1)
        return base64.b64encode(cv2.imencode(".png", img)[1]).decode()
    rough = [[210, 215], [790, 195], [930, 250], [1040, 440], [960, 640], [805, 715], [195, 690]]
    for filled in (True, False):
        out = service.trace_rooms(json.dumps({"png": bow(filled), "rooms": [rough], "close": []}).encode())
        arcs = out["arcs"][0]
        ok = len(arcs) == 1 and abs(arcs[0][2] - 800) <= 3 and abs(arcs[0][3] - 450) <= 3 and abs(arcs[0][4] - (244 if filled else 249)) <= 3
        check(f"curved wall ({'filled' if filled else 'thin'} walls, open doorway): one arc on the wall's inside face, the door swing is not one", ok, [[round(v, 1) for v in a] for a in arcs])
        poly = np.array(out["rooms"][0])
        on = poly[arcs[0][0]:arcs[0][0] + arcs[0][1]] if arcs else poly[:0]
        check("curved wall: its corners lie on the circle, half way round", len(on) >= 8 and np.abs(np.hypot(on[:, 0] - 800, on[:, 1] - 450) - arcs[0][4]).max() < 1 and on[:, 0].max() > 1030, len(on))
    out = service.trace_rooms(json.dumps({"png": bow(True), "rooms": [rough], "close": [[400, 700, 490, 700]]}).encode())
    check("curved wall, enclosed room: traced from the contour with its arc", out["how"] == ["traced"] and len(out["arcs"][0]) == 1 and abs(out["arcs"][0][0][4] - 244) <= 3, out["arcs"])
    out = service.trace_rooms(json.dumps({"png": bow(True, bay=True), "rooms": [[[210, 215], [790, 195], [990, 310], [1005, 590], [805, 715], [195, 690]]], "close": []}).encode())
    check("a bay of straight walls is not a curve", out["arcs"] == [[]], out["arcs"])
    # zoomed-in pieces: they cover the part asked for, overlap, and are enlarged
    an = service.analyze_image(Path(tmp, "plan-scan.png").read_bytes())
    box = [100, 80, 100 + 1500, 80 + 900]
    cut = service.cut_tiles(json.dumps({"png": an["render_png"], "box": box}).encode())["tiles"]
    xs, ys = sorted({(t["box"][0], t["box"][2]) for t in cut}), sorted({(t["box"][1], t["box"][3]) for t in cut})
    check("pieces: 3 x 2 for a 1500 x 900 px part, covering it edge to edge", (len(xs), len(ys), xs[0][0], xs[-1][1], ys[0][0], ys[-1][1]) == (3, 2, 100, 1600, 80, 980), (xs, ys))
    check("pieces: neighbours overlap by about a fifth", all(0.15 <= (a[1] - b[0]) / (a[1] - a[0]) <= 0.25 for a, b in zip(xs, xs[1:])), xs)
    piece = cv2.imdecode(np.frombuffer(base64.b64decode(cut[0]["png"]), np.uint8), cv2.IMREAD_COLOR)
    check("pieces: each is enlarged to about 1400 px on its long side", 1350 <= max(piece.shape[:2]) <= 1450, piece.shape)
    # pages
    two = pymupdf.open()
    two.insert_pdf(pymupdf.open(Path(tmp, "plan-vector.pdf")))
    two.new_page().insert_text(pymupdf.Point(72, 72), "NOTES")
    data = two.tobytes()
    p1, p2 = service.analyze_pdf(data, 1), service.analyze_pdf(data, 2)
    check("pdf pages: page and page count reported", (p1["page"], p1["pages"], p2["page"], p2["kind"]) == (1, 2, 2, "pdf-scan"), (p1["kind"], p2["kind"]))
    try:
        service.analyze_pdf(data, 3)
        check("pdf pages: a page past the end is refused", False)
    except ValueError:
        check("pdf pages: a page past the end is refused", True)
print("all passed" if not fail else f"{fail} failed")
sys.exit(1 if fail else 0)
