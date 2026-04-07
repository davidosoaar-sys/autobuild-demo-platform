'use client';

import { useState } from 'react';

export default function LiveSimulation() {
  const [isSimulating, setIsSimulating] = useState(false);
  const [currentLayer, setCurrentLayer] = useState(0);
  const [hasDefect, setHasDefect] = useState(false);

  const startSimulation = () => {
    setIsSimulating(true);
    setCurrentLayer(0);
    
    // Simulate layer-by-layer printing
    const interval = setInterval(() => {
      setCurrentLayer(prev => {
        if (prev >= 100) {
          clearInterval(interval);
          setIsSimulating(false);
          return 100;
        }
        
        // Random defect at layer 45
        if (prev === 45) {
          setHasDefect(true);
          setTimeout(() => setHasDefect(false), 3000);
        }
        
        return prev + 1;
      });
    }, 100);
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      {/* 3D Visualization Placeholder */}
      <div className="bg-white rounded-2xl p-6 border border-gray-200">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">3D Print Simulation</h3>
        
        <div className="bg-gradient-to-b from-blue-100 to-blue-50 rounded-xl aspect-video flex items-center justify-center">
          <div className="text-center">
            <div className="text-6xl font-bold text-gray-900 mb-2">{currentLayer}%</div>
            <p className="text-sm text-gray-600">Layer {currentLayer}/100</p>
            
            {hasDefect && (
              <div className="mt-4 bg-red-100 text-red-900 px-4 py-2 rounded-lg inline-block">
                <div className="flex items-center space-x-2">
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                  </svg>
                  <span className="font-medium">Defect Detected - Correcting...</span>
                </div>
              </div>
            )}
          </div>
        </div>

        <button
          onClick={startSimulation}
          disabled={isSimulating}
          className="w-full mt-4 py-3 bg-gray-900 text-white rounded-lg hover:bg-gray-800 disabled:bg-gray-200 disabled:text-gray-400 disabled:cursor-not-allowed transition-colors"
        >
          {isSimulating ? 'Simulating...' : 'Start Simulation'}
        </button>
      </div>

      {/* Timeline */}
      <div className="bg-white rounded-2xl p-6 border border-gray-200">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">Print Timeline</h3>
        
        <div className="space-y-3">
          {[
            { layer: 0, status: currentLayer >= 0 ? 'complete' : 'pending', label: 'Foundation' },
            { layer: 25, status: currentLayer >= 25 ? 'complete' : 'pending', label: 'First Floor' },
            { layer: 45, status: currentLayer >= 45 ? 'complete' : 'pending', label: 'Defect Point', isDefect: true },
            { layer: 50, status: currentLayer >= 50 ? 'complete' : 'pending', label: 'Mid Section' },
            { layer: 75, status: currentLayer >= 75 ? 'complete' : 'pending', label: 'Upper Floor' },
            { layer: 100, status: currentLayer >= 100 ? 'complete' : 'pending', label: 'Completion' },
          ].map((milestone, i) => (
            <div key={i} className={`flex items-center space-x-3 p-3 rounded-lg ${milestone.status === 'complete' ? 'bg-green-50' : 'bg-gray-50'}`}>
              <div className={`w-8 h-8 rounded-full flex items-center justify-center ${milestone.status === 'complete' ? 'bg-green-500' : 'bg-gray-300'}`}>
                {milestone.status === 'complete' ? (
                  <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                ) : (
                  <div className="w-2 h-2 bg-white rounded-full" />
                )}
              </div>
              <div className="flex-1">
                <div className={`text-sm font-medium ${milestone.isDefect ? 'text-red-900' : 'text-gray-900'}`}>
                  {milestone.label}
                </div>
                <div className="text-xs text-gray-500">Layer {milestone.layer}</div>
              </div>
              {milestone.isDefect && currentLayer >= milestone.layer && (
                <span className="text-xs bg-yellow-100 text-yellow-800 px-2 py-1 rounded">Corrected</span>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}