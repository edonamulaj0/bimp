"""CubiCasa5K model.svg -> object boxes (pixel coords of F1_original.png) for windows, doors and fittings."""
import re, xml.etree.ElementTree as ET

NUM = r'[-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?'
def parse_transform(s):
    m = [1, 0, 0, 1, 0, 0]
    for name, args in re.findall(r'(\w+)\s*\(([^)]*)\)', s or ''):
        a = [float(v) for v in re.findall(NUM, args)]
        if name == 'matrix' and len(a) == 6: t = a
        elif name == 'translate': t = [1, 0, 0, 1, a[0], a[1] if len(a) > 1 else 0]
        elif name == 'scale': t = [a[0], 0, 0, a[1] if len(a) > 1 else a[0], 0, 0]
        elif name == 'rotate':
            import math
            r = math.radians(a[0]); c, s_ = math.cos(r), math.sin(r)
            t = [c, s_, -s_, c, 0, 0]
            if len(a) == 3:
                cx, cy = a[1], a[2]
                t = mul(mul([1, 0, 0, 1, cx, cy], t), [1, 0, 0, 1, -cx, -cy])
        else: continue
        m = mul(m, t)
    return m
def mul(p, q):
    a, b, c, d, e, f = p; A, B, C, D, E, F = q
    return [a*A + c*B, b*A + d*B, a*C + c*D, b*C + d*D, a*E + c*F + e, b*E + d*F + f]
def apply(m, x, y): return m[0]*x + m[2]*y + m[4], m[1]*x + m[3]*y + m[5]

def points_of(el):
    tag = el.tag.split('}')[-1]
    if tag in ('polygon', 'polyline'):
        v = [float(x) for x in re.findall(NUM, el.get('points', ''))]; return list(zip(v[::2], v[1::2]))
    if tag == 'rect':
        x, y, w, h = (float(el.get(k, 0)) for k in ('x', 'y', 'width', 'height')); return [(x, y), (x+w, y+h)]
    if tag == 'circle':
        cx, cy, r = (float(el.get(k, 0)) for k in ('cx', 'cy', 'r')); return [(cx-r, cy-r), (cx+r, cy+r)]
    if tag == 'line':
        return [(float(el.get('x1', 0)), float(el.get('y1', 0))), (float(el.get('x2', 0)), float(el.get('y2', 0)))]
    return []

def objects(svg_text):
    """[(class, (x0, y0, x1, y1))] for every element whose class starts with Window, Door or FixedFurniture."""
    root = ET.fromstring(svg_text)
    out = []
    def walk(el, m):
        m = mul(m, parse_transform(el.get('transform')))
        cls = (el.get('class') or '').strip()
        if re.match(r'(Window|Door|FixedFurniture)\b', cls) and not cls.startswith('FixedFurnitureSet'):
            # outline: the BoundaryPolygon if present (furniture), else the first polygon (windows, doors)
            bp = None
            for ch in el.iter():
                if (ch.get('class') or '') == 'BoundaryPolygon': bp = ch; break
            target = bp if bp is not None else el
            pts = []
            def collect(e, mm):
                mm = mul(mm, parse_transform(e.get('transform'))) if e is not target else mm
                pts.extend(apply(mm, x, y) for x, y in points_of(e))
                for c in e: collect(c, mm)
            if bp is not None:
                # the boundary's own ancestors between el and bp may carry transforms; they are rare, apply bp's
                collect(bp, mul(m, parse_transform(bp.get('transform'))))
            else:
                first = next((c for c in el if c.tag.split('}')[-1] in ('polygon', 'rect')), None)
                if first is not None: pts = [apply(m, x, y) for x, y in points_of(first)]
                else:  # no outline of its own: the bounds of everything it draws
                    def every(e, mm):
                        for c in e:
                            cm = mul(mm, parse_transform(c.get('transform')))
                            pts.extend(apply(cm, x, y) for x, y in points_of(c)); every(c, cm)
                    every(el, m)
            if pts:
                xs, ys = [p[0] for p in pts], [p[1] for p in pts]
                out.append((cls, (min(xs), min(ys), max(xs), max(ys))))
            if not cls.startswith('FixedFurniture'): return  # door/window parts are not objects; furniture can contain furniture (a sink in a cabinet)
        for ch in el: walk(ch, m)
    walk(root, [1, 0, 0, 1, 0, 0])
    return out
