import { useEffect, useState } from "react";
import { AccessibilityInfo } from "react-native";

export function useReduceMotion(): boolean {
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);

  useEffect(() => {
    let isMounted = true;
    AccessibilityInfo.isReduceMotionEnabled().then((enabled) => {
      if (isMounted) setPrefersReducedMotion(enabled);
    });
    const sub = AccessibilityInfo.addEventListener("reduceMotionChanged", (enabled) => {
      if (isMounted) setPrefersReducedMotion(enabled);
    });
    return () => {
      isMounted = false;
      sub.remove();
    };
  }, []);

  return prefersReducedMotion;
}
