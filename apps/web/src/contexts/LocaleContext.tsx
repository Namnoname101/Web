import { createContext, useContext, useState, type ReactNode } from 'react';
import type { Locale } from '../types';

export type Translate = (vi: string, en: string) => string;

interface LocaleContextValue {
  locale: Locale;
  setLocale: (value: Locale) => void;
  chooseLocale: (value: Locale) => void;
  t: Translate;
}

const LocaleContext = createContext<LocaleContextValue | null>(null);

const readInitialLocale = (): Locale => {
  try {
    return localStorage.getItem('schedule-locale') === 'en' ? 'en' : 'vi';
  } catch {
    return 'vi';
  }
};

export function LocaleProvider({ children, initialLocale }: { children: ReactNode; initialLocale?: Locale }) {
  const [locale, setLocale] = useState<Locale>(initialLocale || readInitialLocale);

  const chooseLocale = (value: Locale) => {
    setLocale(value);
    try {
      localStorage.setItem('schedule-locale', value);
    } catch {
      // Browser storage is optional.
    }
  };

  const t: Translate = (vi, en) => (locale === 'vi' ? vi : en);

  return (
    <LocaleContext.Provider value={{ locale, setLocale, chooseLocale, t }}>
      {children}
    </LocaleContext.Provider>
  );
}

export function useLocale() {
  const ctx = useContext(LocaleContext);
  if (!ctx) throw new Error('useLocale must be used within a LocaleProvider');
  return ctx;
}

export function useTranslate() {
  return useLocale().t;
}
