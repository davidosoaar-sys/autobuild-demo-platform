'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';

export default function SettingsPage() {
  const router = useRouter();

  const [name,         setName]         = useState('');
  const [dataTraining, setDataTraining] = useState(false);
  const [saved,        setSaved]        = useState(false);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      setName(        localStorage.getItem('autobuild_user_name')             ?? '');
      setDataTraining(localStorage.getItem('autobuild_data_training_opted_in') === 'true');
    }
  }, []);

  const save = () => {
    localStorage.setItem('autobuild_user_name',             name.trim());
    localStorage.setItem('autobuild_data_training_opted_in', dataTraining ? 'true' : 'false');
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="border-b border-gray-100 bg-white sticky top-0 z-10">
        <div className="max-w-2xl mx-auto px-4 sm:px-6 py-1 flex items-center gap-3">
          <button onClick={() => router.back()}
            className="text-sm text-black/40 hover:text-black transition-colors flex items-center gap-2">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7"/>
            </svg>
            Back
          </button>
          <div className="h-6 w-px bg-gray-200"/>
          <div className="-my-4 sm:-my-5">
            <Image src="/Autobuildblack.png" alt="AutoBuild AI" width={400} height={400} className="h-20 sm:h-28 w-auto"/>
          </div>
        </div>
      </header>

      <div className="max-w-2xl mx-auto px-4 sm:px-6 py-10 sm:py-14">

        <div className="mb-10">
          <h1 className="text-2xl sm:text-3xl font-bold text-black tracking-tight mb-2">Settings</h1>
          <p className="text-xs text-black/35">AutoBuild AI · Preferences stored locally on this device</p>
        </div>

        <div className="space-y-6">

          {/* Name */}
          <div className="bg-white border border-gray-100 rounded-2xl px-5 py-5">
            <label className="block text-[10px] font-semibold uppercase tracking-widest text-black/40 mb-2">
              Your Name
            </label>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="e.g. Site Engineer"
              className="w-full px-3 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm text-black focus:outline-none focus:border-black transition-colors placeholder:text-black/25"
            />
            <p className="text-[11px] text-black/30 mt-1.5">Used in reports and print logs. Stored on this device only.</p>
          </div>

          {/* Data training */}
          <div className="bg-white border border-gray-100 rounded-2xl px-5 py-5">
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-black mb-0.5">AI Training Data</p>
                <p className="text-xs text-black/50 leading-relaxed">
                  Allow AutoBuild AI to use your anonymised bead analysis results to improve its AI models. Camera frames are never included.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setDataTraining(v => !v)}
                className={`relative inline-flex h-6 w-11 flex-shrink-0 rounded-full border-2 border-transparent transition-colors duration-200 focus:outline-none ${
                  dataTraining ? 'bg-black' : 'bg-gray-200'
                }`}
                role="switch"
                aria-checked={dataTraining}
              >
                <span className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow transition duration-200 ${
                  dataTraining ? 'translate-x-5' : 'translate-x-0'
                }`} />
              </button>
            </div>
            <p className="text-[11px] text-black/30 mt-3">
              You can change this at any time. Withdrawal applies to future events only.
            </p>
          </div>

          {/* Legal links */}
          <div className="bg-white border border-gray-100 rounded-2xl px-5 py-5">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-black/40 mb-4">Legal</p>
            <div className="space-y-2">
              <button onClick={() => router.push('/tos')}
                className="w-full flex items-center justify-between px-3 py-2.5 rounded-xl hover:bg-gray-50 transition-colors group">
                <span className="text-sm text-black/70 group-hover:text-black transition-colors">Terms of Service</span>
                <svg className="w-4 h-4 text-black/25 group-hover:text-black/50 transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7"/>
                </svg>
              </button>
              <button onClick={() => router.push('/privacy')}
                className="w-full flex items-center justify-between px-3 py-2.5 rounded-xl hover:bg-gray-50 transition-colors group">
                <span className="text-sm text-black/70 group-hover:text-black transition-colors">Privacy Policy</span>
                <svg className="w-4 h-4 text-black/25 group-hover:text-black/50 transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7"/>
                </svg>
              </button>
            </div>
          </div>

          {/* Save */}
          <button onClick={save}
            className={`w-full py-3 rounded-xl text-sm font-semibold transition-all ${
              saved ? 'bg-emerald-600 text-white' : 'bg-black text-white hover:bg-black/90'
            }`}>
            {saved ? 'Saved ✓' : 'Save Settings'}
          </button>

        </div>

        <div className="border-t border-gray-100 pt-6 mt-10">
          <p className="text-[11px] text-black/25 text-center">
            AutoBuild AI · Settings are stored locally on this device
          </p>
        </div>

      </div>
    </div>
  );
}
