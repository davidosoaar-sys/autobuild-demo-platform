"""
sika733.py
Hardcoded constants for Sikacrete®-733 W 3D
Source: Sika Product Data Sheet, November 2023, Version 01.03

All values extracted directly from the official PDS.
Temperature sensitivity derived from pot life table:
  10°C → 80 min, 20°C → 60 min, 30°C → 40 min
  → rate: -2 min per +5°C above 10°C baseline
"""

from dataclasses import dataclass
from typing import Tuple
import math

# ── Product identity ──────────────────────────────────────────────────────────

PRODUCT_NAME         = "Sikacrete®-733 W 3D"
PRODUCT_CODE         = "Sikacrete-733W3D"
MAX_GRAIN_SIZE_MM    = 3.0           # mm (max aggregate size)
FRESH_DENSITY_KG_L   = 2.1          # kg/L

# ── Temperature limits (°C) ───────────────────────────────────────────────────

AMBIENT_TEMP_MIN  = 5.0             # °C (do not print below this)
AMBIENT_TEMP_MAX  = 30.0            # °C (do not print above this)
PRODUCT_TEMP_MIN  = 10.0            # °C
PRODUCT_TEMP_MAX  = 25.0            # °C
IDEAL_TEMP        = 20.0            # °C (reference temperature)

# ── Pot life at reference temperatures (minutes) ──────────────────────────────

POT_LIFE_10C  = 80.0   # min at 10°C
POT_LIFE_20C  = 60.0   # min at 20°C
POT_LIFE_30C  = 40.0   # min at 30°C

# Rate: -2 min per +5°C → -0.4 min per °C
POT_LIFE_RATE_MIN_PER_DEG = -0.4   # min / °C (negative = shorter as temp rises)

# ── Layer geometry ────────────────────────────────────────────────────────────

LAYER_HEIGHT_MIN_M  = 0.006    # 6 mm  (from PDS)
LAYER_HEIGHT_MAX_M  = 0.020    # 20 mm (from PDS)
LAYER_HEIGHT_DEF_M  = 0.010    # 10 mm default (mid-range)

# ── Spread flow target ────────────────────────────────────────────────────────

SPREAD_FLOW_TARGET_MM = 130    # mm (EN 13395-1)

# ── Vertical print speed limit ────────────────────────────────────────────────

MAX_VERTICAL_SPEED_CM_MIN = 1.2   # cm/min = 0.2 mm/s vertical build rate

# ── Minimum interlayer times (seconds) by layer height ───────────────────────

# From PDS table: printing height → min layer circle time
INTERLAYER_TABLE = [
    (0.005, 25.0),   # 0.5 cm → 25 sec
    (0.010, 50.0),   # 1.0 cm → 50 sec
    (0.020, 100.0),  # 2.0 cm → 100 sec
]

# ── Water ratio (% by weight of powder) ──────────────────────────────────────

WATER_RATIO_MIN = 0.15   # 15%
WATER_RATIO_MAX = 0.17   # 17%
WATER_RATIO_DEF = 0.16   # 16% default

# ── Compressive strength targets (MPa) ───────────────────────────────────────

STRENGTH_1D   = 10.0    # MPa
STRENGTH_7D   = 47.0    # MPa
STRENGTH_28D  = 50.0    # MPa

# ── Humidity limits ───────────────────────────────────────────────────────────

HUMIDITY_MIN_PCT  = 40.0   # % RH (below this, risk of premature drying)
HUMIDITY_WARN_PCT = 55.0   # % RH (below this, increase caution)


# ── Functions ─────────────────────────────────────────────────────────────────

def pot_life_at_temp(temp_c: float) -> float:
    """
    Pot life in minutes at a given ambient temperature.
    Linear interpolation from PDS data points.
    Below 10°C extrapolates conservatively.
    Above 30°C clamps to minimum 20 min.
    """
    if temp_c <= 10.0:
        return POT_LIFE_10C + (10.0 - temp_c) * abs(POT_LIFE_RATE_MIN_PER_DEG)
    elif temp_c <= 20.0:
        t = (temp_c - 10.0) / 10.0
        return POT_LIFE_10C + t * (POT_LIFE_20C - POT_LIFE_10C)
    elif temp_c <= 30.0:
        t = (temp_c - 20.0) / 10.0
        return POT_LIFE_20C + t * (POT_LIFE_30C - POT_LIFE_20C)
    else:
        # Above max: extrapolate but floor at 20 min
        extra = (temp_c - 30.0) * abs(POT_LIFE_RATE_MIN_PER_DEG)
        return max(20.0, POT_LIFE_30C - extra)


def min_interlayer_time(layer_height_m: float) -> float:
    """
    Minimum interlayer time in seconds for a given layer height.
    Interpolates from PDS table.
    """
    h = layer_height_m
    # Below minimum entry: scale linearly from 0
    if h <= INTERLAYER_TABLE[0][0]:
        ratio = h / INTERLAYER_TABLE[0][0]
        return INTERLAYER_TABLE[0][1] * ratio
    # Above maximum entry: scale linearly from last entry
    if h >= INTERLAYER_TABLE[-1][0]:
        ratio = h / INTERLAYER_TABLE[-1][0]
        return INTERLAYER_TABLE[-1][1] * ratio
    # Interpolate between table entries
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
    """
    Maximum print speed (mm/s) from rotor-stator flow rate and bead cross-section.
    From PDS equation: flow_rate = speed × bead_width × bead_height

    Returns speed in mm/s.
    """
    # Bead cross-section approximation: rectangular nozzle_diam × layer_height
    bead_width_mm  = nozzle_diam_mm
    bead_height_mm = layer_height_m * 1000  # m → mm

    # Volume per mm of travel = width × height (mm²)
    cross_section_mm2 = bead_width_mm * bead_height_mm

    # Convert flow rate: L/min → mm³/s
    flow_mm3_s = flow_rate_l_min * 1_000_000 / 60  # L/min → mm³/s

    if cross_section_mm2 <= 0:
        return 100.0  # fallback

    speed_mm_s = flow_mm3_s / cross_section_mm2
    return round(speed_mm_s, 1)


def temperature_risk_factor(temp_c: float) -> float:
    """
    0.0 = no risk, 1.0 = maximum risk.
    Risk increases outside the 15–25°C comfort zone.
    """
    if 15.0 <= temp_c <= 25.0:
        return 0.0
    elif temp_c < 15.0:
        return min(1.0, (15.0 - temp_c) / 10.0)
    else:
        return min(1.0, (temp_c - 25.0) / 5.0)


def humidity_risk_factor(humidity_pct: float) -> float:
    """
    0.0 = no risk, 1.0 = maximum risk (below 40% RH → premature drying).
    """
    if humidity_pct >= HUMIDITY_WARN_PCT:
        return 0.0
    elif humidity_pct >= HUMIDITY_MIN_PCT:
        return (HUMIDITY_WARN_PCT - humidity_pct) / (HUMIDITY_WARN_PCT - HUMIDITY_MIN_PCT) * 0.5
    else:
        return min(1.0, 0.5 + (HUMIDITY_MIN_PCT - humidity_pct) / HUMIDITY_MIN_PCT * 0.5)


def wind_risk_factor(wind_kmh: float) -> float:
    """
    0.0 = no risk, 1.0 = maximum risk.
    Wind accelerates drying and can cause premature surface cracking.
    """
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
    """
    Composite environmental risk score 0–100.
    Weighted: temperature 40%, humidity 30%, wind 20%, slope 10%.
    """
    t_risk = temperature_risk_factor(temp_c)
    h_risk = humidity_risk_factor(humidity_pct)
    w_risk = wind_risk_factor(wind_kmh)
    s_risk = min(1.0, slope_deg / 15.0)   # 15° slope = full risk

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
    elapsed_fraction: float,   # 0–1, how far through this layer
) -> float:
    """
    Adapt print speed for current environmental conditions and material state.

    Key logic:
    - Hot/dry/windy → speed UP to outrun setting before pot life expires
    - Cool/humid/calm → speed normal or slightly down for better bond
    - As pot life fraction consumed rises → speed UP (urgency)

    Returns adjusted speed in mm/s, clamped to [20, 250].
    """
    speed = base_speed_mm_s

    # Temperature effect: above 25°C speed up, below 15°C slow down slightly
    if temp_c > 25.0:
        # For each degree above 25°C, increase speed by 2%
        speed *= 1.0 + (temp_c - 25.0) * 0.02
    elif temp_c < 15.0:
        # Below 15°C, slow down slightly for better adhesion (cold platform)
        speed *= max(0.85, 1.0 - (15.0 - temp_c) * 0.01)

    # Humidity effect: below 55% RH, speed up slightly to reduce open surface time
    if humidity_pct < HUMIDITY_WARN_PCT:
        dry_factor = (HUMIDITY_WARN_PCT - humidity_pct) / HUMIDITY_WARN_PCT
        speed *= 1.0 + dry_factor * 0.15

    # Wind effect: increase speed to reduce exposure time
    if wind_kmh > 10:
        speed *= 1.0 + min(0.2, (wind_kmh - 10) / 100)

    # Pot life urgency: if >70% of pot life consumed, increase speed
    pot_life_fraction_used = 1.0 - (pot_life_remaining_min / pot_life_at_temp(temp_c))
    pot_life_fraction_used = max(0.0, min(1.0, pot_life_fraction_used))
    if pot_life_fraction_used > 0.7:
        urgency = (pot_life_fraction_used - 0.7) / 0.3
        speed *= 1.0 + urgency * 0.3

    return round(max(20.0, min(250.0, speed)), 1)


def layer_height_for_speed(
    print_speed_mm_s: float,
    nozzle_diam_mm: float,
) -> float:
    """
    Choose layer height that respects the PDS layer height ratio.
    PDS suggests 0.5–0.7× nozzle diameter as typical layer height.
    Clamp to PDS min/max (6–20mm).
    """
    ideal = nozzle_diam_mm * 0.6     # 60% of nozzle diameter
    clamped = max(LAYER_HEIGHT_MIN_M * 1000, min(LAYER_HEIGHT_MAX_M * 1000, ideal))
    return round(clamped / 1000, 4)   # return in metres


def estimated_print_time_seconds(
    total_travel_mm: float,
    avg_speed_mm_s: float,
    num_layers: int,
    layer_height_m: float,
) -> float:
    """
    Realistic print time estimate including travel, interlayer waits, and pump lag.
    """
    if avg_speed_mm_s <= 0:
        return 0.0

    # Pure travel time
    travel_time = total_travel_mm / avg_speed_mm_s

    # Interlayer wait time (min interlayer × num_layers)
    interlayer_wait = min_interlayer_time(layer_height_m) * num_layers

    # Pump startup lag (~3s per layer start/stop)
    pump_lag = num_layers * 3.0

    return travel_time + interlayer_wait + pump_lag