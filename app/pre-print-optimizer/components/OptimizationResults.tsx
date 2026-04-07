'use client';

import { motion } from 'framer-motion';

interface OptimizationResultsProps {
  parameters: {
    temperature: number;
    humidity: number;
    windSpeed: number;
    groundSlope: number;
    cementMix: string;
    batchNumber: string;
  };
}

export default function OptimizationResults({ parameters }: OptimizationResultsProps) {
  // Fake RL optimization logic
  const baseTime = 272; // 4h 32m in minutes
  let optimizedTime = baseTime;
  
  // Wind adjustments
  if (parameters.windSpeed > 15) {
    optimizedTime -= 8;
  } else if (parameters.windSpeed < 10) {
    optimizedTime += 12;
  }
  
  // Temperature adjustments
  if (parameters.temperature < 20 || parameters.temperature > 30) {
    optimizedTime -= 5;
  }

  const totalLayers = 22;
  const avgTimePerLayer = Math.round(optimizedTime / totalLayers);

  const formatTime = (minutes: number) => {
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return `${h}h ${m}m`;
  };

  return (
    <div className="space-y-6">
      {/* Single Metrics Card */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
        className="bg-black rounded-2xl p-8 shadow-lg"
      >
        <div className="grid grid-cols-3 gap-8 text-center">
          <div>
            <p className="text-xs text-gray-400 mb-2">Estimated Time</p>
            <p className="text-4xl font-semibold text-white">{formatTime(optimizedTime)}</p>
          </div>
          <div className="border-l border-r border-gray-700">
            <p className="text-xs text-gray-400 mb-2">Total Layers</p>
            <p className="text-4xl font-semibold text-white">{totalLayers}</p>
          </div>
          <div>
            <p className="text-xs text-gray-400 mb-2">Per Layer (avg)</p>
            <p className="text-4xl font-semibold text-white">{avgTimePerLayer}m</p>
          </div>
        </div>
      </motion.div>
    </div>
  );
}