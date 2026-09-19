"""
geometry.py — 3DCP Adaptive Slicer

Pipeline per layer:
  1. Slice wall mesh at height Z → raw 3D line segments (trimesh)
  2. Project to 2D XY
  3. Buffer each segment by nozzle_width/2 → concrete bead footprint
  4. Merge overlapping bead footprints → printable wall regions
  5. Walk exterior of each region → ordered print segments
  6. Large gaps between consecutive segments = door/window openings
     → left as coordinate jumps; main.py serialiser marks them {"gap":true}

FAST_PATH_THRESHOLD is computed dynamically from nozzle_width:
  - nozzle_width comes from printer setup (nozzle_diameter_mm / 1000)
  - baseline 2000 segs covers Wellness Beckum (~767 segs/layer at 25mm nozzle)
  - scales proportionally: smaller nozzle → lower threshold (faster)
  - always at least 1500 to avoid skipping buffer on medium complexity models
"""

import io
import os
import collections
import numpy as np
import trimesh
import networkx as nx
from concurrent.futures import ProcessPoolExecutor
from scipy.ndimage import gaussian_filter
from shapely.geometry import MultiLineString, LineString
from shapely.ops import unary_union
from skimage.morphology import medial_axis
from skimage.draw import polygon as sk_polygon
from typing import List, Optional, Tuple

from sika733 import (
    LAYER_HEIGHT_DEF_M,
    LAYER_HEIGHT_MAX_M,
    LAYER_HEIGHT_MIN_M,
)

Segment  = Tuple[Tuple[float, float], Tuple[float, float]]
Layer    = List[Segment]
Geometry = List[Layer]


def _load_dxf(file_bytes: bytes) -> trimesh.Trimesh:
    """Convert DXF entities to a trimesh mesh."""
    import ezdxf
    import tempfile, os

    with tempfile.NamedTemporaryFile(suffix=".dxf", delete=False) as f:
        f.write(file_bytes)
        tmp_path = f.name

    try:
        doc   = ezdxf.readfile(tmp_path)
        msp   = doc.modelspace()
        verts = []
        faces = []

        for entity in msp:
            if entity.dxftype() == '3DFACE':
                pts  = [entity.dxf.vtx0, entity.dxf.vtx1, entity.dxf.vtx2, entity.dxf.vtx3]
                base = len(verts)
                verts.extend([[p.x, p.y, p.z] for p in pts])
                faces.append([base, base+1, base+2])
                if pts[2] != pts[3]:
                    faces.append([base, base+2, base+3])
            elif entity.dxftype() == 'MESH':
                try:
                    v    = [(p[0], p[1], p[2]) for p in entity.vertices]
                    f    = list(entity.faces)
                    base = len(verts)
                    verts.extend(v)
                    faces.extend([[base+i for i in face] for face in f])
                except Exception:
                    pass

        if not verts:
            raise ValueError("No 3D geometry found in DXF file.")
        return trimesh.Trimesh(vertices=np.array(verts), faces=np.array(faces), process=True)
    finally:
        os.unlink(tmp_path)


def _load_ifc(file_bytes: bytes) -> trimesh.Trimesh:
    """Extract wall geometry from IFC file using ifcopenshell."""
    import ifcopenshell
    import ifcopenshell.geom
    import tempfile, os

    with tempfile.NamedTemporaryFile(suffix=".ifc", delete=False) as f:
        f.write(file_bytes)
        tmp_path = f.name

    try:
        ifc      = ifcopenshell.open(tmp_path)
        settings = ifcopenshell.geom.settings()
        settings.set(settings.USE_WORLD_COORDS, True)
        meshes   = []

        for product in ifc.by_type('IfcWall') + ifc.by_type('IfcSlab') + \
                       ifc.by_type('IfcColumn') + ifc.by_type('IfcBeam'):
            try:
                shape = ifcopenshell.geom.create_shape(settings, product)
                verts = np.array(shape.geometry.verts).reshape(-1, 3)
                faces = np.array(shape.geometry.faces).reshape(-1, 3)
                if len(verts) > 0 and len(faces) > 0:
                    meshes.append(trimesh.Trimesh(vertices=verts, faces=faces, process=False))
            except Exception:
                continue

        if not meshes:
            raise ValueError("No structural geometry found in IFC file.")
        return trimesh.util.concatenate(meshes) if len(meshes) > 1 else meshes[0]
    finally:
        os.unlink(tmp_path)


# ── Parallel per-layer slicing ───────────────────────────────────────────────
# Geometry mode's raster skeletonization (rasterize → smooth → medial axis →
# prune → simplify) is what makes it correct on a real, messy model, but
# it's also the reason a full slice went from ~15-40s to several minutes —
# each layer costs roughly 0.5-2s on its own. Layers are otherwise fully
# independent, so this spreads them across worker processes rather than
# trying to make any single layer faster. State is set up ONCE per worker
# (via the pool's initializer), not once per layer, since re-sending the
# whole mesh on every one of e.g. 300 tasks would eat most of the savings.
_worker_state: dict = {}


def _init_slice_worker(mesh, nozzle_width: float, slicing_mode: str, max_seg_len: float) -> None:
    _worker_state['mesh'] = mesh
    _worker_state['nozzle_width'] = nozzle_width
    _worker_state['slicing_mode'] = slicing_mode
    _worker_state['max_seg_len'] = max_seg_len


def _slice_layer_worker(args: Tuple[int, float]) -> Layer:
    idx, z = args
    return _slice_layer(
        _worker_state['mesh'], z, _worker_state['nozzle_width'],
        _worker_state['slicing_mode'], idx, _worker_state['max_seg_len'],
    )


def parse_and_slice(
    file_bytes:   bytes,
    filename:     str,
    layer_height: float = LAYER_HEIGHT_DEF_M,
    nozzle_width: float = 0.025,
    max_layers:   Optional[int] = None,
    print_scale:  float = 1.0,
    slicing_mode: str   = 'geometry',
) -> Tuple[Geometry, List[dict], dict]:

    ext = filename.lower().split(".")[-1]

    # ── Load ──────────────────────────────────────────────────────────────────
    try:
        if ext == "stl":
            mesh = trimesh.load(io.BytesIO(file_bytes), file_type="stl", force="mesh")
        elif ext == "obj":
            mesh = trimesh.load(io.BytesIO(file_bytes), file_type="obj", force="mesh")
        elif ext in ("stp", "step"):
            mesh = trimesh.load(io.BytesIO(file_bytes), file_type="step", force="mesh")
        elif ext == "dxf":
            mesh = _load_dxf(file_bytes)
        elif ext == "ifc":
            mesh = _load_ifc(file_bytes)
        else:
            raise ValueError(f"Unsupported file type: .{ext}. Supported: STL, OBJ, STP/STEP, DXF, IFC")
    except Exception as e:
        raise ValueError(f"Could not load mesh: {e}")

    if not isinstance(mesh, trimesh.Trimesh):
        try:
            mesh = trimesh.util.concatenate(list(mesh.geometry.values()))
        except Exception as e:
            raise ValueError(f"Could not merge mesh: {e}")

    if ext == "obj":
        mesh.apply_transform(trimesh.transformations.rotation_matrix(-np.pi / 2, [1, 0, 0]))

    try:
        trimesh.repair.fix_normals(mesh)
        trimesh.repair.fix_winding(mesh)
    except Exception:
        pass

    # ── Centre: sit on Z=0, centre X/Y ───────────────────────────────────────
    b = mesh.bounds
    mesh.apply_translation([
        -(b[0][0] + b[1][0]) / 2.0,
        -(b[0][1] + b[1][1]) / 2.0,
        -b[0][2],
    ])

    # ── Auto unit detection ───────────────────────────────────────────────────
    # STL/OBJ files are commonly authored in mm. Detect and convert to meters.
    # Heuristic: if any dimension > 100, assume mm and scale to meters.
    raw_bounds = mesh.bounds  # [[xmin,ymin,zmin],[xmax,ymax,zmax]]
    max_dim = max(
        raw_bounds[1][0] - raw_bounds[0][0],  # x extent
        raw_bounds[1][1] - raw_bounds[0][1],  # y extent
        raw_bounds[1][2] - raw_bounds[0][2],  # z extent
    )
    if max_dim > 100:
        print(f"[geometry] Model appears to be in mm (max_dim={max_dim:.1f}) — converting to meters", flush=True)
        mesh.vertices *= 0.001
    else:
        print(f"[geometry] Model appears to be in meters (max_dim={max_dim:.3f}m) — no conversion needed", flush=True)

    if abs(print_scale - 1.0) > 1e-6:
        mesh.apply_scale(float(print_scale))

    bounds       = mesh.bounds
    total_height = float(bounds[1][2])
    layer_height = float(np.clip(layer_height, LAYER_HEIGHT_MIN_M, LAYER_HEIGHT_MAX_M))
    # Max plausible segment length = the longest single wall in the model (max XY side).
    # Anything longer is a garbage segment from degenerate mesh intersections.
    _max_side = float(max(bounds[1][0]-bounds[0][0], bounds[1][1]-bounds[0][1]))
    MAX_SEG_LEN = _max_side * 1.05 if _max_side > 0 else 1e9

    if total_height < layer_height:
        raise ValueError(f"Model height {total_height*1000:.1f}mm < layer height {layer_height*1000:.1f}mm")

    # ── Layer count ───────────────────────────────────────────────────────────
    total_layers  = max(1, int(total_height / layer_height))
    print(f"[geometry] total_height={total_height:.3f}m layers={total_layers} layer_height={layer_height*1000:.1f}mm", flush=True)
    if total_layers > 1000:
        raise ValueError(f"Unrealistic layer count ({total_layers}) — model may be in wrong units after conversion. Check file.")
    num_layers    = min(total_layers, max_layers) if max_layers else total_layers
    layer_indices = list(range(num_layers))

    z_heights = [(layer_i + 0.5) * layer_height for layer_i in layer_indices]

    # Geometry mode's per-layer cost (raster skeletonization) makes a serial
    # loop take minutes on a real building — spread layers across worker
    # processes instead. Shell mode is already fast per layer, so the pool's
    # own worker-startup cost (each has to re-import numpy/scipy/skimage on
    # Windows) usually isn't worth paying there, and for a handful of layers
    # the serial loop is faster outright — only pay pool overhead when both
    # the mode benefits and there's enough work to amortize it.
    use_pool = slicing_mode == 'geometry' and len(z_heights) >= 8
    if use_pool:
        workers = max(1, min(os.cpu_count() or 4, 8, len(z_heights)))
        with ProcessPoolExecutor(
            max_workers=workers, initializer=_init_slice_worker,
            initargs=(mesh, nozzle_width, slicing_mode, MAX_SEG_LEN),
        ) as pool:
            geometry = list(pool.map(_slice_layer_worker, enumerate(z_heights), chunksize=4))
    else:
        geometry = [
            _slice_layer(mesh, z, nozzle_width, slicing_mode, idx, MAX_SEG_LEN)
            for idx, z in enumerate(z_heights)
        ]

    layer_metas: List[dict] = []
    max_segs = 0

    for idx, z in enumerate(z_heights):
        segments = geometry[idx]

        n        = len(segments)
        max_segs = max(max_segs, n)

        perim   = sum(_seg_len(s[0], s[1]) for s in segments) if segments else 0.0
        all_pts = [p for s in segments for p in s]
        if all_pts:
            xs   = [p[0] for p in all_pts]
            ys   = [p[1] for p in all_pts]
            area = (max(xs) - min(xs)) * (max(ys) - min(ys))
        else:
            area = 0.0

        layer_metas.append({
            "index":            idx,
            "z_height_m":       round(z, 4),
            "segment_count":    n,
            "perimeter_m":      round(perim, 4),
            "area_m2":          round(area, 6),
            "wall_thickness_m": round(nozzle_width, 4),
            "complexity":       0.0,
        })

    for lm in layer_metas:
        lm["complexity"] = round(lm["segment_count"] / max(max_segs, 1), 4)

    bounds = mesh.bounds
    meta = {
        "num_layers":        num_layers,
        "total_layers":      total_layers,
        "subsampled":        num_layers < total_layers,
        "layer_height":      layer_height,
        "nozzle_width":      nozzle_width,
        "bounds_x":          (round(float(bounds[0][0]), 3), round(float(bounds[1][0]), 3)),
        "bounds_y":          (round(float(bounds[0][1]), 3), round(float(bounds[1][1]), 3)),
        "bounds_z":          (round(float(bounds[0][2]), 3), round(float(bounds[1][2]), 3)),
        "total_height_m":    round(total_height, 3),
        "total_segments":    sum(len(l) for l in geometry),
        "total_perimeter_m": round(sum(lm["perimeter_m"] for lm in layer_metas), 2),
        "file_name":         filename,
    }

    return geometry, layer_metas, meta


# ── Geometry-mode centerline extraction ─────────────────────────────────────
# Turns raw boundary segments (from mesh.section() — an outer face, an inner
# face, an infill rib, whatever the mesh actually has) into ONE centerline
# per wall/element, the way "geometry mode" is meant to work: regardless of
# how many surfaces a wall is modeled with, print one bead-wide pass down
# its middle. This replaced several earlier attempts (nested-loop pairing,
# whole-contour matching, per-point nearest-neighbour matching) that were
# each too fragile on a real, messy, non-watertight architectural export —
# verified end-to-end against a real model (Wellness Beckum), not synthetic
# test shapes.
#
# The technique — standard in road/vessel centerline extraction, not
# bespoke to this project — is: turn the boundary lines into a solid shape
# (thicken every line into a thin ribbon and merge overlapping ribbons —
# two nearby lines belonging to the same wall fuse into one ribbon, while
# genuinely open/hollow space is never filled, since only the lines
# themselves get thickened, not the areas they enclose), then find that
# shape's own skeleton/centerline — a well-defined operation for ANY shape,
# corners and curves included, that doesn't need to know in advance which
# lines "belong together".
GEOM_BUFFER_RADIUS   = 0.15  # metres — half the largest wall thickness two nearby faces still merge across
GEOM_PIXEL_SIZE      = 0.01  # metres/pixel for the raster skeleton
GEOM_SMOOTH_SIGMA    = 1.2   # pixels — blurs raster "staircase" noise that otherwise fractures curves into a braided mess
GEOM_PRUNE_RATIO     = 2.5   # a leaf branch survives only if longer than this × the local wall thickness there
GEOM_MIN_SPUR_LEN    = 0.04  # metres — a leaf branch this short is pruned regardless of the ratio above (catches spurs at points where the local thickness estimate is itself small/noisy, which the ratio test alone lets through)
GEOM_MIN_COMPONENT_LEN = 0.05  # metres — drops any small fragment entirely, including a pure loop with no dead end at all for the ratio-based pruning above to ever reach
GEOM_SIMPLIFY_TOL    = 0.02  # metres — Douglas-Peucker tolerance on the final centerline chains


def _rasterize_solid(solid, px_size: float):
    minx, miny, maxx, maxy = solid.bounds
    w = int((maxx - minx) / px_size) + 4
    h = int((maxy - miny) / px_size) + 4
    mask = np.zeros((h, w), dtype=bool)
    polys = list(solid.geoms) if solid.geom_type == 'MultiPolygon' else [solid]
    for poly in polys:
        for ring, fill in [(poly.exterior, True)] + [(r, False) for r in poly.interiors]:
            xs, ys = ring.xy
            cols = (np.asarray(xs) - minx) / px_size
            rows = (np.asarray(ys) - miny) / px_size
            rr, cc = sk_polygon(rows, cols, shape=(h, w))
            mask[rr, cc] = fill
    return mask, minx, miny


def _prune_skeleton_graph(
    G: 'nx.Graph', dist: np.ndarray, px_size: float, prune_ratio: float, min_abs_len: float,
) -> 'nx.Graph':
    """Removes leaf branches (dead ends) that are short relative to the local
    wall thickness there — that ratio is what tells a real branch (e.g. a
    T-junction where a partition wall meets an exterior wall) apart from
    raster noise (which is short no matter how thick the wall is). A queue
    of only-just-changed nodes keeps this from rescanning the whole graph on
    every single removal, which is what made an earlier version of this
    pruning pass far too slow to run on every layer of a real slice.

    min_abs_len is a second, absolute floor on top of the ratio: right where
    the local thickness estimate is itself small or noisy, the ratio test's
    own threshold shrinks along with it and a short spur can slip through —
    an absolute length catches those regardless of what the local thickness
    looked like."""
    degree = dict(G.degree())
    queue  = collections.deque(n for n, d in degree.items() if d == 1)
    removed = set()
    while queue:
        node = queue.popleft()
        if node in removed or degree.get(node, 0) != 1:
            continue
        nbrs = list(G.neighbors(node))
        if not nbrs:
            continue
        nb = nbrs[0]
        edge_len = G[node][nb]['weight']
        local_r  = max(dist[node] * px_size, dist[nb] * px_size, 1e-6)
        if edge_len < prune_ratio * local_r or edge_len < min_abs_len:
            G.remove_edge(node, nb)
            removed.add(node)
            degree[node] = 0
            degree[nb] = degree.get(nb, 1) - 1
            if degree[nb] == 1:
                queue.append(nb)
    G.remove_nodes_from(removed)
    return G


def _drop_tiny_components(G: 'nx.Graph', min_component_len: float) -> 'nx.Graph':
    """Leaf-pruning can only ever chew in from a dead end — a small isolated
    LOOP of raster noise (no degree-1 node anywhere in it) is invisible to
    it no matter how aggressively tuned, and shows up as a stray disconnected
    speck in the output. This drops any connected component (loop or chain)
    whose total length is small, regardless of its internal shape."""
    for comp in list(nx.connected_components(G)):
        total_len = sum(G[a][b]['weight'] for a, b in G.subgraph(comp).edges())
        if total_len < min_component_len:
            G.remove_nodes_from(comp)
    return G


def _chains_from_skeleton_graph(G: 'nx.Graph', minx: float, miny: float, px_size: float) -> List[list]:
    """Breaks the pixel graph into polylines between junction/leaf nodes
    (walking straight through degree-2 runs in between), plus any pure
    cycles left over (a closed loop with no junction at all)."""
    def to_xy(node):
        y, x = node
        return (minx + (x + 0.5) * px_size, miny + (y + 0.5) * px_size)

    visited_edges = set()
    chains = []

    special_nodes = [n for n in G.nodes if G.degree(n) != 2]
    for start in special_nodes:
        for nb in list(G.neighbors(start)):
            e = frozenset((start, nb))
            if e in visited_edges:
                continue
            chain = [start, nb]
            visited_edges.add(e)
            prev, cur = start, nb
            while G.degree(cur) == 2:
                nxts = [n for n in G.neighbors(cur) if n != prev]
                if not nxts:
                    break
                nxt = nxts[0]
                e2 = frozenset((cur, nxt))
                if e2 in visited_edges:
                    break
                visited_edges.add(e2)
                chain.append(nxt)
                prev, cur = cur, nxt
            chains.append([to_xy(n) for n in chain])

    for comp in nx.connected_components(G):
        sub = G.subgraph(comp)
        if all(frozenset(e) in visited_edges for e in sub.edges()):
            continue
        start = next(iter(comp))
        chain = [start]
        prev, cur = None, start
        while True:
            nxts = [n for n in sub.neighbors(cur) if n != prev]
            if not nxts:
                break
            nxt = nxts[0]
            chain.append(nxt)
            if nxt == start:
                break
            prev, cur = cur, nxt
        chains.append([to_xy(n) for n in chain])

    return chains


def _skeletonize_geometry_mode(segments: List[Segment], min_len: float, max_seg_len: float) -> List[Segment]:
    if not segments:
        return []
    mls = MultiLineString(segments)
    solid = unary_union(mls).buffer(GEOM_BUFFER_RADIUS, cap_style=2, join_style=2)
    if solid.is_empty:
        return []

    mask, minx, miny = _rasterize_solid(solid, GEOM_PIXEL_SIZE)
    smoothed = gaussian_filter(mask.astype(float), sigma=GEOM_SMOOTH_SIGMA) > 0.5
    skel, dist = medial_axis(smoothed, return_distance=True)

    G = nx.Graph()
    ys_idx, xs_idx = np.nonzero(skel)
    pix = set(zip(ys_idx.tolist(), xs_idx.tolist()))
    for (y, x) in pix:
        for dy in (-1, 0, 1):
            for dx in (-1, 0, 1):
                if dy == 0 and dx == 0:
                    continue
                if (y + dy, x + dx) in pix:
                    w = GEOM_PIXEL_SIZE * ((dy * dy + dx * dx) ** 0.5)
                    G.add_edge((y, x), (y + dy, x + dx), weight=w)

    # _collapse_small_cycles was tried here and reverted: on a real building
    # outline, which is itself topologically one long loop, "remove the
    # longest edge in any locally-small cycle" isn't actually safe — it cut
    # large real stretches of wall out entirely rather than only clearing
    # the small redundant bubbles it was meant to target. Needs a better
    # approach (e.g. only collapsing a cycle whose two junction nodes have
    # no OTHER connection to the rest of the graph) before it's safe to use.
    G = _prune_skeleton_graph(G, dist, GEOM_PIXEL_SIZE, GEOM_PRUNE_RATIO, GEOM_MIN_SPUR_LEN)
    G = _drop_tiny_components(G, GEOM_MIN_COMPONENT_LEN)
    chains = _chains_from_skeleton_graph(G, minx, miny, GEOM_PIXEL_SIZE)

    out: List[Segment] = []
    for chain in chains:
        if len(chain) < 2:
            continue
        simplified = LineString(chain).simplify(GEOM_SIMPLIFY_TOL, preserve_topology=False)
        coords = list(simplified.coords)
        for i in range(len(coords) - 1):
            p0, p1 = coords[i], coords[i + 1]
            slen = ((p1[0]-p0[0])**2 + (p1[1]-p0[1])**2) ** 0.5
            if min_len <= slen <= max_seg_len:
                out.append((p0, p1))
    return out


def _slice_layer(
    mesh,
    z_height:     float,
    nozzle_width: float,
    slicing_mode: str = 'geometry',
    layer_idx:    int = 0,
    max_seg_len:  float = 1e9,
) -> List[Segment]:
    z_sample = float(z_height) + 1e-5
    MIN_LEN  = float(nozzle_width) * 0.1
    MIN_PERIM = float(nozzle_width) * 4.0

    # ── Geometry mode ─────────────────────────────────────────────────────────────
    # Every raw boundary line from the mesh section (an outer wall face, an
    # inner wall face, a designed infill rib — whatever's actually there) is
    # thickened into a ribbon and merged with any others nearby, then that
    # solid shape's own centerline is extracted (see _skeletonize_geometry_
    # mode above). A real hollow interior or window is never part of any
    # ribbon in the first place (only the lines get thickened, not the areas
    # they enclose), so it's correctly never traced, without needing a
    # separate "is this a hole" classification step at all.
    if slicing_mode == 'geometry':
        try:
            section = mesh.section(plane_origin=[0, 0, z_sample], plane_normal=[0, 0, 1])
        except Exception as e:
            print(f"[geometry] layer={layer_idx} section failed: {e}", flush=True)
            return []
        if section is None:
            return []
        try:
            section_2d, _ = section.to_planar()
        except Exception as e:
            print(f"[geometry] layer={layer_idx} to_planar failed: {e}", flush=True)
            return []
        if section_2d is None or not hasattr(section_2d, 'entities') or len(section_2d.entities) == 0:
            return []

        # Raw boundary edges, exactly as the mesh has them — an outer face,
        # an inner face, a designed infill rib, whatever's there. A
        # non-watertight mesh (common in real architectural exports) can
        # make trimesh return some of these as OPEN chains (entity.closed is
        # False) rather than closed loops — wrapping one closed anyway draws
        # a bogus edge from its last point straight back to its first, which
        # is what used to cut a long diagonal "wall" across empty space that
        # was never part of the model, so open chains never get that
        # wraparound edge.
        raw_segments: List[Segment] = []
        for entity in section_2d.entities:
            try:
                indices = entity.points
                pts_raw = section_2d.vertices[indices]
                n = len(pts_raw)
                if n < 2:
                    continue
                pts = [(float(pts_raw[i][0]), float(pts_raw[i][1])) for i in range(n)]
                is_closed = bool(getattr(entity, 'closed', True))
                edge_count = n if is_closed else n - 1
                for i in range(edge_count):
                    p0, p1 = pts[i], pts[(i + 1) % n]
                    slen = ((p1[0]-p0[0])**2 + (p1[1]-p0[1])**2) ** 0.5
                    if MIN_LEN <= slen <= max_seg_len:
                        raw_segments.append((p0, p1))
            except Exception as e:
                print(f"[geometry] layer={layer_idx} entity error: {e}", flush=True)
                continue

        segments = _skeletonize_geometry_mode(raw_segments, MIN_LEN, max_seg_len)
        print(
            f"[geometry] layer={layer_idx} z={z_height:.3f}m "
            f"raw_segments={len(raw_segments)} segments={len(segments)}",
            flush=True,
        )
        return segments

    # ── Shell mode: section contours = closed loops (both sides of each element) ──
    try:
        section = mesh.section(
            plane_origin=[0, 0, z_sample],
            plane_normal=[0, 0, 1],
        )
    except Exception as e:
        print(f"[geometry] layer={layer_idx} section failed: {e}", flush=True)
        return []

    if section is None:
        return []

    try:
        section_2d, _ = section.to_planar()
    except Exception as e:
        print(f"[geometry] layer={layer_idx} to_planar failed: {e}", flush=True)
        return []

    if section_2d is None:
        return []

    if not hasattr(section_2d, 'entities') or len(section_2d.entities) == 0:
        return []

    MIN_PERIM = float(nozzle_width) * 4.0
    contours  = []

    for entity in section_2d.entities:
        try:
            indices = entity.points
            pts_raw = section_2d.vertices[indices]
            n = len(pts_raw)
            if n < 3:
                continue

            # A non-watertight mesh can produce an OPEN boundary chain here
            # (entity.closed is False) rather than a real closed loop — see
            # the matching note in geometry mode above. Wrapping it closed
            # anyway draws a bogus edge from its last point straight back to
            # its first, which is what showed up as a long diagonal line
            # slicing across empty space in the toolpath preview.
            is_closed = bool(getattr(entity, 'closed', True))
            edge_count = n if is_closed else n - 1

            perim = 0.0
            for i in range(edge_count):
                dx = float(pts_raw[(i + 1) % n][0]) - float(pts_raw[i][0])
                dy = float(pts_raw[(i + 1) % n][1]) - float(pts_raw[i][1])
                perim += (dx * dx + dy * dy) ** 0.5

            if perim < MIN_PERIM:
                continue

            points_list = [(float(pts_raw[i][0]), float(pts_raw[i][1])) for i in range(n)]
            contours.append({'points': points_list, 'perimeter': perim, 'closed': is_closed})
        except Exception as e:
            print(f"[geometry] layer={layer_idx} contour error: {e}", flush=True)
            continue

    if not contours:
        return []

    def contour_to_segments(points_list, closed=True) -> List[Segment]:
        segs = []
        m    = len(points_list)
        end  = m if closed else m - 1
        for i in range(end):
            p0 = points_list[i]
            p1 = points_list[(i + 1) % m]
            slen = ((p1[0]-p0[0])**2 + (p1[1]-p0[1])**2)**0.5
            if slen <= max_seg_len:
                segs.append((p0, p1))
        return segs

    segments: List[Segment] = []
    for contour in contours:
        segments.extend(contour_to_segments(contour['points'], closed=contour['closed']))

    print(
        f"[geometry] layer={layer_idx} z={z_height:.3f}m "
        f"mode=shell contours={len(contours)} segments={len(segments)}",
        flush=True,
    )
    return segments



def _zigzag_weave(contours, MIN_LEN):
    """Two walls + one connected zigzag woven between them, ends closed."""
    def slen(a, b):
        return ((b[0]-a[0])**2 + (b[1]-a[1])**2) ** 0.5
    outer = max(range(len(contours)), key=lambda i: contours[i][1])
    cells = [contours[i] for i in range(len(contours)) if i != outer]
    allpts = [p for (P, _, _) in cells for p in P]
    ys = [p[1] for p in allpts]; xs = [p[0] for p in allpts]
    ytop, ybot = max(ys), min(ys)
    xmin, xmax = min(xs), max(xs)
    info = sorted((sum(p[0] for p in P)/len(P), min(p[0] for p in P), max(p[0] for p in P))
                  for (P, _, _) in cells)
    segs = [((xmin, ytop), (xmax, ytop)), ((xmin, ybot), (xmax, ybot)),
            ((xmin, ybot), (xmin, ytop)), ((xmax, ybot), (xmax, ytop))]
    rail = ybot
    prev = (xmin, rail)
    for (cx, lx, rx) in info:
        rail = ytop if rail == ybot else ybot
        nxt = (rx, rail)
        if slen(prev, nxt) >= MIN_LEN:
            segs.append((prev, nxt))
        prev = nxt
    end = (xmax, prev[1])
    if slen(prev, end) >= MIN_LEN:
        segs.append((prev, end))
    return segs

def _pick_inside(contours, depths, MIN_LEN):
    """Keep inner faces (odd nesting depth), drop outer faces. Single walls."""
    def slen(a, b):
        return ((b[0]-a[0])**2 + (b[1]-a[1])**2) ** 0.5
    segs = []
    for i, (P, per, a) in enumerate(contours):
        if depths[i] % 2 == 0:
            continue
        n = len(P)
        for k in range(n):
            if slen(P[k], P[(k+1) % n]) >= MIN_LEN:
                segs.append((P[k], P[(k+1) % n]))
    return segs

def _geometry_path(contours, depths, MIN_LEN):
    """Detect wall-with-infill (>=4 small similar cells inside a big contour)
    -> zigzag weave; otherwise pick-inside. Model-agnostic dispatch."""
    if len(contours) >= 4:
        areas = sorted(abs(a) for (_, _, a) in contours)
        big = areas[-1]
        small = [a for a in areas[:-1] if a < big * 0.05]
        if len(small) >= 4:
            return _zigzag_weave(contours, MIN_LEN)
    return _pick_inside(contours, depths, MIN_LEN)


def _chain_path(segs: List[Segment]) -> List[Segment]:
    """Order segments into a single continuous print path via nearest-neighbour."""
    if len(segs) <= 1:
        return segs
    # Start from the segment whose first endpoint is furthest left (wall start)
    segs = sorted(segs, key=lambda s: min(s[0][0], s[1][0]))
    ordered   = [segs[0]]
    remaining = list(segs[1:])
    while remaining:
        cur = ordered[-1][1]
        best_i, best_d, flip = 0, float('inf'), False
        for i, s in enumerate(remaining):
            d0 = (s[0][0]-cur[0])**2 + (s[0][1]-cur[1])**2
            d1 = (s[1][0]-cur[0])**2 + (s[1][1]-cur[1])**2
            if d0 < best_d: best_d, best_i, flip = d0, i, False
            if d1 < best_d: best_d, best_i, flip = d1, i, True
        s = remaining.pop(best_i)
        ordered.append((s[1], s[0]) if flip else s)
    return ordered


def _seg_len(p0: Tuple[float, float], p1: Tuple[float, float]) -> float:
    return float(np.hypot(p1[0] - p0[0], p1[1] - p0[1]))


