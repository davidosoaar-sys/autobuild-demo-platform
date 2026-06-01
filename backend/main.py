"""
main.py
AutoBuild AI — FastAPI backend
Adaptive 3DCP slicer with Sikacrete-733 W 3D + live weather.
"""

import os, uuid, json, time, math, random, base64
from collections import defaultdict
from typing import Optional, List

from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import PlainTextResponse
import requests

from geometry   import parse_and_slice
from optimizer  import optimize
from gcode      import toolpath_to_gcode, format_print_time
from weather    import (
    fetch_current_weather, fetch_forecast_schedule,
    build_schedule_from_blocks, average_conditions, worst_conditions,
    WeatherSchedule,
)
from sika733    import (
    pot_life_at_temp, composite_risk_score, estimated_print_time_seconds,
    PRODUCT_NAME, LAYER_HEIGHT_DEF_M, LAYER_HEIGHT_MIN_M, LAYER_HEIGHT_MAX_M,
)
from scan       import scan_mesh
from environment import DEFAULT_PRINTER

# ── App ───────────────────────────────────────────────────────────────────────

app = FastAPI(
    title       = "AutoBuild AI — Adaptive 3DCP Slicer",
    description = "RL-powered adaptive slicer for Sikacrete-733 W 3D",
    version     = "3.2.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins     = ["*"],
    allow_credentials = False,
    allow_methods     = ["*"],
    allow_headers     = ["*"],
)

MODEL_PATH  = os.getenv("MODEL_PATH",  "model.zip")
RESULTS_DIR = "results"
OW_KEY      = "b3c56e66236ef0a54e1d8aee8f399533"
OW_BASE     = "http://api.openweathermap.org/data/2.5"
OW_GEO_BASE = "http://api.openweathermap.org/geo/1.0"
os.makedirs(RESULTS_DIR, exist_ok=True)


# ── Health ────────────────────────────────────────────────────────────────────

@app.get("/health")
def health():
    return {
        "status":      "ok",
        "model_ready": os.path.exists(MODEL_PATH),
        "weather_api": True,
        "material":    PRODUCT_NAME,
    }


# ── Scan endpoint ─────────────────────────────────────────────────────────────

@app.post("/scan")
async def scan_endpoint(
    file:               UploadFile = File(...),
    nozzle_diameter_mm: float      = Form(25.0),
    layer_height_m:     float      = Form(0.012),
):
    fname = file.filename or ""
    allowed_exts = (".stl", ".obj", ".stp", ".step", ".dxf", ".ifc")
    if not fname.lower().endswith(allowed_exts):
        raise HTTPException(400, f"Unsupported file type. Supported: {', '.join(allowed_exts)}")

    try:
        file_bytes = await file.read()
    except Exception as e:
        raise HTTPException(400, f"Could not read file: {e}")

    try:
        result = scan_mesh(
            file_bytes     = file_bytes,
            filename       = fname,
            nozzle_diam_mm = nozzle_diameter_mm,
            layer_height_m = layer_height_m,
        )
    except Exception as e:
        raise HTTPException(500, f"Scan failed: {e}")

    return result


# ── Floor plan helpers ────────────────────────────────────────────────────────

def _drawing_segments(d):
    out = []
    for it in d.get("items") or []:
        if it and it[0] == "l" and len(it) >= 3:
            a, b = it[1], it[2]
            try:
                out.append(((a.x, a.y), (b.x, b.y)))
            except Exception:
                out.append(((a[0], a[1]), (b[0], b[1])))
    return out


def _hatch_signature(d):
    segs = _drawing_segments(d)
    if len(segs) < 3:
        return None
    angs = []
    for (a, b) in segs:
        angs.append(math.degrees(math.atan2(b[1] - a[1], b[0] - a[0])) % 180)
    h = defaultdict(int)
    for a in angs:
        h[round(a / 5) * 5] += 1
    dom_ang, dom_n = max(h.items(), key=lambda x: x[1])
    if dom_n < 3:
        return None
    rad = math.radians(dom_ang)
    nx, ny = -math.sin(rad), math.cos(rad)
    mids = sorted(
        ((a[0] + b[0]) / 2) * nx + ((a[1] + b[1]) / 2) * ny
        for (a, b) in segs
    )
    gaps = [mids[i + 1] - mids[i] for i in range(len(mids) - 1) if mids[i + 1] - mids[i] > 0.3]
    spacing = round(sorted(gaps)[len(gaps) // 2], 1) if gaps else 0.0
    return (float(dom_ang), float(spacing))


# ── Floor plan endpoints ──────────────────────────────────────────────────────

from pdf_walls import (
    group_key, classify_drawing, rgb_to_hex, normalize_color,
    clean_hex, drawing_matches_exact_color, point_xy,
)


@app.post("/floorplan/scan")
async def floorplan_scan(file: UploadFile = File(...)):
    import fitz
    try:
        file_bytes = await file.read()
        doc = fitz.open(stream=file_bytes, filetype="pdf")
        page = doc[0]
        drawings = page.get_drawings()
        groups: dict = {}
        for d in drawings:
            key = group_key(d)
            cls = classify_drawing(d)
            if key not in groups:
                groups[key] = {
                    "fill_hex":   rgb_to_hex(d.get("fill")),
                    "stroke_hex": rgb_to_hex(d.get("color")),
                    "width":      round(float(d.get("width") or 0), 3),
                    "kind":       cls["kind"],
                    "count":      0,
                    "total_len":  0.0,
                }
            groups[key]["count"] += 1
            groups[key]["total_len"] += cls["total_len"]
        result = sorted(groups.values(), key=lambda g: g["count"], reverse=True)
        for g in result:
            g["total_len"] = round(g["total_len"], 2)
        doc.close()
        return {"groups": result, "total_drawings": len(drawings)}
    except Exception as e:
        return {"error": str(e)}


@app.post("/floorplan/pick")
async def floorplan_pick(
    file: UploadFile = File(...),
    px:   float      = Form(...),
    py:   float      = Form(...),
    tol:  float      = Form(4.0),
):
    import fitz

    def _pt_seg_dist(qx, qy, x0, y0, x1, y1):
        dx, dy = x1 - x0, y1 - y0
        if dx == 0 and dy == 0:
            return math.hypot(qx - x0, qy - y0)
        t = max(0.0, min(1.0, ((qx - x0) * dx + (qy - y0) * dy) / (dx * dx + dy * dy)))
        return math.hypot(qx - (x0 + t * dx), qy - (y0 + t * dy))

    try:
        file_bytes = await file.read()
        doc = fitz.open(stream=file_bytes, filetype="pdf")
        page = doc[0]
        best_dist = float("inf")
        best_seg  = None
        for d in page.get_drawings():
            for item in d.get("items") or []:
                op = item[0] if item else None
                segs = []
                if op == "l" and len(item) >= 3:
                    p1 = point_xy(item[1])
                    p2 = point_xy(item[2])
                    if p1 and p2:
                        segs.append((p1, p2))
                elif op == "re" and len(item) >= 2:
                    r = item[1]
                    try:
                        c = [(r.x0, r.y0), (r.x1, r.y0), (r.x1, r.y1), (r.x0, r.y1)]
                        for i in range(4):
                            segs.append((c[i], c[(i + 1) % 4]))
                    except Exception:
                        pass
                for p1, p2 in segs:
                    dist = _pt_seg_dist(px, py, p1[0], p1[1], p2[0], p2[1])
                    if dist < best_dist:
                        best_dist = dist
                        best_seg  = (p1, p2)
        doc.close()
        if best_seg and best_dist <= tol:
            return {"hit": True, "segment": [list(best_seg[0]), list(best_seg[1])]}
        return {"hit": False}
    except Exception as e:
        return {"error": str(e)}


@app.post("/floorplan/legend_colors")
async def floorplan_legend_colors(file: UploadFile = File(...)):
    import fitz
    try:
        file_bytes = await file.read()
        doc  = fitz.open(stream=file_bytes, filetype="pdf")
        page = doc[0]
        W    = page.rect.width
        split = W * 0.62
        drawings = page.get_drawings()

        # Collect distinct fill colors found in the legend region (right side)
        legend_hexes: dict = {}   # hex -> legend_count
        for d in drawings:
            rect = d.get("rect")
            if rect is None:
                continue
            cx = (rect.x0 + rect.x1) / 2.0
            if cx <= split:
                continue
            fill = normalize_color(d.get("fill"))
            if fill is None:
                continue
            # Skip white
            if fill[0] > 0.98 and fill[1] > 0.98 and fill[2] > 0.98:
                continue
            h = rgb_to_hex(fill)
            if h == "-":
                continue
            legend_hexes[h] = legend_hexes.get(h, 0) + 1

        # Count each legend color on the plan side (left side)
        result = []
        for h, lcount in legend_hexes.items():
            plan_count = sum(
                1 for d in drawings
                if (r := d.get("rect")) is not None
                and (r.x0 + r.x1) / 2.0 <= split
                and drawing_matches_exact_color(d, h)
            )
            if plan_count >= 1:
                result.append({"hex": h, "legend_count": lcount, "plan_count": plan_count})

        result.sort(key=lambda x: x["plan_count"], reverse=True)
        doc.close()
        return {"legend_colors": result}
    except Exception as e:
        return {"error": str(e)}


@app.post("/floorplan/color_at")
async def floorplan_color_at(
    file: UploadFile = File(...),
    px:   float      = Form(...),
    py:   float      = Form(...),
    tol:  float      = Form(4.0),
):
    import fitz

    def _pt_seg_dist(qx, qy, x0, y0, x1, y1):
        dx, dy = x1 - x0, y1 - y0
        if dx == 0 and dy == 0:
            return math.hypot(qx - x0, qy - y0)
        t = max(0.0, min(1.0, ((qx - x0) * dx + (qy - y0) * dy) / (dx * dx + dy * dy)))
        return math.hypot(qx - (x0 + t * dx), qy - (y0 + t * dy))

    try:
        file_bytes = await file.read()
        doc  = fitz.open(stream=file_bytes, filetype="pdf")
        page = doc[0]
        best_dist = float("inf")
        best_hex  = None
        for d in page.get_drawings():
            fill_hex   = rgb_to_hex(d.get("fill"))
            stroke_hex = rgb_to_hex(d.get("color"))
            candidate  = fill_hex if fill_hex != "-" else stroke_hex if stroke_hex != "-" else None
            if candidate is None:
                continue
            for item in d.get("items") or []:
                op   = item[0] if item else None
                segs = []
                if op == "l" and len(item) >= 3:
                    p1 = point_xy(item[1]); p2 = point_xy(item[2])
                    if p1 and p2:
                        segs.append((p1, p2))
                elif op == "re" and len(item) >= 2:
                    r = item[1]
                    try:
                        c = [(r.x0, r.y0), (r.x1, r.y0), (r.x1, r.y1), (r.x0, r.y1)]
                        for i in range(4):
                            segs.append((c[i], c[(i + 1) % 4]))
                    except Exception:
                        pass
                for p1, p2 in segs:
                    dist = _pt_seg_dist(px, py, p1[0], p1[1], p2[0], p2[1])
                    if dist < best_dist:
                        best_dist = dist
                        best_hex  = candidate
        doc.close()
        if best_hex and best_dist <= tol:
            return {"hit": True, "hex": best_hex}
        return {"hit": False}
    except Exception as e:
        return {"error": str(e)}


@app.post("/floorplan/signature_at")
async def floorplan_signature_at(
    file: UploadFile = File(...),
    px:   float      = Form(...),
    py:   float      = Form(...),
    tol:  float      = Form(6.0),
):
    import fitz
    try:
        file_bytes = await file.read()
        doc  = fitz.open(stream=file_bytes, filetype="pdf")
        page = doc[0]
        best_dist = float("inf")
        best_sig  = None
        for d in page.get_drawings():
            sig = _hatch_signature(d)
            if sig is None:
                continue
            rect = d.get("rect")
            if rect is None:
                continue
            if not (rect.x0 - tol <= px <= rect.x1 + tol and
                    rect.y0 - tol <= py <= rect.y1 + tol):
                continue
            cx = (rect.x0 + rect.x1) / 2.0
            cy = (rect.y0 + rect.y1) / 2.0
            dist = math.hypot(px - cx, py - cy)
            if dist < best_dist:
                best_dist = dist
                best_sig  = sig
        doc.close()
        if best_sig is not None:
            return {"hit": True, "angle": best_sig[0], "spacing": best_sig[1]}
        return {"hit": False}
    except Exception as e:
        return {"error": str(e)}


@app.post("/floorplan/extract_by_signature")
async def floorplan_extract_by_signature(
    file:        UploadFile = File(...),
    angle:       float      = Form(...),
    spacing:     float      = Form(...),
    angle_tol:   float      = Form(8.0),
    spacing_tol: float      = Form(0.5),
    match_mode:  str        = Form("both"),
):
    import fitz
    try:
        file_bytes = await file.read()
        doc  = fitz.open(stream=file_bytes, filetype="pdf")
        page = doc[0]
        segments: list = []
        matched = 0
        for d in page.get_drawings():
            sig = _hatch_signature(d)
            if sig is None:
                continue
            ang_diff = abs(sig[0] - angle) % 180
            ang_diff = min(ang_diff, 180 - ang_diff)
            if ang_diff > angle_tol:
                continue
            if match_mode != "angle" and abs(sig[1] - spacing) > spacing_tol:
                continue
            matched += 1
            for (a, b) in _drawing_segments(d):
                segments.append([[a[0], a[1]], [b[0], b[1]]])
        width_pt  = float(page.rect.width)
        height_pt = float(page.rect.height)
        doc.close()
        return {
            "segments":        segments,
            "count":           len(segments),
            "page_width_pt":   width_pt,
            "page_height_pt":  height_pt,
            "matched_objects": matched,
        }
    except Exception as e:
        return {"error": str(e)}


@app.post("/floorplan/extract")
async def floorplan_extract(
    file:          UploadFile = File(...),
    color_hex:     str        = Form(""),
    colors_json:   str        = Form("[]"),
    segments_json: str        = Form("[]"),
):
    import fitz

    def _drawing_segs(d):
        out = []
        for item in d.get("items") or []:
            op = item[0] if item else None
            if op == "l" and len(item) >= 3:
                p1 = point_xy(item[1]); p2 = point_xy(item[2])
                if p1 and p2:
                    out.append([list(p1), list(p2)])
            elif op == "re" and len(item) >= 2:
                r = item[1]
                try:
                    c = [[r.x0, r.y0], [r.x1, r.y0], [r.x1, r.y1], [r.x0, r.y1]]
                    for i in range(4):
                        out.append([c[i], c[(i + 1) % 4]])
                except Exception:
                    pass
        return out

    try:
        file_bytes = await file.read()
        doc  = fitz.open(stream=file_bytes, filetype="pdf")
        page = doc[0]
        drawings = page.get_drawings()
        segments = []

        # Build full set of target colors (single + list)
        targets = set()
        if t := clean_hex(color_hex):
            targets.add(t)
        try:
            for h in json.loads(colors_json):
                if t := clean_hex(h):
                    targets.add(t)
        except Exception:
            pass

        for target in targets:
            for d in drawings:
                if drawing_matches_exact_color(d, target):
                    segments.extend(_drawing_segs(d))

        # Add manually clicked segments
        try:
            for seg in json.loads(segments_json):
                segments.append(seg)
        except Exception:
            pass

        width_pt  = float(page.rect.width)
        height_pt = float(page.rect.height)
        doc.close()
        return {"segments": segments, "count": len(segments),
                "page_width_pt": width_pt, "page_height_pt": height_pt}
    except Exception as e:
        return {"error": str(e)}


@app.post("/floorplan/slice")
async def floorplan_slice(
    segments_json:      str           = Form(...),
    page_width_pt:      float         = Form(0.0),
    page_height_pt:     float         = Form(0.0),
    wall_height_mm:     float         = Form(2500.0),
    layer_height_mm:    float         = Form(50.0),
    printer_name:       str           = Form("Custom 3DCP Printer"),
    nozzle_diameter_mm: float         = Form(25.0),
    bead_compression:   float         = Form(0.6),
    max_speed_mm_s:     float         = Form(100.0),
    min_speed_mm_s:     float         = Form(15.0),
    base_speed_mm_s:    float         = Form(60.0),
    uses_e_axis:        bool          = Form(False),
    city:               Optional[str] = Form(None),
    temperature:        float         = Form(20.0),
    humidity:           float         = Form(65.0),
    wind_speed:         float         = Form(8.0),
    print_start_hour:   float         = Form(8.0),
    structure_type:     str           = Form("wall"),
):
    PT_TO_M = (0.0254 / 72) * 50  # PDF points → real-world metres at 1:50

    try:
        raw_segs = json.loads(segments_json)
    except Exception:
        raise HTTPException(400, "Invalid segments_json")
    if not raw_segs:
        raise HTTPException(400, "No wall segments provided")

    segs_m = []
    for s in raw_segs:
        try:
            segs_m.append(((float(s[0][0]) * PT_TO_M, float(s[0][1]) * PT_TO_M),
                           (float(s[1][0]) * PT_TO_M, float(s[1][1]) * PT_TO_M)))
        except Exception:
            pass
    if not segs_m:
        raise HTTPException(400, "No valid segments after conversion")

    layer_h    = float(max(LAYER_HEIGHT_MIN_M, min(LAYER_HEIGHT_MAX_M, layer_height_mm / 1000.0)))
    wall_h     = float(max(layer_h, wall_height_mm / 1000.0))
    num_layers = max(1, int(wall_h / layer_h))

    perim = sum(math.hypot(s[1][0] - s[0][0], s[1][1] - s[0][1]) for s in segs_m)
    xs    = [p[0] for s in segs_m for p in s]
    ys    = [p[1] for s in segs_m for p in s]
    area  = (max(xs) - min(xs)) * (max(ys) - min(ys)) if xs else 0.0

    geometry    = [list(segs_m) for _ in range(num_layers)]
    layer_metas = [
        {
            "index":            idx,
            "z_height_m":       round((idx + 0.5) * layer_h, 4),
            "segment_count":    len(segs_m),
            "perimeter_m":      round(perim, 4),
            "area_m2":          round(area, 6),
            "wall_thickness_m": round(nozzle_diameter_mm / 1000.0, 4),
            "complexity":       1.0,
        }
        for idx in range(num_layers)
    ]
    geo_meta = {
        "num_layers":        num_layers,
        "total_layers":      num_layers,
        "subsampled":        False,
        "layer_height":      layer_h,
        "nozzle_width":      nozzle_diameter_mm / 1000.0,
        "bounds_x":          (round(min(xs), 3), round(max(xs), 3)),
        "bounds_y":          (round(min(ys), 3), round(max(ys), 3)),
        "bounds_z":          (0.0, round(wall_h, 3)),
        "total_height_m":    round(wall_h, 3),
        "total_segments":    len(segs_m) * num_layers,
        "total_perimeter_m": round(perim * num_layers, 2),
        "file_name":         "floorplan",
    }

    start   = time.time()
    printer = {
        "nozzle_diameter_mm":    nozzle_diameter_mm,
        "bead_compression":      bead_compression,
        "max_speed_mm_s":        max_speed_mm_s,
        "min_speed_mm_s":        min_speed_mm_s,
        "max_mass_flow_l_min":   8.0,
        "hose_length_m":         15.0,
        "hose_internal_diam_mm": 50.0,
        "acceleration_mm_s2":    500.0,
        "pump_lag_s":            2.25,
    }

    if city:
        try:
            weather_sched = fetch_forecast_schedule(city, print_start_hour, max(1.0, num_layers * layer_h / 60.0))
        except Exception:
            try:
                snap = fetch_current_weather(city)
                weather_sched = WeatherSchedule()
                weather_sched.snapshots = [snap]
                weather_sched.source    = "live"
                weather_sched.city      = city
            except Exception:
                weather_sched = _manual_schedule(None, print_start_hour, temperature, humidity, wind_speed, 0.0)
    else:
        weather_sched = _manual_schedule(None, print_start_hour, temperature, humidity, wind_speed, 0.0)

    avg_cond   = average_conditions(weather_sched)
    worst_cond = worst_conditions(weather_sched)

    if not os.path.exists(MODEL_PATH):
        raise HTTPException(503, "RL model not found — run python train.py first")

    try:
        toolpath, layer_params, stats = optimize(
            geometry        = geometry,
            layer_metas     = layer_metas,
            weather_sched   = weather_sched,
            model_path      = MODEL_PATH,
            printer         = printer,
            base_speed_mm_s = base_speed_mm_s,
        )
    except Exception as e:
        raise HTTPException(500, f"Optimisation failed: {e}")

    gcode_str = toolpath_to_gcode(
        toolpath         = toolpath,
        layer_params     = layer_params,
        printer_name     = printer_name,
        uses_e_axis      = uses_e_axis,
        nozzle_diam_mm   = nozzle_diameter_mm,
        structure_type   = structure_type,
        time_blocks      = [],
        print_start_hour = print_start_hour,
    )

    elapsed   = round(time.time() - start, 2)
    result_id = str(uuid.uuid4())
    with open(f"{RESULTS_DIR}/{result_id}.gcode", "w", encoding="utf-8") as f:
        f.write(gcode_str)

    import math as _math
    GAP_THRESHOLD_M = 0.002
    def _ser(segs):
        out = []
        for i, s in enumerate(segs):
            if i > 0:
                prev = segs[i - 1]
                if _math.hypot(s[0][0] - prev[1][0], s[0][1] - prev[1][1]) > GAP_THRESHOLD_M:
                    out.append({"gap": True})
            out.append({"x0": s[0][0], "y0": s[0][1], "x1": s[1][0], "y1": s[1][1]})
        return out

    toolpath_json = [_ser(layer) for layer in toolpath]
    est_s         = stats.get("estimated_print_time_s", 0)

    return {
        "result_id":              result_id,
        "elapsed_seconds":        elapsed,
        "geometry":               geo_meta,
        "material": {
            "name":              PRODUCT_NAME,
            "pot_life_20c":      60,
            "pot_life_at_worst": round(pot_life_at_temp(worst_cond["temperature"]), 1),
        },
        "printer": {
            "name":             printer_name,
            "nozzle_mm":        nozzle_diameter_mm,
            "layer_height_mm":  round(layer_h * 1000, 1),
            "effective_speed":  stats.get("avg_print_speed_mm_s", base_speed_mm_s),
        },
        "weather": {
            "source": weather_sched.source,
            "city":   weather_sched.city or "manual",
            "avg":    avg_cond,
            "worst":  worst_cond,
        },
        "optimization":           stats,
        "estimated_print_time":   format_print_time(est_s),
        "estimated_print_time_s": est_s,
        "toolpath":               toolpath_json,
        "gcode_lines":            len(gcode_str.splitlines()),
        "gcode_preview":          "\n".join(gcode_str.splitlines()[:40]),
        "gcode_full":             gcode_str,
        "layer_stats": [
            {
                "layer":        lm["index"],
                "z_height_mm":  round(lm["z_height_m"] * 1000, 1),
                "segments":     lm["segment_count"],
                "perimeter_mm": round(lm["perimeter_m"] * 1000, 1),
                "speed_mm_s":   layer_params[lm["index"]].print_speed_mm_s if lm["index"] < len(layer_params) else 0,
                "risk_score":   layer_params[lm["index"]].risk_score        if lm["index"] < len(layer_params) else 0,
            }
            for lm in layer_metas[:len(layer_params)]
        ],
    }


@app.post("/floorplan/preview")
async def floorplan_preview(file: UploadFile = File(...)):
    import fitz
    try:
        file_bytes = await file.read()
        doc = fitz.open(stream=file_bytes, filetype="pdf")
        page = doc[0]
        mat  = fitz.Matrix(2.0, 2.0)
        pix  = page.get_pixmap(matrix=mat, alpha=False)
        png_bytes = pix.tobytes("png")
        result = {
            "image_base64":   base64.b64encode(png_bytes).decode("utf-8"),
            "page_width_pt":  float(page.rect.width),
            "page_height_pt": float(page.rect.height),
            "zoom":           2.0,
            "image_width_px": pix.width,
            "image_height_px": pix.height,
            "page_count":     doc.page_count,
        }
        doc.close()
        return result
    except Exception as e:
        return {"error": str(e)}


# ── Weather endpoints ─────────────────────────────────────────────────────────

@app.get("/weather/current")
def get_current_weather(city: str):
    try:
        resp = requests.get(
            f"{OW_BASE}/weather",
            params={"q": city, "appid": OW_KEY, "units": "metric"},
            timeout=10,
        )
        resp.raise_for_status()
        data = resp.json()
        temp       = data["main"]["temp"]
        humidity   = data["main"]["humidity"]
        wind_speed = data["wind"]["speed"] * 3.6  # m/s → km/h
        description = data["weather"][0]["description"]
        timezone    = data.get("timezone", 0)       # seconds from UTC
        city_name   = data.get("name", city)
        return {
            "city":         city_name,
            "temperature":  temp,
            "humidity":     humidity,
            "wind_speed":   wind_speed,
            "description":  description,
            "timezone":     timezone,
            "pot_life_min": round(pot_life_at_temp(temp), 1),
            "risk_score":   composite_risk_score(temp, humidity, wind_speed),
            "source":       "openweathermap",
        }
    except requests.HTTPError as e:
        if e.response.status_code == 404:
            raise HTTPException(404, f"City '{city}' not found")
        raise HTTPException(502, f"Weather API error: {e}")
    except Exception as e:
        raise HTTPException(502, str(e))


@app.get("/weather/search")
def search_cities(q: str):
    try:
        resp = requests.get(
            f"{OW_GEO_BASE}/direct",
            params={"q": q, "limit": 5, "APPID": OW_KEY},
            timeout=8,
        )
        resp.raise_for_status()
        results = resp.json()
        return [
            {
                "name":    r.get("name"),
                "country": r.get("country"),
                "state":   r.get("state", ""),
                "display": f"{r.get('name')}, {r.get('state', '')} {r.get('country')}".strip(", "),
                "lat":     r.get("lat"),
                "lon":     r.get("lon"),
            }
            for r in results
        ]
    except Exception as e:
        raise HTTPException(502, str(e))


@app.get("/weather/forecast")
def get_forecast(city: str, start_hour: float = 8.0, hours: int = 8):
    """
    Fetch hourly forecast for a city starting at a given hour.
    Returns up to `hours` forecast blocks for the RL optimizer.
    """
    try:
        resp = requests.get(
            f"{OW_BASE}/forecast",
            params={"q": city, "appid": OW_KEY, "units": "metric", "cnt": 40},
            timeout=8,
        )
        resp.raise_for_status()
        data = resp.json()
        items = data.get("list", [])

        result = []
        for item in items:
            import datetime
            dt   = datetime.datetime.fromtimestamp(item["dt"])
            hour = dt.hour + dt.minute / 60.0

            # Filter to items at or after start_hour
            if hour < start_hour and len(result) == 0:
                continue

            temp     = item["main"]["temp"]
            humidity = item["main"]["humidity"]
            wind     = item["wind"]["speed"] * 3.6  # m/s → km/h
            desc     = item["weather"][0]["description"] if item.get("weather") else ""
            risk     = composite_risk_score(temp, humidity, wind)

            result.append({
                "hour":        round(hour, 2),
                "temperature": round(temp, 1),
                "humidity":    round(humidity, 1),
                "wind_speed":  round(wind, 1),
                "description": desc,
                "risk":        round(risk, 1),
            })

            if len(result) >= hours:
                break

        return result
    except requests.HTTPError as e:
        raise HTTPException(502, f"Weather API error: {e}")
    except Exception as e:
        raise HTTPException(502, str(e))


# ── Sika 733 info ─────────────────────────────────────────────────────────────

@app.get("/material")
def material_info():
    return {
        "product":          PRODUCT_NAME,
        "pot_life": {
            "10c": 80, "20c": 60, "30c": 40,
            "unit": "minutes",
            "note": "Based on extruded material temperature",
        },
        "ambient_temp_range": {"min_c": 5, "max_c": 30},
        "layer_height_range": {"min_mm": 6, "max_mm": 20},
        "max_grain_size_mm": 3,
        "fresh_density_kg_l": 2.1,
        "spread_flow_target_mm": 130,
        "water_ratio": {"min_pct": 15, "max_pct": 17},
    }


# ── Main optimize endpoint ────────────────────────────────────────────────────

@app.post("/optimize")
async def optimize_endpoint(
    file:                  UploadFile     = File(...),
    # Printer config
    printer_name:          str            = Form("Custom 3DCP Printer"),
    nozzle_diameter_mm:    float          = Form(25.0),
    bead_compression:      float          = Form(0.6),   # layer height = nozzle × this
    max_speed_mm_s:        float          = Form(100.0),
    min_speed_mm_s:        float          = Form(15.0),
    max_mass_flow_l_min:   float          = Form(8.0),
    hose_length_m:         float          = Form(15.0),
    hose_internal_diam_mm: float          = Form(50.0),
    acceleration_mm_s2:    float          = Form(500.0),
    uses_e_axis:           bool           = Form(False),
    # Base speed
    base_speed_mm_s:       float          = Form(60.0),
    # Layer height — 0 means auto-compute from nozzle × bead_compression
    layer_height_m:        float          = Form(0.0),
    # Weather
    city:                  Optional[str]  = Form(None),
    temperature:           float          = Form(20.0),
    humidity:              float          = Form(65.0),
    wind_speed:            float          = Form(8.0),
    ground_slope:          float          = Form(0.0),
    weather_blocks:        Optional[str]  = Form(None),
    print_start_hour:      float          = Form(8.0),
    # Max layers
    max_layers:            Optional[int]  = Form(None),
    # Deprecated — kept for backwards compat
    cement_mix_name:       Optional[str]  = Form(None),
    print_speed:           Optional[float] = Form(None),
    # Scale factor
    print_scale:           float          = Form(1.0),
    # Slicing mode
    slicing_mode:          str            = Form("geometry"),
    # Structure / time blocks
    structure_type:        str            = Form("wall"),
    time_blocks:           str            = Form("[]"),
):
    fname = file.filename or ""
    allowed_exts = (".stl", ".obj", ".stp", ".step", ".dxf", ".ifc")
    if not fname.lower().endswith(allowed_exts):
        raise HTTPException(400, f"Unsupported file type. Supported: {', '.join(allowed_exts)}")
    if not os.path.exists(MODEL_PATH):
        raise HTTPException(503, "RL model not found — run python train.py first")

    # Compat: print_speed form field → base_speed_mm_s
    if print_speed is not None and base_speed_mm_s == 60.0:
        base_speed_mm_s = print_speed

    start = time.time()

    # ── Build printer profile ─────────────────────────────────────────────────
    printer = {
        "nozzle_diameter_mm":    nozzle_diameter_mm,
        "bead_compression":      bead_compression,
        "max_speed_mm_s":        max_speed_mm_s,
        "min_speed_mm_s":        min_speed_mm_s,
        "max_mass_flow_l_min":   max_mass_flow_l_min,
        "hose_length_m":         hose_length_m,
        "hose_internal_diam_mm": hose_internal_diam_mm,
        "acceleration_mm_s2":    acceleration_mm_s2,
        "pump_lag_s":            max(1.0, hose_length_m * 0.15),
    }

    # ── Layer height from nozzle × bead compression ───────────────────────────
    # bead_compression: 0.5 = conservative (strong bond), 0.6 = industry standard,
    # 0.8 = aggressive (fast build). Pi auto-calibrates from test extrusion.
    if layer_height_m <= 0:
        layer_height_m = float(
            max(LAYER_HEIGHT_MIN_M,
                min(LAYER_HEIGHT_MAX_M, (nozzle_diameter_mm * bead_compression) / 1000.0))
        )
    print(f"[DEBUG] nozzle={nozzle_diameter_mm}mm bead={bead_compression} => layer_height={layer_height_m*1000:.1f}mm", flush=True)

    # ── Parse and slice first — we need actual geometry for print-duration estimate ──
    try:
        file_bytes = await file.read()
        geometry, layer_metas, geo_meta = parse_and_slice(
            file_bytes,
            fname,
            layer_height  = layer_height_m,
            nozzle_width  = nozzle_diameter_mm / 1000.0,
            max_layers    = max_layers,
            print_scale   = print_scale,
            slicing_mode  = slicing_mode,
        )
    except Exception as e:
        raise HTTPException(422, f"Failed to parse 3D file: {e}")

    # Estimate print duration from real geometry so the forecast covers the full job
    from sika733 import min_interlayer_time as _mit
    _pump_lag_s   = max(1.0, hose_length_m * 0.15)
    _lh_m         = layer_height_m if layer_height_m > 0 else max(
        LAYER_HEIGHT_MIN_M, min(LAYER_HEIGHT_MAX_M, (nozzle_diameter_mm * bead_compression) / 1000.0)
    )
    _total_perim  = sum(float(lm.get("perimeter_m", 0.0)) for lm in layer_metas) * 1000.0
    _num_layers   = len(layer_metas)
    _est_print_h  = max(
        1.0,
        (_total_perim / max(base_speed_mm_s, 1.0) + _num_layers * (_mit(_lh_m) + _pump_lag_s)) / 3600.0 * 1.3,
    )

    # ── Weather schedule ──────────────────────────────────────────────────────
    weather_sched: WeatherSchedule

    if city:
        try:
            weather_sched = fetch_forecast_schedule(city, print_start_hour, _est_print_h)
        except Exception:
            try:
                snap = fetch_current_weather(city)
                weather_sched = WeatherSchedule()
                weather_sched.snapshots = [snap]
                weather_sched.source    = "live"
                weather_sched.city      = city
            except Exception:
                weather_sched = _manual_schedule(
                    weather_blocks, print_start_hour,
                    temperature, humidity, wind_speed, ground_slope,
                )
    else:
        weather_sched = _manual_schedule(
            weather_blocks, print_start_hour,
            temperature, humidity, wind_speed, ground_slope,
        )

    avg_cond   = average_conditions(weather_sched)
    worst_cond = worst_conditions(weather_sched)

    # ── RL optimise ───────────────────────────────────────────────────────────
    try:
        toolpath, layer_params, stats = optimize(
            geometry        = geometry,
            layer_metas     = layer_metas,
            weather_sched   = weather_sched,
            model_path      = MODEL_PATH,
            printer         = printer,
            base_speed_mm_s = base_speed_mm_s,
            max_layers      = max_layers,
        )
    except Exception as e:
        raise HTTPException(500, f"Optimisation failed: {e}")

    # ── Parse time blocks ─────────────────────────────────────────────────────
    try:
        parsed_time_blocks = json.loads(time_blocks) if time_blocks else []
    except Exception:
        parsed_time_blocks = []

    # ── G-code ────────────────────────────────────────────────────────────────
    gcode_str = toolpath_to_gcode(
        toolpath       = toolpath,
        layer_params   = layer_params,
        printer_name   = printer_name,
        uses_e_axis    = uses_e_axis,
        nozzle_diam_mm = nozzle_diameter_mm,
        structure_type = structure_type,
        time_blocks    = parsed_time_blocks,
        print_start_hour = print_start_hour,
    )

    elapsed   = round(time.time() - start, 2)
    result_id = str(uuid.uuid4())

    with open(f"{RESULTS_DIR}/{result_id}.gcode", "w", encoding="utf-8") as f:
        f.write(gcode_str)

    import math as _math
    GAP_THRESHOLD_M = 0.002

    def serialise_layer(segs):
        out = []
        for i, s in enumerate(segs):
            if i > 0:
                prev = segs[i - 1]
                gap  = _math.hypot(s[0][0] - prev[1][0], s[0][1] - prev[1][1])
                if gap > GAP_THRESHOLD_M:
                    out.append({"gap": True})
            out.append({"x0": s[0][0], "y0": s[0][1], "x1": s[1][0], "y1": s[1][1]})
        return out

    toolpath_json = [serialise_layer(layer) for layer in toolpath]
    with open(f"{RESULTS_DIR}/{result_id}.json", "w") as f:
        json.dump({
            "toolpath":     toolpath_json,
            "layer_params": [lp.to_dict() for lp in layer_params],
        }, f)

    est_s   = stats.get("estimated_print_time_s", 0)
    est_str = format_print_time(est_s)

    speed_profile = [
        {"layer": lp.layer_idx, "speed_mm_s": lp.print_speed_mm_s, "risk": lp.risk_score}
        for lp in layer_params[:20]
    ]

    return {
        "result_id":              result_id,
        "elapsed_seconds":        elapsed,
        "geometry":               {**geo_meta, "file_name": fname},
        "material": {
            "name":              PRODUCT_NAME,
            "pot_life_20c":      60,
            "pot_life_at_worst": round(pot_life_at_temp(worst_cond["temperature"]), 1),
        },
        "printer": {
            "name":             printer_name,
            "nozzle_mm":        nozzle_diameter_mm,
            "bead_compression": bead_compression,
            "layer_height_mm":  round(layer_height_m * 1000, 1),
            "effective_speed":  stats.get("avg_print_speed_mm_s", base_speed_mm_s),
        },
        "weather": {
            "source":      weather_sched.source,
            "city":        weather_sched.city or "manual",
            "avg":         avg_cond,
            "worst":       worst_cond,
            "blocks_used": len(weather_sched.blocks) + len(weather_sched.snapshots),
        },
        "optimization":           {**stats},
        "estimated_print_time":   est_str,
        "estimated_print_time_s": est_s,
        "speed_profile":          speed_profile,
        "toolpath":               toolpath_json,
        "gcode_lines":            len(gcode_str.splitlines()),
        "gcode_preview":          "\n".join(gcode_str.splitlines()[:40]),
        "gcode_full":             gcode_str,
        "layer_stats": [
            {
                "layer":            lm["index"],
                "z_height_mm":      round(lm["z_height_m"] * 1000, 1),
                "segments":         lm["segment_count"],
                "perimeter_mm":     round(lm["perimeter_m"] * 1000, 1),
                "area_cm2":         round(lm["area_m2"] * 10000, 2),
                "complexity":       lm["complexity"],
                "print_speed_mm_s": layer_params[lm["index"]].print_speed_mm_s if lm["index"] < len(layer_params) else 0,
                "risk_score":       layer_params[lm["index"]].risk_score        if lm["index"] < len(layer_params) else 0,
                "temperature_c":    layer_params[lm["index"]].weather_snapshot.get("temperature", 20.0) if lm["index"] < len(layer_params) else None,
            }
            for lm in layer_metas[:max_layers or len(layer_metas)]
        ],
    }


# ── G-code download ───────────────────────────────────────────────────────────

@app.get("/gcode/{result_id}", response_class=PlainTextResponse)
def get_gcode(result_id: str):
    path = f"{RESULTS_DIR}/{result_id}.gcode"
    if not os.path.exists(path):
        raise HTTPException(404, "G-code not found")
    with open(path, encoding="utf-8") as f:
        return f.read()


@app.get("/toolpath/{result_id}")
def get_toolpath(result_id: str):
    path = f"{RESULTS_DIR}/{result_id}.json"
    if not os.path.exists(path):
        raise HTTPException(404, "Result not found")
    with open(path) as f:
        return json.load(f)


# ── Helpers ───────────────────────────────────────────────────────────────────

def _manual_schedule(
    weather_blocks_json: Optional[str],
    print_start_hour:    float,
    temperature:         float,
    humidity:            float,
    wind_speed:          float,
    ground_slope:        float,
) -> WeatherSchedule:
    if weather_blocks_json:
        try:
            blocks_data = json.loads(weather_blocks_json)
            return build_schedule_from_blocks(blocks_data, print_start_hour)
        except Exception:
            pass
    from weather import WeatherSnapshot, WeatherSchedule
    sched = WeatherSchedule()
    sched.snapshots = [WeatherSnapshot(
        temperature = temperature,
        humidity    = humidity,
        wind_speed  = wind_speed,
        description = "manual input",
        timestamp_h = 0.0,
    )]
    sched.source = "manual"
    return sched