# AutoBuild AI — Python Backend

RL-based 3DCP toolpath optimiser. Takes STL/OBJ + environmental conditions,
produces an optimised print sequence and G-code via a trained PPO agent.

---

## Folder structure

```
backend/
├── main.py          ← FastAPI server (run this)
├── train.py         ← PPO training script (run once)
├── environment.py   ← Gymnasium RL environment
├── optimizer.py     ← Runs trained agent on real geometry
├── geometry.py      ← STL/OBJ parser + layer slicer
├── gcode.py         ← Toolpath → G-code converter
├── requirements.txt
├── setup.bat        ← Windows one-click setup
└── README.md
```

---

## Setup (Windows)

```
# Option A — double-click setup.bat

# Option B — manual
python -m venv venv
venv\Scripts\activate
pip install -r requirements.txt
```

---

## Step 1 — Train the model (run once)

```bash
venv\Scripts\activate
python train.py
```

**Default:** 500,000 timesteps, ~20 minutes on CPU.  
Produces `model.zip`. Checkpoints saved to `checkpoints/` every 50k steps.

For a faster demo-ready model (lower quality but works):
```bash
python train.py --timesteps 100000
```

For best quality (overnight):
```bash
python train.py --timesteps 2000000 --envs 8
```

---

## Step 2 — Start the API server

```bash
venv\Scripts\activate
python -m uvicorn main:app --reload --port 8000
```

Server runs at: **http://localhost:8000**  
API docs at:    **http://localhost:8000/docs**

---

## Step 3 — Test it

```bash
# Health check
curl http://localhost:8000/health

# Optimize an STL file
curl -X POST http://localhost:8000/optimize \
  -F "file=@yourmodel.stl" \
  -F "temperature=28" \
  -F "humidity=70" \
  -F "wind_speed=5" \
  -F "ground_slope=1"
```

---

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/optimize` | Upload STL/OBJ → optimised toolpath + G-code |
| `GET`  | `/health` | Server + model status |
| `GET`  | `/toolpath/{id}` | Retrieve saved toolpath JSON |
| `GET`  | `/gcode/{id}` | Download G-code file |

### POST /optimize — form fields

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `file` | file | required | STL or OBJ file |
| `temperature` | float | 24.0 | °C |
| `humidity` | float | 65.0 | % |
| `wind_speed` | float | 8.0 | km/h |
| `ground_slope` | float | 2.0 | degrees |
| `layer_height` | float | 0.04 | metres |
| `nozzle_width` | float | 0.025 | metres |
| `print_speed` | float | 60.0 | mm/s |
| `printer_name` | string | "AutoBuild AI" | Appears in G-code header |
| `max_layers` | int | null | Limit layers (useful for testing) |

---

## Frontend integration (Next.js)

Add to your `.env.local`:
```
NEXT_PUBLIC_API_URL=http://localhost:8000
```

Call from your pre-print optimizer page:
```typescript
const form = new FormData();
form.append('file', stlFile);
form.append('temperature', String(parameters.temperature));
form.append('humidity', String(parameters.humidity));
form.append('wind_speed', String(parameters.windSpeed));
form.append('ground_slope', String(parameters.groundSlope));

const res  = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/optimize`, {
  method: 'POST',
  body: form,
});
const data = await res.json();
// data.toolpath      → optimised layer segments for 3D visualisation
// data.naive_toolpath → original order for before/after comparison
// data.optimization  → stats: time_saved_pct, env_risk_score, etc.
// data.result_id     → use to download G-code: GET /gcode/{result_id}
```

---

## Deployment (post-showcase)

1. Push `backend/` to GitHub
2. Create a new service on [Railway](https://railway.app)
3. Set env var: `MODEL_PATH=model.zip`
4. Upload your trained `model.zip` to the service
5. Update `NEXT_PUBLIC_API_URL` in Vercel to your Railway URL
6. Done — production architecture

---

## How the RL works

The PPO agent treats each layer as an episode:

- **State:** nozzle position + remaining segments + normalised env conditions
- **Action:** which segment to print next (discrete, up to 512 per layer)
- **Reward:** +print length −travel distance −environmental risk +structural consistency bonus

Training uses synthetic random layers for curriculum diversity. The learned policy
generalises to real STL geometry because the underlying optimisation problem
(minimise wasted travel, adapt to conditions) is geometry-agnostic.