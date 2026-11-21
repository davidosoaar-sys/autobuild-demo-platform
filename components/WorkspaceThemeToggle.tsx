'use client';

import { Moon, Sun } from 'lucide-react';
import { useSyncExternalStore } from 'react';

const key = 'autobuild_workspace_theme';
const eventName = 'autobuild-workspace-theme';
const readTheme = () => document.documentElement.dataset.workspaceTheme === 'light' ? 'light' : 'dark';
const readServerTheme = () => 'dark' as const;

function subscribe(onChange: () => void) {
  const onStorage = (event: StorageEvent) => {
    if (event.key !== key) return;
    document.documentElement.dataset.workspaceTheme = event.newValue === 'light' ? 'light' : 'dark';
    onChange();
  };
  window.addEventListener(eventName, onChange);
  window.addEventListener('storage', onStorage);
  return () => {
    window.removeEventListener(eventName, onChange);
    window.removeEventListener('storage', onStorage);
  };
}

export default function WorkspaceThemeToggle() {
  const dark = useSyncExternalStore(subscribe, readTheme, readServerTheme) === 'dark';
  return <button type="button" className="workspace-theme-toggle" aria-label="Dark mode" aria-pressed={dark}
    title={dark ? 'Switch to light mode' : 'Switch to dark mode'}
    onClick={() => {
      const theme = dark ? 'light' : 'dark';
      document.documentElement.dataset.workspaceTheme = theme;
      try { localStorage.setItem(key, theme); } catch { /* Keep the current-page preference. */ }
      window.dispatchEvent(new Event(eventName));
    }}>
    {dark ? <Sun size={18} aria-hidden="true" /> : <Moon size={18} aria-hidden="true" />}
  </button>;
}
