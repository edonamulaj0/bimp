"""bimp ingestion service: exact geometry and text from drawings.

POST /analyze (body = file bytes, Content-Type = mime) returns, in one pixel space (the returned render):
  kind      pdf-vector | pdf-scan | image | dxf
  width, height, render_png (base64)
  segments  [[x1, y1, x2, y2], ...]   line work for snapping (vector lines, or wall strokes found by OpenCV)
  texts     [{text, bbox: [x0, y0, x1, y1]}]  exact vector/DXF text, none for scans
  scale     {meters_per_px, source, ratio?} when the drawing states it exactly (1:N on a vector sheet, DXF units), else null
  paper_mm_per_px  size of one render pixel on the paper sheet when known (PDF page size; image DPI metadata), else null.
            Lets the Worker turn a measured dimension into a drawing scale and round it to a preferred one.
  detections [{kind, conf, bbox: [x0, y0, x1, y1]}] for scans and images: windows, doors, toilets, sinks, showers and
            bathtubs found by the symbol detector (models/fixtures-v1.onnx, trained in ml/), or null when the model or
            onnxruntime is not installed. Counting symbols is the detector's job, not the language model's.
POST /analyze takes the page of a PDF to read in the x-page header (1-based; default 1) and returns `page` and `pages`.
POST /trace returns exact room outlines traced from the wall lines of a render (see trace_rooms).
The model never measures; this service and the Worker do.

Every parse runs in a child process with memory, CPU and wall-clock limits, and counts entities, points, drawing items
and text spans as it goes, so one hostile file (a DXF block bomb, a 30000 x 30000 px PNG, a PDF with millions of path
operators) fails with 422 instead of taking the instance down.
"""
import asyncio
import base64
import io
import math
import multiprocessing as mp
import os
import re
import resource
import traceback
from collections import Counter

os.environ.setdefault("OPENCV_IO_MAX_IMAGE_PIXELS", str(50_000_000))

import cv2
import ezdxf
import numpy as np
from PIL import Image
import pymupdf
from ezdxf import path as dxfpath
from ezdxf import recover
from starlette.applications import Starlette
from starlette.requests import Request
from starlette.responses import JSONResponse
from starlette.routing import Route

MAX_SIDE = 3000          # render size cap; Gemini downsamples larger images anyway
MAX_SEGMENTS = 20000
SCALE_RE = re.compile(r"(?<![\d.,])1\s*:\s*(\d{1,4})(?![\d.,])")
DXF_UNITS = {1: 0.0254, 2: 0.3048, 4: 0.001, 5: 0.01, 6: 1.0, 14: 0.1}  # $INSUNITS -> metres
MAX_BODY = 50 * 1024 * 1024
MAX_PIXELS = 50_000_000  # images and rendered pages
MAX_ENTITIES = 200_000   # DXF entities after expanding blocks
MAX_POINTS = 2_000_000   # DXF flattened vertices
MAX_ITEMS = 200_000      # PDF drawing items
MAX_SPANS = 20_000       # PDF text spans
MAX_TEXTS = 5_000        # texts returned
MEM_LIMIT = 3 * 1024 ** 3
CPU_S, WALL_S = 90, 120
Image.MAX_IMAGE_PIXELS = MAX_PIXELS

# Symbol detector (YOLO11s exported to ONNX, see ml/). Thresholds are the ones tuned for exact counts on CubiCasa5K's
# val split (models/fixtures-v1.report.json); change them together with the model.
DET_MODEL = os.environ.get("BIMP_DETECTOR", os.path.join(os.path.dirname(os.path.abspath(__file__)), "models", "fixtures-v1.onnx"))
DET_SIZE = 1024
DET_KINDS = ["window", "door", "toilet", "sink", "shower_bath"]
DET_THRESHOLD = {"window": 0.425, "door": 0.4, "toilet": 0.375, "sink": 0.35, "shower_bath": 0.2}
DET_IOU = 0.5


class TooLarge(ValueError):
    """A limit was hit; the message is safe to show to the user."""


def png_b64(img: np.ndarray) -> str:
    ok, buf = cv2.imencode(".png", img, [cv2.IMWRITE_PNG_COMPRESSION, 6])
    if not ok:
        raise ValueError("could not encode render")
    return base64.b64encode(buf.tobytes()).decode()


def keep_longest(segs, min_len):
    segs = [s for s in segs if math.hypot(s[2] - s[0], s[3] - s[1]) >= min_len]
    segs.sort(key=lambda s: -math.hypot(s[2] - s[0], s[3] - s[1]))
    return [[round(v, 2) for v in s] for s in segs[:MAX_SEGMENTS]]


def scale_from_texts(texts):
    """Most frequent 1:N on the sheet. Several different ratios usually means details at other scales."""
    found = Counter()
    for t in texts:
        for m in SCALE_RE.finditer(t["text"]):
            n = int(m.group(1))
            if 5 <= n <= 2500:
                found[n] += 1
    if not found:
        return None, []
    return found.most_common(1)[0][0], sorted(found)


def wall_segments(gray: np.ndarray):
    """Thick dark strokes (walls) as line segments: Otsu threshold, morphological opening, probabilistic Hough."""
    _, bw = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)
    k = max(3, round(max(gray.shape) / 500))
    thick = cv2.morphologyEx(bw, cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_RECT, (k, k)))
    size = max(gray.shape)
    lines = cv2.HoughLinesP(thick, 1, np.pi / 360, threshold=60, minLineLength=size * 0.02, maxLineGap=k * 2)
    segs = [] if lines is None else lines.reshape(-1, 4).astype(float).tolist()
    return keep_longest(segs, size * 0.02)


def detect_symbols(img: np.ndarray):
    """Windows, doors, toilets, sinks, showers/bathtubs on a BGR render, as boxes in its pixel space. None = no detector."""
    if not os.path.exists(DET_MODEL):
        return None
    try:
        import onnxruntime as ort
    except ImportError:
        return None
    h, w = img.shape[:2]
    r = DET_SIZE / max(h, w)  # letterbox: longest side to DET_SIZE, grey padding, as in training
    nw, nh = max(1, round(w * r)), max(1, round(h * r))
    left, top = (DET_SIZE - nw) // 2, (DET_SIZE - nh) // 2
    canvas = np.full((DET_SIZE, DET_SIZE, 3), 114, np.uint8)
    canvas[top:top + nh, left:left + nw] = cv2.resize(img, (nw, nh), interpolation=cv2.INTER_LINEAR)
    x = np.ascontiguousarray(canvas[:, :, ::-1].transpose(2, 0, 1)[None], dtype=np.float32) / 255.0
    opts = ort.SessionOptions()
    opts.intra_op_num_threads = 2
    sess = ort.InferenceSession(DET_MODEL, opts, providers=["CPUExecutionProvider"])
    out = sess.run(None, {sess.get_inputs()[0].name: x})[0][0]  # (4 + classes, candidates): cx, cy, w, h, scores
    boxes, scores = out[:4].T, out[4:].T
    found = []
    for k, kind in enumerate(DET_KINDS):
        thr = DET_THRESHOLD[kind]
        idx = np.nonzero(scores[:, k] >= thr)[0]
        if not len(idx):
            continue
        b, sc = boxes[idx], scores[idx, k]
        xywh = np.stack([b[:, 0] - b[:, 2] / 2, b[:, 1] - b[:, 3] / 2, b[:, 2], b[:, 3]], 1)
        for i in np.array(cv2.dnn.NMSBoxes(xywh.tolist(), sc.tolist(), thr, DET_IOU)).reshape(-1):
            x0, y0, bw, bh = xywh[i]
            box = [(x0 - left) / r, (y0 - top) / r, (x0 + bw - left) / r, (y0 + bh - top) / r]
            box = [round(float(min(max(v, 0), w if j % 2 == 0 else h)), 1) for j, v in enumerate(box)]
            found.append({"kind": kind, "conf": round(float(sc[i]), 3), "bbox": box})
    return found


def fit(img: np.ndarray):
    h, w = img.shape[:2]
    f = min(1.0, MAX_SIDE / max(w, h))
    if f < 1:
        img = cv2.resize(img, (round(w * f), round(h * f)), interpolation=cv2.INTER_AREA)
    return img, f


def image_dpi(data: bytes):
    """Scanner DPI from PNG pHYs / JPEG JFIF / TIFF metadata; None when absent or implausible."""
    try:
        dpi = Image.open(io.BytesIO(data)).info.get("dpi")
        x = float(dpi[0]) if dpi else 0
        return x if 150 <= x <= 2400 and round(x) != 144 else None  # 72/96/144 are software defaults, not a scanner
    except Exception:
        return None


def analyze_image(data: bytes):
    try:
        w0, h0 = Image.open(io.BytesIO(data)).size  # header only: check the size before decoding
    except Image.DecompressionBombError:
        raise TooLarge("the image has too many pixels (50 megapixels at most)")
    except Exception:
        raise ValueError("unreadable image")
    if w0 * h0 > MAX_PIXELS:
        raise TooLarge("the image has too many pixels (50 megapixels at most)")
    img = cv2.imdecode(np.frombuffer(data, np.uint8), cv2.IMREAD_COLOR)
    if img is None:
        raise ValueError("unreadable image")
    img, f = fit(img)
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    h, w = gray.shape
    dpi = image_dpi(data)
    return {"kind": "image", "width": w, "height": h, "render_png": png_b64(img), "segments": wall_segments(gray), "texts": [], "scale": None,
            "paper_mm_per_px": 25.4 / (dpi * f) if dpi else None, "detections": detect_symbols(img)}


def analyze_pdf(data: bytes, page_no: int = 1):
    doc = pymupdf.open(stream=data, filetype="pdf")
    if not 1 <= page_no <= doc.page_count:
        raise ValueError("no such page")
    page = doc[page_no - 1]
    W, H = page.rect.width, page.rect.height
    dpi = min(200.0, MAX_SIDE * 72 / max(W, H))
    pix = page.get_pixmap(matrix=pymupdf.Matrix(dpi / 72, dpi / 72), alpha=False)
    img = np.frombuffer(pix.samples, np.uint8).reshape(pix.height, pix.width, pix.n)
    img = cv2.cvtColor(img, cv2.COLOR_RGBA2BGR if pix.n == 4 else cv2.COLOR_RGB2BGR)
    k = pix.width / W                       # px per point
    rot = page.rotation_matrix              # unrotated page space -> displayed page space

    def pt(p):
        q = (p if isinstance(p, pymupdf.Point) else pymupdf.Point(*p)) * rot
        return q.x * k, q.y * k

    segs, items = [], 0
    for d in page.get_drawings():
        items += len(d["items"])
        if items > MAX_ITEMS:
            raise TooLarge("the sheet has too much line work to read")
        for it in d["items"]:
            if it[0] == "l":
                segs.append([*pt(it[1]), *pt(it[2])])
            elif it[0] in ("re", "qu"):
                q = it[1].quad if it[0] == "re" else it[1]
                c = [pt(q.ul), pt(q.ur), pt(q.lr), pt(q.ll)]
                segs += [[*c[i], *c[(i + 1) % 4]] for i in range(4)]
    texts, spans = [], 0
    for b in page.get_text("dict")["blocks"]:
        for line in b.get("lines", []):
            spans += len(line["spans"])
            if spans > MAX_SPANS:
                raise TooLarge("the sheet has too much text to read")
            for s in line["spans"]:
                if s["text"].strip():
                    r = pymupdf.Rect(s["bbox"]) * rot
                    texts.append({"text": s["text"].strip(), "bbox": [round(v * k, 1) for v in (r.x0, r.y0, r.x1, r.y1)]})

    size = max(pix.width, pix.height)
    vector = len(segs) > 50 and len(texts) > 3
    out = {"kind": "pdf-vector" if vector else "pdf-scan", "pages": doc.page_count, "page": page_no, "width": pix.width, "height": pix.height,
           "render_png": png_b64(img), "texts": texts[:MAX_TEXTS], "scale": None, "paper_mm_per_px": 25.4 / 72 / k,
           "detections": None if vector else detect_symbols(img)}  # vector sheets are read exactly; the detector is for scans
    if vector:
        out["segments"] = keep_longest(segs, size * 0.004)
        n, all_ratios = scale_from_texts(texts)
        if n:
            # 1 px = 1/k pt; 1 pt = 0.0254/72 m on paper; × N in the real world
            out["scale"] = {"meters_per_px": 0.0254 / 72 / k * n, "ratio": n, "source": f"Sheet scale 1:{n}", "all_ratios": all_ratios}
    else:
        out["segments"] = wall_segments(cv2.cvtColor(img, cv2.COLOR_BGR2GRAY))
    return out


def dxf_entities(entities, depth=0, seen=None):
    """Entities with block references expanded (4 levels deep), counted so nested or arrayed blocks can't explode."""
    seen = seen if seen is not None else [0]
    for e in entities:
        seen[0] += 1
        if seen[0] > MAX_ENTITIES:
            raise TooLarge("the DXF has too many entities to read")
        if e.dxftype() == "INSERT" and depth < 4:
            if getattr(e.dxf, "row_count", 1) * getattr(e.dxf, "column_count", 1) > 1000:
                raise TooLarge("the DXF has a block array that is too large")
            try:
                yield from dxf_entities(e.virtual_entities(), depth + 1, seen)
            except TooLarge:
                raise
            except Exception:
                continue
        else:
            yield e


def analyze_dxf(data: bytes):
    doc, _ = recover.read(io.BytesIO(data))
    msp = doc.modelspace()
    units = int(doc.header.get("$INSUNITS", 0))
    unit_m = DXF_UNITS.get(units)
    lines, texts, npts = [], [], 0
    for e in dxf_entities(msp):
        t = e.dxftype()
        if t in ("TEXT", "MTEXT"):
            s = e.plain_text() if t == "MTEXT" else e.dxf.text
            if s and s.strip() and len(texts) < MAX_TEXTS:
                texts.append((s.strip(), e.dxf.insert.x, e.dxf.insert.y, getattr(e.dxf, "height", 0) or getattr(e.dxf, "char_height", 0) or 0))
            continue
        try:
            pts = []
            for p in dxfpath.make_path(e).flattening(0.01):  # a generator: stop a huge circle before it fills memory
                pts.append(p)
                if npts + len(pts) > MAX_POINTS:
                    raise TooLarge("the DXF has too much line work to read")
        except TooLarge:
            raise
        except Exception:
            continue
        npts += len(pts)
        lines += [(a.x, a.y, b.x, b.y) for a, b in zip(pts, pts[1:])]
    if not lines:
        raise ValueError("no line work found in the DXF")

    xs = np.array([v for l in lines for v in (l[0], l[2])])
    ys = np.array([v for l in lines for v in (l[1], l[3])])
    x0, x1 = np.percentile(xs, [0.5, 99.5])   # ignore stray far-away entities
    y0, y1 = np.percentile(ys, [0.5, 99.5])
    ext = max(x1 - x0, y1 - y0) or 1.0
    s = MAX_SIDE * 0.92 / ext                 # px per drawing unit
    pad = MAX_SIDE * 0.04
    W, H = int((x1 - x0) * s + 2 * pad), int((y1 - y0) * s + 2 * pad)
    to_px = lambda x, y: ((x - x0) * s + pad, (y1 - y) * s + pad)   # DXF y is up, image y is down

    img = np.full((H, W, 3), 255, np.uint8)
    segs = []
    for l in lines:
        a, b = to_px(l[0], l[1]), to_px(l[2], l[3])
        if -W < a[0] < 2 * W and -H < a[1] < 2 * H:
            cv2.line(img, tuple(map(round, a)), tuple(map(round, b)), (20, 20, 20), 2, cv2.LINE_AA)
            segs.append([*a, *b])
    out_texts = []
    for txt, x, y, h in texts:
        px, py = to_px(x, y)
        hp = max(10.0, h * s)
        cv2.putText(img, txt.encode("ascii", "replace").decode(), (round(px), round(py)), cv2.FONT_HERSHEY_SIMPLEX, hp / 22, (20, 20, 20), 1, cv2.LINE_AA)
        out_texts.append({"text": txt, "bbox": [round(px, 1), round(py - hp, 1), round(px + hp * 0.6 * len(txt), 1), round(py, 1)]})

    scale = None
    if unit_m:
        scale = {"meters_per_px": unit_m / s, "source": f"DXF drawing units ({ {1: 'in', 2: 'ft', 4: 'mm', 5: 'cm', 6: 'm', 14: 'dm'}[units] })"}
    return {"kind": "dxf", "width": W, "height": H, "render_png": png_b64(img), "segments": keep_longest(segs, MAX_SIDE * 0.004),
            "texts": out_texts, "scale": scale, "units_known": bool(unit_m), "paper_mm_per_px": None}


def trace_rooms(data: bytes):
    """Exact room outlines from the drawing itself.

    Body: JSON {png (base64 render), rooms: [[[x, y], ...], ...], close: [[x1, y1, x2, y2], ...]}, all in render pixels.
    `rooms` are rough outlines (read by the language model); `close` are the door and window openings, drawn shut so
    rooms do not leak into each other. Each room is answered with the outline of the enclosed space it covers, bounded
    by the wall lines, or null when no enclosed space matches it (then the rough outline stands).
    Two wall masks are tried: thick strokes only (filled or hatched walls; thin dimension, furniture and text lines
    vanish), then all line work (walls drawn as thin double lines), which must match more closely to be accepted.
    A room still without an outline has each of its edges moved onto the wall face beside it (`how`: traced | fitted).
    `arcs` lists, per room, the curved walls of its traced outline: [first corner, number of corners, centre x,
    centre y, radius]; the corners from the first one on lie on that circle.
    `boxes` (rough boxes of fittings and furniture) come back tightened onto the line work drawn there, or null;
    `blank` says for each whether nothing at all is drawn where it was read.
    `exterior_px` is the measured thickness of the outside walls where they are drawn filled, else null.
    """
    import json
    req = json.loads(data)
    img = cv2.imdecode(np.frombuffer(base64.b64decode(req["png"]), np.uint8), cv2.IMREAD_GRAYSCALE)
    if img is None:
        raise ValueError("unreadable render")
    h, w = img.shape
    if h * w > MAX_PIXELS:
        raise TooLarge("the render has too many pixels")
    rooms = [np.array(r, np.float64).reshape(-1, 2) for r in req.get("rooms", [])][:200]
    close = [c for c in req.get("close", []) if len(c) == 4][:500]
    _, bw = cv2.threshold(img, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)
    k = max(3, round(max(h, w) / 500))
    thick = cv2.morphologyEx(bw, cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_RECT, (k, k)))
    best = [None] * len(rooms)  # (iou, polygon)
    arcs = [[] for _ in rooms]  # per room: [first corner, corners, centre x, centre y, radius] of each curved wall
    axis = plan_axis(bw, max(h, w))
    for mask, need in ((thick, 0.6), (bw, 0.75)):
        walls = mask.copy()
        for x1, y1, x2, y2 in close:
            L = math.hypot(x2 - x1, y2 - y1)
            if L < 1:
                continue
            e = min(3.0 * k, 0.15 * L) / L  # reach into the jambs at both ends
            a = (round(x1 - (x2 - x1) * e), round(y1 - (y2 - y1) * e))
            b = (round(x2 + (x2 - x1) * e), round(y2 + (y2 - y1) * e))
            cv2.line(walls, a, b, 255, max(3, k))
        n, labels, stats, _ = cv2.connectedComponentsWithStats((walls == 0).astype(np.uint8), connectivity=4)
        for i, poly in enumerate(rooms):
            if len(poly) < 3 or (best[i] and best[i][0] >= need):
                continue
            x0, y0 = np.floor(poly.min(0)).astype(int)
            x1, y1 = np.ceil(poly.max(0)).astype(int)
            x0, y0, x1, y1 = max(0, x0), max(0, y0), min(w, x1 + 1), min(h, y1 + 1)
            if x1 - x0 < 4 or y1 - y0 < 4:
                continue
            pm = np.zeros((y1 - y0, x1 - x0), np.uint8)
            cv2.fillPoly(pm, [np.round(poly - [x0, y0]).astype(np.int32)], 1)
            counts = np.bincount(labels[y0:y1, x0:x1][pm > 0], minlength=n)
            counts[0] = 0  # label 0 is the walls themselves
            c = int(counts.argmax())
            if not counts[c]:
                continue
            cx, cy, cw, ch, area = stats[c]
            if cx <= 0 or cy <= 0 or cx + cw >= w or cy + ch >= h:
                continue  # reaches the edge of the sheet: the outside, not a room
            iou = counts[c] / (int(pm.sum()) + int(area) - counts[c])
            if iou < need or (best[i] and best[i][0] >= iou):
                continue
            comp = (labels[cy:cy + ch, cx:cx + cw] == c).astype(np.uint8)
            cs, _ = cv2.findContours(comp, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
            if not cs:
                continue
            out = cv2.approxPolyDP(max(cs, key=cv2.contourArea), max(2.0, 0.75 * k), True).reshape(-1, 2)
            # Only a clean outline replaces the reading: straight runs along the drawing's axes and no more corners
            # than the reading plus a jog. A contour that wanders round door leaves, hatching or handwriting is noise,
            # and a wrong wall is worse than one a little out of place.
            if len(out) >= 3 and clean_outline(out.astype(float), poly, axis, k, 0.03 * max(h, w)):
                best[i], arcs[i] = (float(iou), [[float(px + cx), float(py + cy)] for px, py in out]), []
                continue
            # A curved wall is not noise: where the contour runs along a circle it is kept as an arc, and the rest of
            # the outline has to be as clean as any other.
            dense, _ = cv2.findContours(comp, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
            curved = curved_outline(max(dense, key=cv2.contourArea).reshape(-1, 2).astype(float), comp, k, max(h, w),
                                    [((x1 - cx, y1 - cy), (x2 - cx, y2 - cy)) for x1, y1, x2, y2 in close], thin_walls=mask is bw)
            if curved and clean_outline(curved[0], poly, axis, k, 0.03 * max(h, w), on_arc=curved[2]):
                best[i] = (float(iou), [[float(px + cx), float(py + cy)] for px, py in curved[0]])
                arcs[i] = [[a, n, float(ax + cx), float(ay + cy), float(r)] for a, n, ax, ay, r in curved[1]]
    # Rooms with no enclosed space of their own (an open plan, a doorway nobody reported): each edge of the outline as
    # read is moved onto the wall face it runs along. A wall is still mostly wall where a door or window breaks it, so
    # this needs no openings at all.
    how = ["traced" if b else None for b in best]
    walls_thick = int(thick.sum()) > 255 * 0.002 * h * w   # are there filled walls at all, or only thin lines
    for i, poly in enumerate(rooms):
        if best[i] or len(poly) < 3:
            continue
        # filled walls first; walls drawn as thin lines, hatched or empty, next
        fit = fit_edges(poly, thick, k, h, w, solid_run=k + 1, axis=axis) if walls_thick else None
        if fit is None:
            fit = fit_edges(poly, bw, k, h, w, solid_run=1, axis=axis)
        if fit is not None:
            best[i], how[i], arcs[i] = (0.0, fit[0]), "fitted", fit[1]

    out_rooms = [b and b[1] for b in best]
    boxes, blank = refine_boxes(req.get("boxes", [])[:400], bw, k, h, w)
    return {"rooms": out_rooms, "match": [b and round(b[0], 3) for b in best], "how": how, "arcs": arcs,
            "boxes": boxes, "blank": blank,
            "exterior_px": exterior_thickness(out_rooms, thick, k, h, w) if walls_thick else None}


def plan_axis(bw: np.ndarray, size: int) -> float:
    """The direction (radians, modulo 90°) most of the drawing's line work runs along."""
    lines = cv2.HoughLinesP(bw, 1, np.pi / 360, threshold=60, minLineLength=size * 0.04, maxLineGap=4)
    if lines is None:
        return 0.0
    l = lines.reshape(-1, 4).astype(float)
    ang = np.arctan2(l[:, 3] - l[:, 1], l[:, 2] - l[:, 0]) % (np.pi / 2)
    hist = np.bincount(np.rint(np.degrees(ang) * 2).astype(int) % 180, weights=np.hypot(l[:, 2] - l[:, 0], l[:, 3] - l[:, 1]), minlength=180)
    hist = hist + np.roll(hist, 1) + np.roll(hist, -1)
    return float(np.radians(int(hist.argmax()) / 2))


def off_axis(u, axis: float) -> float:
    """Degrees between a direction and the nearest of the drawing's two axes."""
    d = abs(math.degrees(math.atan2(u[1], u[0]) - axis)) % 90
    return min(d, 90 - d)


def reads_slanted(u, L: float, axis: float, noise: float) -> bool:
    """Whether an edge as read is really a slanted wall: off the axes by more than a sloppy reading of a straight wall
    explains. A short edge read 15° off is noise; a long one is a slanted wall."""
    off = off_axis(u, axis)
    return off > 12 and L * math.sin(math.radians(off)) > 1.5 * noise


def clean_outline(out: np.ndarray, read: np.ndarray, axis: float, k: int, noise: float, on_arc=None) -> bool:
    """Whether a traced contour is fit to replace the outline as read (see trace_rooms).

    `on_arc[i]`: the edge from corner i to the next runs along a curved wall (see curved_outline); such edges are
    judged by their circle, not by these rules, and a room with one is believed however it was read."""
    out = np.asarray(out, float)
    arc = np.zeros(len(out), bool) if on_arc is None else np.asarray(on_arc, bool)
    if (~arc).sum() > len(read) + 4:
        return False
    edges = np.roll(out, -1, axis=0) - out
    length = np.hypot(edges[:, 0], edges[:, 1])
    straight = length[~arc]
    if length.sum() <= 0 or straight[straight < 4 * k].sum() > 0.08 * length.sum():
        return False                                          # too much of it is little steps
    r_edges = np.roll(read, -1, axis=0) - read
    r_len = np.hypot(r_edges[:, 0], r_edges[:, 1])
    if not arc.any() and any(L > 0 and reads_slanted(e, L, axis, noise) for e, L in zip(r_edges, r_len)):
        return False                                          # a room read with a slanted wall: the fit below keeps its shape
    return all(off_axis(e, axis) <= 3 for e, L, a in zip(edges, length, arc) if L >= 4 * k and not a)


def fit_circle(pts: np.ndarray):
    """Least-squares circle through points (Kåsa): centre x, centre y, radius, and the largest distance off it."""
    x, y = pts[:, 0], pts[:, 1]
    A = np.column_stack([x, y, np.ones(len(pts))])
    (a, b, c), *_ = np.linalg.lstsq(A, x * x + y * y, rcond=None)
    cx, cy = a / 2, b / 2
    r2 = c + cx * cx + cy * cy
    if not r2 > 0:
        return None
    r = math.sqrt(r2)
    return float(cx), float(cy), r, float(np.abs(np.hypot(x - cx, y - cy) - r).max())


def curved_outline(contour: np.ndarray, comp: np.ndarray, k: int, size: int, openings, thin_walls: bool):
    """A traced contour with its curved walls kept as arcs: (corners, arcs, on_arc), or None when it has none.

    contour: every pixel of the closed contour, in order. A stretch of it is a curved wall when one circle runs
    through it within a pixel or so, over at least 30° and a real length; a straight wall fits no such circle (its
    sweep is nil) and a corner fits none either. arcs = [first corner, corners, cx, cy, r]: that many corners of the
    result, from the first, lie on the circle. The rest of the contour is simplified as usual.
    A door's swing is an arc too. Where the walls are drawn filled, door leaves and swings are not in the picture at
    all; where they are thin lines (`thin_walls`), an arc counts only if it bulges out of the room (a swing bites into
    it) and its centre is not at the end of a known opening (the hinge)."""
    n = len(contour)
    if n < 40:
        return None
    eps = max(1.5, 0.4 * k)
    fine = cv2.approxPolyDP(contour.reshape(-1, 1, 2).astype(np.float32), eps, True).reshape(-1, 2)
    if len(fine) < 4:
        return None
    # where on the contour each fine corner is
    index = {(int(x), int(y)): j for j, (x, y) in reversed(list(enumerate(contour)))}
    at = [index.get((int(round(x)), int(round(y)))) for x, y in fine]
    if any(a is None for a in at):
        return None
    m, tol, min_len = len(fine), max(1.2, 0.35 * k), 12 * k
    stretch = lambda a, b: contour[a:b + 1] if a <= b else np.vstack([contour[a:], contour[:b + 1]])
    found, i, used = [], 0, 0
    while i < m and used < m:
        best = None
        for span in range(3, m):                              # corners i .. i+span: grow while one circle still fits
            j = (i + span) % m
            pts = stretch(at[i], at[j])
            if len(pts) < min_len:
                continue
            c = fit_circle(pts)
            if c is None or c[3] > tol or c[2] > 3 * size or c[2] < 4 * k:
                if best is not None or (c is not None and c[3] > 4 * tol):
                    break
                continue
            sweep = len(pts) / c[2]                           # arc length over radius
            if sweep >= math.radians(30) and sweep <= 2 * math.pi:
                best = (span, c, pts, sweep)
        if best is None:
            i += 1
            used += 1
            continue
        span, (cx, cy, r, _), pts, sweep = best
        mid = pts[len(pts) // 2]
        inward = np.array([cx, cy]) - mid
        inward /= max(1e-9, float(np.hypot(*inward)))
        probe = mid + inward * max(3.0, 1.5 * k)             # a step from the wall towards the circle's centre
        px, py = int(round(probe[0])), int(round(probe[1]))
        bulges_out = 0 <= py < comp.shape[0] and 0 <= px < comp.shape[1] and comp[py, px] > 0
        hinge = any(math.hypot(cx - ex, cy - ey) < 0.3 * r for a, b in openings for ex, ey in (a, b))
        if not thin_walls or (bulges_out and not hinge):
            found.append((i, (i + span) % m, cx, cy, r, pts, sweep))
        i += span
        used += span
    if not found:
        return None
    # corners in order: arcs sampled along their circle, the stretches between them simplified as a plain outline is
    corners, arcs, on_arc = [], [], []
    coarse = max(2.0, 0.75 * k)
    for f, (a, b, cx, cy, r, pts, sweep) in enumerate(found):
        steps = max(4, int(math.ceil(sweep / (2 * math.acos(max(-1.0, 1 - 0.5 / r))))))
        t0 = math.atan2(pts[0][1] - cy, pts[0][0] - cx)
        t1 = math.atan2(pts[-1][1] - cy, pts[-1][0] - cx)
        turn = math.atan2(pts[len(pts) // 2][1] - cy, pts[len(pts) // 2][0] - cx) - t0
        ccw = math.sin(turn) > 0                              # which way round the circle the contour goes
        d = (t1 - t0) % (2 * math.pi) if ccw else -((t0 - t1) % (2 * math.pi))
        first = len(corners)
        for q in range(steps + 1):
            t = t0 + d * q / steps
            corners.append([cx + r * math.cos(t), cy + r * math.sin(t)])
            on_arc.append(q < steps)
        arcs.append([first, steps + 1, cx, cy, r])
        nxt = found[(f + 1) % len(found)][0]
        between = stretch(at[b], at[nxt])                     # the straight part up to the next arc
        if len(between) > 2:
            line = cv2.approxPolyDP(between.reshape(-1, 1, 2).astype(np.float32), coarse, False).reshape(-1, 2)
            for x, y in line[1:-1]:
                corners.append([float(x), float(y)])
                on_arc.append(False)
    return np.array(corners, float), arcs, on_arc


def _sample(mask: np.ndarray, pts: np.ndarray, h: int, w: int) -> np.ndarray:
    """mask > 0 at float points (..., 2), False outside the image."""
    x, y = np.rint(pts[..., 0]).astype(int), np.rint(pts[..., 1]).astype(int)
    ok = (x >= 0) & (x < w) & (y >= 0) & (y < h)
    out = np.zeros(x.shape, bool)
    out[ok] = mask[y[ok], x[ok]] > 0
    return out


def _faces(mask: np.ndarray, a: np.ndarray, u: np.ndarray, nrm: np.ndarray, t: np.ndarray, reach: int, solid_run: int, k: int, h: int, w: int):
    """Where, across an edge, the room turns into wall: for places t along the edge from a, the offsets outward (d)
    at which that happens with real wall behind, and a weight for each (more for more ink behind it).
    Returns (column index into t, d, weight)."""
    offs = np.arange(-reach, reach + 1)
    hit = _sample(mask, a + u * t[:, None, None] + nrm * offs[None, :, None], h, w)   # (along, across)
    # in every column across the edge: the places where it turns from room to wall going outward, with real
    # wall behind them. A door or window leaves its columns empty; furniture adds stray ones.
    run = max(1, solid_run)
    solid = hit.copy()
    for r in range(1, run):
        solid[:, :-r] &= hit[:, r:]
        solid[:, -r:] = False
    rise = solid[:, 1:] & ~hit[:, :-1]
    ti, oi = np.nonzero(rise)
    # a wall has ink behind its face (fill, hatching, its other face); the edge of a worktop or a rug has
    # blank floor behind it. Each place counts for more the more ink follows it.
    csum = np.concatenate([np.zeros((hit.shape[0], 1)), np.cumsum(hit, axis=1)], axis=1)
    span = 4 * k
    end = np.minimum(oi + 1 + span, hit.shape[1])
    weight = 1 + 3 * (csum[ti, end] - csum[ti, oi + 1]) / span
    return ti, offs[oi + 1].astype(float), weight


def _curved_runs(poly: np.ndarray, sign: float):
    """Stretches of a rough outline that were read as a curved wall: three or more corners in a row that each turn
    the same way by a part of a right angle. (first corner, last corner), indices; never wrapping past corner 0,
    which the caller has put on a square corner."""
    n = len(poly)
    e = np.roll(poly, -1, axis=0) - poly
    ang = np.arctan2(e[:, 1], e[:, 0])
    turn = np.degrees((ang - np.roll(ang, 1) + np.pi) % (2 * np.pi) - np.pi)   # at corner i, from edge i-1 to edge i
    runs, i = [], 0
    while i < n:
        if not 8 <= abs(turn[i]) <= 65:
            i += 1
            continue
        j = i
        while j + 1 < n and 8 <= abs(turn[j + 1]) <= 65 and turn[j + 1] * turn[i] > 0:
            j += 1
        if j - i >= 2 and abs(turn[i:j + 1].sum()) >= 40:
            runs.append((i, j))
        i = j + 1
    return runs


def _fit_arc(poly: np.ndarray, run, mask: np.ndarray, sign: float, reach: int, solid_run: int, k: int, h: int, w: int, size: int):
    """The circle of the wall face along a stretch read as curved: (cx, cy, r), or None when the wall there is not
    one circle (a bay of straight facets, a wall the reading only made look round)."""
    i0, i1 = run
    pts, col, wts, ncol = [], [], [], 0
    for i in range(i0, i1):                                   # the chords between the run's corners
        a, b = poly[i], poly[i + 1]
        L = float(np.hypot(*(b - a)))
        if L < 2:
            continue
        u = (b - a) / L
        nrm = np.array([u[1], -u[0]]) * sign
        t = np.arange(0.0, L, 2.0)
        ti, d, wt = _faces(mask, a, u, nrm, t, reach, solid_run, k, h, w)
        pts.append(a + u * t[ti][:, None] + nrm * d[:, None])
        col.append(ti + ncol)
        wts.append(wt)
        ncol += len(t)
    if ncol < 12 or not pts:
        return None
    P, C, Wt = np.vstack(pts), np.concatenate(col), np.concatenate(wts)
    if len(P) < 12:
        return None
    rng = np.random.default_rng(7)                            # the same drawing always gives the same plan
    order = np.argsort(C)
    P, C, Wt = P[order], C[order], Wt[order]
    thirds = [np.nonzero((C >= ncol * q / 3) & (C < ncol * (q + 1) / 3))[0] for q in range(3)]
    if any(len(q) == 0 for q in thirds):
        return None
    mid_read = poly[(i0 + i1) // 2]
    best = None
    for _ in range(300):                                      # a circle through one face point from each third
        tri = P[[rng.choice(q) for q in thirds]]
        (x1, y1), (x2, y2), (x3, y3) = tri
        det = 2 * (x1 * (y2 - y3) + x2 * (y3 - y1) + x3 * (y1 - y2))
        if abs(det) < 1e-6:
            continue
        cx = ((x1 * x1 + y1 * y1) * (y2 - y3) + (x2 * x2 + y2 * y2) * (y3 - y1) + (x3 * x3 + y3 * y3) * (y1 - y2)) / det
        cy = ((x1 * x1 + y1 * y1) * (x3 - x2) + (x2 * x2 + y2 * y2) * (x1 - x3) + (x3 * x3 + y3 * y3) * (x2 - x1)) / det
        r = math.hypot(x1 - cx, y1 - cy)
        if not 4 * k <= r <= 3 * size:
            continue
        near = np.abs(np.hypot(P[:, 0] - cx, P[:, 1] - cy) - r) <= 1.5
        cols = len(np.unique(C[near]))
        score = (cols, float(Wt[near].sum()), -abs(math.hypot(mid_read[0] - cx, mid_read[1] - cy) - r))
        if best is None or score > best[0]:
            best = (score, near)
    if best is None or best[0][0] < 0.7 * ncol:
        return None                                           # the wall is not on one circle for most of the stretch
    on = np.zeros(ncol, bool)
    on[np.unique(C[best[1]])] = True
    if any(on[int(ncol * q / 4):int(ncol * (q + 1) / 4)].mean() < 0.5 for q in range(4)):
        return None                                           # ...or not all the way along it
    c = fit_circle(P[best[1]])
    if c is None or not 4 * k <= c[2] <= 3 * size:
        return None
    cx, cy, r, _ = c
    # the circle is the wall that was read: every corner of the stretch lies beside it (a door's swing, a round
    # table or a dash-dotted boundary line nearby is a circle too, but not through these corners)
    if any(abs(math.hypot(poly[i][0] - cx, poly[i][1] - cy) - r) > reach for i in range(i0, i1 + 1)):
        return None
    # the stretch has to go a real way round its circle: a nearly straight wall is not a curved one
    a0 = math.atan2(poly[i0][1] - cy, poly[i0][0] - cx)
    a1 = math.atan2(poly[i1][1] - cy, poly[i1][0] - cx)
    sweep = abs((a1 - a0 + math.pi) % (2 * math.pi) - math.pi)
    if sweep < math.radians(25):
        return None
    return cx, cy, r


def fit_edges(poly: np.ndarray, mask: np.ndarray, k: int, h: int, w: int, solid_run: int = 1, axis: float = 0.0):
    """Moves each edge of a rough outline onto the inside face of the wall beside it; None if too few edges find one.
    Returns (corners, arcs): arcs = [first corner, corners, cx, cy, r] for each curved wall, whose corners lie on that
    circle. A stretch read as curved (a run of short edges turning one way) is fitted with one circle through the wall
    face along it, not edge by edge.

    `solid_run`: how many pixels of wall must follow a face for it to count, so that a boldly drawn piece of furniture
    is not taken for a filled wall. 1 when the walls themselves are thin lines."""
    n = len(poly)
    area2 = float(np.sum(poly[:, 0] * np.roll(poly[:, 1], -1) - np.roll(poly[:, 0], -1) * poly[:, 1]))
    if abs(area2) < 2 * 16 * k * k:
        return None
    sign = 1.0 if area2 > 0 else -1.0
    size = math.sqrt(abs(area2) / 2)
    reach = int(max(3 * k, min(0.035 * max(h, w), 0.3 * size)))   # how far off the model may have put an edge
    # start on a square corner, so no curved stretch runs across the start of the list
    e0 = np.roll(poly, -1, axis=0) - poly
    ang0 = np.arctan2(e0[:, 1], e0[:, 0])
    turn0 = np.abs(np.degrees((ang0 - np.roll(ang0, 1) + np.pi) % (2 * np.pi) - np.pi))
    square = np.nonzero(turn0 > 65)[0]
    shift = int(square[0]) if len(square) else 0
    poly = np.roll(poly, -shift, axis=0)
    circle_of = {}                                            # edge index -> (run, circle) for chords of a curved wall
    for run in _curved_runs(poly, sign):
        c = _fit_arc(poly, run, mask, sign, reach, solid_run, k, h, w, max(h, w))
        if c:
            for i in range(run[0], run[1]):
                circle_of[i] = (run, c)
    lines, fitted, total = [], 0.0, 0.0
    for i in range(n):
        a, b = poly[i], poly[(i + 1) % n]
        L = float(np.hypot(*(b - a)))
        if L < 1e-6:
            lines.append(None)
            continue
        if i in circle_of:                                    # a chord of a curved wall: its circle stands for it
            lines.append(None)
            total += L
            fitted += L
            continue
        u = (b - a) / L
        nrm = np.array([u[1], -u[0]]) * sign               # points out of the room
        total += L
        d0 = d1 = 0.0                                          # how far the face lies outward at the edge's two ends
        if L >= 4 * k:
            t = np.arange(0.1 * L, 0.9 * L, 2.0)             # the corners belong to the neighbouring walls
            ti, dd, weight = _faces(mask, a, u, nrm, t, reach, solid_run, k, h, w)
            if len(ti) >= 6:
                tt = t[ti]
                # the face is a straight line d = c + m·t; the outline as read may be tilted against it, so tilts are
                # tried and the line most columns agree on wins, the one nearest the read edge on a tie
                best = None
                for m in np.linspace(-0.12, 0.12, 49):
                    r = dd - m * (tt - L / 2)
                    bins = np.rint(r).astype(int) + reach * 2
                    cnt = np.bincount(bins[bins >= 0], weights=weight[bins >= 0], minlength=4 * reach + 1)
                    c = int(cnt.argmax())
                    score = (round(float(cnt[c] + cnt[max(0, c - 1)] + cnt[min(len(cnt) - 1, c + 1)]), 1), -abs(c - reach * 2) - 40 * abs(m))
                    if best is None or score > best[0]:
                        best = (score, m, c - reach * 2)
                (votes, _), m, c = best
                near = np.abs(dd - m * (tt - L / 2) - c) <= 1.5
                cols = len(np.unique(ti[near]))
                if cols >= 0.35 * len(t):                     # the wall is there along a good part of the edge (openings take the rest)
                    m, c0 = np.polyfit(tt[near], dd[near], 1) if cols >= 8 else (m, c - m * L / 2)
                    d0, d1 = float(c0), float(c0 + m * L)
                    fitted += L
        # The fit says where the wall is, not which way it runs: an edge read along the drawing's axes lies exactly on
        # the axis; an edge read as slanted keeps its own direction unless the fit runs the same way. So a room keeps
        # the shape it was read with, and stray marks cannot bend a wall.
        mid = (a + b) / 2 + nrm * ((d0 + d1) / 2 - 0.5)
        p0, p1 = a + nrm * (d0 - 0.5), b + nrm * (d1 - 0.5)
        fit_u = (p1 - p0) / max(1e-9, float(np.hypot(*(p1 - p0))))
        if not reads_slanted(u, L, axis, reach):
            ang = axis + round((math.atan2(u[1], u[0]) - axis) / (math.pi / 2)) * (math.pi / 2)
            use = np.array([math.cos(ang), math.sin(ang)])
        else:
            use = fit_u if abs(fit_u[0] * u[1] - fit_u[1] * u[0]) <= math.sin(math.radians(3)) else u
        lines.append((mid, use))
    if total <= 0 or fitted / total < 0.6:
        return None

    def meet(line, circle, near_pt):
        """Where a straight wall meets a curved one: the crossing of the line and the circle nearest the corner as
        read; where they do not cross, the corner as read moved onto the circle."""
        cx, cy, r = circle
        if line is not None:
            p, d = line
            f = p - np.array([cx, cy])
            bq, cq = 2 * float(np.dot(f, d)), float(np.dot(f, f)) - r * r
            disc = bq * bq - 4 * cq
            if disc >= 0:
                xs = [p + d * ((-bq + s * math.sqrt(disc)) / 2) for s in (1, -1)]
                x = min(xs, key=lambda q: float(np.hypot(*(q - near_pt))))
                if float(np.hypot(*(x - near_pt))) <= 3 * reach:
                    return x
        v = near_pt - np.array([cx, cy])
        return np.array([cx, cy]) + v / max(1e-9, float(np.hypot(*v))) * r

    out, arcs, i = [], [], 0
    while i < n:
        if i in circle_of:
            (i0, i1), circle = circle_of[i]
            cx, cy, r = circle
            start = meet(lines[i0 - 1], circle, poly[i0])
            stop = meet(lines[i1 % n], circle, poly[i1 % n])
            t0, t1 = math.atan2(start[1] - cy, start[0] - cx), math.atan2(stop[1] - cy, stop[0] - cx)
            tm = math.atan2(poly[(i0 + i1) // 2][1] - cy, poly[(i0 + i1) // 2][0] - cx)
            ccw = math.sin(tm - t0) > 0                       # which way round the circle the wall was read
            d = (t1 - t0) % (2 * math.pi) if ccw else -((t0 - t1) % (2 * math.pi))
            steps = max(4, int(math.ceil(abs(d) / (2 * math.acos(max(-1.0, 1 - 0.5 / r))))))
            arcs.append([len(out), steps + 1, float(cx), float(cy), float(r)])
            out += [[cx + r * math.cos(t0 + d * q / steps), cy + r * math.sin(t0 + d * q / steps)] for q in range(steps + 1)]
            i = i1 + 1                                        # the run's last corner is the arc's last point
            continue
        p, q = lines[i - 1], lines[i]                        # corner i lies on the edge before and the edge after
        if p is None or q is None:
            out.append(poly[i].tolist())
            i += 1
            continue
        cross = p[1][0] * q[1][1] - p[1][1] * q[1][0]
        if abs(cross) < 0.2:                                  # nearly one line: keep the corner, moved onto it
            out.append((q[0] + q[1] * float(np.dot(poly[i] - q[0], q[1]))).tolist())
            i += 1
            continue
        t = ((q[0][0] - p[0][0]) * q[1][1] - (q[0][1] - p[0][1]) * q[1][0]) / cross
        c = p[0] + p[1] * t
        out.append(c.tolist() if np.hypot(*(c - poly[i])) <= 3 * reach else poly[i].tolist())
        i += 1
    return [[float(x), float(y)] for x, y in out], arcs


def refine_boxes(boxes, bw: np.ndarray, k: int, h: int, w: int):
    """Tightens rough boxes of fittings and furniture onto the line work actually drawn there; None where it is unclear."""
    if not boxes:
        return [], []
    # everything but the walls. Furniture is drawn in lines up to about the width that counts as a thick stroke, so
    # only strokes twice that wide are taken out here.
    wide = cv2.morphologyEx(bw, cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_RECT, (2 * k, 2 * k)))
    thin = cv2.bitwise_and(bw, cv2.bitwise_not(cv2.dilate(wide, np.ones((k, k), np.uint8))))
    out = []
    for box in boxes:
        try:
            x0, y0, x1, y1 = [float(v) for v in box]
        except (TypeError, ValueError):
            out.append(None)
            continue
        bw_, bh_ = x1 - x0, y1 - y0
        if bw_ < 4 or bh_ < 4:
            out.append(None)
            continue
        px, py = max(6.0, 0.3 * bw_), max(6.0, 0.3 * bh_)
        cx0, cy0, cx1, cy1 = int(max(0, x0 - px)), int(max(0, y0 - py)), int(min(w, x1 + px)), int(min(h, y1 + py))
        crop = thin[cy0:cy1, cx0:cx1]
        if crop.size == 0:
            out.append(None)
            continue
        n, _, stats, _ = cv2.connectedComponentsWithStats(crop, connectivity=8)
        H, W = crop.shape
        keep = []
        for sx, sy, sw, sh, area in stats[1:]:
            if area < 6:
                continue
            # a line that runs on past the search window belongs to something else (a floor pattern, a dimension line)
            if (sx <= 0 and cx0 > 0) or (sy <= 0 and cy0 > 0) or (sx + sw >= W and cx1 < w) or (sy + sh >= H and cy1 < h):
                continue
            mx, my = cx0 + sx + sw / 2, cy0 + sy + sh / 2
            if x0 - 0.1 * bw_ <= mx <= x1 + 0.1 * bw_ and y0 - 0.1 * bh_ <= my <= y1 + 0.1 * bh_:
                keep.append((cx0 + sx, cy0 + sy, cx0 + sx + sw, cy0 + sy + sh))
        if not keep:
            out.append(None)
            continue
        rx0, ry0, rx1, ry1 = min(b[0] for b in keep), min(b[1] for b in keep), max(b[2] for b in keep), max(b[3] for b in keep)
        ix, iy = max(0.0, min(x1, rx1) - max(x0, rx0)), max(0.0, min(y1, ry1) - max(y0, ry0))
        ra, ba = (rx1 - rx0) * (ry1 - ry0), bw_ * bh_
        iou = ix * iy / (ra + ba - ix * iy)
        out.append([float(rx0), float(ry0), float(rx1), float(ry1)] if iou >= 0.35 and 0.4 <= ra / ba <= 1.8 else None)
    # What the symbol's own strokes did not settle, the lines along its sides may: worktops, beds, baths and cupboards
    # are drawn as rectangles, often against a wall, and a box read a little off still lies beside the lines it meant.
    across = cv2.dilate(bw, np.ones((3, 1), np.uint8)), cv2.dilate(bw, np.ones((1, 3), np.uint8))
    rough = []
    for box in boxes:
        try:
            rough.append([float(v) for v in box] if len(box) == 4 else None)
        except (TypeError, ValueError):
            rough.append(None)
    def outlined(b) -> float:
        """How much of a box's outline has a line drawn along it."""
        x0, y0, x1, y1 = (int(round(v)) for v in b)
        x0, y0, x1, y1 = max(0, x0), max(0, y0), min(w - 1, x1), min(h - 1, y1)
        if x1 - x0 < 2 or y1 - y0 < 2:
            return 0.0
        sides = [across[0][y0, x0:x1], across[0][y1, x0:x1], across[1][y0:y1, x0], across[1][y0:y1, x1]]
        return float(sum(int((s > 0).sum()) for s in sides)) / (2 * (x1 - x0) + 2 * (y1 - y0))

    for i, box in enumerate(rough):
        if not box:
            continue
        sides = fit_box(box, across, h, w)
        # the strokes gathered round a box can be its neighbour's; a box with lines along all its sides is the symbol
        if sides and (out[i] is None or (outlined(sides) >= 0.7 and outlined(sides) >= outlined(out[i]) + 0.15)):
            out[i] = sides
    # A reading is off the same way across a part of the sheet: what its neighbours had to be moved by, a box that
    # found nothing where it was read is moved by too, and looks again there.
    mid = lambda b: ((b[0] + b[2]) / 2, (b[1] + b[3]) / 2)
    moved = [(mid(r), (mid(o)[0] - mid(r)[0], mid(o)[1] - mid(r)[1])) for r, o in zip(rough, out) if r and o]
    for i, box in enumerate(rough):
        if out[i] is not None or not box or len(moved) < 3:
            continue
        c, size = mid(box), max(box[2] - box[0], box[3] - box[1])
        near = sorted(moved, key=lambda m: math.hypot(m[0][0] - c[0], m[0][1] - c[1]))[:3]
        if math.hypot(near[-1][0][0] - c[0], near[-1][0][1] - c[1]) > 0.2 * max(h, w):
            continue
        dx, dy = float(np.median([m[1][0] for m in near])), float(np.median([m[1][1] for m in near]))
        spread = max(math.hypot(m[1][0] - dx, m[1][1] - dy) for m in near)
        if math.hypot(dx, dy) < 3 or spread > max(4.0, 0.5 * math.hypot(dx, dy)) or math.hypot(dx, dy) > 1.5 * size:
            continue                                          # no drift here, or the neighbours do not agree on one
        out[i] = fit_box([box[0] + dx, box[1] + dy, box[2] + dx, box[3] + dy], across, h, w)
    # Nothing drawn at all where a thing was read (no strokes inside, no line along its sides): it is not there.
    blank = []
    for box, o in zip(rough, out):
        if o is not None or not box:
            blank.append(False)
            continue
        x0, y0, x1, y1 = (int(round(v)) for v in box)
        x0, y0, x1, y1 = max(0, x0), max(0, y0), min(w, x1), min(h, y1)
        inner = bw[y0:y1, x0:x1]
        blank.append(bool(inner.size and (inner > 0).mean() < 0.01 and outlined(box) < 0.2))
    return out, blank


def _side_lines(cover: np.ndarray, thr: float = 0.6):
    """Positions of the lines in a coverage profile: the middle of a thin line, both faces of a filled band."""
    on = cover >= thr
    if not on.any():
        return []
    d = np.diff(np.concatenate([[0], on.astype(np.int8), [0]]))
    lines = []
    for a, b in zip(np.nonzero(d == 1)[0], np.nonzero(d == -1)[0] - 1):
        lines += [(a + b) / 2.0] if b - a < 8 else [float(a), float(b)]
    return lines


def fit_box(box, across, h: int, w: int):
    """Moves a rough box onto the lines drawn along its sides; None if no pair of opposite sides finds its lines.

    `across` = the ink mask thickened by a pixel each way across horizontal and across vertical lines. For each pair of
    opposite sides, every line that runs along most of the side's length within reach is a candidate; the pair of
    lines that needs the smallest move, and keeps the box's size best, is taken. A box is usually read the right size
    but shifted, so both sides moving the same way costs little and one side running off alone costs a lot."""
    x0, y0, x1, y1 = box
    if x1 - x0 < 6 or y1 - y0 < 6:
        return None
    fitted = 0
    cur = [x0, y0, x1, y1]

    def pair(lo: float, hi: float, a: float, b: float, horizontal: bool):
        """The lines for the two sides at `lo` and `hi`; the sides run from a to b on the other axis."""
        size, limit = hi - lo, (h if horizontal else w)
        reach = int(max(4, min(size, 0.06 * max(h, w))))
        m = 0.1 * (b - a)
        p0, p1 = int(max(0, lo - reach)), int(min(limit - 1, hi + reach))
        q0, q1 = int(max(0, a + m)), int(min((w if horizontal else h), b - m))
        if q1 - q0 < 4 or p1 - p0 < 4:
            return None
        strip = across[0][p0:p1 + 1, q0:q1] if horizontal else across[1][q0:q1, p0:p1 + 1].T
        lines = [p0 + v for v in _side_lines((strip > 0).mean(axis=1))]
        best = None
        for i, la in enumerate(lines):
            if abs(la - lo) > reach:
                continue
            for lb in lines[i + 1:]:
                if abs(lb - hi) > reach or not 0.6 <= (lb - la) / size <= 1.6:
                    continue
                cost = abs(la - lo) + abs(lb - hi) + 2 * abs((la - lo) - (lb - hi))
                if best is None or cost < best[0]:
                    best = (cost, la, lb)
        return best and (best[1], best[2])

    for _ in range(2):                                        # each pair is found along the other pair's span
        got = pair(cur[1], cur[3], cur[0], cur[2], True)
        if got:
            cur[1], cur[3] = got
        gotx = pair(cur[0], cur[2], cur[1], cur[3], False)
        if gotx:
            cur[0], cur[2] = gotx
        fitted = int(bool(got)) + int(bool(gotx))
    if not fitted or cur[2] - cur[0] < 4 or cur[3] - cur[1] < 4:
        return None
    return [float(v) for v in cur]


def exterior_thickness(rooms, thick: np.ndarray, k: int, h: int, w: int):
    """Median thickness, in pixels, of filled walls with no room behind them: the outside walls. None if unclear."""
    polys = [np.array(r, np.float32) for r in rooms if r]
    if len(polys) < 1:
        return None
    reach = int(max(6 * k, 0.03 * max(h, w)))
    found = []
    for pi, poly in enumerate(polys):
        area2 = float(np.sum(poly[:, 0] * np.roll(poly[:, 1], -1) - np.roll(poly[:, 0], -1) * poly[:, 1]))
        sign = 1.0 if area2 > 0 else -1.0
        for i in range(len(poly)):
            a, b = poly[i].astype(float), poly[(i + 1) % len(poly)].astype(float)
            L = float(np.hypot(*(b - a)))
            if L < 6 * k:
                continue
            u = (b - a) / L
            nrm = np.array([u[1], -u[0]]) * sign
            beyond = a + u * (L / 2) + nrm * (reach + 2 * k)
            if any(cv2.pointPolygonTest(q, (float(beyond[0]), float(beyond[1])), False) >= 0 for qi, q in enumerate(polys) if qi != pi):
                continue                                     # another room lies behind this wall: a partition
            t = np.linspace(0.2 * L, 0.8 * L, 15)
            offs = np.arange(0, reach + 1)
            hit = _sample(thick, a + u * t[:, None, None] + nrm * offs[None, :, None], h, w)
            for row in hit:                                   # wall run starting at (or just beyond) the room's face
                start = int(np.argmax(row)) if row.any() else -1
                if start < 0 or start > 2 * k:
                    continue
                stop = start + int(np.argmin(row[start:])) if not row[start:].all() else len(row)
                if stop < len(row) and stop - start >= k:
                    found.append(stop - start)
    return float(np.median(found)) if len(found) >= 12 else None


PARSERS = {"application/pdf": "analyze_pdf", "application/dxf": "analyze_dxf"}


def _child(name: str, data: bytes, conn, *args):
    try:
        resource.setrlimit(resource.RLIMIT_AS, (MEM_LIMIT, MEM_LIMIT))
        resource.setrlimit(resource.RLIMIT_CPU, (CPU_S, CPU_S + 5))
        conn.send(("ok", globals()[name](data, *args)))
    except TooLarge as e:
        conn.send(("err", f"This drawing is too large to read: {e}."))
    except MemoryError:
        conn.send(("err", "This drawing is too large to read."))
    except Exception:
        traceback.print_exc()  # details stay in the container log
        conn.send(("err", "This file could not be read as a drawing. Try a PDF, DXF or a clear image."))
    finally:
        conn.close()


def run_limited(name: str, data: bytes, *args):
    """Runs one parser in a fresh child process; kills it on the wall-clock limit."""
    recv, send = CTX.Pipe(duplex=False)
    p = CTX.Process(target=_child, args=(name, data, send, *args), daemon=True)
    p.start()
    send.close()
    try:
        if not recv.poll(WALL_S):
            return "err", "This drawing took too long to read."
        return recv.recv()
    except EOFError:  # the child was killed (CPU or memory limit)
        return "err", "This drawing is too large to read."
    finally:
        p.join(2)
        if p.is_alive():
            p.kill()
            p.join()


async def analyze(request: Request):
    mime = request.headers.get("content-type", "").split(";")[0]
    if int(request.headers.get("content-length") or 0) > MAX_BODY:
        return JSONResponse({"error": "Files up to 50 MB."}, 413)
    data = await request.body()
    if len(data) > MAX_BODY:
        return JSONResponse({"error": "Files up to 50 MB."}, 413)
    name = PARSERS.get(mime) or ("analyze_image" if mime.startswith("image/") else None)
    if not name:
        return JSONResponse({"error": "Upload a PDF, DXF, PNG, JPG or WebP drawing."}, 415)
    args = ()
    if name == "analyze_pdf":
        try:
            args = (max(1, int(request.headers.get("x-page") or 1)),)
        except ValueError:
            return JSONResponse({"error": "Bad page number."}, 400)
    async with PARSE:  # one parse per instance: its memory limit is most of the instance's 4 GiB
        kind, out = await asyncio.to_thread(run_limited, name, data, *args)
    if kind == "err":  # one broken file never takes the service down
        return JSONResponse({"error": out}, 422)
    return JSONResponse(out)


async def trace(request: Request):
    if int(request.headers.get("content-length") or 0) > MAX_BODY:
        return JSONResponse({"error": "Files up to 50 MB."}, 413)
    data = await request.body()
    async with PARSE:
        kind, out = await asyncio.to_thread(run_limited, "trace_rooms", data)
    if kind == "err":
        return JSONResponse({"error": out}, 422)
    return JSONResponse(out)


async def health(_: Request):
    return JSONResponse({"ok": True})


# forkserver: children start from a clean, preloaded process (fork from a threaded server is unsafe)
PARSE = asyncio.Semaphore(1)
CTX = mp.get_context("forkserver")
if __name__ != "__mp_main__":
    CTX.set_forkserver_preload([__name__])
app = Starlette(routes=[Route("/analyze", analyze, methods=["POST"]), Route("/trace", trace, methods=["POST"]), Route("/health", health), Route("/ping", health)])
