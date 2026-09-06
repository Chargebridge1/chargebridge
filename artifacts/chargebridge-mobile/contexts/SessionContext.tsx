import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";

// ── Types ─────────────────────────────────────────────────────────────────────

/** Static session params set once at session start (from router params). */
export interface ActiveSessionData {
  sessionId: string;
  stationId: number;
  stationName: string;
  chargerType: string;
  targetKwh: number;
  totalCostCents: number;
  /** Unix ms timestamp when the session started on this device. */
  startedAt: number;
  lat?: number;
  lng?: number;
  // Telemetry — updated periodically (not every second)
  displayKwh: number;
  powerW: number | null;
}

interface SessionContextValue {
  /** Currently active session, or null when idle. */
  session: ActiveSessionData | null;
  /**
   * Called by active-session.tsx on mount to register the session globally.
   * Sets startedAt = Date.now() automatically.
   */
  startSession: (
    params: Omit<ActiveSessionData, "startedAt" | "displayKwh" | "powerW">,
  ) => void;
  /**
   * Called by active-session.tsx when kWh or power changes meaningfully.
   * Rate-limited: only triggers a state update when kWh delta ≥ 0.05 kWh
   * or powerW changes, to avoid 1-render-per-second storms across consumers.
   */
  updateTelemetry: (kwh: number, powerW: number | null) => void;
  /** Called when the session ends (user stops, SSE session_stop, or summary reached). */
  endSession: () => void;
}

// ── Storage ───────────────────────────────────────────────────────────────────

const STORAGE_KEY = "CB_ACTIVE_SESSION";

async function persistSession(data: ActiveSessionData) {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch {}
}

async function clearPersistedSession() {
  try {
    await AsyncStorage.removeItem(STORAGE_KEY);
  } catch {}
}

async function loadPersistedSession(): Promise<ActiveSessionData | null> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ActiveSessionData;
    // Discard sessions older than 4 hours (SESSION_ORPHAN_TTL default)
    const ageMs = Date.now() - (parsed.startedAt ?? 0);
    if (ageMs > 4 * 60 * 60 * 1000) {
      await clearPersistedSession();
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

// ── Context ───────────────────────────────────────────────────────────────────

const SessionContext = createContext<SessionContextValue | null>(null);

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<ActiveSessionData | null>(null);

  // Ref to track last kWh we committed to state — used for rate-limiting
  const lastCommittedKwh = useRef<number>(0);
  const lastCommittedPowerW = useRef<number | null>(null);

  // On mount: restore any persisted session (cold-start resume)
  useEffect(() => {
    loadPersistedSession().then((stored) => {
      if (stored) setSession(stored);
    });
  }, []);

  const startSession = useCallback(
    (params: Omit<ActiveSessionData, "startedAt" | "displayKwh" | "powerW">) => {
      setSession((prev) => {
        // Same session re-mounted (user navigated away and returned via a banner) —
        // preserve startedAt and live telemetry so elapsed time stays continuous
        // and the session banners don't show a reset counter.
        if (prev?.sessionId === params.sessionId) {
          const preserved: ActiveSessionData = { ...prev, ...params };
          void persistSession(preserved);
          return preserved;
        }
        // Genuinely new session — reset everything.
        lastCommittedKwh.current = 0;
        lastCommittedPowerW.current = null;
        const data: ActiveSessionData = {
          ...params,
          startedAt: Date.now(),
          displayKwh: 0,
          powerW: null,
        };
        void persistSession(data);
        return data;
      });
    },
    [],
  );

  const updateTelemetry = useCallback(
    (kwh: number, powerW: number | null) => {
      const kwhDelta = Math.abs(kwh - lastCommittedKwh.current);
      const powerChanged = powerW !== lastCommittedPowerW.current;

      // Only re-render consumers when change is meaningful
      if (kwhDelta < 0.05 && !powerChanged) return;

      lastCommittedKwh.current = kwh;
      lastCommittedPowerW.current = powerW;

      setSession((prev) => {
        if (!prev) return prev;
        const updated = { ...prev, displayKwh: kwh, powerW };
        void persistSession(updated);
        return updated;
      });
    },
    [],
  );

  const endSession = useCallback(() => {
    setSession(null);
    lastCommittedKwh.current = 0;
    lastCommittedPowerW.current = null;
    void clearPersistedSession();
  }, []);

  return (
    <SessionContext.Provider
      value={{ session, startSession, updateTelemetry, endSession }}
    >
      {children}
    </SessionContext.Provider>
  );
}

// ── Hooks ─────────────────────────────────────────────────────────────────────

export function useSession(): SessionContextValue {
  const ctx = useContext(SessionContext);
  if (!ctx) {
    throw new Error("useSession must be used within a SessionProvider");
  }
  return ctx;
}

/**
 * Returns elapsed seconds since the session started, updating every second.
 * Isolated to its own state so re-renders don't propagate up to parent screens.
 * Returns 0 when no session is active.
 */
export function useSessionElapsed(): number {
  const { session } = useSession();
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (!session) {
      setElapsed(0);
      return;
    }
    const compute = () =>
      setElapsed(Math.floor((Date.now() - session.startedAt) / 1000));
    compute();
    const t = setInterval(compute, 1000);
    return () => clearInterval(t);
  }, [session?.sessionId]); // eslint-disable-line react-hooks/exhaustive-deps

  return elapsed;
}

/** Formats elapsed seconds as MM:SS or Xh YYm */
export function fmtElapsedSession(secs: number): string {
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  if (h > 0) return `${h}h ${String(m).padStart(2, "0")}m`;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}
