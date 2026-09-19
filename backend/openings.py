"""
openings.py
Detects candidate door/window openings as gaps in a selected wall run,
then guesses a type (door vs window) from nearby PDF drawing symbols
(arcs = door swing, short parallel lines crossing the gap = window).

This is a heuristic first pass, not a certainty — the frontend always
shows candidates for the user to confirm, retype, or discard before
they're used for slicing.
"""
import math
from typing import List, Tuple, Optional

Point = Tuple[float, float]
Seg   = Tuple[Point, Point]

# Standard heights (mm above floor). Editable per-opening on the frontend.
DEFAULTS = {
    "door":   {"sill_mm": 0.0,   "head_mm": 2100.0},
    "window": {"sill_mm": 900.0, "head_mm": 2100.0},
    "opening": {"sill_mm": 900.0, "head_mm": 2100.0},
}


def _seg_dir(s: Seg) -> Tuple[float, float]:
    (x0, y0), (x1, y1) = s
    dx, dy = x1 - x0, y1 - y0
    length = math.hypot(dx, dy)
    if length < 1e-9:
        return (0.0, 0.0)
    return (dx / length, dy / length)


def _seg_len(s: Seg) -> float:
    (x0, y0), (x1, y1) = s
    return math.hypot(x1 - x0, y1 - y0)


def find_wall_gaps(
    segments: List[Seg],
    pt_to_m: float,
    min_gap_mm: float = 400.0,
    max_gap_mm: float = 1500.0,
    colinear_tol: float = 0.04,   # ~2.3 degrees, as sin of angle between directions
    offset_tol_pt: float = 3.0,   # max perpendicular offset between the two wall lines
) -> List[dict]:
    """Find pairs of near-colinear wall segments separated by a small gap —
    the classic way an architect draws a wall with a door/window opening."""
    min_gap_pt = min_gap_mm / 1000.0 / pt_to_m
    max_gap_pt = max_gap_mm / 1000.0 / pt_to_m

    gaps = []
    seen = set()
    n = len(segments)
    for i in range(n):
        si = segments[i]
        di = _seg_dir(si)
        if di == (0.0, 0.0):
            continue
        for j in range(i + 1, n):
            if (i, j) in seen:
                continue
            sj = segments[j]
            dj = _seg_dir(sj)
            if dj == (0.0, 0.0):
                continue
            # Roughly parallel (or anti-parallel) directions
            cross = abs(di[0] * dj[1] - di[1] * dj[0])
            if cross > colinear_tol:
                continue

            # Try every endpoint-pair combination, keep the closest
            best = None
            for a in (si[0], si[1]):
                for b in (sj[0], sj[1]):
                    d = math.hypot(a[0] - b[0], a[1] - b[1])
                    if best is None or d < best[0]:
                        best = (d, a, b)
            gap_dist, a, b = best
            if not (min_gap_pt <= gap_dist <= max_gap_pt):
                continue

            # Perpendicular offset check: b should lie close to the line through a,di
            nx, ny = -di[1], di[0]
            offset = abs((b[0] - a[0]) * nx + (b[1] - a[1]) * ny)
            if offset > offset_tol_pt:
                continue

            seen.add((i, j))
            gaps.append({
                "gap_start": [a[0], a[1]],
                "gap_end":   [b[0], b[1]],
                "width_mm":  gap_dist * pt_to_m * 1000.0,
            })
    return _dedup_gaps(gaps)


def _dedup_gaps(gaps: List[dict], midpoint_tol_pt: float = 60.0) -> List[dict]:
    """Wall runs are often drawn with closely-spaced parallel strokes (double
    lines for a window symbol, wall thickness on both sides), so the same
    physical opening can otherwise show up as several near-identical gaps."""
    used = [False] * len(gaps)
    midpoints = [
        ((g["gap_start"][0] + g["gap_end"][0]) / 2, (g["gap_start"][1] + g["gap_end"][1]) / 2)
        for g in gaps
    ]
    out = []
    for i, g in enumerate(gaps):
        if used[i]:
            continue
        cluster = [g]
        used[i] = True
        mx, my = midpoints[i]
        for j in range(i + 1, len(gaps)):
            if used[j]:
                continue
            mx2, my2 = midpoints[j]
            if math.hypot(mx - mx2, my - my2) <= midpoint_tol_pt:
                cluster.append(gaps[j])
                used[j] = True
        cluster.sort(key=lambda x: x["width_mm"])
        out.append(cluster[len(cluster) // 2])
    return out


def _drawing_items(d) -> list:
    return d.get("items") or []


def _entity_bbox(d) -> Optional[Tuple[float, float, float, float]]:
    xs, ys = [], []
    for item in _drawing_items(d):
        op = item[0] if item else None
        pts = []
        if op == "l" and len(item) >= 3:
            pts = [item[1], item[2]]
        elif op == "c" and len(item) >= 5:
            pts = [item[1], item[2], item[3], item[4]]
        elif op == "re" and len(item) >= 2:
            r = item[1]
            try:
                pts = [(r.x0, r.y0), (r.x1, r.y1)]
            except Exception:
                pts = []
        for p in pts:
            try:
                xs.append(float(p.x)); ys.append(float(p.y))
            except AttributeError:
                xs.append(float(p[0])); ys.append(float(p[1]))
    if not xs:
        return None
    return (min(xs), min(ys), max(xs), max(ys))


def _bbox_overlaps(a, b, margin: float) -> bool:
    return not (a[2] + margin < b[0] or b[2] + margin < a[0] or
                a[3] + margin < b[1] or b[3] + margin < a[1])


def _build_symbol_index(drawings: list, max_entity_size_pt: float = 250.0) -> list:
    """Precompute bboxes once, keeping only small entities — door swings and
    window tick marks are small; walls, room fills and hatches are not, and
    would otherwise dominate the per-gap scan for no classification benefit."""
    index = []
    for d in drawings:
        bbox = _entity_bbox(d)
        if bbox is None:
            continue
        if max(bbox[2] - bbox[0], bbox[3] - bbox[1]) > max_entity_size_pt:
            continue
        index.append((bbox, _drawing_items(d)))
    return index


def classify_opening_candidate(gap: dict, symbol_index: list, margin_pt: float = 30.0) -> dict:
    """Look at nearby small PDF drawing entities to guess door vs window."""
    gx0, gy0 = gap["gap_start"]
    gx1, gy1 = gap["gap_end"]
    gap_bbox = (min(gx0, gx1) - margin_pt, min(gy0, gy1) - margin_pt,
                max(gx0, gx1) + margin_pt, max(gy0, gy1) + margin_pt)
    gap_dir = _seg_dir(((gx0, gy0), (gx1, gy1))) or (1.0, 0.0)

    has_arc = False
    cross_line_count = 0

    for bbox, items in symbol_index:
        if not _bbox_overlaps(bbox, gap_bbox, 0.0):
            continue
        for item in items:
            op = item[0] if item else None
            if op == "c":
                has_arc = True
            elif op == "l" and len(item) >= 3:
                try:
                    p0 = (float(item[1].x), float(item[1].y))
                    p1 = (float(item[2].x), float(item[2].y))
                except AttributeError:
                    p0, p1 = tuple(item[1]), tuple(item[2])
                seg_dir = _seg_dir((p0, p1))
                if seg_dir == (0.0, 0.0):
                    continue
                # Short line, roughly perpendicular to the wall gap direction
                cross = abs(gap_dir[0] * seg_dir[1] - gap_dir[1] * seg_dir[0])
                length = _seg_len((p0, p1))
                if cross > 0.7 and length < margin_pt * 3:
                    cross_line_count += 1

    if has_arc:
        opening_type, confidence = "door", 0.75
    elif cross_line_count >= 2:
        opening_type, confidence = "window", 0.6
    else:
        opening_type, confidence = "opening", 0.35

    defaults = DEFAULTS[opening_type]
    return {
        "type": opening_type,
        "confidence": confidence,
        "sill_mm": defaults["sill_mm"],
        "head_mm": defaults["head_mm"],
    }


MAX_CANDIDATES = 120  # keep the review UI usable; wrong-layer selections can produce noise


def detect_openings(segments: List[Seg], drawings: list, pt_to_m: float) -> List[dict]:
    gaps = find_wall_gaps(segments, pt_to_m)
    truncated = len(gaps) > MAX_CANDIDATES
    if truncated:
        # Real doors/windows cluster near typical widths (~700-1200mm);
        # prefer those over outliers when a layer produces excess noise.
        gaps.sort(key=lambda g: min(abs(g["width_mm"] - 900.0), 900.0))
        gaps = gaps[:MAX_CANDIDATES]

    symbol_index = _build_symbol_index(drawings)
    candidates = []
    for i, gap in enumerate(gaps):
        info = classify_opening_candidate(gap, symbol_index)
        candidates.append({
            "id": f"cand-{i}",
            "gap_start": gap["gap_start"],
            "gap_end":   gap["gap_end"],
            "width_mm":  round(gap["width_mm"], 1),
            **info,
        })
    return candidates, truncated
