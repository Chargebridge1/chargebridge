import React, { createContext, useContext, useState, useCallback, useEffect, useRef } from "react";
import { useAuth } from "@clerk/expo";
import { track } from "@/lib/analytics";

type Units = "mi" | "km";

interface UnitsContextValue {
  units: Units;
  toggleUnits: () => void;
  formatDistance: (miles: number) => string;
}

const UnitsContext = createContext<UnitsContextValue>({
  units: "mi",
  toggleUnits: () => {},
  formatDistance: (m) => `${m.toFixed(1)} mi`,
});

const BASE = `https://${process.env.EXPO_PUBLIC_DOMAIN}`;
const SAVE_DEBOUNCE_MS = 600;

export function UnitsProvider({ children }: { children: React.ReactNode }) {
  const [units, setUnits] = useState<Units>("mi");
  const { isSignedIn, getToken } = useAuth();
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!isSignedIn) return;
    getToken()
      .then((token) => {
        if (!token) return null;
        return fetch(`${BASE}/api/me`, {
          headers: { Authorization: `Bearer ${token}` },
        }).then((r) => (r.ok ? r.json() : null));
      })
      .then((user) => {
        const unit = user?.preferences?.distanceUnit;
        if (unit === "mi" || unit === "km") {
          setUnits(unit);
        }
      })
      .catch(() => {});
  }, [isSignedIn, getToken]);

  const toggleUnits = useCallback(() => {
    setUnits((u) => {
      const next: Units = u === "mi" ? "km" : "mi";

      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(() => {
        getToken()
          .then((token) => {
            if (!token) {
              track("units_save_no_token", {});
              return;
            }
            return fetch(`${BASE}/api/me`, {
              method: "PATCH",
              headers: {
                Authorization: `Bearer ${token}`,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({ preferences: { distanceUnit: next } }),
            });
          })
          .catch(() => {});
      }, SAVE_DEBOUNCE_MS);

      return next;
    });
  }, [getToken]);

  const formatDistance = useCallback(
    (miles: number) => {
      if (units === "km") return `${(miles * 1.60934).toFixed(1)} km`;
      return `${miles.toFixed(1)} mi`;
    },
    [units]
  );

  return (
    <UnitsContext.Provider value={{ units, toggleUnits, formatDistance }}>
      {children}
    </UnitsContext.Provider>
  );
}

export function useUnits() {
  return useContext(UnitsContext);
}
