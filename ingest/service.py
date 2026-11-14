"""bimp ingestion service: exact geometry and text from drawings.

POST /analyze (body = file bytes, Content-Type = mime) returns, in one pixel space (the returned render):
  kind      pdf-vector | pdf-scan | image | dxf
  width, height, render_png (base64)
  segments  [[x1, y1, x2, y2], ...]   line work for snapping (vector lines, or wall strokes found by OpenCV)
  texts     [{text, bbox: [x0, y0, x1, y1]}]  exact vector/DXF text, none for scans
  scale     {meters_per_px, source, ratio?} when the drawing states it exactly (1:N on a vector sheet, DXF units), else null
  paper_mm_per_px  size of one render pixel on the paper sheet when known (PDF page size; image DPI metadata), else null.
            Lets the Worker turn a measured dimension into a drawing scale and round it to a preferred one.
The model never measures; this service and the Worker do.
"""
import base64
import io
import math
import re
from collections import Counter

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
        return x if 50 <= x <= 2400 else None
    except Exception:
        return None


def analyze_image(data: bytes):
    img = cv2.imdecode(np.frombuffer(data, np.uint8), cv2.IMREAD_COLOR)
    if img is None:
        raise ValueError("unreadable image")
    img, f = fit(img)
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    h, w = gray.shape
    dpi = image_dpi(data)
    return {"kind": "image", "width": w, "height": h, "render_png": png_b64(img), "segments": wall_segments(gray), "texts": [], "scale": None,
            "paper_mm_per_px": 25.4 / (dpi * f) if dpi else None}


def analyze_pdf(data: bytes):
    doc = pymupdf.open(stream=data, filetype="pdf")
    page = doc[0]
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

    segs = []
    for d in page.get_drawings():
        for it in d["items"]:
            if it[0] == "l":
                segs.append([*pt(it[1]), *pt(it[2])])
            elif it[0] in ("re", "qu"):
                q = it[1].quad if it[0] == "re" else it[1]
                c = [pt(q.ul), pt(q.ur), pt(q.lr), pt(q.ll)]
                segs += [[*c[i], *c[(i + 1) % 4]] for i in range(4)]
    texts = []
    for b in page.get_text("dict")["blocks"]:
        for line in b.get("lines", []):
            for s in line["spans"]:
                if s["text"].strip():
                    r = pymupdf.Rect(s["bbox"]) * rot
                    texts.append({"text": s["text"].strip(), "bbox": [round(v * k, 1) for v in (r.x0, r.y0, r.x1, r.y1)]})

    size = max(pix.width, pix.height)
    vector = len(segs) > 50 and len(texts) > 3
    out = {"kind": "pdf-vector" if vector else "pdf-scan", "pages": doc.page_count, "width": pix.width, "height": pix.height,
           "render_png": png_b64(img), "texts": texts, "scale": None, "paper_mm_per_px": 25.4 / 72 / k}
    if vector:
        out["segments"] = keep_longest(segs, size * 0.004)
        n, all_ratios = scale_from_texts(texts)
        if n:
            # 1 px = 1/k pt; 1 pt = 0.0254/72 m on paper; × N in the real world
            out["scale"] = {"meters_per_px": 0.0254 / 72 / k * n, "ratio": n, "source": f"Sheet scale 1:{n}", "all_ratios": all_ratios}
    else:
        out["segments"] = wall_segments(cv2.cvtColor(img, cv2.COLOR_BGR2GRAY))
    return out


def dxf_entities(entities, depth=0):
    for e in entities:
        if e.dxftype() == "INSERT" and depth < 4:
            try:
                yield from dxf_entities(e.virtual_entities(), depth + 1)
            except Exception:
                continue
        else:
            yield e


def analyze_dxf(data: bytes):
    doc, _ = recover.read(io.BytesIO(data))
    msp = doc.modelspace()
    units = int(doc.header.get("$INSUNITS", 0))
    unit_m = DXF_UNITS.get(units)
    lines, texts = [], []
    for e in dxf_entities(msp):
        t = e.dxftype()
        if t in ("TEXT", "MTEXT"):
            s = e.plain_text() if t == "MTEXT" else e.dxf.text
            if s and s.strip():
                texts.append((s.strip(), e.dxf.insert.x, e.dxf.insert.y, getattr(e.dxf, "height", 0) or getattr(e.dxf, "char_height", 0) or 0))
            continue
        try:
            pts = list(dxfpath.make_path(e).flattening(0.01))
        except Exception:
            continue
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


async def analyze(request: Request):
    mime = request.headers.get("content-type", "").split(";")[0]
    data = await request.body()
    try:
        if mime == "application/pdf":
            out = analyze_pdf(data)
        elif mime.startswith("image/"):
            out = analyze_image(data)
        elif mime == "application/dxf":
            out = analyze_dxf(data)
        else:
            return JSONResponse({"error": f"unsupported type {mime}"}, 415)
    except Exception as e:  # one broken file never takes the service down
        return JSONResponse({"error": f"could not read the drawing: {e}"}, 422)
    return JSONResponse(out)


async def health(_: Request):
    return JSONResponse({"ok": True})


app = Starlette(routes=[Route("/analyze", analyze, methods=["POST"]), Route("/health", health), Route("/ping", health)])
