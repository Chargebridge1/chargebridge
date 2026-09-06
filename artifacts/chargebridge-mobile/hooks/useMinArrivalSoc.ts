import { useState, useEffect, useCallback } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";

const STORAGE_KEY = "@chargebridge/min_arrival_soc";
const DEFAULT_MIN_SOC = 10;

export function useMinArrivalSoc() {
  const [minArrivalSoc, setMinArrivalSocState] = useState<number>(DEFAULT_MIN_SOC);

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY).then((raw) => {
      if (raw !== null) {
        const parsed = parseInt(raw, 10);
        if (!isNaN(parsed) && parsed >= 5 && parsed <= 30) {
          setMinArrivalSocState(parsed);
        }
      }
    });
  }, []);

  const setMinArrivalSoc = useCallback((pct: number) => {
    const clamped = Math.max(5, Math.min(30, Math.round(pct)));
    setMinArrivalSocState(clamped);
    AsyncStorage.setItem(STORAGE_KEY, String(clamped));
  }, []);

  return { minArrivalSoc, setMinArrivalSoc };
}
