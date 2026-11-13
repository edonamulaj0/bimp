"""Generates test drawings with known geometry: the sample house (12 x 9 m) as
vector PDF at 1:100 on A3, a 150 dpi raster scan of it, and a DXF in millimetres."""
import sys
from pathlib import Path

import ezdxf
import pymupdf

ROOMS = [("Living room", 0, 0, 6.5, 5), ("Kitchen", 6.5, 0, 12, 4), ("Hall", 6.5, 4, 12, 5.2), ("Bedroom 1", 0, 5, 4.5, 9),
         ("Bathroom", 4.5, 5, 6.5, 7.5), ("Storage", 4.5, 7.5, 6.5, 9), ("Bedroom 2", 6.5, 5.2, 9.5, 9), ("Office", 9.5, 5.2, 12, 9)]
out = Path(sys.argv[1] if len(sys.argv) > 1 else "fixtures")
out.mkdir(parents=True, exist_ok=True)

# Vector PDF, 1:100: 1 m = 10 mm on paper = 28.3465 pt
M = 72 / 25.4 * 10
ox, oy = 120, 90
doc = pymupdf.open()
page = doc.new_page(width=1190.55, height=841.89)  # A3 landscape
P = lambda x, y: pymupdf.Point(ox + x * M, oy + y * M)
for name, x0, y0, x1, y1 in ROOMS:
    page.draw_rect(pymupdf.Rect(P(x0, y0), P(x1, y1)), color=(0, 0, 0), width=2.5)
    page.insert_text(P((x0 + x1) / 2 - 0.8, (y0 + y1) / 2), name, fontsize=9)
page.draw_line(P(0, 9.8), P(12, 9.8), width=0.5)            # overall dimension line
page.insert_text(P(5.6, 9.7), "12.00", fontsize=8)
page.insert_text(pymupdf.Point(900, 800), "GROUND FLOOR PLAN  M 1:100", fontsize=11)
for i in range(30):                                         # furniture-ish clutter
    page.draw_line(P(0.5 + i * 0.1, 1), P(0.5 + i * 0.1, 1.4), width=0.2)
doc.save(out / "plan-vector.pdf")
page.get_pixmap(dpi=150).save(out / "plan-scan.png")

# DXF in millimetres
d = ezdxf.new(units=4)
msp = d.modelspace()
for name, x0, y0, x1, y1 in ROOMS:
    pts = [(x0 * 1000, -y0 * 1000), (x1 * 1000, -y0 * 1000), (x1 * 1000, -y1 * 1000), (x0 * 1000, -y1 * 1000)]
    msp.add_lwpolyline(pts, close=True)
    msp.add_text(name, height=250).set_placement(((x0 + x1) * 500 - 700, -(y0 + y1) * 500))
d.saveas(out / "plan.dxf")
print("wrote", *sorted(p.name for p in out.iterdir()))
