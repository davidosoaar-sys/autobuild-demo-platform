"""
gcode.py — AutoBuild AI 3DCP G-code Generator

Handles:
- Per-layer adaptive speed from RL + Sika 733 physics
- PUMP OFF before travel gaps (windows/doors) → PUMP ON after
- Interlayer dwell
- Proper E-axis extrusion accounting
"""

from typing import List
from optimizer import LayerParams
from geometry import Segment, Layer
import math

# Gap threshold scales with nozzle diameter: 8% of nozzle width
# 15mm nozzle → 1.2mm, 25mm → 2.0mm, 50mm → 4.0mm
def _gap_threshold_mm(nozzle_diam_mm: float) -> float:
    return max(1.0, nozzle_diam_mm * 0.08)


def toolpath_to_gcode(
    toolpath:       List[Layer],
    layer_params:   List["LayerParams"],
    printer_name:   str   = "Custom 3DCP Printer",
    uses_e_axis:    bool  = True,
    nozzle_diam_mm: float = 25.0,
    comment_level:  int   = 1,
) -> str:
    lines: List[str] = []

    def c(text: str) -> str:
        return f"; {text}" if comment_level >= 1 else ""

    def pump_on(speed_mm_min: float) -> str:
        return f"M106 S255  {c('PUMP ON — start extrusion')}"

    def pump_off() -> str:
        return f"M107       {c('PUMP OFF — stop extrusion')}"

    # ── Header ────────────────────────────────────────────────────────────────
    gap_threshold_mm = _gap_threshold_mm(nozzle_diam_mm)

    lines += [
        c("=" * 60),
        c("AutoBuild AI — Adaptive 3DCP G-code"),
        c(f"Material: Sikacrete-733 W 3D"),
        c(f"Printer:  {printer_name}"),
        c(f"Nozzle:   {nozzle_diam_mm} mm"),
        c(f"Layers:   {len(toolpath)}"),
        c(f"Gap threshold: {gap_threshold_mm:.1f} mm (windows/doors)"),
        c("=" * 60),
        "",
        "; === INITIALISE ===",
        "G21         ; units: millimetres",
        "G90         ; absolute positioning",
        "M83         ; relative extrusion" if uses_e_axis else "; pump-controlled",
        "G92 E0      ; reset extrusion counter",
        "G1 F1000    ; safe starting feedrate",
        pump_off(),   # start with pump off
        "",
    ]

    e_total      = 0.0
    extruding    = False   # track pump state

    for layer_idx, (layer_segs, lp) in enumerate(zip(toolpath, layer_params)):

        if not layer_segs:
            lines += [c(f"Layer {layer_idx+1} — empty, skip"), ""]
            continue

        z_mm         = lp.z_height_m * 1000
        speed_mm_s   = lp.print_speed_mm_s
        speed_mm_min = speed_mm_s * 60
        ext_mult     = lp.extrusion_multiplier
        wait_ms      = int(lp.interlayer_wait_s * 1000)
        temp_c       = lp.weather_snapshot.get("temperature", 20.0)
        risk         = lp.risk_score
        bead_area    = nozzle_diam_mm * (lp.layer_height_m * 1000)

        lines += [
            c("-" * 50),
            c(f"Layer {layer_idx+1}/{len(toolpath)}"),
            c(f"  Z: {z_mm:.1f} mm  |  Speed: {speed_mm_s:.1f} mm/s  |  Risk: {risk:.1f}/100"),
            c(f"  Temp: {temp_c:.1f}°C  |  Pot life left: {lp.pot_life_remaining_min:.1f} min"),
        ]

        # Make sure pump is off before raising Z
        if extruding:
            lines.append(pump_off())
            extruding = False

        # Raise to layer height
        lines.append(f"G0 Z{z_mm:.3f}  {c('raise to layer height')}")

        # Travel to first segment start
        first = layer_segs[0]
        x0 = first[0][0] * 1000
        y0 = first[0][1] * 1000
        lines.append(f"G0 X{x0:.3f} Y{y0:.3f} F3000  {c('travel to layer start')}")

        # Print segments — detect gaps for windows/doors
        for seg_idx, seg in enumerate(layer_segs):
            xs = seg[0][0] * 1000;  ys = seg[0][1] * 1000
            xe = seg[1][0] * 1000;  ye = seg[1][1] * 1000
            seg_len = math.hypot(xe - xs, ye - ys)

            if seg_idx == 0:
                # Always travel to first seg start, then pump on
                if not extruding:
                    lines.append(pump_on(speed_mm_min))
                    extruding = True
            else:
                # Check gap from previous segment end
                prev = layer_segs[seg_idx - 1]
                px = prev[1][0] * 1000
                py = prev[1][1] * 1000
                gap = math.hypot(xs - px, ys - py)

                if gap > gap_threshold_mm:
                    # ── WINDOW / DOOR OPENING ─────────────────────────────
                    # Stop pump, travel over gap, restart pump
                    lines += [
                        pump_off(),
                        c(f"  Gap {gap:.1f}mm — window/door opening"),
                        f"G0 X{xs:.3f} Y{ys:.3f} F3000  {c('travel over opening')}",
                        pump_on(speed_mm_min),
                    ]
                    extruding = True
                else:
                    # Continuous — just move (pump already on)
                    if not extruding:
                        lines.append(pump_on(speed_mm_min))
                        extruding = True

            # Extrusion
            if uses_e_axis and seg_len > 0.01:
                e_amount = (seg_len * bead_area * ext_mult) / (math.pi * (1.75/2)**2)
                e_total += e_amount
                e_str = f" E{e_total:.4f}"
            else:
                e_str = ""

            lines.append(
                f"G1 X{xe:.3f} Y{ye:.3f} F{speed_mm_min:.0f}{e_str}  "
                f"{c(f'seg {seg_idx+1}') if comment_level >= 2 else ''}"
            )

        # End of layer — pump off
        if extruding:
            lines.append(pump_off())
            extruding = False

        # Interlayer wait
        if wait_ms > 0 and layer_idx < len(toolpath) - 1:
            lines.append(f"G4 P{wait_ms}  {c(f'wait {lp.interlayer_wait_s:.1f}s for bond')}")

        lines.append("")

    # ── Footer ────────────────────────────────────────────────────────────────
    lines += [
        c("=" * 60),
        c("Print complete"),
        pump_off(),
        "G0 Z100   ; raise nozzle",
        "M84       ; disable motors",
        c("End of file"),
    ]

    return "\n".join(lines)


def format_print_time(seconds: float) -> str:
    if seconds < 60:   return f"{int(seconds)}s"
    if seconds < 3600: return f"{int(seconds//60)}m {int(seconds%60)}s"
    return f"{int(seconds//3600)}h {int((seconds%3600)//60)}m"