"""
weather.py
Live weather via OpenWeatherMap API + time-block fallback.

OpenWeatherMap free tier:
  GET https://api.openweathermap.org/data/2.5/weather?q={city}&appid={key}&units=metric
  GET https://api.openweathermap.org/data/2.5/forecast?q={city}&appid={key}&units=metric
    → 5-day / 3-hour forecast

The optimizer requests weather at intervals throughout the estimated print duration.
"""

import time
import requests
from typing import List, Optional
from dataclasses import dataclass, field


# Hardcoded per project requirements — always included in every API call
OPENWEATHER_KEY = "b3c56e66236ef0a54e1d8aee8f399533"
OW_BASE         = "http://api.openweathermap.org/data/2.5"
OW_GEO_BASE     = "http://api.openweathermap.org/geo/1.0"


# ── Data classes ──────────────────────────────────────────────────────────────

@dataclass
class WeatherSnapshot:
    """Single point-in-time weather reading."""
    temperature:  float   # °C
    humidity:     float   # %
    wind_speed:   float   # km/h
    description:  str
    timestamp_h:  float   # hours from print start (0 = now)


@dataclass
class WeatherBlock:
    """User-defined manual time block."""
    start_hour:   float
    end_hour:     float
    temperature:  float
    humidity:     float
    wind_speed:   float
    ground_slope: float = 0.0
    notes:        str   = ""


@dataclass
class WeatherSchedule:
    """Complete weather schedule for a print session."""
    snapshots:        List[WeatherSnapshot] = field(default_factory=list)
    blocks:           List[WeatherBlock]    = field(default_factory=list)
    print_start_hour: float                 = 8.0
    city:             Optional[str]         = None
    source:           str                   = "manual"   # "live" | "forecast" | "manual"


# ── Live weather fetch ────────────────────────────────────────────────────────

def fetch_current_weather(city: str) -> WeatherSnapshot:
    """Fetch current weather for a city from OpenWeatherMap."""
    resp = requests.get(
        f"{OW_BASE}/weather",
        params={"q": city, "APPID": OPENWEATHER_KEY, "units": "metric"},
        timeout=10,
    )
    resp.raise_for_status()
    data = resp.json()

    return WeatherSnapshot(
        temperature  = data["main"]["temp"],
        humidity     = data["main"]["humidity"],
        wind_speed   = data["wind"]["speed"] * 3.6,   # m/s → km/h
        description  = data["weather"][0]["description"],
        timestamp_h  = 0.0,
    )


def fetch_forecast_schedule(
    city: str,
    print_start_hour: float,
    print_duration_h: float,
) -> WeatherSchedule:
    """
    Fetch the full 5-day / 3-hour forecast (cnt=40 = 120 hours) so that
    long prints (e.g. 52-hour builds) get a real weather reading every
    3 hours throughout, not just 2 readings from a hardcoded 4-hour window.
    print_duration_h is kept as a parameter for documentation but no longer
    clips the data — the optimizer consumes as many blocks as the print needs.
    """
    resp = requests.get(
        f"{OW_BASE}/forecast",
        params={"q": city, "APPID": OPENWEATHER_KEY, "units": "metric", "cnt": 40},
        timeout=10,
    )
    resp.raise_for_status()
    data = resp.json()

    snapshots: List[WeatherSnapshot] = []
    now_ts = time.time()

    for item in data["list"]:
        item_ts  = item["dt"]
        offset_h = (item_ts - now_ts) / 3600.0
        # Keep all future forecasts — skip entries more than 1h in the past
        if offset_h < -1:
            continue
        snapshots.append(WeatherSnapshot(
            temperature  = item["main"]["temp"],
            humidity     = item["main"]["humidity"],
            wind_speed   = item["wind"]["speed"] * 3.6,
            description  = item["weather"][0]["description"],
            timestamp_h  = max(0.0, offset_h),
        ))

    return WeatherSchedule(
        snapshots        = snapshots,
        print_start_hour = print_start_hour,
        city             = city,
        source           = "forecast",
    )


def build_schedule_from_blocks(
    blocks_data: List[dict],
    print_start_hour: float,
) -> WeatherSchedule:
    """Parse user-defined time blocks into a WeatherSchedule."""
    blocks = []
    for b in blocks_data:
        blocks.append(WeatherBlock(
            start_hour   = float(b.get("start_hour",   8.0)),
            end_hour     = float(b.get("end_hour",     10.0)),
            temperature  = float(b.get("temperature",  20.0)),
            humidity     = float(b.get("humidity",     65.0)),
            wind_speed   = float(b.get("wind_speed",    8.0)),
            ground_slope = float(b.get("ground_slope",  0.0)),
            notes        = str(b.get("notes", "")),
        ))
    blocks.sort(key=lambda b: b.start_hour)
    return WeatherSchedule(
        blocks           = blocks,
        print_start_hour = print_start_hour,
        source           = "manual",
    )


# ── Condition lookup ──────────────────────────────────────────────────────────

def conditions_at_elapsed(
    schedule: WeatherSchedule,
    elapsed_hours: float,
) -> dict:
    """
    Get weather conditions at a given number of hours into the print.
    Prefers forecast snapshots → falls back to blocks → falls back to defaults.
    """
    # Try forecast snapshots
    if schedule.snapshots:
        best = min(schedule.snapshots, key=lambda s: abs(s.timestamp_h - elapsed_hours))
        return {
            "temperature":  best.temperature,
            "humidity":     best.humidity,
            "wind_speed":   best.wind_speed,
            "ground_slope": 0.0,
            "source":       "forecast",
            "description":  best.description,
        }

    # Try manual blocks
    current_hour = schedule.print_start_hour + elapsed_hours
    for block in schedule.blocks:
        if block.start_hour <= current_hour < block.end_hour:
            return {
                "temperature":  block.temperature,
                "humidity":     block.humidity,
                "wind_speed":   block.wind_speed,
                "ground_slope": block.ground_slope,
                "source":       "manual",
                "description":  block.notes or "manual block",
            }

    # Last block fallback
    if schedule.blocks:
        b = schedule.blocks[-1]
        return {
            "temperature":  b.temperature,
            "humidity":     b.humidity,
            "wind_speed":   b.wind_speed,
            "ground_slope": b.ground_slope,
            "source":       "manual_fallback",
            "description":  "after last block",
        }

    # Absolute fallback — benign conditions
    return {
        "temperature":  20.0,
        "humidity":     65.0,
        "wind_speed":    8.0,
        "ground_slope":  0.0,
        "source":       "default",
        "description":  "no weather data",
    }


def average_conditions(schedule: WeatherSchedule) -> dict:
    """Weighted average conditions across the schedule."""
    if schedule.snapshots:
        n = len(schedule.snapshots)
        return {
            "temperature":  round(sum(s.temperature for s in schedule.snapshots) / n, 1),
            "humidity":     round(sum(s.humidity    for s in schedule.snapshots) / n, 1),
            "wind_speed":   round(sum(s.wind_speed  for s in schedule.snapshots) / n, 1),
            "ground_slope": 0.0,
        }
    if schedule.blocks:
        total_dur = sum(b.end_hour - b.start_hour for b in schedule.blocks)
        if total_dur <= 0:
            b = schedule.blocks[0]
            return {"temperature": b.temperature, "humidity": b.humidity,
                    "wind_speed": b.wind_speed, "ground_slope": b.ground_slope}
        avg = {"temperature": 0.0, "humidity": 0.0, "wind_speed": 0.0, "ground_slope": 0.0}
        for b in schedule.blocks:
            w = (b.end_hour - b.start_hour) / total_dur
            avg["temperature"]  += b.temperature  * w
            avg["humidity"]     += b.humidity     * w
            avg["wind_speed"]   += b.wind_speed   * w
            avg["ground_slope"] += b.ground_slope * w
        return {k: round(v, 2) for k, v in avg.items()}
    return {"temperature": 20.0, "humidity": 65.0, "wind_speed": 8.0, "ground_slope": 0.0}


def worst_conditions(schedule: WeatherSchedule) -> dict:
    """Return the most demanding conditions (highest temp × wind)."""
    if schedule.snapshots:
        worst = max(schedule.snapshots, key=lambda s: s.temperature * 0.6 + s.wind_speed * 0.4)
        return {"temperature": worst.temperature, "humidity": worst.humidity,
                "wind_speed": worst.wind_speed, "ground_slope": 0.0}
    if schedule.blocks:
        worst = max(schedule.blocks, key=lambda b: b.temperature * 0.6 + b.wind_speed * 0.4)
        return {"temperature": worst.temperature, "humidity": worst.humidity,
                "wind_speed": worst.wind_speed, "ground_slope": worst.ground_slope}
    return {"temperature": 20.0, "humidity": 65.0, "wind_speed": 8.0, "ground_slope": 0.0}