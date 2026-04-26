"""
sika733.py
Hardcoded constants for Sikacrete®-733 W 3D
Source: Sika Product Data Sheet, November 2023, Version 01.03
"""


# ── Product identity ──────────────────────────────────────────────────────────

PRODUCT_NAME         = "Sikacrete®-733 W 3D"
PRODUCT_CODE         = "Sikacrete-733W3D"
MAX_GRAIN_SIZE_MM    = 3.0
FRESH_DENSITY_KG_L   = 2.1

# ── Temperature limits (°C) ───────────────────────────────────────────────────

AMBIENT_TEMP_MIN  = 5.0
AMBIENT_TEMP_MAX  = 30.0
PRODUCT_TEMP_MIN  = 10.0
PRODUCT_TEMP_MAX  = 25.0
IDEAL_TEMP        = 20.0

# ── Pot life at reference temperatures (minutes) ──────────────────────────────

POT_LIFE_10C  = 80.0
POT_LIFE_20C  = 60.0
POT_LIFE_30C  = 40.0
POT_LIFE_RATE_MIN_PER_DEG = -0.4

# ── Layer geometry ────────────────────────────────────────────────────────────

LAYER_HEIGHT_MIN_M  = 0.006
LAYER_HEIGHT_MAX_M  = 0.020
LAYER_HEIGHT_DEF_M  = 0.010

# ── Spread flow target ────────────────────────────────────────────────────────

SPREAD_FLOW_TARGET_MM = 130

# ── Vertical print speed limit ────────────────────────────────────────────────

MAX_VERTICAL_SPEED_CM_MIN = 1.2

# ── Minimum interlayer times (seconds) by layer height ───────────────────────

INTERLAYER_TABLE = [
    (0.005, 25.0),
    (0.010, 50.0),
    (0.020, 100.0),
]

# ── Water ratio ───────────────────────────────────────────────────────────────

WATER_RATIO_MIN = 0.15
WATER_RATIO_MAX = 0.17
WATER_RATIO_DEF = 0.16

# ── Compressive strength targets (MPa) ───────────────────────────────────────

STRENGTH_1D   = 10.0
STRENGTH_7D   = 47.0
STRENGTH_28D  = 50.0

# ── Humidity limits ───────────────────────────────────────────────────────────

HUMIDITY_MIN_PCT  = 40.0
HUMIDITY_WARN_PCT = 55.0


# ── Functions ─────────────────────────────────────────────────────────────────

def pot_life_at_temp(temp_c: float) -> float:
    if temp_c <= 10.0:
        return POT_LIFE_10C + (10.0 - temp_c) * abs(POT_LIFE_RATE_MIN_PER_DEG)
    elif temp_c <= 20.0:
        t = (temp_c - 10.0) / 10.0
        return POT_LIFE_10C + t * (POT_LIFE_20C - POT_LIFE_10C)
    elif temp_c <= 30.0:
        t = (temp_c - 20.0) / 10.0
        return POT_LIFE_20C + t * (POT_LIFE_30C - POT_LIFE_20C)
    else:
        extra = (temp_c - 30.0) * abs(POT_LIFE_RATE_MIN_PER_DEG)
        return max(20.0, POT_LIFE_30C - extra)


def min_interlayer_time(layer_height_m: float) -> float:
    h = layer_height_m
    if h <= INTERLAYER_TABLE[0][0]:
        ratio = h / INTERLAYER_TABLE[0][0]
        return INTERLAYER_TABLE[0][1] * ratio
    if h >= INTERLAYER_TABLE[-1][0]:
        ratio = h / INTERLAYER_TABLE[-1][0]
        return INTERLAYER_TABLE[-1][1] * ratio
    for i in range(len(INTERLAYER_TABLE) - 1):
        h0, t0 = INTERLAYER_TABLE[i]
        h1, t1 = INTERLAYER_TABLE[i + 1]
        if h0 <= h <= h1:
            frac = (h - h0) / (h1 - h0)
            return t0 + frac * (t1 - t0)
    return INTERLAYER_TABLE[-1][1]


def max_print_speed(
    nozzle_diam_mm: float,
    layer_height_m: float,
    flow_rate_l_min: float,
) -> float:
    bead_width_mm  = nozzle_diam_mm
    bead_height_mm = layer_height_m * 1000
    cross_section_mm2 = bead_width_mm * bead_height_mm
    flow_mm3_s = flow_rate_l_min * 1_000_000 / 60
    if cross_section_mm2 <= 0:
        return 100.0
    speed_mm_s = flow_mm3_s / cross_section_mm2
    return round(speed_mm_s, 1)


def temperature_risk_factor(temp_c: float) -> float:
    # Optimal range per Sikacrete 733 data sheet: 15°C to 25°C
    # AMBIENT_TEMP_MAX = 30°C — above 25°C is already elevated risk
    if 15.0 <= temp_c <= 25.0:
        return 0.0
    elif temp_c < 15.0:
        return min(1.0, (15.0 - temp_c) / 10.0)
    elif temp_c <= 30.0:
        # 25°C to 30°C — moderate risk, linear scale
        return min(0.6, (temp_c - 25.0) / 5.0 * 0.6)
    else:
        # Above 30°C — high risk
        return min(1.0, 0.6 + (temp_c - 30.0) / 10.0 * 0.4)


def humidity_risk_factor(humidity_pct: float) -> float:
    if humidity_pct >= HUMIDITY_WARN_PCT:
        return 0.0
    elif humidity_pct >= HUMIDITY_MIN_PCT:
        return (HUMIDITY_WARN_PCT - humidity_pct) / (HUMIDITY_WARN_PCT - HUMIDITY_MIN_PCT) * 0.5
    else:
        return min(1.0, 0.5 + (HUMIDITY_MIN_PCT - humidity_pct) / HUMIDITY_MIN_PCT * 0.5)


def wind_risk_factor(wind_kmh: float) -> float:
    if wind_kmh < 10:
        return 0.0
    elif wind_kmh < 20:
        return (wind_kmh - 10) / 10 * 0.3
    elif wind_kmh < 40:
        return 0.3 + (wind_kmh - 20) / 20 * 0.5
    else:
        return min(1.0, 0.8 + (wind_kmh - 40) / 40 * 0.2)


def composite_risk_score(
    temp_c: float,
    humidity_pct: float,
    wind_kmh: float,
    slope_deg: float = 0.0,
) -> float:
    t_risk = temperature_risk_factor(temp_c)
    h_risk = humidity_risk_factor(humidity_pct)
    w_risk = wind_risk_factor(wind_kmh)
    s_risk = min(1.0, slope_deg / 15.0)
    score = (
        t_risk * 40.0 +
        h_risk * 30.0 +
        w_risk * 20.0 +
        s_risk * 10.0
    )
    return round(min(100.0, score), 1)


def adapt_speed_for_conditions(
    base_speed_mm_s: float,
    temp_c: float,
    humidity_pct: float,
    wind_kmh: float,
    pot_life_remaining_min: float,
    elapsed_fraction: float,       # fraction of total print elapsed (0–1)
) -> float:
    speed = base_speed_mm_s

    # Temperature: push faster when hot (cement sets quicker), slower when cold
    if temp_c > 25.0:
        speed *= 1.0 + (temp_c - 25.0) * 0.02
    elif temp_c < 15.0:
        speed *= max(0.85, 1.0 - (15.0 - temp_c) * 0.01)

    # Humidity: dry air → surface skins faster → print faster to close layers
    if humidity_pct < HUMIDITY_WARN_PCT:
        dry_factor = (HUMIDITY_WARN_PCT - humidity_pct) / HUMIDITY_WARN_PCT
        speed *= 1.0 + dry_factor * 0.15

    # Wind: slight speed-up to minimise exposed surface time
    if wind_kmh > 10:
        speed *= 1.0 + min(0.2, (wind_kmh - 10) / 100)

    # Pot-life urgency within the current batch window
    pot_life_fraction_used = 1.0 - (pot_life_remaining_min / max(pot_life_at_temp(temp_c), 1.0))
    pot_life_fraction_used = max(0.0, min(1.0, pot_life_fraction_used))
    if pot_life_fraction_used > 0.7:
        urgency = (pot_life_fraction_used - 0.7) / 0.3
        speed *= 1.0 + urgency * 0.3

    # Overall print progress: ease off slightly in early layers for bond strength,
    # hold steady through mid-print, push in the final 20% to beat pot life
    if elapsed_fraction < 0.1:
        speed *= 0.95
    elif elapsed_fraction > 0.8:
        speed *= 1.0 + (elapsed_fraction - 0.8) * 0.15

    return round(max(20.0, min(250.0, speed)), 1)


def layer_height_for_speed(
    nozzle_diam_mm: float,
    bead_compression: float = 0.6,
) -> float:
    """Layer height from actual printer bead compression, not a fixed 0.6 ratio."""
    ideal   = nozzle_diam_mm * bead_compression
    clamped = max(LAYER_HEIGHT_MIN_M * 1000, min(LAYER_HEIGHT_MAX_M * 1000, ideal))
    return round(clamped / 1000, 4)


def estimated_print_time_seconds(
    total_travel_mm: float,
    avg_speed_mm_s: float,
    num_layers: int,
    layer_height_m: float,
    pump_lag_s_per_layer: float = 3.0,
) -> float:
    """
    Realistic print time estimate.

    Logic:
    - Travel time = total path / average speed
    - Interlayer wait is only added if a layer finishes FASTER than the min cure time
      (i.e. the printer has to pause and wait). Large complex layers won't need extra wait.
    - Pump lag per layer comes from printer hose config (hose_length_m * 0.15),
      defaulting to 3s if not supplied.
    """
    if avg_speed_mm_s <= 0 or total_travel_mm <= 0:
        return 0.0

    travel_time_s     = total_travel_mm / avg_speed_mm_s
    avg_layer_print_s = travel_time_s / max(num_layers, 1)
    min_cure_s        = min_interlayer_time(layer_height_m)
    wait_per_layer_s  = max(0.0, min_cure_s - avg_layer_print_s)
    total_wait_s      = wait_per_layer_s * num_layers
    pump_lag_s        = num_layers * pump_lag_s_per_layer

    return travel_time_s + total_wait_s + pump_lag_s