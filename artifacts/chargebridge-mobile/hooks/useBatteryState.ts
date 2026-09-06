import { useState, useCallback, useEffect } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";

const BATTERY_STORAGE_KEY = "@chargebridge/battery_percent";

/**
 * Battery SoC state, persisted to AsyncStorage so it is shared across all
 * tabs and survives navigation. Each component that calls this hook reads the
 * same persisted value on mount and receives the current value through React
 * state on subsequent updates within the same session.
 *
 * Returns null until the AsyncStorage read completes (or if never set by user).
 */
export function useBatteryState() {
  const [batteryPercent, setBatteryPercentRaw] = useState<number | null>(null);

  useEffect(() => {
    AsyncStorage.getItem(BATTERY_STORAGE_KEY)
      .then((val) => {
        if (val != null) {
          const pct = parseInt(val, 10);
          if (!isNaN(pct) && pct >= 0 && pct <= 100) {
            setBatteryPercentRaw(pct);
          }
        }
      })
      .catch(() => {});
  }, []);

  const setBatteryPercent = useCallback((pct: number) => {
    const clamped = Math.max(0, Math.min(100, Math.round(pct)));
    setBatteryPercentRaw(clamped);
    AsyncStorage.setItem(BATTERY_STORAGE_KEY, String(clamped)).catch(() => {});
  }, []);

  const clear = useCallback(() => {
    setBatteryPercentRaw(null);
    AsyncStorage.removeItem(BATTERY_STORAGE_KEY).catch(() => {});
  }, []);

  return { batteryPercent, setBatteryPercent, clear };
}
