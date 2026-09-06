import React, { createContext, useContext, useEffect, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";

export type TabKey = "home" | "nearby" | "gas" | "explore" | "profile" | "map" | "charge" | "activity";

export type WallpaperPreset = {
  id: string;
  label: string;
  colors: readonly [string, string, ...string[]];
  start?: { x: number; y: number };
  end?: { x: number; y: number };
};

export const PRESETS: WallpaperPreset[] = [
  { id: "default",   label: "Default",    colors: ["#f2f5f8", "#e8ecf1"] },
  { id: "midnight",  label: "Midnight",   colors: ["#0f0c29", "#302b63", "#24243e"] },
  { id: "ocean",     label: "Ocean",      colors: ["#0D9E7E", "#007EA7", "#0f2027"] },
  { id: "forest",    label: "Forest",     colors: ["#134E5E", "#71B280"] },
  { id: "sunset",    label: "Sunset",     colors: ["#ff4e50", "#f9d423"] },
  { id: "aurora",    label: "Aurora",     colors: ["#085078", "#85D8CE"] },
  { id: "dusk",      label: "Dusk",       colors: ["#4e54c8", "#8f94fb"] },
  { id: "rose",      label: "Rose",       colors: ["#f953c6", "#b91d73"] },
  { id: "ember",     label: "Ember",      colors: ["#232526", "#ff512f"] },
  { id: "cosmic",    label: "Cosmic",     colors: ["#141E30", "#243B55"] },
  { id: "peach",     label: "Peach",      colors: ["#ED4264", "#FFEDBC"] },
  { id: "mint",      label: "Mint",       colors: ["#00b09b", "#96c93d"] },
  { id: "lavender",  label: "Lavender",   colors: ["#c471f5", "#12c2e9"] },
  { id: "steel",     label: "Steel",      colors: ["#4b79a1", "#283e51"] },
  { id: "charcoal",  label: "Charcoal",   colors: ["#232526", "#414345"] },
  { id: "snow",      label: "Snow",       colors: ["#e0eafc", "#cfdef3"] },
  { id: "electric",  label: "Electric",   colors: ["#020024", "#090979", "#00d4ff"] },
  { id: "charged",   label: "Charged",    colors: ["#11998e", "#38ef7d"] },
  { id: "nebula",    label: "Nebula",     colors: ["#667eea", "#764ba2"] },
  { id: "neon",      label: "Neon",       colors: ["#00f260", "#0575e6"] },
  { id: "solar",     label: "Solar",      colors: ["#f7971e", "#ffd200"] },
  { id: "volt",      label: "Volt",       colors: ["#1a1a2e", "#16213e", "#0f3460", "#e94560"] },
];

type WallpaperState = Record<TabKey, string>;
type PhotoUriState  = Record<TabKey, string | null>;

const ALL_TAB_KEYS: TabKey[] = ["home", "nearby", "gas", "explore", "profile", "map", "charge", "activity"];

const DEFAULT_STATE: WallpaperState = {
  home: "default", nearby: "default", gas: "default",
  explore: "default", profile: "default", map: "default",
  charge: "default", activity: "default",
};
const DEFAULT_PHOTOS: PhotoUriState = {
  home: null, nearby: null, gas: null, explore: null, profile: null, map: null,
  charge: null, activity: null,
};

export const MAX_SAVED_PHOTOS = 4;

type WallpaperContextValue = {
  wallpapers:             WallpaperState;
  photoUris:              PhotoUriState;
  savedPhotos:            string[];
  setWallpaper:           (tab: TabKey, presetId: string) => void;
  setPhotoWallpaper:      (tab: TabKey, uri: string | null) => void;
  setAllWallpapers:       (presetId: string) => void;
  setAllPhotoWallpapers:  (uri: string | null) => void;
  addSavedPhoto:          (uri: string) => void;
  removeSavedPhoto:       (uri: string) => void;
};

const WallpaperContext = createContext<WallpaperContextValue>({
  wallpapers:             DEFAULT_STATE,
  photoUris:              DEFAULT_PHOTOS,
  savedPhotos:            [],
  setWallpaper:           () => {},
  setPhotoWallpaper:      () => {},
  setAllWallpapers:       () => {},
  setAllPhotoWallpapers:  () => {},
  addSavedPhoto:          () => {},
  removeSavedPhoto:       () => {},
});

const STORAGE_KEY       = "@cb:wallpapers_v1";
const PHOTO_STORAGE_KEY = "@cb:wallpaper_photos_v1";
const SAVED_PHOTOS_KEY  = "@cb:wallpaper_saved_photos_v1";

export function WallpaperProvider({ children }: { children: React.ReactNode }) {
  const [wallpapers,  setWallpapers]  = useState<WallpaperState>(DEFAULT_STATE);
  const [photoUris,   setPhotoUris]   = useState<PhotoUriState>(DEFAULT_PHOTOS);
  const [savedPhotos, setSavedPhotos] = useState<string[]>([]);

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY).then((v) => {
      if (v) { try { setWallpapers({ ...DEFAULT_STATE, ...JSON.parse(v) }); } catch {} }
    });
    AsyncStorage.getItem(PHOTO_STORAGE_KEY).then((v) => {
      if (v) { try { setPhotoUris({ ...DEFAULT_PHOTOS, ...JSON.parse(v) }); } catch {} }
    });
    AsyncStorage.getItem(SAVED_PHOTOS_KEY).then((v) => {
      if (v) { try { setSavedPhotos(JSON.parse(v)); } catch {} }
    });
  }, []);

  function persistSavedPhotos(next: string[]) {
    AsyncStorage.setItem(SAVED_PHOTOS_KEY, JSON.stringify(next)).catch(() => {});
  }

  function addSavedPhoto(uri: string) {
    setSavedPhotos((prev) => {
      if (prev.includes(uri)) return prev;
      const next = prev.length >= MAX_SAVED_PHOTOS
        ? [...prev.slice(1), uri]
        : [...prev, uri];
      persistSavedPhotos(next);
      return next;
    });
  }

  function removeSavedPhoto(uri: string) {
    setSavedPhotos((prev) => {
      const next = prev.filter((u) => u !== uri);
      persistSavedPhotos(next);
      return next;
    });
  }

  function setWallpaper(tab: TabKey, presetId: string) {
    setWallpapers((prev) => {
      const next = { ...prev, [tab]: presetId };
      AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next)).catch(() => {});
      return next;
    });
    if (presetId !== "custom-photo") {
      setPhotoUris((prev) => {
        const next = { ...prev, [tab]: null };
        AsyncStorage.setItem(PHOTO_STORAGE_KEY, JSON.stringify(next)).catch(() => {});
        return next;
      });
    }
  }

  function setPhotoWallpaper(tab: TabKey, uri: string | null) {
    setPhotoUris((prev) => {
      const next = { ...prev, [tab]: uri };
      AsyncStorage.setItem(PHOTO_STORAGE_KEY, JSON.stringify(next)).catch(() => {});
      return next;
    });
    setWallpapers((prev) => {
      const next = { ...prev, [tab]: uri ? "custom-photo" : "default" };
      AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next)).catch(() => {});
      return next;
    });
  }

  function setAllWallpapers(presetId: string) {
    setWallpapers((prev) => {
      const next = { ...prev };
      ALL_TAB_KEYS.forEach((k) => { next[k] = presetId; });
      AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next)).catch(() => {});
      return next;
    });
    if (presetId !== "custom-photo") {
      setPhotoUris((prev) => {
        const next = { ...prev };
        ALL_TAB_KEYS.forEach((k) => { next[k] = null; });
        AsyncStorage.setItem(PHOTO_STORAGE_KEY, JSON.stringify(next)).catch(() => {});
        return next;
      });
    }
  }

  function setAllPhotoWallpapers(uri: string | null) {
    setPhotoUris((prev) => {
      const next = { ...prev };
      ALL_TAB_KEYS.forEach((k) => { next[k] = uri; });
      AsyncStorage.setItem(PHOTO_STORAGE_KEY, JSON.stringify(next)).catch(() => {});
      return next;
    });
    setWallpapers((prev) => {
      const next = { ...prev };
      ALL_TAB_KEYS.forEach((k) => { next[k] = uri ? "custom-photo" : "default"; });
      AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next)).catch(() => {});
      return next;
    });
  }

  return (
    <WallpaperContext.Provider value={{
      wallpapers, photoUris, savedPhotos,
      setWallpaper, setPhotoWallpaper,
      setAllWallpapers, setAllPhotoWallpapers,
      addSavedPhoto, removeSavedPhoto,
    }}>
      {children}
    </WallpaperContext.Provider>
  );
}

export function useAllWallpapers() {
  const { wallpapers, photoUris, setAllWallpapers, setAllPhotoWallpapers } = useContext(WallpaperContext);
  const allSame = Object.values(wallpapers).every((v) => v === wallpapers.home);
  const presetId = allSame ? wallpapers.home : "mixed";
  const photoUri = allSame ? (photoUris.home ?? null) : null;
  return { presetId, photoUri, setAllWallpapers, setAllPhotoWallpapers };
}

export function useWallpaperRaw() {
  return useContext(WallpaperContext);
}

export function useWallpaper(tab: TabKey) {
  const { wallpapers, photoUris, setWallpaper, setPhotoWallpaper } = useContext(WallpaperContext);
  const presetId  = wallpapers[tab];
  const photoUri  = photoUris[tab] ?? null;
  const preset    = PRESETS.find((p) => p.id === presetId) ?? PRESETS[0];
  const isDefault = presetId === "default";
  const isPhoto   = presetId === "custom-photo" && !!photoUri;
  return {
    preset,
    presetId,
    photoUri,
    isDefault,
    isPhoto,
    setWallpaper:      (id: string)           => setWallpaper(tab, id),
    setPhotoWallpaper: (uri: string | null)   => setPhotoWallpaper(tab, uri),
  };
}
