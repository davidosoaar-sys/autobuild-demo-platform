# AutoBuild AI - Pre-Print Optimizer

Complete Next.js project with Pre-Print Optimization dashboard.

## Windows Setup (3 Steps)

### 1. Extract & Open in VS Code
- Extract the zip folder
- Open VS Code
- File → Open Folder → Select `autobuild-demo-platform`

### 2. Install Dependencies
Open terminal in VS Code (Ctrl + `) and run:

```powershell
npm install
```

### 3. Run
```powershell
npm run dev
```

Visit: `http://localhost:3000`

---

## What's Included

✅ **Complete Next.js 14 project** with all config files
✅ **Homepage** with navigation to all modes
✅ **Pre-Print Optimizer** - Fully functional dashboard
✅ **All dependencies** pre-configured in package.json

---

## Project Structure

```
autobuild-demo-platform/
├── package.json              # All dependencies included
├── next.config.js            # Next.js configuration
├── tsconfig.json             # TypeScript config
├── tailwind.config.js        # Tailwind CSS config
├── postcss.config.js         # PostCSS config
├── lib/
│   └── utils.ts              # Utility functions
└── app/
    ├── globals.css           # Global styles + slider styles
    ├── layout.tsx            # Root layout
    ├── page.tsx              # Homepage
    └── pre-print-optimizer/
        ├── page.tsx          # Pre-print dashboard
        └── components/
            ├── FileUpload.tsx
            ├── ParameterInputs.tsx
            ├── OptimizationResults.tsx
            └── LayerVisualization.tsx
```

---

## Features

### Pre-Print Optimizer Dashboard
- 📁 **G-code file upload** - Drag & drop interface
- 🎚️ **Environmental parameters** - Temperature, humidity, wind, slope
- 🧪 **Material properties** - Cement mix type, batch tracking
- 📊 **Smart optimization** - Time savings, risk assessment
- 🎨 **3D visualization** - Color-coded layer stack
- 💼 **Professional design** - Black/white/grey/blue theme

### Color Coding
- 🟢 Green = Optimal conditions
- 🟡 Amber = Adjusted parameters
- 🔵 Blue = Slowed for stability
- 🔴 Red = Pause required

---

## Tech Stack

- **Next.js 14** - React framework
- **TypeScript** - Type safety
- **Tailwind CSS** - Utility-first CSS
- **Framer Motion** - Smooth animations
- **React Three Fiber** - 3D graphics
- **react-dropzone** - File upload

---

## Troubleshooting

### Port 3000 already in use?
```powershell
npm run dev -- -p 3001
```

### Dependencies won't install?
```powershell
Remove-Item -Recurse -Force node_modules
Remove-Item package-lock.json
npm install
```

### Build errors?
Make sure you're using Node.js 18 or higher:
```powershell
node --version
```

---

## Next Steps

### For TKS Demo:
1. ✅ Pre-Print Optimizer (done)
2. Build Mode 1: Image detection
3. Build Mode 2: Video analysis
4. Build Mode 3: Live 3D simulation

### To Deploy:
```powershell
npm run build
```

Then deploy to Vercel:
1. Push to GitHub
2. Import in Vercel
3. Deploy!

---

Built for AutoBuild AI | David Osoba | TKS Innovator
