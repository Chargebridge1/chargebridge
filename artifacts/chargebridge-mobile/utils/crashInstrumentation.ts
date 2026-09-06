import AsyncStorage from "@react-native-async-storage/async-storage";

const CRASH_LOG_KEY = "@chargebridge/last_crash";
const TRACE_KEY = "@chargebridge/startup_trace";

// ── Global error handler ─────────────────────────────────────────────────────
// Installed at module load (side-effect import in _layout.tsx) so it captures
// any unhandled native exception that makes it through convertNSExceptionToJSError.
const EU = (globalThis as any).ErrorUtils as
  | {
      getGlobalHandler: () => (error: Error, isFatal?: boolean) => void;
      setGlobalHandler: (handler: (error: Error, isFatal?: boolean) => void) => void;
    }
  | undefined;

if (EU) {
  const origHandler = EU.getGlobalHandler();
  EU.setGlobalHandler((error: Error, isFatal?: boolean) => {
    try {
      const entry = JSON.stringify({
        t: Date.now(),
        msg: error?.message ?? String(error),
        stack: (error?.stack ?? "").slice(0, 3000),
        fatal: isFatal ?? false,
      });
      AsyncStorage.setItem(CRASH_LOG_KEY, entry).catch(() => {});
    } catch (_) {}
    if (origHandler) origHandler(error, isFatal);
  });
}

// ── Startup trace ─────────────────────────────────────────────────────────────
// Each logStartup() call appends an entry and rewrites the AsyncStorage key so
// that the full trace up to the crash point survives the process termination.
// On the NEXT launch, readAndClearStartupTrace() returns the trace for diagnosis.
const _traceEntries: string[] = [];

export function logStartup(tag: string): void {
  const entry = `${Date.now()} ${tag}`;
  _traceEntries.push(entry);
  AsyncStorage.setItem(TRACE_KEY, _traceEntries.join("\n")).catch(() => {});
}

// ── Readers (call on next launch) ─────────────────────────────────────────────
export async function readAndClearCrashLog(): Promise<string | null> {
  try {
    const data = await AsyncStorage.getItem(CRASH_LOG_KEY);
    if (data) {
      await AsyncStorage.removeItem(CRASH_LOG_KEY);
      return data;
    }
  } catch (_) {}
  return null;
}

export async function readAndClearStartupTrace(): Promise<string | null> {
  try {
    const data = await AsyncStorage.getItem(TRACE_KEY);
    if (data) {
      await AsyncStorage.removeItem(TRACE_KEY);
      return data;
    }
  } catch (_) {}
  return null;
}
