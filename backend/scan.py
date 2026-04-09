"""
scan.py — AutoBuild AI Printability Scanner

Analyses an STL/OBJ mesh for 3DCP printability issues BEFORE optimization.
Fast — no RL, pure geometry. Runs in ~0.5–2s.

Issues detected:
  1. Non-manifold edges (bad mesh topology)
  2. Wall thickness < nozzle diameter
  3. Overhangs > 45° (unsupported layers)
  4. Floating geometry / disconnected islands
  5. Total height vs layer height mismatch
  6. Extrusion gaps — windows, doors, voids requiring travel moves
"""

import io
import math
import numpy as np
import trimesh
from typing import Optional
from collections import defaultdict


# ─────────────────────────────────────────────────────────────────────────────

def scan_mesh(
    file_bytes:     bytes,
    filename:       str,
    nozzle_diam_mm: float = 25.0,
    layer_height_m: float = 0.012,
) -> dict:
    """
    Run all printability checks on a mesh.
    Returns a structured report with issues, warnings, printability score, and
    per-issue detail (count, severity, description, recommendation).
    """
    ext = filename.lower().split(".")[-1]
    issues   = []
    warnings = []
    info     = {}

    # ── Load ──────────────────────────────────────────────────────────────────
    try:
        if ext == "stl":
            mesh = trimesh.load(io.BytesIO(file_bytes), file_type="stl", force="mesh")
        elif ext == "obj":
            mesh = trimesh.load(io.BytesIO(file_bytes), file_type="obj", force="mesh")
        else:
            return _fail(f"Unsupported file type: {ext}")
    except Exception as e:
        return _fail(f"Could not load mesh: {e}")

    if not isinstance(mesh, trimesh.Trimesh):
        try:
            mesh = trimesh.util.concatenate(list(mesh.geometry.values()))
        except Exception as e:
            return _fail(f"Could not merge mesh geometry: {e}")

    # ── Basic mesh info ───────────────────────────────────────────────────────
    b = mesh.bounds
    w  = float(b[1][0] - b[0][0])
    d  = float(b[1][1] - b[0][1])
    h  = float(b[1][2] - b[0][2])
    num_faces    = len(mesh.faces)
    num_verts    = len(mesh.vertices)
    num_layers   = max(1, round(h / layer_height_m))
    nozzle_m     = nozzle_diam_mm / 1000.0

    info["dimensions_m"]   = {"width": round(w, 3), "depth": round(d, 3), "height": round(h, 3)}
    info["face_count"]     = num_faces
    info["vertex_count"]   = num_verts
    info["layer_count"]    = num_layers
    info["layer_height_m"] = layer_height_m
    info["nozzle_diam_mm"] = nozzle_diam_mm

    # ── 1. Non-manifold edges ─────────────────────────────────────────────────
    try:
        nm_edges = mesh.as_open_as_possible
        # trimesh unique edges that appear != 2 times = non-manifold
        edge_counts = defaultdict(int)
        for face in mesh.faces:
            for i in range(3):
                e = tuple(sorted([face[i], face[(i+1)%3]]))
                edge_counts[e] += 1
        bad_edges = [e for e, cnt in edge_counts.items() if cnt != 2]
        nm_count = len(bad_edges)
        if nm_count > 0:
            severity = "error" if nm_count > 50 else "warning"
            issues.append({
                "id":             "non_manifold",
                "severity":       severity,
                "title":          "Non-manifold edges detected",
                "count":          nm_count,
                "detail":         f"{nm_count} edge{'s' if nm_count != 1 else ''} shared by ≠2 faces — mesh has holes or T-junctions.",
                "recommendation": "Repair mesh in Blender (Edit Mode → Mesh → Cleanup → Fill Holes) or use Meshmixer auto-repair before uploading.",
            })
        else:
            info["manifold"] = True
    except Exception:
        warnings.append({"id": "non_manifold_check_failed", "detail": "Could not check manifold status."})

    # ── 2. Wall thickness ─────────────────────────────────────────────────────
    try:
        # Sample cross-sections at 10%, 30%, 50%, 70%, 90% heights
        thin_layers = []
        sample_zs   = [h * f + float(b[0][2]) for f in [0.10, 0.30, 0.50, 0.70, 0.90]]
        min_wall_m  = float("inf")

        for z in sample_zs:
            try:
                lines = trimesh.intersections.mesh_plane(
                    mesh,
                    plane_normal=[0, 0, 1],
                    plane_origin=[0, 0, z],
                )
                if lines is None or len(lines) == 0:
                    continue
                # Estimate wall thickness as min segment pair separation
                pts_2d = np.array([[seg[0][0], seg[0][1]] for seg in lines])
                if len(pts_2d) < 4:
                    continue
                # Rough thickness: bounding box minor axis of cross-section cluster
                dists = []
                for i in range(min(len(pts_2d), 30)):
                    for j in range(i+1, min(len(pts_2d), 30)):
                        d_ = float(np.linalg.norm(pts_2d[i] - pts_2d[j]))
                        if d_ > 0.001:
                            dists.append(d_)
                if dists:
                    # 5th percentile = likely wall-to-wall measurement
                    thickness = float(np.percentile(dists, 5))
                    min_wall_m = min(min_wall_m, thickness)
                    if thickness < nozzle_m * 0.9:
                        thin_layers.append(round(z - float(b[0][2]), 3))
            except Exception:
                continue

        info["min_wall_thickness_mm"] = round(min_wall_m * 1000, 1) if min_wall_m < float("inf") else None

        if thin_layers:
            issues.append({
                "id":             "thin_walls",
                "severity":       "error",
                "title":          "Wall thickness below nozzle diameter",
                "count":          len(thin_layers),
                "detail":         f"Walls thinner than {nozzle_diam_mm}mm nozzle detected near heights: {[f'{x*1000:.0f}mm' for x in thin_layers[:4]]}{'...' if len(thin_layers)>4 else ''}.",
                "recommendation": f"Thicken walls to ≥ {nozzle_diam_mm}mm in your CAD model, or switch to a smaller nozzle. Min detected: ~{round(min_wall_m*1000,0):.0f}mm.",
            })
        elif min_wall_m < float("inf"):
            info["wall_check"] = f"OK — min ~{round(min_wall_m*1000,0):.0f}mm"
    except Exception:
        warnings.append({"id": "wall_check_failed", "detail": "Wall thickness check could not complete."})

    # ── 3. Overhangs > 45° ───────────────────────────────────────────────────
    try:
        normals       = mesh.face_normals
        # Downward-facing faces: nz < -cos(45°) ≈ -0.707
        overhang_mask = normals[:, 2] < -0.707
        overhang_count = int(np.sum(overhang_mask))
        overhang_pct   = round(100.0 * overhang_count / max(num_faces, 1), 1)
        info["overhang_faces"]   = overhang_count
        info["overhang_face_pct"] = overhang_pct

        if overhang_pct > 15:
            issues.append({
                "id":             "overhangs",
                "severity":       "error",
                "title":          f"Severe overhangs ({overhang_pct}% of faces)",
                "count":          overhang_count,
                "detail":         f"{overhang_count} faces overhang > 45° — concrete cannot support itself at this angle without formwork.",
                "recommendation": "Redesign with self-supporting angles ≤ 45°, add temporary supports, or use a printer with tilting nozzle capability.",
            })
        elif overhang_pct > 3:
            issues.append({
                "id":             "overhangs",
                "severity":       "warning",
                "title":          f"Moderate overhangs ({overhang_pct}% of faces)",
                "count":          overhang_count,
                "detail":         f"{overhang_count} faces overhang > 45°. May print with careful speed tuning.",
                "recommendation": "Reduce speed on overhang layers. Optimizer will flag these in the layer risk score.",
            })
        else:
            info["overhang_check"] = "OK"
    except Exception:
        warnings.append({"id": "overhang_check_failed", "detail": "Overhang check could not complete."})

    # ── 4. Floating geometry / disconnected islands ───────────────────────────
    try:
        components = mesh.split(only_watertight=False)
        n_components = len(components) if hasattr(components, '__len__') else 1
        info["component_count"] = n_components

        if n_components > 1:
            # Check how many components are significant (> 1% of total volume)
            vols = []
            for c in components:
                try:
                    vols.append(abs(float(c.volume)) if c.is_watertight else float(c.area))
                except Exception:
                    vols.append(0.0)
            total_vol  = sum(vols)
            significant = sum(1 for v in vols if v > total_vol * 0.01)
            floating    = significant - 1  # subtract the main body

            if floating > 0:
                sev = "error" if floating > 3 else "warning"
                issues.append({
                    "id":             "floating_geometry",
                    "severity":       sev,
                    "title":          f"{floating} disconnected island{'s' if floating!=1 else ''} detected",
                    "count":          floating,
                    "detail":         f"Mesh has {n_components} separate bodies. {floating} appear to be floating geometry not connected to the main structure.",
                    "recommendation": "In your CAD tool, merge or delete disconnected components. Each island will need separate print start/stop commands.",
                })
            else:
                info["floating_check"] = "OK — single body"
        else:
            info["floating_check"] = "OK — single body"
    except Exception:
        warnings.append({"id": "floating_check_failed", "detail": "Island detection could not complete."})

    # ── 5. Height vs layer height mismatch ────────────────────────────────────
    try:
        exact_layers   = h / layer_height_m
        fractional     = exact_layers - round(exact_layers)
        remainder_mm   = abs(fractional) * layer_height_m * 1000

        info["exact_layers"]    = round(exact_layers, 2)
        info["layer_remainder_mm"] = round(remainder_mm, 2)

        if remainder_mm > layer_height_m * 1000 * 0.3:  # > 30% of layer height leftover
            issues.append({
                "id":             "height_mismatch",
                "severity":       "warning",
                "title":          "Height not divisible by layer height",
                "count":          1,
                "detail":         f"Model height {round(h*1000,1)}mm / layer height {round(layer_height_m*1000,1)}mm = {round(exact_layers,2)} layers. Remainder: ~{round(remainder_mm,1)}mm — top layer will be partial.",
                "recommendation": f"Adjust model height to a multiple of {round(layer_height_m*1000,1)}mm, or adjust layer height in Print Configuration.",
            })
        else:
            info["height_check"] = "OK"
    except Exception:
        warnings.append({"id": "height_check_failed", "detail": "Height check could not complete."})

    # ── 6. Extrusion gap detection (windows, doors, through-holes) ────────────
    try:
        gap_layers   = []
        gap_details  = []
        # Sample at regular Z intervals
        num_samples  = min(num_layers, 40)
        sample_hs    = [h * (i + 0.5) / num_samples + float(b[0][2]) for i in range(num_samples)]

        prev_segments_count = None

        for z in sample_hs:
            try:
                lines = trimesh.intersections.mesh_plane(
                    mesh,
                    plane_normal=[0, 0, 1],
                    plane_origin=[0, 0, z],
                )
                if lines is None:
                    n_segs = 0
                else:
                    n_segs = len(lines)

                # A sudden drop + recovery in segment count = through-opening
                if prev_segments_count is not None and n_segs > 0:
                    ratio = n_segs / max(prev_segments_count, 1)
                    # Also detect significant increase (frame around opening has MORE segments)
                    if ratio > 1.6 or ratio < 0.5:
                        z_rel_m = round(z - float(b[0][2]), 3)
                        gap_details.append({
                            "z_m":       z_rel_m,
                            "z_mm":      round(z_rel_m * 1000, 1),
                            "segments":  n_segs,
                            "prev_segs": prev_segments_count,
                            "type":      "increase" if ratio > 1.6 else "decrease",
                        })
                        gap_layers.append(z_rel_m)

                prev_segments_count = n_segs if n_segs > 0 else prev_segments_count
            except Exception:
                continue

        # Cluster nearby z-levels into single gap events
        gap_events = _cluster_gaps(gap_layers, threshold=layer_height_m * 3)
        info["gap_events"]       = len(gap_events)
        info["gap_event_heights"] = [round(g * 1000, 1) for g in gap_events]

        if gap_events:
            issues.append({
                "id":             "extrusion_gaps",
                "severity":       "info",
                "title":          f"{len(gap_events)} extrusion gap event{'s' if len(gap_events)!=1 else ''} detected",
                "count":          len(gap_events),
                "detail":         f"Openings (windows, doors, voids) detected near heights: {[f'{round(g*1000,0):.0f}mm' for g in gap_events[:6]]}. Printer must stop extruding, travel over the gap, and restart.",
                "recommendation": "Optimizer will insert pump stop/start G-code commands at these transitions. Verify your cement pump has < 500ms response time for clean gap edges.",
            })
        else:
            info["gap_check"] = "OK — no openings detected"
    except Exception:
        warnings.append({"id": "gap_check_failed", "detail": "Extrusion gap detection could not complete."})

    # ── Score ─────────────────────────────────────────────────────────────────
    error_count   = sum(1 for i in issues if i["severity"] == "error")
    warning_count = sum(1 for i in issues if i["severity"] == "warning")
    info_count    = sum(1 for i in issues if i["severity"] == "info")

    # Score: 100 - (errors×20 + warnings×8 + infos×2), floored at 0
    score = max(0, 100 - error_count * 20 - warning_count * 8 - info_count * 2)

    if score >= 85:
        verdict = "ready"
        verdict_msg = "Model is printable. No blocking issues found."
    elif score >= 60:
        verdict = "caution"
        verdict_msg = "Model can print but has warnings. Review issues before proceeding."
    else:
        verdict = "blocked"
        verdict_msg = "Critical issues detected. Resolve errors before printing."

    return {
        "ok":          True,
        "score":       score,
        "verdict":     verdict,
        "verdict_msg": verdict_msg,
        "issues":      issues,
        "warnings":    warnings,
        "info":        info,
        "counts": {
            "errors":   error_count,
            "warnings": warning_count,
            "info":     info_count,
            "total":    len(issues),
        },
    }


def _cluster_gaps(zs: list, threshold: float) -> list:
    """Merge nearby z-values into single gap events."""
    if not zs:
        return []
    zs_sorted = sorted(set(zs))
    clusters  = [[zs_sorted[0]]]
    for z in zs_sorted[1:]:
        if z - clusters[-1][-1] <= threshold:
            clusters[-1].append(z)
        else:
            clusters.append([z])
    return [sum(c) / len(c) for c in clusters]  # centroid of each cluster


def _fail(msg: str) -> dict:
    return {
        "ok":          False,
        "score":       0,
        "verdict":     "blocked",
        "verdict_msg": msg,
        "issues":      [{"id": "load_error", "severity": "error", "title": "Failed to load mesh", "count": 1, "detail": msg, "recommendation": "Check that the file is a valid STL or OBJ."}],
        "warnings":    [],
        "info":        {},
        "counts":      {"errors": 1, "warnings": 0, "info": 0, "total": 1},
    }