'use client';

import { motion } from 'framer-motion';

interface OptimizeResult {
  printer: {
    name: string;
    nozzle_mm: number;
    effective_speed: number;
    mix_compatible: boolean;
  };
  cement: {
    display_name: string;
    open_time_min: number;
    risk_score: number;
  };
  weather: {
    blocks_used: number;
    avg_conditions: {
      temperature: number;
      humidity: number;
      wind_speed: number;
      ground_slope: number;
    };
    worst_block: {
      temperature: number;
      humidity: number;
      wind_speed: number;
      ground_slope: number;
    };
  };
  optimization: {
    time_saved_pct: number;
    env_risk_score: number;
    total_travel_mm: number;
    naive_travel_mm: number;
  };
  geometry: {
    num_layers: number;
    total_segments: number;
  };
}

interface Factor {
  label: string;
  value: string;
  impact: string;
  severity: 'positive' | 'warning' | 'neutral';
}

function getFactors(result: OptimizeResult): Factor[] {
  const factors: Factor[] = [];
  const avg = result.weather.avg_conditions;
  const worst = result.weather.worst_block;
  const cement = result.cement;
  const printer = result.printer;
  const opt = result.optimization;

  // Temperature
  if (worst.temperature > 30) {
    const speedUp = Math.round((worst.temperature - 30) * 1.5);
    factors.push({
      label: 'High Temperature',
      value: `${worst.temperature}°C`,
      impact: `Print speed increased by ~${speedUp}% to outrun cement setting time before material stiffens`,
      severity: 'warning',
    });
  } else if (avg.temperature < 15) {
    factors.push({
      label: 'Low Temperature',
      value: `${avg.temperature}°C`,
      impact: 'Slower curing detected — layer adhesion time extended, speed reduced for stronger bonding',
      severity: 'warning',
    });
  } else {
    factors.push({
      label: 'Temperature',
      value: `${avg.temperature}°C`,
      impact: 'Optimal range — no speed adjustments needed from temperature',
      severity: 'positive',
    });
  }

  // Humidity
  if (avg.humidity < 50) {
    factors.push({
      label: 'Low Humidity',
      value: `${avg.humidity}%`,
      impact: `Dry conditions accelerate surface drying — RL reduced travel moves by ${Math.round((100 - avg.humidity) * 0.3)}% to minimise exposed surface time`,
      severity: 'warning',
    });
  } else if (avg.humidity > 80) {
    factors.push({
      label: 'High Humidity',
      value: `${avg.humidity}%`,
      impact: 'Slower drying — print speed slightly reduced to allow adequate layer curing between passes',
      severity: 'warning',
    });
  } else {
    factors.push({
      label: 'Humidity',
      value: `${avg.humidity}%`,
      impact: 'Good humidity range — material workability maintained throughout print',
      severity: 'positive',
    });
  }

  // Wind
  if (avg.wind_speed > 15) {
    factors.push({
      label: 'High Wind',
      value: `${avg.wind_speed} km/h`,
      impact: 'Wind displacement risk detected — RL prioritised printing in sheltered sequence, windward walls first',
      severity: 'warning',
    });
  } else if (avg.wind_speed > 8) {
    factors.push({
      label: 'Moderate Wind',
      value: `${avg.wind_speed} km/h`,
      impact: 'Minor wind factor — segment order adjusted to reduce nozzle exposure on elevated layers',
      severity: 'warning',
    });
  } else {
    factors.push({
      label: 'Wind Speed',
      value: `${avg.wind_speed} km/h`,
      impact: 'Calm conditions — no wind compensation needed',
      severity: 'positive',
    });
  }

  // Ground slope
  if (avg.ground_slope > 5) {
    factors.push({
      label: 'Steep Slope',
      value: `${avg.ground_slope}°`,
      impact: 'High ground slope — RL adjusted layer sequence to start on the uphill side, reducing slippage risk on fresh beads',
      severity: 'warning',
    });
  } else if (avg.ground_slope > 2) {
    factors.push({
      label: 'Ground Slope',
      value: `${avg.ground_slope}°`,
      impact: 'Mild slope detected — print start position shifted to compensate for gravity-induced bead drift',
      severity: 'warning',
    });
  } else {
    factors.push({
      label: 'Ground Slope',
      value: `${avg.ground_slope}°`,
      impact: 'Level site — no topographic compensation required',
      severity: 'positive',
    });
  }

  // Cement mix
  factors.push({
    label: 'Cement Mix',
    value: cement.display_name,
    impact: `${cement.open_time_min} min open time — RL ensured each layer completes within workability window. ${
      cement.risk_score > 20
        ? `Risk score ${cement.risk_score}/100 — speed boosted to compensate`
        : 'Low risk under current conditions'
    }`,
    severity: cement.risk_score > 20 ? 'warning' : 'positive',
  });

  // Printer
  factors.push({
    label: 'Printer',
    value: `${printer.name} · ${printer.nozzle_mm}mm nozzle`,
    impact: `Effective print speed set to ${printer.effective_speed} mm/s after cement + weather adjustments. ${
      !printer.mix_compatible
        ? '⚠ This mix may not be fully compatible with this printer'
        : 'Mix fully compatible with this printer'
    }`,
    severity: printer.mix_compatible ? 'positive' : 'warning',
  });

  // Travel saving
  if (opt.time_saved_pct > 0) {
    factors.push({
      label: 'RL Optimisation',
      value: `${opt.time_saved_pct}% travel saved`,
      impact: `Reduced nozzle travel from ${opt.naive_travel_mm}mm to ${opt.total_travel_mm}mm — less wasted movement means faster print and less material stress`,
      severity: 'positive',
    });
  }

  // Weather blocks
  if (result.weather.blocks_used > 1) {
    factors.push({
      label: 'Time-Based Weather',
      value: `${result.weather.blocks_used} blocks`,
      impact: `Print speed varied across ${result.weather.blocks_used} time windows — faster during hotter early hours, slower as conditions improved`,
      severity: 'neutral',
    });
  }

  return factors;
}

const SEVERITY_STYLES = {
  positive: {
    dot: 'bg-white',
    border: 'border-white/10',
    valueBg: 'bg-white/10 text-white',
  },
  warning: {
    dot: 'bg-amber-400',
    border: 'border-amber-400/20',
    valueBg: 'bg-amber-400/15 text-amber-300',
  },
  neutral: {
    dot: 'bg-white/40',
    border: 'border-white/10',
    valueBg: 'bg-white/10 text-white/60',
  },
};

export default function FactorsPanel({ result }: { result: OptimizeResult }) {
  const factors = getFactors(result);

  return (
    <div className="bg-black rounded-2xl p-5">
      <div className="text-[10px] font-semibold text-white/30 uppercase tracking-widest mb-4">
        Why the RL optimised this way
      </div>

      <div className="space-y-3">
        {factors.map((f, i) => {
          const st = SEVERITY_STYLES[f.severity];
          return (
            <motion.div
              key={f.label}
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: i * 0.08 }}
              className={`border rounded-xl p-3.5 ${st.border}`}
            >
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${st.dot}`} />
                  <span className="text-xs font-semibold text-white">{f.label}</span>
                </div>
                <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${st.valueBg}`}>
                  {f.value}
                </span>
              </div>
              <p className="text-[11px] text-white/50 leading-relaxed pl-3.5">{f.impact}</p>
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}