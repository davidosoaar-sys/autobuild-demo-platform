'use client';

import { useEffect } from 'react';

/**
 * Best-effort deterrent for a beta-test link: blocks right-click, text
 * selection, and copy/cut on the page. This raises friction for casual
 * copying; it cannot stop someone using browser devtools, view-source, or a
 * screenshot — no client-side script can. Mount once per allowed page.
 */
export default function BetaGuard() {
  useEffect(() => {
    const block = (e: Event) => e.preventDefault();
    document.addEventListener('contextmenu', block);
    document.addEventListener('copy', block);
    document.addEventListener('cut', block);
    document.body.style.userSelect = 'none';
    return () => {
      document.removeEventListener('contextmenu', block);
      document.removeEventListener('copy', block);
      document.removeEventListener('cut', block);
      document.body.style.userSelect = '';
    };
  }, []);

  return null;
}
