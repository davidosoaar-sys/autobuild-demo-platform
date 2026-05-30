"""
pdf_walls.py
Non-GUI helper functions extracted from pdf_exact_color_exporter.py.
Safe to import on headless servers (no Tkinter, no fitz dependency).
"""
import math


def normalize_color(c):
    if c is None:
        return None
    if isinstance(c, (tuple, list)) and len(c) >= 3:
        return tuple(float(max(0, min(1, x))) for x in c[:3])
    if isinstance(c, (tuple, list)) and len(c) == 1:
        g = float(max(0, min(1, c[0])))
        return (g, g, g)
    return None


def rgb_to_hex(c):
    c = normalize_color(c)
    if c is None:
        return "-"
    return "#{:02X}{:02X}{:02X}".format(
        int(round(c[0] * 255)),
        int(round(c[1] * 255)),
        int(round(c[2] * 255)),
    )


def clean_hex(value):
    if not value:
        return None
    text = value.strip().upper()
    if not text.startswith("#"):
        text = "#" + text
    if len(text) != 7:
        return None
    try:
        int(text[1:3], 16)
        int(text[3:5], 16)
        int(text[5:7], 16)
    except ValueError:
        return None
    return text


def point_xy(p):
    if hasattr(p, "x") and hasattr(p, "y"):
        return float(p.x), float(p.y)
    if isinstance(p, (tuple, list)) and len(p) >= 2:
        return float(p[0]), float(p[1])
    return None


def line_length(p1, p2):
    a = point_xy(p1)
    b = point_xy(p2)
    if not a or not b:
        return 0.0
    return math.hypot(a[0] - b[0], a[1] - b[1])


def rect_area(r):
    if r is None:
        return 0.0
    try:
        return abs(float(r.width) * float(r.height))
    except Exception:
        return 0.0


def item_stats(items):
    line_count = 0
    curve_count = 0
    rect_count = 0
    total_len = 0.0
    for item in items or []:
        op = item[0] if item else None
        if op == "l" and len(item) >= 3:
            line_count += 1
            total_len += line_length(item[1], item[2])
        elif op == "re":
            rect_count += 1
            try:
                total_len += 2 * (abs(item[1].width) + abs(item[1].height))
            except Exception:
                pass
        elif op == "qu":
            line_count += 4
        elif op == "c":
            curve_count += 1
    return line_count, curve_count, rect_count, total_len


def classify_drawing(d):
    fill   = normalize_color(d.get("fill"))
    stroke = normalize_color(d.get("color"))
    width  = float(d.get("width") or 0)
    items  = d.get("items") or []
    line_count, curve_count, rect_count, total_len = item_stats(items)
    area      = rect_area(d.get("rect"))
    has_fill  = fill is not None
    has_stroke = stroke is not None
    dash   = d.get("dashes")
    dashed = bool(dash and str(dash).strip() not in ("[] 0", "None", ""))
    if has_fill and area > 0:
        kind = "Patch / filled area"
    elif has_stroke and line_count >= 6 and width <= 1.2:
        kind = "Hatch / line pattern"
    elif has_stroke and dashed:
        kind = "Dashed line"
    elif has_stroke:
        kind = "Lines"
    else:
        kind = "Other"
    return {
        "kind": kind, "has_fill": has_fill, "has_stroke": has_stroke,
        "width": width, "line_count": line_count, "curve_count": curve_count,
        "rect_count": rect_count, "total_len": total_len, "area": area, "dashed": dashed,
    }


def group_key(d):
    cls        = classify_drawing(d)
    fill_hex   = rgb_to_hex(d.get("fill"))
    stroke_hex = rgb_to_hex(d.get("color"))
    width      = round(float(d.get("width") or 0), 3)
    dash       = d.get("dashes")
    dash_text  = str(dash) if dash else "-"
    return (cls["kind"], fill_hex, stroke_hex, width, dash_text)


def drawing_matches_exact_color(d, target_hex):
    target_hex = clean_hex(target_hex)
    if target_hex is None:
        return False
    return rgb_to_hex(d.get("fill")) == target_hex or rgb_to_hex(d.get("color")) == target_hex
