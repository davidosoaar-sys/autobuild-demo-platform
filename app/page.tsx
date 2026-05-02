'use client';

import { useState, useEffect } from 'react';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';

export default function Home() {
  const router = useRouter();
  const [showOnboard,    setShowOnboard]    = useState(false);
  const [nameInput,      setNameInput]      = useState('');
  const [tosChecked,     setTosChecked]     = useState(false);
  const [privChecked,    setPrivChecked]    = useState(false);
  const [dataChecked,    setDataChecked]    = useState(false);
  const [ready,          setReady]          = useState(false);

  useEffect(() => {
    const name = localStorage.getItem('autobuild_user_name');
    const tos  = localStorage.getItem('autobuild_tos_accepted');
    const priv = localStorage.getItem('autobuild_privacy_accepted');
    if (name && tos && priv) {
      router.replace('/projects');
    } else {
      setShowOnboard(true);
      setReady(true);
    }
  }, [router]);

  const handleOnboard = () => {
    if (!nameInput.trim() || !tosChecked || !privChecked) return;
    localStorage.setItem('autobuild_user_name',              nameInput.trim());
    localStorage.setItem('autobuild_tos_accepted',           'true');
    localStorage.setItem('autobuild_privacy_accepted',       'true');
    localStorage.setItem('autobuild_data_training_opted_in', dataChecked ? 'true' : 'false');
    router.replace('/projects');
  };

  if (!ready) return null;

  return (
    <AnimatePresence>
      {showOnboard && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          style={{ position: 'fixed', inset: 0, zIndex: 300, background: '#080808', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px' }}>
          <motion.div initial={{ scale: 0.95, y: 10 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.95, opacity: 0 }}
            style={{ background: '#fff', borderRadius: '20px', maxWidth: '400px', width: '100%', overflow: 'hidden', boxShadow: '0 32px 80px rgba(0,0,0,0.5)' }}>
            <div style={{ background: '#080808', padding: '24px 24px 20px' }}>
              <Image src="/Autobuildwhite.png" alt="AutoBuild AI" width={160} height={40} style={{ height: '32px', width: 'auto', marginBottom: '16px' }} />
              <p style={{ color: '#fff', fontWeight: 700, fontSize: '18px', lineHeight: 1.3, fontFamily: "'Space Grotesk', sans-serif" }}>Welcome to AutoBuild AI</p>
              <p style={{ color: 'rgba(255,255,255,0.4)', fontSize: '12px', marginTop: '4px', fontFamily: "'Space Grotesk', sans-serif" }}>3DCP monitoring and path optimisation platform</p>
            </div>
            <div style={{ padding: '20px 24px 24px', display: 'flex', flexDirection: 'column', gap: '16px', fontFamily: "'Space Grotesk', sans-serif" }}>
              <div>
                <label style={{ display: 'block', fontSize: '11px', fontWeight: 600, color: 'rgba(0,0,0,0.45)', marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Your name</label>
                <input autoFocus value={nameInput} onChange={e => setNameInput(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleOnboard()} placeholder="e.g. John Doe"
                  style={{ width: '100%', border: '1px solid rgba(0,0,0,0.12)', borderRadius: '12px', padding: '10px 14px', fontSize: '14px', outline: 'none', fontFamily: "'Space Grotesk', sans-serif" }} />
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                {[
                  { key: 'tos',  state: tosChecked,  set: setTosChecked,  text: <span>I agree to the <button type="button" onClick={() => router.push('/tos')} style={{ textDecoration: 'underline', background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontSize: 'inherit', color: 'inherit' }}>Terms of Service</button> <span style={{ color: '#f87171' }}>*</span></span> },
                  { key: 'priv', state: privChecked, set: setPrivChecked, text: <span>I agree to the <button type="button" onClick={() => router.push('/privacy')} style={{ textDecoration: 'underline', background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontSize: 'inherit', color: 'inherit' }}>Privacy Policy</button> <span style={{ color: '#f87171' }}>*</span></span> },
                ].map(item => (
                  <label key={item.key} style={{ display: 'flex', alignItems: 'flex-start', gap: '10px', cursor: 'pointer' }}>
                    <input type="checkbox" checked={item.state} onChange={e => item.set(e.target.checked)}
                      style={{ marginTop: '2px', width: '15px', height: '15px', flexShrink: 0, accentColor: '#080808' }} />
                    <span style={{ fontSize: '12px', color: 'rgba(0,0,0,0.6)', lineHeight: 1.6 }}>{item.text}</span>
                  </label>
                ))}
                <label style={{ display: 'flex', alignItems: 'flex-start', gap: '10px', cursor: 'pointer' }}>
                  <input type="checkbox" checked={dataChecked} onChange={e => setDataChecked(e.target.checked)}
                    style={{ marginTop: '2px', width: '15px', height: '15px', flexShrink: 0, accentColor: '#080808' }} />
                  <span style={{ fontSize: '12px', color: 'rgba(0,0,0,0.45)', lineHeight: 1.6 }}>
                    Allow AutoBuild AI to use my anonymised print data to improve its models.{' '}
                    <span style={{ color: 'rgba(0,0,0,0.25)' }}>(Optional)</span>
                  </span>
                </label>
              </div>
              <button onClick={handleOnboard} disabled={!nameInput.trim() || !tosChecked || !privChecked}
                style={{ width: '100%', padding: '12px', background: '#080808', color: '#fff', border: 'none', borderRadius: '12px', fontSize: '14px', fontWeight: 600, cursor: 'pointer', opacity: (!nameInput.trim() || !tosChecked || !privChecked) ? 0.3 : 1, transition: 'opacity 0.2s', fontFamily: "'Space Grotesk', sans-serif" }}>
                Enter AutoBuild AI
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
