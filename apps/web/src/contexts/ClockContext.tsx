import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { ServerClock } from '../server-clock';

interface ClockContextValue {
  now: number;
  synchronize: (serverIso: string, requestStartedAt: number, responseReceivedAt: number) => boolean;
  getNow: () => number;
}

const ClockContext = createContext<ClockContextValue | null>(null);

export function ClockProvider({ children }: { children: ReactNode }) {
  const clockRef = useRef(new ServerClock());
  const [now, setNow] = useState(() => clockRef.current.now());

  useEffect(() => {
    const timer = setInterval(() => {
      setNow(clockRef.current.now());
    }, 60_000);
    return () => clearInterval(timer);
  }, []);

  const synchronize = (serverIso: string, requestStartedAt: number, responseReceivedAt: number) => {
    const shifted = clockRef.current.synchronize(serverIso, requestStartedAt, responseReceivedAt);
    if (shifted) {
      setNow(clockRef.current.now());
    }
    return shifted;
  };

  const getNow = () => clockRef.current.now();

  return (
    <ClockContext.Provider value={{ now, synchronize, getNow }}>
      {children}
    </ClockContext.Provider>
  );
}

export function useClock() {
  const ctx = useContext(ClockContext);
  if (!ctx) throw new Error('useClock must be used within a ClockProvider');
  return ctx;
}

export function useNow() {
  return useClock().now;
}
