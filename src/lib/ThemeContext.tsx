import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import type { Dispatch, ReactNode, SetStateAction } from 'react';
import { Capacitor } from '@capacitor/core';
import { StatusBar, Style } from '@capacitor/status-bar';

export type AppTheme = 'dark' | 'light';
type ThemeContextValue = {
  theme: AppTheme;
  setTheme: Dispatch<SetStateAction<AppTheme>>;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

function savedTheme(): AppTheme {
  try {
    return window.localStorage.getItem('simorgh-theme') === 'light' ? 'light' : 'dark';
  } catch {
    return 'dark';
  }
}

/** One persisted preference shared by the public showcase, sign-in and operational workspace. */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<AppTheme>(savedTheme);

  useEffect(() => {
    const documentThemeColor = theme === 'dark' ? '#101719' : '#F4F7F7';
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
    const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
    if (meta) meta.content = documentThemeColor;

    try {
      window.localStorage.setItem('simorgh-theme', theme);
    } catch {
      // The visual preference still works in the current session when storage is unavailable.
    }

    if (Capacitor.isNativePlatform()) {
      void StatusBar.setStyle({ style: theme === 'dark' ? Style.Light : Style.Dark }).catch(() => {});
      void StatusBar.setOverlaysWebView({ overlay: false }).catch(() => {});
      if (Capacitor.getPlatform() === 'android') {
        void StatusBar.setBackgroundColor({ color: documentThemeColor }).catch(() => {});
      }
    }
  }, [theme]);

  const value = useMemo(() => ({ theme, setTheme }), [theme]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useAppTheme() {
  const context = useContext(ThemeContext);
  if (!context) throw new Error('ThemeProvider missing');
  return context;
}
