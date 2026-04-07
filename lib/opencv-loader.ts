// lib/opencv-loader.ts
let loadPromise: Promise<void> | null = null;

export function loadOpenCV(): Promise<void> {
  if (typeof window === 'undefined') return Promise.resolve();
  if ((window as any).cv?.Mat) return Promise.resolve();
  if (loadPromise) return loadPromise;

  loadPromise = new Promise((resolve, reject) => {
    (window as any).Module = {
      onRuntimeInitialized() {
        resolve();
      },
    };
    const script = document.createElement('script');
    script.src = 'https://docs.opencv.org/4.8.0/opencv.js';
    script.async = true;
    script.onerror = () => reject(new Error('Failed to load OpenCV.js'));
    // Fallback poll
    script.onload = () => {
      const t = setInterval(() => {
        if ((window as any).cv?.Mat) { clearInterval(t); resolve(); }
      }, 150);
      setTimeout(() => { clearInterval(t); reject(new Error('OpenCV timeout')); }, 40000);
    };
    document.head.appendChild(script);
  });

  return loadPromise;
}