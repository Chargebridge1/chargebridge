import React, { createContext, useContext, useState } from "react";

interface NavStateContextValue {
  isNavigating: boolean;
  setIsNavigating: (v: boolean) => void;
  navCardHeight: number;
  setNavCardHeight: (h: number) => void;
}

const NavStateContext = createContext<NavStateContextValue>({
  isNavigating: false,
  setIsNavigating: () => {},
  navCardHeight: 0,
  setNavCardHeight: () => {},
});

export function NavStateProvider({ children }: { children: React.ReactNode }) {
  const [isNavigating, setIsNavigating] = useState(false);
  const [navCardHeight, setNavCardHeight] = useState(0);
  return (
    <NavStateContext.Provider value={{ isNavigating, setIsNavigating, navCardHeight, setNavCardHeight }}>
      {children}
    </NavStateContext.Provider>
  );
}

export function useNavState() {
  return useContext(NavStateContext);
}
