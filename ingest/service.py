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
    out = {"kind": "pdf-vector" if vector else "pdf-scan", "pages": doc.page_count, "width": pix.width, "height": pix.height,
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


PARSERS = {"application/pdf": "analyze_pdf", "application/dxf": "analyze_dxf"}


def _child(name: str, data: bytes, conn):
    try:
        resource.setrlimit(resource.RLIMIT_AS, (MEM_LIMIT, MEM_LIMIT))
        resource.setrlimit(resource.RLIMIT_CPU, (CPU_S, CPU_S + 5))
        conn.send(("ok", globals()[name](data)))
    except TooLarge as e:
        conn.send(("err", f"This drawing is too large to read: {e}."))
    except MemoryError:
        conn.send(("err", "This drawing is too large to read."))
    except Exception:
        traceback.print_exc()  # details stay in the container log
        conn.send(("err", "This file could not be read as a drawing. Try a PDF, DXF or a clear image."))
    finally:
        conn.close()


def run_limited(name: str, data: bytes):
    """Runs one parser in a fresh child process; kills it on the wall-clock limit."""
    recv, send = CTX.Pipe(duplex=False)
    p = CTX.Process(target=_child, args=(name, data, send), daemon=True)
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
    async with PARSE:  # one parse per instance: its memory limit is most of the instance's 4 GiB
        kind, out = await asyncio.to_thread(run_limited, name, data)
    if kind == "err":  # one broken file never takes the service down
        return JSONResponse({"error": out}, 422)
    return JSONResponse(out)


async def health(_: Request):
    return JSONResponse({"ok": True})


# forkserver: children start from a clean, preloaded process (fork from a threaded server is unsafe)
PARSE = asyncio.Semaphore(1)
CTX = mp.get_context("forkserver")
if __name__ != "__mp_main__":
    CTX.set_forkserver_preload([__name__])
app = Starlette(routes=[Route("/analyze", analyze, methods=["POST"]), Route("/health", health), Route("/ping", health)])
