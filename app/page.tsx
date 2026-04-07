'use client';

import Link from 'next/link'
import { motion } from 'framer-motion'
import Image from 'next/image'

const ModeCard = ({ 
  href, 
  icon, 
  title, 
  description, 
  status,
  delay 
}: { 
  href?: string; 
  icon: React.ReactNode; 
  title: string; 
  description: string; 
  status: 'active' | 'soon';
  delay: number;
}) => {
  const content = (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay, duration: 0.5 }}
      className={`group relative bg-white rounded-2xl p-8 transition-all duration-300 h-full flex flex-col ${
        status === 'active' 
          ? 'hover:shadow-xl hover:shadow-gray-200 cursor-pointer border border-gray-100 hover:border-gray-300' 
          : 'opacity-60 border border-gray-100'
      }`}
    >
      {/* Icon */}
      <div className={`w-16 h-16 rounded-xl flex items-center justify-center mb-6 transition-all duration-300 ${
        status === 'active'
          ? 'bg-gradient-to-br from-gray-800 to-gray-900 group-hover:scale-110 group-hover:shadow-lg group-hover:shadow-gray-300'
          : 'bg-gray-100'
      }`}>
        <div className={status === 'active' ? 'text-white' : 'text-gray-400'}>
          {icon}
        </div>
      </div>

      {/* Title */}
      <h3 className="text-xl font-semibold text-gray-900 mb-3">
        {title}
      </h3>

      {/* Description */}
      <p className="text-sm text-gray-500 leading-relaxed mb-6 flex-grow">
        {description}
      </p>

      {/* Status Badge */}
      <div className="flex items-center justify-between mt-auto">
        {status === 'active' ? (
          <span className="inline-flex items-center space-x-2 text-sm font-medium text-gray-900 group-hover:text-gray-700">
            <span>Launch</span>
            <svg className="w-4 h-4 transition-transform group-hover:translate-x-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8l4 4m0 0l-4 4m4-4H3" />
            </svg>
          </span>
        ) : (
          <span className="text-xs font-medium text-gray-400 uppercase tracking-wider">
            Coming Soon
          </span>
        )}
      </div>

      {/* Hover indicator */}
      {status === 'active' && (
        <div className="absolute top-4 right-4 opacity-0 group-hover:opacity-100 transition-opacity">
          <div className="w-2 h-2 rounded-full bg-gray-900"></div>
        </div>
      )}
    </motion.div>
  );

  return href ? <Link href={href}>{content}</Link> : content;
};

export default function Home() {
  return (
    <main className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100">
      {/* Header - Compact with Large Logo */}
      <div className="border-b border-gray-200 bg-white/80 backdrop-blur-sm sticky top-0 z-10 overflow-visible">
        <div className="max-w-7xl mx-auto px-6 py-1 flex items-center">
          <div className="-my-6">
            <Image 
              src="/logo.png" 
              alt="PrintGuard AI" 
              width={400} 
              height={400}
              className="h-40 w-auto"
            />
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-6 py-12">
        {/* Hero Section */}
        <motion.div 
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
          className="mb-12"
        >
          <h2 className="text-4xl font-bold text-gray-900 mb-4">
            Intelligent 3D Concrete Printing
          </h2>
          <p className="text-lg text-gray-600 max-w-2xl">
            AI-powered quality control and optimization platform for next-generation construction
          </p>
        </motion.div>

        {/* Mode Cards - Now only 2 */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-12 max-w-4xl">
          <ModeCard
            href="/pre-print-optimizer"
            icon={
              <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
              </svg>
            }
            title="Pre-Print Optimizer"
            description="Analyze environmental conditions and optimize print paths before job execution"
            status="active"
            delay={0.1}
          />

          <ModeCard
            href="/live-monitoring"
            icon={
              <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
              </svg>
            }
            title="Live Monitoring"
            description="Real-time defect detection, video analysis, and 3D simulation with predictive error correction during active printing"
            status="active"
            delay={0.2}
          />
        </div>

        {/* Footer */}
        <motion.div 
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.6 }}
          className="text-center pt-8 border-t border-gray-200"
        >
          <p className="text-sm text-gray-500">
            © Omide
          </p>
        </motion.div>
      </div>
    </main>
  )
}