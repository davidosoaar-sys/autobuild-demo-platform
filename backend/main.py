"""
main.py
AutoBuild AI — FastAPI backend
Adaptive 3DCP slicer with Sikacrete-733 W 3D + live weather.
"""

import os, uuid, json, time, math, random
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


# ── Weather endpoints ─────────────────────────────────────────────────────────

@app.get("/weather/current")
def get_current_weather(city: str):
    try:
        snap = fetch_current_weather(city)
        return {
            "city":         city,
            "temperature":  snap.temperature,
            "humidity":     snap.humidity,
            "wind_speed":   snap.wind_speed,
            "description":  snap.description,
            "pot_life_min": round(pot_life_at_temp(snap.temperature), 1),
            "risk_score":   composite_risk_score(snap.temperature, snap.humidity, snap.wind_speed),
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

    # ── Weather schedule ──────────────────────────────────────────────────────
    weather_sched: WeatherSchedule

    if city:
        try:
            weather_sched = fetch_forecast_schedule(city, print_start_hour, 4.0)
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

    # ── Parse and slice ───────────────────────────────────────────────────────
    try:
        file_bytes = await file.read()
        geometry, layer_metas, geo_meta = parse_and_slice(
            file_bytes,
            fname,
            layer_height = layer_height_m,
            nozzle_width = nozzle_diameter_mm / 1000.0,
            max_layers   = max_layers,
            print_scale  = print_scale,
        )
    except Exception as e:
        raise HTTPException(422, f"Failed to parse 3D file: {e}")

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

    # ── G-code ────────────────────────────────────────────────────────────────
    gcode_str = toolpath_to_gcode(
        toolpath       = toolpath,
        layer_params   = layer_params,
        printer_name   = printer_name,
        uses_e_axis    = uses_e_axis,
        nozzle_diam_mm = nozzle_diameter_mm,
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
    return sched#   f o r c e   r e d e p l o y  
 