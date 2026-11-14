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
