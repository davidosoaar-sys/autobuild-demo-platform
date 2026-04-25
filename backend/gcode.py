"""
gcode.py — AutoBuild AI 3DCP G-code Generator

Handles:
- Per-layer adaptive speed from RL + Sika 733 physics
- PUMP OFF before travel gaps (windows/doors) → PUMP ON after
- Interlayer dwell
- Proper E-axis extrusion accounting
- Time block pause sequences (overnight stops)
- Rebar placement comments for column structure type
"""

from typing import List, Optional
from optimizer import LayerParams, _enforce_continuous_loop
from geometry import Segment, Layer
import math

# Gap threshold scales with nozzle diameter: 8% of nozzle width
# 15mm nozzle → 1.2mm, 25mm → 2.0mm, 50mm → 4.0mm
def _gap_threshold_mm(nozzle_diam_mm: float) -> float:
    return max(1.0, nozzle_diam_mm * 0.08)


def _add_rebar_comments(current_height_mm: float, structure_type: str) -> Optional[str]:
    """Return rebar reminder comment lines for column structure, or None."""
    if structure_type != "column":
        return None
    comments = []
    if abs(current_height_mm % 200) < 6:
        comments.append(f"; REBAR: Stirrup required at {current_height_mm:.0f} mm height")
    if abs(current_height_mm % 400) < 6:
        comments.append(f"; REBAR: Vertical rebar check at {current_height_mm:.0f} mm height")
    return "\n".join(comments) if comments else None


def _pause_block(next_block_label: str) -> List[str]:
    """G-code lines emitted at the end of a working window."""
    return [
        "; === PAUSE: End of working window ===",
        "M107       ; PUMP OFF — end of session",
        "G0 Z100    ; raise nozzle clear",
        f"M0        ; unconditional stop — resume at {next_block_label}",
        "; === RESUME: Operator restarted print ===",
    ]


def toolpath_to_gcode(
    toolpath:         List[Layer],
    layer_params:     List["LayerParams"],
    printer_name:     str         = "Custom 3DCP Printer",
    uses_e_axis:      bool        = True,
    nozzle_diam_mm:   float       = 25.0,
    comment_level:    int         = 1,
    structure_type:   str         = "wall",
    time_blocks:      List[dict]  = None,
    print_start_hour: float       = 8.0,
) -> str:
    lines: List[str] = []
    time_blocks = time_blocks or []

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
        c(f"Structure: {structure_type}"),
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

    e_total   = 0.0
    extruding = False   # track pump state

    # ── Pre-compute cumulative layer times for time-block pauses ──────────────
    # elapsed_min_at_layer[i] = minutes elapsed before layer i starts
    elapsed_min_at_layer: List[float] = []
    acc = 0.0
    for lp in layer_params:
        elapsed_min_at_layer.append(acc)
        layer_perim_mm = sum(
            math.hypot(s[1][0] - s[0][0], s[1][1] - s[0][1]) * 1000
            for s in (lp.segments_ordered or [])
        )
        acc += (layer_perim_mm / max(lp.print_speed_mm_s, 1.0) + lp.interlayer_wait_s) / 60.0

    # Convert time_blocks to fractional hours for boundary detection
    def _block_end_h(block: dict) -> Optional[float]:
        try:
            end_str = block.get("end", "")
            h, m    = map(int, end_str.split(":"))
            return h + m / 60.0
        except Exception:
            return None

    def _block_start_label(block: dict) -> str:
        return block.get("start", "next window")

    # For each layer, check if we cross a time-block boundary before this layer
    def _pause_before_layer(layer_idx: int) -> Optional[List[str]]:
        if not time_blocks or layer_idx == 0:
            return None
        elapsed_h = print_start_hour + elapsed_min_at_layer[layer_idx] / 60.0
        prev_elapsed_h = print_start_hour + elapsed_min_at_layer[layer_idx - 1] / 60.0
        for b_idx, block in enumerate(time_blocks):
            end_h = _block_end_h(block)
            if end_h is None:
                continue
            if prev_elapsed_h < end_h <= elapsed_h:
                # We cross this block's end between the previous and current layer
                next_label = _block_start_label(time_blocks[b_idx + 1]) if b_idx + 1 < len(time_blocks) else "next session"
                return _pause_block(next_label)
        return None

    for layer_idx, (layer_segs, lp) in enumerate(zip(toolpath, layer_params)):

        if not layer_segs:
            lines += [c(f"Layer {layer_idx+1} — empty, skip"), ""]
            continue

        # Insert pause G-code at time-block boundary if needed
        pause = _pause_before_layer(layer_idx)
        if pause:
            lines += pause + [""]

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

        # Rebar comments for column structure type
        rebar = _add_rebar_comments(z_mm, structure_type)
        if rebar:
            lines.append(rebar)

        # Make sure pump is off before raising Z
        if extruding:
            lines.append(pump_off())
            extruding = False

        # Raise to layer height
        lines.append(f"G0 Z{z_mm:.3f}  {c('raise to layer height')}")

        # Travel to first segment start (G1 — controlled feed, not rapid)
        first = layer_segs[0]
        x0 = first[0][0] * 1000
        y0 = first[0][1] * 1000
        lines.append(f"G1 X{x0:.3f} Y{y0:.3f} F3000  {c('TRAVEL MOVE')}")

        # Use enriched move list from _enforce_continuous_loop for precise travel/extrude tagging
        enriched = _enforce_continuous_loop(layer_segs)

        for move in enriched:
            if move["type"] == "travel":
                xe = move["x1"] * 1000
                ye = move["y1"] * 1000
                if extruding:
                    lines.append(pump_off())
                    extruding = False
                lines.append(f"G1 X{xe:.3f} Y{ye:.3f} F3000  {c('TRAVEL MOVE')}")
            else:
                xs = move["x0"] * 1000
                ys = move["y0"] * 1000
                xe = move["x1"] * 1000
                ye = move["y1"] * 1000
                seg_len = math.hypot(xe - xs, ye - ys)

                if not extruding:
                    lines.append(pump_on(speed_mm_min))
                    extruding = True

                if uses_e_axis and seg_len > 0.01:
                    e_amount = (seg_len * bead_area * ext_mult) / (math.pi * (1.75 / 2) ** 2)
                    e_total += e_amount
                    e_str = f" E{e_total:.4f}"
                else:
                    e_str = ""

                lines.append(
                    f"G1 X{xe:.3f} Y{ye:.3f} F{speed_mm_min:.0f}{e_str}  {c('EXTRUDE')}"
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


def generate_gcode_with_timeblocks(
    toolpath:              List[Layer],
    layer_params:          List["LayerParams"],
    time_blocks:           List[dict],
    print_start_hour:      float              = 8.0,
    estimated_layer_times: Optional[List[float]] = None,
    printer_name:          str               = "Custom 3DCP Printer",
    uses_e_axis:           bool              = True,
    nozzle_diam_mm:        float             = 25.0,
    structure_type:        str               = "wall",
) -> str:
    """Convenience wrapper: calls toolpath_to_gcode with time_blocks wired in."""
    return toolpath_to_gcode(
        toolpath         = toolpath,
        layer_params     = layer_params,
        printer_name     = printer_name,
        uses_e_axis      = uses_e_axis,
        nozzle_diam_mm   = nozzle_diam_mm,
        structure_type   = structure_type,
        time_blocks      = time_blocks,
        print_start_hour = print_start_hour,
    )


def format_print_time(seconds: float) -> str:
    if seconds < 60:   return f"{int(seconds)}s"
    if seconds < 3600: return f"{int(seconds//60)}m {int(seconds%60)}s"
    return f"{int(seconds//3600)}h {int((seconds%3600)//60)}m"
