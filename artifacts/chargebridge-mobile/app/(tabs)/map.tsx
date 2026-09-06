import React, { useState, useEffect, useCallback, useRef } from "react";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Platform,
  TextInput,
  ActivityIndicator,
  Linking,
  Keyboard,
  ScrollView,
  FlatList,
  Modal,
  AppState,
  AppStateStatus,
  Animated,
  Alert,
  KeyboardAvoidingView,
  LayoutChangeEvent,
  Share,
  PanResponder,
} from "react-native";
import * as Print from "expo-print";
import * as Sharing from "expo-sharing";
import { QuickRateSheet } from "@/components/QuickRateSheet";
import { TypeBadge, StatusChip } from "@/components/StationCard";
import MapView, {
  Marker,
  Polyline,
  PROVIDER_DEFAULT,
  PROVIDER_GOOGLE,
} from "react-native-maps";
import { Feather, Ionicons } from "@expo/vector-icons";
import * as Location from "expo-location";
import * as Haptics from "expo-haptics";
import {
  navState,
  BACKGROUND_NAV_TASK,
  requestNavNotifPermissions,
  showTurnNotification,
  showArrivalNotification,
  cancelNavNotifications,
} from "@/utils/navNotifications";
import { scheduleForcedSpeak } from "@/utils/navSpeakScheduler";
import { syncBgNotifiedIntoVoiceAnnounced } from "@/utils/navVoiceSync";
import { navStepThreshold } from "@/utils/navSpeedThreshold";
import { navOffRouteThreshold } from "@/utils/navOffRouteThreshold";
import { consumeBgOffRoute } from "@/utils/navOffRouteDetect";
import { foregroundAdvanceStepIdx, navMissedTurnThreshold } from "@/utils/navStepAdvance";
import { buildNavZoneLogLine, buildNavSpeakLogLine } from "@/utils/navZoneLog";
import { useColors } from "@/hooks/useColors";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { updateCarPlayLocation } from "@/app/carplay/CarPlayService";
import { router, useFocusEffect } from "expo-router";
import * as Speech from "expo-speech";
import { setAudioModeAsync } from "expo-audio";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { logStartup } from "@/utils/crashInstrumentation";
import * as Calendar from "expo-calendar";
import { consumeNavigationIntent } from "@/utils/navigationIntent";
import { getDefaultMap, openWithDefaultMap } from "@/hooks/useDefaultMap";
import { useListFavorites } from "@/lib/api-client";
import { track } from "@/lib/analytics";
import { WallpaperLayer, AllTabsWallpaperPicker } from "@/components/WallpaperPicker";
import { usePrimaryVehicle } from "@/hooks/usePrimaryVehicle";
import { useBatteryState } from "@/hooks/useBatteryState";
import { useMinArrivalSoc } from "@/hooks/useMinArrivalSoc";
import {
  computeChargeConfidence,
  computeChargeEstimates,
} from "@/utils/chargeConfidence";
import { MapBottomSheet, SHEET_SNAP_PEEK } from "@/components/map/MapBottomSheet";
import { MapFilterPills } from "@/components/map/MapFilterPills";
import { StationListRow } from "@/components/map/StationListRow";
import type { StationRowItem } from "@/components/map/StationListRow";
import { BestMatchBanner } from "@/components/map/BestMatchBanner";
import { MatchExplanationSheet } from "@/components/map/MatchExplanationSheet";
import { useSmartChargerMatch } from "@/hooks/useSmartChargerMatch";
import { SkeletonCard } from "@/components/ui/Skeleton";
import { EmptyState } from "@/components/ui/EmptyState";
import { useSession, useSessionElapsed, fmtElapsedSession, type ActiveSessionData } from "@/contexts/SessionContext";
import { useNavState } from "@/contexts/NavStateContext";
import { NavEvidenceCapturePanel } from "@/components/NavEvidenceCapturePanel";
import {
  armNextA3Capture,
  captureArmedA3,
  createNavEvidenceCaptureState,
  recordEvidenceTtsDispatch,
  recordEvidenceTtsOutcome,
  resetNavEvidenceCaptureSession,
  type NavEvidenceA3Context,
  type NavEvidenceCaptureState,
} from "@/utils/navEvidenceCapture";

const BASE = `https://${process.env.EXPO_PUBLIC_DOMAIN}`;
const NAV_EVIDENCE_CAPTURE_ENABLED = process.env.EXPO_PUBLIC_NAV_EVIDENCE_CAPTURE === "1";

// Height of the bottom tab bar (used to keep the popup above it)
const TAB_BAR_HEIGHT = 58;

// ── EV network → native app mapping ──────────────────────────────────────────
type NetworkAppInfo = {
  scheme: string;
  iosStore: string;
  androidStore: string;
  label: string;
};

// ── Nearby transit stop (from Overpass OSM) ──────────────────────────────────
type TransitStop = {
  id: string;
  name: string;
  stopType: "bus" | "train" | "subway" | "tram" | "other";
  lat: number;
  lng: number;
  routes: string;   // e.g. "5, 14, 49"
  operator: string; // agency/network name
  distanceM: number;
};

// ── Transitland live departure ────────────────────────────────────────────────
type TlDeparture = {
  route: string;         // short name e.g. "14" or "BART"
  headsign: string;      // e.g. "Mission & Balboa Park"
  departureTime: string; // "HH:MM" 24h
  minutesAway: number;
};

// ── In-app transit itinerary ──────────────────────────────────────────────────
type TransitLeg = {
  type: "walk" | "transit";
  fromLabel: string;
  toLabel: string;
  from: LatLng;
  to: LatLng;
  durationMin: number;
  distanceM: number;
  coordinates: LatLng[];
  routeName?: string;       // e.g. "14", "BART Blue Line"
  operator?: string;
  nextDepartures?: TlDeparture[]; // live departures from Transitland
};
type TransitItinerary = {
  legs: TransitLeg[];
  totalDurationMin: number;
};

const NETWORK_APP_MAP: { key: string; info: NetworkAppInfo }[] = [
  {
    key: "tesla",
    info: {
      scheme: "tesla://",
      iosStore: "https://apps.apple.com/us/app/tesla/id582007913",
      androidStore: "https://play.google.com/store/apps/details?id=com.teslamotors.tesla",
      label: "Tesla",
    },
  },
  {
    key: "chargepoint",
    info: {
      scheme: "chargepoint://",
      iosStore: "https://apps.apple.com/us/app/chargepoint/id356866128",
      androidStore: "https://play.google.com/store/apps/details?id=com.coulombtech",
      label: "ChargePoint",
    },
  },
  {
    key: "evgo",
    info: {
      scheme: "evgo://",
      iosStore: "https://apps.apple.com/us/app/evgo-electric-vehicle-charging/id1042351697",
      androidStore: "https://play.google.com/store/apps/details?id=com.evgo.evgo",
      label: "EVgo",
    },
  },
  {
    key: "blink",
    info: {
      scheme: "blinkcharging://",
      iosStore: "https://apps.apple.com/us/app/blink-charging/id1277021177",
      androidStore: "https://play.google.com/store/apps/details?id=com.greenlots.blink",
      label: "Blink Charging",
    },
  },
  {
    key: "electrify america",
    info: {
      scheme: "electrifyamerica://",
      iosStore: "https://apps.apple.com/us/app/electrify-america/id1171351543",
      androidStore: "https://play.google.com/store/apps/details?id=com.electrifyamerica.app",
      label: "Electrify America",
    },
  },
  {
    key: "shell",
    info: {
      scheme: "shellrecharge://",
      iosStore: "https://apps.apple.com/us/app/shell-recharge/id1484350916",
      androidStore: "https://play.google.com/store/apps/details?id=com.shell.shellrecharge",
      label: "Shell Recharge",
    },
  },
  {
    key: "volta",
    info: {
      scheme: "volta://",
      iosStore: "https://apps.apple.com/us/app/volta-charging/id919856302",
      androidStore: "https://play.google.com/store/apps/details?id=com.voltainc.volta",
      label: "Volta",
    },
  },
  {
    key: "flo",
    info: {
      scheme: "flo://",
      iosStore: "https://apps.apple.com/us/app/flo-ev-charging/id1301164553",
      androidStore: "https://play.google.com/store/apps/details?id=com.flo.flo",
      label: "FLO",
    },
  },
  {
    key: "rivian",
    info: {
      scheme: "rivian://",
      iosStore: "https://apps.apple.com/us/app/rivian/id1487165994",
      androidStore: "https://play.google.com/store/apps/details?id=com.rivian.android.consumer",
      label: "Rivian",
    },
  },
  {
    key: "ionna",
    info: {
      scheme: "ionna://",
      iosStore: "https://apps.apple.com/us/app/ionna/id6482498018",
      androidStore: "https://play.google.com/store/apps/details?id=com.ionna.app",
      label: "IONNA",
    },
  },
  {
    key: "ampup",
    info: {
      scheme: "ampup://",
      iosStore: "https://apps.apple.com/us/app/ampup-ev-charging/id1479413898",
      androidStore: "https://play.google.com/store/apps/details?id=com.ampup.app",
      label: "AmpUp",
    },
  },
  {
    key: "semaconnect",
    info: {
      scheme: "semacharge://",
      iosStore: "https://apps.apple.com/us/app/semaconnect/id1447893665",
      androidStore: "https://play.google.com/store/apps/details?id=com.semaconnect.ev",
      label: "SemaConnect",
    },
  },
];

function matchNetworkApp(network: string | null): NetworkAppInfo | null {
  if (!network) return null;
  const lower = network.toLowerCase();
  for (const { key, info } of NETWORK_APP_MAP) {
    if (lower.includes(key)) return info;
  }
  return null;
}

async function openNetworkApp(station: EvStation) {
  const appInfo = matchNetworkApp(station.network);
  if (appInfo) {
    const canOpen = await Linking.canOpenURL(appInfo.scheme).catch(() => false);
    if (canOpen) {
      Linking.openURL(appInfo.scheme);
      return;
    }
    // App not installed — prompt to download
    const storeUrl = Platform.OS === "ios" ? appInfo.iosStore : appInfo.androidStore;
    const storeName = Platform.OS === "ios" ? "App Store" : "Google Play";
    Alert.alert(
      `Open in ${appInfo.label}`,
      `The ${appInfo.label} app isn't installed. Get it from the ${storeName} to manage sessions at this station.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: `Download ${appInfo.label}`,
          onPress: () => Linking.openURL(storeUrl),
        },
      ]
    );
    return;
  }
  // No known network app — fall back to Maps
  openNavigation(station.lat, station.lng, station.name);
}

type LatLng = { latitude: number; longitude: number };
type MapViewType = "standard" | "hybrid";

type RouteStep = {
  coordinate: LatLng;
  distanceM: number;
  durationS: number;
  instruction: string;
  featherIcon: string;
  streetName: string;
  lanes?: Array<{ indications: string[]; valid: boolean }>;
};

type DestHistoryEntry = {
  id: string;
  label: string;
  lat: number;
  lng: number;
  timestamp: number;
};

type SavedPlace = {
  id: string;
  name: string;
  label: string;
  lat: number;
  lng: number;
};

type RouteResult = {
  coordinates: LatLng[];
  distanceKm: number;
  durationMin: number;
  steps: RouteStep[];
};

type AltRoute = {
  coordinates: LatLng[];
  distanceKm: number;
  durationMin: number;
};

type EvStation = {
  id: string;
  source: "community" | "nrel" | "osm" | "ocm";
  name: string;
  address: string | null;
  city: string | null;
  lat: number;
  lng: number;
  chargerType: "Level1" | "Level2" | "DCFC";
  connectorTypes: string[];
  powerKw: number | null;
  pricePerKwh: number | null;
  priceText: string | null;
  isFree: boolean;
  pricingUrl: string | null;
  status: "available" | "busy" | "offline" | "unknown";
  distanceMiles: number;
  network: string | null;
  totalPorts: number | null;
  availablePorts: number | null;
  phone: string | null;
  website: string | null;
  osmUrl: string | null;
};

type GasStation = {
  id: string;
  source: string;
  name: string;
  brand: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  lat: number;
  lng: number;
  distanceMiles: number | null;
  fuelTypes: string[];
  hasCarWash: boolean;
  hasConvenienceStore: boolean;
  opening_hours: string | null;
  phone: string | null;
  website: string | null;
  osmUrl: string | null;
  prices: {
    regularCents: number | null;
    midCents: number | null;
    premiumCents: number | null;
    dieselCents: number | null;
    source: "osm" | "community" | "eia" | "fred" | null;
    reporterName: string | null;
    reportedAt: string | null;
    regionName: string | null;
    eiaWeek: string | null;
  };
  averageRating: number | null;
  reviewCount: number;
};

type NominatimResult = {
  place_id: string;
  display_name: string;
  lat: string;
  lon: string;
};

type CalEvt = {
  id: string;
  title: string;
  location: string;
  startDate: Date;
};

type TripWaypoint = {
  id: string;
  label: string;
  loc: LatLng;
};

type TripLeg = {
  fromLabel: string;
  toLabel: string;
  distanceKm: number;
  durationMin: number;
  coordinates: LatLng[];
};

function evStatusColor(s: string) {
  return s === "available" ? "#22c55e" : s === "busy" ? "#f59e0b" : "#ef4444";
}

function gradeColor(grade: "A" | "B" | "C" | "D"): string {
  return grade === "A" ? "#16a34a" : grade === "B" ? "#2563eb" : grade === "C" ? "#d97706" : "#dc2626";
}

function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

function formatEventTime(date: Date): string {
  const now = new Date();
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const timeStr = date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  if (date.toDateString() === now.toDateString()) return `Today ${timeStr}`;
  if (date.toDateString() === tomorrow.toDateString()) return `Tomorrow ${timeStr}`;
  return date.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" }) + " " + timeStr;
}

function formatDistance(km: number): string {
  const miles = km * 0.621371;
  return miles < 10 ? `${miles.toFixed(1)} mi` : `${Math.round(miles)} mi`;
}

function haversineKm(a: LatLng, b: LatLng): number {
  const R = 6371;
  const dLat = (b.latitude - a.latitude) * Math.PI / 180;
  const dLon = (b.longitude - a.longitude) * Math.PI / 180;
  const lat1 = a.latitude * Math.PI / 180;
  const lat2 = b.latitude * Math.PI / 180;
  const s1 = Math.sin(dLat / 2), s2 = Math.sin(dLon / 2);
  const a2 = s1 * s1 + Math.cos(lat1) * Math.cos(lat2) * s2 * s2;
  return R * 2 * Math.atan2(Math.sqrt(a2), Math.sqrt(1 - a2));
}

// Smooth route progress: finds the nearest point on the route LINE (not just the nearest vertex)
// Returns the segment index and an interpolated coordinate between the two endpoints.
//
// Performance: route progress always moves forward, so the new closest segment is almost always
// within ~50 segments of the last one. We search a forward window first (O(50)) and only fall
// back to a full O(n) scan when the window result looks implausibly far away (> 80 m), which
// catches U-turns and the very first call. This keeps the JS thread free at hardware GPS rate.
function closestRoutePoint(coords: LatLng[], pos: LatLng, hintIdx = 0): { idx: number; interp: LatLng } {
  if (coords.length === 0) return { idx: 0, interp: pos };
  if (coords.length === 1) return { idx: 0, interp: coords[0] };

  let bestIdx = 0;
  let bestDist = Infinity;
  let bestInterp: LatLng = coords[0];

  const scanRange = (start: number, end: number) => {
    for (let i = start; i < end; i++) {
      const A = coords[i];
      const B = coords[i + 1];
      const ax = A.longitude, ay = A.latitude;
      const bx = B.longitude, by = B.latitude;
      const px = pos.longitude, py = pos.latitude;
      const abx = bx - ax, aby = by - ay;
      const abLen2 = abx * abx + aby * aby;
      let t = abLen2 === 0 ? 0 : ((px - ax) * abx + (py - ay) * aby) / abLen2;
      t = Math.max(0, Math.min(1, t));
      const cx = ax + t * abx, cy = ay + t * aby;
      const interp: LatLng = { latitude: cy, longitude: cx };
      const d = haversineKm(interp, pos);
      if (d < bestDist) { bestDist = d; bestIdx = i; bestInterp = interp; }
    }
  };

  // Fast-path window search: ±3 behind hint, up to 50 ahead
  const wStart = Math.max(0, hintIdx - 3);
  const wEnd   = Math.min(coords.length - 1, hintIdx + 50);
  scanRange(wStart, wEnd);

  // Full-scan fallback: wrong turn, large route gap, or first call
  if (bestDist > 0.08) {
    bestIdx = 0; bestDist = Infinity; bestInterp = coords[0];
    scanRange(0, coords.length - 1);
  }

  return { idx: bestIdx, interp: bestInterp };
}

/**
 * Route-arc distance (metres) from an interpolated polyline position to a maneuver coordinate.
 *
 * Uses the actual road geometry rather than straight-line haversine so that curved approaches
 * (highway cloverleafs, roundabout entries, on-ramp loops) produce the correct lead time.
 * On a 270° cloverleaf exit at 65 mph, straight-line to the exit point ≈ 280 m while
 * road-arc ≈ 700 m — a 24-second difference that would fire a3 while still on the main highway.
 *
 * Algorithm: scan up to 600 vertices forward from fromIdx, find the vertex closest to toCoord,
 * sum arc lengths from fromInterp → polyline[fromIdx] → … → polyline[toIdx] → toCoord.
 * Falls back to straight-line when the polyline is unavailable (first GPS tick / web builds).
 */
function routeArcDistM(
  polyline: LatLng[],
  fromIdx: number,
  fromInterp: LatLng,
  toCoord: LatLng,
): number {
  if (polyline.length === 0) return haversineKm(fromInterp, toCoord) * 1000;
  const clampedFrom = Math.max(0, Math.min(fromIdx, polyline.length - 1));
  const searchEnd   = Math.min(polyline.length - 1, clampedFrom + 600);
  // Find the polyline vertex closest to toCoord, searching only forward.
  let toIdx   = clampedFrom;
  let minDist = haversineKm(polyline[clampedFrom], toCoord);
  for (let i = clampedFrom + 1; i <= searchEnd; i++) {
    const d = haversineKm(polyline[i], toCoord);
    if (d < minDist) { minDist = d; toIdx = i; }
  }
  // Sum arc FORWARD: fromInterp → polyline[clampedFrom+1] → … → polyline[toIdx] → toCoord.
  // NOTE: fromInterp is the perpendicular projection of the car's GPS position onto the segment
  // polyline[fromIdx]→polyline[fromIdx+1].  The forward direction is toward polyline[fromIdx+1].
  // The previous implementation stepped backward to polyline[clampedFrom] first, which added
  // 2×d_back to every measurement (d_back = distance already behind the car on that segment).
  // On 100–300m highway segments that error reached 200m, suppressing a3 until the next vertex.
  if (toIdx <= clampedFrom) return haversineKm(fromInterp, toCoord) * 1000; // same-segment edge case
  let km = haversineKm(fromInterp, polyline[clampedFrom + 1]);
  for (let i = clampedFrom + 1; i < toIdx; i++) {
    km += haversineKm(polyline[i], polyline[i + 1]);
  }
  km += haversineKm(polyline[toIdx], toCoord);
  return km * 1000;
}

function liveDistance(userLoc: LatLng | null, lat: number, lng: number): string {
  if (!userLoc) return "";
  const km = haversineKm(userLoc, { latitude: lat, longitude: lng });
  const miles = km * 0.621371;
  return miles < 0.1 ? "< 0.1 mi" : miles < 10 ? `${miles.toFixed(1)} mi away` : `${Math.round(miles)} mi away`;
}

function openNavigation(lat: number, lng: number, label?: string) {
  getDefaultMap().then((pref) => {
    openWithDefaultMap(lat, lng, label ?? "", pref, { alreadyOnMap: true });
  });
}

// ── Turn instruction builder ──────────────────────────────────────────────────
function buildInstruction(type: string, modifier: string | null, name: string): string {
  const s = name && name.trim() ? name.trim() : null;
  const onto = s ? ` onto ${s}` : "";
  const on = s ? ` on ${s}` : "";
  // OSRM sometimes stores a pre-formed instruction as the step name
  // (e.g. mid-route departs: "Continue onto Bayshore Blvd", crosswalks: "Take the crosswalk",
  //  ramps: "Turn right onto the ramp", departures: "Head northeast toward 11th St").
  // Detect and return directly to avoid double-wrapping like "Head out on Continue onto X".
  if (s && /^(Continue|Take the|Head |Turn |Keep |Bear |Make a|Stay on|Cross|At the|Merge|Exit)/i.test(s)) return s;
  if (type === "depart") return s ? `Head out on ${s}` : "Head out";
  if (type === "arrive") return "You have arrived";
  if (modifier === "uturn") return "Make a U-turn";
  if (type === "roundabout" || type === "rotary") return `Enter the roundabout${onto}`;
  if (type === "exit roundabout" || type === "exit rotary") return `Exit the roundabout${onto}`;
  if (type === "merge") return `Merge${modifier?.includes("left") ? " left" : " right"}${on}`;
  if (type === "off ramp") return `Take the exit${onto}`;
  if (type === "on ramp") return `Take the ramp${onto}`;
  if (type === "fork") return modifier?.includes("left") ? "Keep left at the fork" : "Keep right at the fork";
  if (type === "end of road") return modifier?.includes("left") ? `Turn left${onto}` : `Turn right${onto}`;
  if (!modifier || modifier === "straight") return s ? `Continue straight on ${s}` : "Continue straight";
  if (modifier === "slight right") return `Bear right${onto}`;
  if (modifier === "slight left") return `Bear left${onto}`;
  if (modifier.includes("right")) return `Turn right${onto}`;
  if (modifier.includes("left")) return `Turn left${onto}`;
  return s ? `Continue on ${s}` : "Continue";
}

function maneuverFeatherIcon(type: string, modifier: string | null): string {
  if (type === "arrive") return "flag";
  if (type === "depart") return "navigation";
  if (type === "roundabout" || type === "rotary" || type === "exit roundabout" || type === "exit rotary")
    return "rotate-cw";
  if (modifier === "uturn") return "rotate-ccw";
  if (modifier?.includes("right")) return "corner-up-right";
  if (modifier?.includes("left")) return "corner-up-left";
  return "arrow-up";
}

// ── Walking stat helpers ───────────────────────────────────────────────────
type WalkPace = "leisurely" | "normal" | "brisk";
const WALK_PACE_CONFIG: Record<WalkPace, { label: string; speedFactor: number; calFactor: number }> = {
  leisurely: { label: "Leisurely", speedFactor: 0.72, calFactor: 0.88 },
  normal:    { label: "Normal",    speedFactor: 1.00, calFactor: 1.00 },
  brisk:     { label: "Brisk",     speedFactor: 1.32, calFactor: 1.28 },
};
const STEPS_PER_KM = 1312;   // avg stride ~76 cm
const KCAL_PER_KM  = 68;     // ~68 kcal/km for average adult

function walkSteps(distKm: number): number {
  return Math.round(distKm * STEPS_PER_KM);
}
function walkCalories(distKm: number, pace: WalkPace): number {
  return Math.round(distKm * KCAL_PER_KM * WALK_PACE_CONFIG[pace].calFactor);
}
function walkDuration(baseDurationMin: number, pace: WalkPace): number {
  return Math.round(baseDurationMin / WALK_PACE_CONFIG[pace].speedFactor);
}

function distToPoint(from: LatLng | null, to: LatLng): string {
  if (!from) return "";
  const meters = haversineKm(from, to) * 1000;
  if (meters < 50) return "Now";
  if (meters < 1000) return `${Math.round(meters / 10) * 10} m`;
  return `${(meters / 1609.34).toFixed(1)} mi`;
}

// ── Route fetcher (OSRM with steps + alternatives) ───────────────────────────
function parseOsrmRoute(r: any): RouteResult {
  const coordinates = (r.geometry.coordinates as [number, number][]).map(
    ([lng, lat]) => ({ latitude: lat, longitude: lng })
  );
  const steps: RouteStep[] = [];
  for (const leg of (r.legs ?? []) as any[]) {
    for (const step of (leg.steps ?? []) as any[]) {
      const [sLng, sLat] = (step.maneuver?.location as [number, number]) ?? [0, 0];
      const mType = (step.maneuver?.type as string) ?? "turn";
      const mMod = (step.maneuver?.modifier as string | undefined) ?? null;
      const mName = (step.name as string) ?? "";
      steps.push({
        coordinate: { latitude: sLat, longitude: sLng },
        distanceM: (step.distance as number) ?? 0,
        durationS: (step.duration as number) ?? 0,
        instruction: buildInstruction(mType, mMod, mName),
        featherIcon: maneuverFeatherIcon(mType, mMod),
        streetName: mName,
        lanes: (() => {
          const ints = (step.intersections as any[] | undefined) ?? [];
          for (const inter of ints) {
            if ((inter.lanes as any[] | undefined)?.length) {
              return inter.lanes as Array<{ indications: string[]; valid: boolean }>;
            }
          }
          return undefined;
        })(),
      });
    }
  }
  return {
    coordinates,
    distanceKm: r.distance / 1000,
    durationMin: Math.round(r.duration / 60),
    steps,
  };
}

async function fetchRoute(
  origin: LatLng,
  destination: LatLng,
  mode: "driving" | "walking" | "cycling" | "transit" = "driving",
  live = false
): Promise<(RouteResult & { altRoutes: AltRoute[] }) | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  try {
    const url = `${BASE}/api/route?olat=${origin.latitude}&olng=${origin.longitude}&dlat=${destination.latitude}&dlng=${destination.longitude}&mode=${mode}${live ? "&live=1" : ""}`;
    const resp = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);
    if (!resp.ok) return null;
    const data = await resp.json();
    if (!data.routes?.length) return null;
    const [primary, ...alts] = (data.routes as any[]).map(parseOsrmRoute);
    return {
      ...primary,
      altRoutes: alts.map(({ coordinates, distanceKm, durationMin }) => ({
        coordinates,
        distanceKm,
        durationMin,
      })),
    };
  } catch {
    clearTimeout(timer);
    return null;
  }
}

/** Fetch all routes with full step data (used for in-navigation alt picker). */
async function fetchAllRoutes(
  origin: LatLng,
  destination: LatLng,
  mode: "driving" | "walking" | "cycling" = "driving",
  live = false
): Promise<RouteResult[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  try {
    const url = `${BASE}/api/route?olat=${origin.latitude}&olng=${origin.longitude}&dlat=${destination.latitude}&dlng=${destination.longitude}&mode=${mode}${live ? "&live=1" : ""}`;
    const resp = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);
    if (!resp.ok) return [];
    const data = await resp.json();
    if (!data.routes?.length) return [];
    return (data.routes as any[]).map(parseOsrmRoute);
  } catch {
    clearTimeout(timer);
    return [];
  }
}

async function searchAddress(
  text: string,
  userLat?: number,
  userLng?: number
): Promise<NominatimResult[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  try {
    const locParams =
      userLat != null && userLng != null
        ? `&lat=${userLat}&lng=${userLng}`
        : "";
    const resp = await fetch(
      `${BASE}/api/geocode?q=${encodeURIComponent(text)}${locParams}`,
      { signal: controller.signal }
    );
    clearTimeout(timer);
    if (!resp.ok) return [];
    return resp.json();
  } catch {
    clearTimeout(timer);
    return [];
  }
}

function sampleRoute(coords: LatLng[], n = 6): LatLng[] {
  if (coords.length <= n) return coords;
  const step = Math.floor(coords.length / n);
  const pts: LatLng[] = [];
  for (let i = 0; i < coords.length; i += step) pts.push(coords[i]);
  if (pts[pts.length - 1] !== coords[coords.length - 1])
    pts.push(coords[coords.length - 1]);
  return pts;
}

function laneIndToArrow(ind: string): string {
  switch (ind) {
    case "sharp left":   return "↰";
    case "left":         return "←";
    case "slight left":  return "↙";
    case "straight":     return "↑";
    case "slight right": return "↘";
    case "right":        return "→";
    case "sharp right":  return "↱";
    case "uturn":        return "↺";
    case "merge left":   return "↙";
    case "merge right":  return "↘";
    default:             return "↑";
  }
}

async function fetchStationsAlongRoute(
  coords: LatLng[]
): Promise<{ ev: EvStation[]; gas: GasStation[] }> {
  const samples = sampleRoute(coords, 5);
  const [evSets, gasSets] = await Promise.all([
    Promise.all(
      samples.map((p) =>
        fetch(`${BASE}/api/ev-stations?lat=${p.latitude}&lng=${p.longitude}&radius=3`)
          .then((r) => r.json())
          .catch(() => [])
      )
    ),
    Promise.all(
      samples.map((p) =>
        fetch(`${BASE}/api/gas-stations?lat=${p.latitude}&lng=${p.longitude}&radius=3`)
          .then((r) => r.json())
          .catch(() => [])
      )
    ),
  ]);

  const seenEv = new Set<string>();
  const ev = (evSets.flat() as EvStation[]).filter((s) => {
    if (!s?.id || seenEv.has(s.id)) return false;
    seenEv.add(s.id);
    return true;
  });

  const seenGas = new Set<string>();
  const gas = (gasSets.flat() as GasStation[]).filter((s) => {
    if (!s?.id || seenGas.has(s.id)) return false;
    seenGas.add(s.id);
    return true;
  });

  return { ev, gas };
}

// ─── Web Leaflet fallback (unchanged from before) ─────────────────────────────
function WebLeafletMap({
  stations,
  userLat,
  userLng,
}: {
  stations: EvStation[];
  userLat: number | null;
  userLng: number | null;
}) {
  const mapRef = useRef<any>(null);
  const instanceRef = useRef<any>(null);

  useEffect(() => {
    const mountMap = () => {
      if (!mapRef.current || instanceRef.current) return;
      const L = (globalThis as any).L;
      if (!L) return;
      const center: [number, number] =
        userLat != null && userLng != null ? [userLat, userLng] : [39.5, -98.35];
      const map = L.map(mapRef.current, { zoomControl: true }).setView(
        center,
        userLat != null ? 13 : 4
      );
      instanceRef.current = map;
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: "© OpenStreetMap contributors",
        maxZoom: 19,
      }).addTo(map);
      if (userLat != null && userLng != null) {
        L.circleMarker([userLat, userLng], {
          radius: 9,
          fillColor: "#0D9E7E",
          color: "#fff",
          weight: 2.5,
          fillOpacity: 1,
        })
          .addTo(map)
          .bindPopup("<b>Your location</b>");
      }
      stations.forEach((s) => {
        const dot = evStatusColor(s.status);
        const icon = L.divIcon({
          html: `<div style="width:28px;height:28px;border-radius:50%;background:#0D9E7E;border:2px solid white;box-shadow:0 2px 6px rgba(0,0,0,0.3);display:flex;align-items:center;justify-content:center;"><div style="width:8px;height:8px;border-radius:50%;background:${dot};"></div></div>`,
          className: "",
          iconSize: [28, 28],
          iconAnchor: [14, 14],
        });
        L.marker([s.lat, s.lng], { icon })
          .addTo(map)
          .bindPopup(
            `<b style="font-size:13px">${s.name}</b><br>
            <a href="https://www.google.com/maps/dir/?api=1&destination=${s.lat},${s.lng}" target="_blank" style="display:block;margin-top:8px;background:#0D9E7E;color:white;border-radius:6px;padding:5px 10px;text-decoration:none;text-align:center;font-size:12px">Get Directions</a>`
          );
      });
    };
    if (!document.getElementById("leaflet-css")) {
      const link = document.createElement("link");
      link.id = "leaflet-css";
      link.rel = "stylesheet";
      link.href = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";
      document.head.appendChild(link);
    }
    if ((globalThis as any).L) {
      mountMap();
    } else if (!document.getElementById("leaflet-js")) {
      const script = document.createElement("script");
      script.id = "leaflet-js";
      script.src = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js";
      script.onload = mountMap;
      document.head.appendChild(script);
    } else {
      const check = setInterval(() => {
        if ((globalThis as any).L) {
          clearInterval(check);
          mountMap();
        }
      }, 100);
      return () => clearInterval(check);
    }
    return () => {
      if (instanceRef.current) {
        instanceRef.current.remove();
        instanceRef.current = null;
      }
    };
  }, [stations, userLat, userLng]);

  return <View ref={mapRef} style={StyleSheet.absoluteFill} />;
}

// ─── Custom EV pin ─────────────────────────────────────────────────────────────
function EvPin({ status, selected, availablePorts, totalPorts, isFavorited, matchGrade, bestForMeActive }: { status: string; selected: boolean; availablePorts?: number | null; totalPorts?: number | null; isFavorited?: boolean; matchGrade?: "A" | "B" | "C" | "D" | null; bestForMeActive?: boolean }) {
  const dot = evStatusColor(status);
  const showPorts = totalPorts != null && totalPorts > 0;
  const showGrade = bestForMeActive && matchGrade != null;
  const gColor = showGrade ? gradeColor(matchGrade!) : null;
  return (
    <View style={{ alignItems: "center" }}>
      <View style={{ position: "relative" }}>
        <View
          style={[
            S.pinOuter,
            {
              borderColor: showGrade ? gColor! : dot,
              backgroundColor: selected ? (showGrade ? gColor! : dot) : "#fff",
              width: selected ? 36 : 28,
              height: selected ? 36 : 28,
              borderRadius: selected ? 18 : 14,
            },
          ]}
        >
          <Ionicons name="flash" size={selected ? 16 : 12} color={selected ? "#fff" : (showGrade ? gColor! : dot)} />
        </View>
        {isFavorited && (
          <View style={{
            position: "absolute",
            top: -4,
            right: -4,
            width: 14,
            height: 14,
            borderRadius: 7,
            backgroundColor: "#ef4444",
            alignItems: "center",
            justifyContent: "center",
            borderWidth: 1.5,
            borderColor: "#fff",
          }}>
            <Ionicons name="heart" size={8} color="#fff" />
          </View>
        )}
        {showGrade && (
          <View style={{
            position: "absolute",
            bottom: -4,
            right: -4,
            width: 14,
            height: 14,
            borderRadius: 7,
            backgroundColor: gColor!,
            alignItems: "center",
            justifyContent: "center",
            borderWidth: 1.5,
            borderColor: "#fff",
          }}>
            <Text style={{ color: "#fff", fontSize: 7, fontWeight: "800", lineHeight: 10 }}>{matchGrade}</Text>
          </View>
        )}
      </View>
      {showPorts && (
        <View style={{ backgroundColor: (availablePorts ?? 0) > 0 ? dot : "#94a3b8", borderRadius: 6, paddingHorizontal: 4, paddingVertical: 1, marginTop: 2 }}>
          <Text style={{ color: "#fff", fontSize: 8, fontWeight: "700" }}>{availablePorts ?? "?"}/{totalPorts}</Text>
        </View>
      )}
    </View>
  );
}

// ─── Custom gas pin ─────────────────────────────────────────────────────────────
function GasPin({ selected }: { selected: boolean }) {
  const col = "#f59e0b";
  return (
    <View
      style={[
        S.pinOuter,
        {
          borderColor: col,
          backgroundColor: selected ? col : "#fff",
          width: selected ? 36 : 28,
          height: selected ? 36 : 28,
          borderRadius: selected ? 18 : 14,
        },
      ]}
    >
      <Feather name="droplet" size={selected ? 14 : 11} color={selected ? "#fff" : col} />
    </View>
  );
}

// ─── Trip Plan Modal ───────────────────────────────────────────────────────────
function TripPlanModal({
  visible,
  userLoc,
  navMode,
  onClose,
  onStartTrip,
  initialWaypoints,
}: {
  visible: boolean;
  userLoc: LatLng | null;
  navMode: "driving" | "walking" | "transit" | "cycling";
  onClose: () => void;
  onStartTrip: (allCoords: LatLng[], waypoints: TripWaypoint[], legs: TripLeg[]) => void;
  initialWaypoints?: TripWaypoint[];
}) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const [waypoints, setWaypoints] = useState<TripWaypoint[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<NominatimResult[]>([]);
  const [searchBusy, setSearchBusy] = useState(false);
  const [activeAddIdx, setActiveAddIdx] = useState<number | null>(null);
  const [legs, setLegs] = useState<TripLeg[]>([]);
  const [calcBusy, setCalcBusy] = useState(false);
  const [calcError, setCalcError] = useState<string | null>(null);
  const [sharing, setSharing] = useState(false);
  const [moveModeIdx, setMoveModeIdx] = useState<number | null>(null);
  const searchDebounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Drag-to-reorder state
  const dragIdxRef = useRef<number | null>(null);
  const dragStartYRef = useRef(0);
  const dragAnim = useRef(new Animated.Value(0)).current;
  const [draggingIdx, setDraggingIdx] = useState<number | null>(null);
  const ITEM_H = 62;

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => dragIdxRef.current !== null,
      onMoveShouldSetPanResponder: () => dragIdxRef.current !== null,
      onPanResponderMove: (_, gs) => {
        dragAnim.setValue(gs.dy);
      },
      onPanResponderRelease: (_, gs) => {
        const from = dragIdxRef.current;
        if (from === null) { dragAnim.setValue(0); return; }
        const steps = Math.round(gs.dy / ITEM_H);
        dragAnim.setValue(0);
        dragIdxRef.current = null;
        setDraggingIdx(null);
        if (steps !== 0) {
          setWaypoints((prev) => {
            const next = [...prev];
            const to = Math.max(0, Math.min(next.length - 1, from + steps));
            const [item] = next.splice(from, 1);
            next.splice(to, 0, item);
            return next;
          });
          setLegs([]);
          Haptics.selectionAsync();
        }
      },
      onPanResponderTerminate: () => {
        dragAnim.setValue(0);
        dragIdxRef.current = null;
        setDraggingIdx(null);
      },
    })
  ).current;

  useEffect(() => {
    if (visible) {
      setWaypoints(initialWaypoints?.length ? [...initialWaypoints] : []);
      setLegs([]);
      setCalcError(null);
      setSearchQuery("");
      setMoveModeIdx(null);
      setSearchResults([]);
      setActiveAddIdx(null);
    }
  }, [visible]);

  function handleSearch(text: string) {
    setSearchQuery(text);
    if (searchDebounce.current) clearTimeout(searchDebounce.current);
    if (text.length < 2) { setSearchResults([]); return; }
    setSearchBusy(true);
    searchDebounce.current = setTimeout(async () => {
      try {
        const results = await searchAddress(text, userLoc?.latitude, userLoc?.longitude);
        setSearchResults(results);
      } finally {
        setSearchBusy(false);
      }
    }, 400);
  }

  function addWaypoint(result: NominatimResult, insertAt: number) {
    const loc: LatLng = { latitude: parseFloat(result.lat), longitude: parseFloat(result.lon) };
    const label = (result.display_name ?? "").split(",").slice(0, 2).join(", ");
    const wp: TripWaypoint = { id: `${Date.now()}-${Math.random()}`, label, loc };
    setWaypoints((prev) => {
      const next = [...prev];
      next.splice(insertAt, 0, wp);
      return next;
    });
    setSearchQuery("");
    setSearchResults([]);
    setActiveAddIdx(null);
    setLegs([]);
    Haptics.selectionAsync();
  }

  function removeWaypoint(id: string) {
    setWaypoints((prev) => prev.filter((w) => w.id !== id));
    setLegs([]);
    Haptics.selectionAsync();
  }

  function moveUp(idx: number) {
    if (idx === 0) return;
    setWaypoints((prev) => {
      const next = [...prev];
      [next[idx - 1], next[idx]] = [next[idx], next[idx - 1]];
      return next;
    });
    setLegs([]);
  }

  function moveDown(idx: number) {
    setWaypoints((prev) => {
      if (idx >= prev.length - 1) return prev;
      const next = [...prev];
      [next[idx], next[idx + 1]] = [next[idx + 1], next[idx]];
      return next;
    });
    setLegs([]);
  }

  async function calculateTrip() {
    if (waypoints.length < 2) {
      setCalcError("Add at least 2 stops to calculate a trip.");
      return;
    }
    if (!userLoc) {
      setCalcError("Enable GPS to get directions from your current location.");
      return;
    }
    setCalcBusy(true);
    setCalcError(null);
    setLegs([]);
    try {
      const allPoints: LatLng[] = [userLoc, ...waypoints.map((w) => w.loc)];
      const calcedLegs: TripLeg[] = [];
      for (let i = 0; i < allPoints.length - 1; i++) {
        const result = await fetchRoute(
          allPoints[i],
          allPoints[i + 1],
          navMode === "transit" ? "driving" : navMode
        );
        if (!result) {
          setCalcError(`Couldn't find a route for leg ${i + 1}. Try different stops.`);
          setCalcBusy(false);
          return;
        }
        calcedLegs.push({
          fromLabel: i === 0 ? "My Location" : waypoints[i - 1].label,
          toLabel: waypoints[i].label,
          distanceKm: result.distanceKm,
          durationMin: result.durationMin,
          coordinates: result.coordinates,
        });
      }
      setLegs(calcedLegs);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } finally {
      setCalcBusy(false);
    }
  }

  function buildTripSummary(): { text: string; html: string } {
    const totalKm = legs.reduce((s, l) => s + l.distanceKm, 0);
    const totalMin = legs.reduce((s, l) => s + l.durationMin, 0);
    const modeLabel = navMode === "walking" ? "Walking" : navMode === "transit" ? "Transit" : navMode === "cycling" ? "Cycling" : "Driving";
    const date = new Date().toLocaleDateString("en-US", {
      weekday: "long", year: "numeric", month: "long", day: "numeric",
    });

    const stopsText = ["Start: My Location (GPS)", ...waypoints.map((w, i) => `Stop ${i + 1}: ${w.label}`)].join("\n");
    const legsText = legs
      .map((l, i) => `  ${i + 1}. ${l.fromLabel} → ${l.toLabel}\n     ${formatDistance(l.distanceKm)} · ${formatDuration(l.durationMin)}`)
      .join("\n");

    const text = [
      `⚡ ChargeBridge Trip Plan`,
      `${date} · ${modeLabel}`,
      ``,
      `📍 Stops`,
      stopsText,
      ``,
      `🗺 Route`,
      legsText,
      ``,
      `Total: ${formatDistance(totalKm)} · ${formatDuration(totalMin)}`,
      ``,
      `Created with ChargeBridge`,
    ].join("\n");

    const stopsList = waypoints
      .map((w, i) => `<li><strong>Stop ${i + 1}:</strong> ${w.label}</li>`)
      .join("\n");
    const legsTable = legs
      .map(
        (l, i) =>
          `<tr><td style="text-align:center">${i + 1}</td><td>${l.fromLabel}</td><td>${l.toLabel}</td><td>${l.distanceKm.toFixed(1)} km (${(l.distanceKm * 0.621371).toFixed(1)} mi)</td><td>${formatDuration(l.durationMin)}</td></tr>`
      )
      .join("\n");

    const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>ChargeBridge Trip Plan</title>
  <style>
    body { font-family: -apple-system, Helvetica Neue, sans-serif; max-width: 760px; margin: 0 auto; padding: 32px 24px; color: #1e293b; }
    h1 { color: #0D9E7E; font-size: 26px; margin: 0 0 4px; }
    .meta { color: #64748b; font-size: 13px; margin-bottom: 28px; }
    h2 { font-size: 16px; color: #0f172a; border-bottom: 2px solid #e2e8f0; padding-bottom: 6px; margin: 24px 0 12px; }
    ol { padding-left: 20px; margin: 0; }
    li { margin: 7px 0; font-size: 14px; line-height: 1.5; }
    table { width: 100%; border-collapse: collapse; font-size: 13px; margin-top: 8px; }
    th { background: #f1f5f9; padding: 9px 12px; text-align: left; font-weight: 600; border: 1px solid #e2e8f0; }
    td { padding: 9px 12px; border: 1px solid #e2e8f0; }
    tr:nth-child(even) td { background: #f8fafc; }
    .total-box { background: #0D9E7E; color: #fff; padding: 14px 20px; border-radius: 10px; margin-top: 20px; display: flex; justify-content: space-between; font-size: 15px; font-weight: 600; }
    .footer { margin-top: 36px; color: #94a3b8; font-size: 11px; text-align: center; }
  </style>
</head>
<body>
  <h1>⚡ ChargeBridge Trip Plan</h1>
  <p class="meta">Generated ${date} &nbsp;·&nbsp; ${modeLabel} route &nbsp;·&nbsp; ${waypoints.length} stop${waypoints.length !== 1 ? "s" : ""}</p>
  <h2>Stops</h2>
  <ol>
    <li><strong>Start:</strong> My Location (GPS)</li>
    ${stopsList}
  </ol>
  <h2>Route Details</h2>
  <table>
    <thead>
      <tr><th>#</th><th>From</th><th>To</th><th>Distance</th><th>Est. Time</th></tr>
    </thead>
    <tbody>${legsTable}</tbody>
  </table>
  <div class="total-box">
    <span>Total: ${totalKm.toFixed(1)} km &nbsp;(${(totalKm * 0.621371).toFixed(1)} mi)</span>
    <span>${formatDuration(totalMin)}</span>
  </div>
  <p class="footer">Created with ChargeBridge</p>
</body>
</html>`;

    return { text, html };
  }

  async function shareAsText() {
    if (legs.length === 0) return;
    try {
      const { text } = buildTripSummary();
      await Share.share({ message: text, title: "ChargeBridge Trip Plan" });
    } catch {
      // user cancelled or dismissed — no action needed
    }
  }

  async function shareAsPDF() {
    if (legs.length === 0) return;
    setSharing(true);
    try {
      const { html } = buildTripSummary();
      const { uri } = await Print.printToFileAsync({ html });
      await Sharing.shareAsync(uri, {
        mimeType: "application/pdf",
        dialogTitle: "Share Trip Plan",
        UTI: "com.adobe.pdf",
      });
    } catch {
      Alert.alert("Error", "Could not generate the PDF. Please try again.");
    } finally {
      setSharing(false);
    }
  }

  function handleSharePress() {
    if (legs.length === 0) return;
    Alert.alert(
      "Share Trip Plan",
      "How would you like to share?",
      [
        {
          text: "Text / iMessage / Email",
          onPress: shareAsText,
        },
        {
          text: "Export PDF (AirDrop / Bluetooth / Files)",
          onPress: shareAsPDF,
        },
        { text: "Cancel", style: "cancel" },
      ],
      { cancelable: true }
    );
  }

  const totalKm = legs.reduce((s, l) => s + l.distanceKm, 0);
  const totalMin = legs.reduce((s, l) => s + l.durationMin, 0);
  const allCoords = legs.flatMap((l) => l.coordinates);
  const canCalculate = waypoints.length >= 2 && !!userLoc;

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
        <View style={[TP.root, { backgroundColor: colors.background }]}>
          {/* Header */}
          <View style={[TP.header, { paddingTop: Platform.OS === "ios" ? 20 : insets.top + 12, borderBottomColor: colors.border }]}>
            <View style={{ flex: 1 }}>
              <Text style={[TP.title, { color: colors.foreground }]}>Plan a Trip</Text>
              <Text style={[TP.sub, { color: colors.mutedForeground }]}>Add stops — we'll calculate the full route</Text>
            </View>
            <TouchableOpacity onPress={onClose} style={[TP.closeBtn, { backgroundColor: colors.muted }]}>
              <Feather name="x" size={18} color={colors.foreground} />
            </TouchableOpacity>
          </View>

          <ScrollView
            style={{ flex: 1 }}
            contentContainerStyle={[TP.scroll, { paddingBottom: insets.bottom + 40 }]}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            {/* Origin */}
            <View style={[TP.waypointRow, { backgroundColor: colors.card, borderColor: "#0D9E7E40" }]}>
              <View style={[TP.waypointDot, { backgroundColor: "#0D9E7E" }]} />
              <Text style={[TP.waypointLabel, { color: colors.foreground }]} numberOfLines={1}>
                {userLoc ? "My Location (GPS)" : "⚠ Enable GPS for your starting point"}
              </Text>
            </View>

            {/* Waypoints */}
            {waypoints.map((wp, idx) => {
              const isDragging = draggingIdx === idx;
              const inMoveMode = moveModeIdx === idx;
              const dotColor = idx === waypoints.length - 1 ? "#ef4444" : "#3b82f6";
              return (
                <View key={wp.id}>
                  <View style={[TP.connector, { backgroundColor: colors.border }]} />
                  <Animated.View
                    style={[
                      TP.waypointRow,
                      {
                        backgroundColor: isDragging
                          ? colors.primary + "20"
                          : inMoveMode
                          ? colors.primary + "12"
                          : colors.card,
                        borderColor: inMoveMode ? colors.primary + "60" : colors.border,
                        transform: isDragging ? [{ translateY: dragAnim }] : [],
                        zIndex: isDragging ? 99 : 1,
                        shadowOpacity: isDragging ? 0.18 : 0,
                      },
                    ]}
                  >
                    {/* Drag handle — hold to drag */}
                    <View
                      style={[TP.dragHandle, { borderRightColor: colors.border }]}
                      {...panResponder.panHandlers}
                      onStartShouldSetResponder={() => {
                        dragIdxRef.current = idx;
                        dragStartYRef.current = 0;
                        setDraggingIdx(idx);
                        setMoveModeIdx(null);
                        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                        return false;
                      }}
                    >
                      <Feather name="menu" size={15} color={inMoveMode ? colors.primary : colors.mutedForeground} />
                    </View>

                    <View style={[TP.waypointDot, { backgroundColor: dotColor }]} />
                    <Text style={[TP.waypointLabel, { color: colors.foreground }]} numberOfLines={1} ellipsizeMode="tail">
                      {wp.label}
                    </Text>

                    {/* Move mode: show large up/down arrows */}
                    {inMoveMode ? (
                      <View style={TP.moveModeActions}>
                        <TouchableOpacity
                          onPress={() => { moveUp(idx); setMoveModeIdx(idx > 1 ? idx - 1 : 0); }}
                          disabled={idx === 0}
                          style={[TP.moveArrowBtn, { opacity: idx === 0 ? 0.3 : 1, backgroundColor: colors.primary + "18" }]}
                          hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                        >
                          <Feather name="arrow-up" size={17} color={colors.primary} />
                        </TouchableOpacity>
                        <TouchableOpacity
                          onPress={() => { moveDown(idx); setMoveModeIdx(idx < waypoints.length - 2 ? idx + 1 : waypoints.length - 1); }}
                          disabled={idx === waypoints.length - 1}
                          style={[TP.moveArrowBtn, { opacity: idx === waypoints.length - 1 ? 0.3 : 1, backgroundColor: colors.primary + "18" }]}
                          hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                        >
                          <Feather name="arrow-down" size={17} color={colors.primary} />
                        </TouchableOpacity>
                        <TouchableOpacity
                          onPress={() => setMoveModeIdx(null)}
                          hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                        >
                          <Feather name="check" size={16} color="#22c55e" />
                        </TouchableOpacity>
                        <TouchableOpacity
                          onPress={() => { removeWaypoint(wp.id); setMoveModeIdx(null); }}
                          hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                        >
                          <Feather name="trash-2" size={15} color="#ef4444" />
                        </TouchableOpacity>
                      </View>
                    ) : (
                      <View style={TP.waypointActions}>
                        <TouchableOpacity
                          onPress={() => { setMoveModeIdx(idx); Haptics.selectionAsync(); }}
                          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                          style={TP.reorderBtn}
                        >
                          <Feather name="move" size={14} color={colors.mutedForeground} />
                        </TouchableOpacity>
                        <TouchableOpacity onPress={() => removeWaypoint(wp.id)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                          <Feather name="x" size={16} color="#ef4444" />
                        </TouchableOpacity>
                      </View>
                    )}
                  </Animated.View>
                </View>
              );
            })}

            {/* Add stop */}
            <View style={[TP.connector, { backgroundColor: colors.border }]} />
            {activeAddIdx === null ? (
              <TouchableOpacity
                style={[TP.addStopBtn, { backgroundColor: colors.muted, borderColor: colors.border }]}
                onPress={() => { setActiveAddIdx(waypoints.length); setSearchQuery(""); setSearchResults([]); }}
                activeOpacity={0.8}
              >
                <Feather name="plus" size={15} color={colors.primary} />
                <Text style={[TP.addStopTxt, { color: colors.primary }]}>Add a stop</Text>
              </TouchableOpacity>
            ) : (
              <View style={[TP.searchWrap, { backgroundColor: colors.card, borderColor: colors.primary + "60" }]}>
                <Feather name="search" size={15} color={colors.mutedForeground} />
                <TextInput
                  style={[TP.searchInput, { color: colors.foreground }]}
                  placeholder="Search address or place…"
                  placeholderTextColor={colors.mutedForeground}
                  value={searchQuery}
                  onChangeText={handleSearch}
                  autoFocus
                  returnKeyType="search"
                  autoCorrect={false}
                />
                {searchBusy ? (
                  <ActivityIndicator size={14} color={colors.primary} />
                ) : (
                  <TouchableOpacity
                    onPress={() => { setActiveAddIdx(null); setSearchQuery(""); setSearchResults([]); }}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  >
                    <Feather name="x" size={15} color={colors.mutedForeground} />
                  </TouchableOpacity>
                )}
              </View>
            )}

            {/* Search results */}
            {searchResults.length > 0 && activeAddIdx !== null && (
              <View style={[TP.searchResults, { backgroundColor: colors.card, borderColor: colors.border }]}>
                {searchResults.slice(0, 5).map((r) => {
                  const parts = (r.display_name ?? "").split(",");
                  const primary = parts.slice(0, 2).join(",").trim();
                  const secondary = parts.slice(2, 4).join(",").trim();
                  return (
                    <TouchableOpacity
                      key={r.place_id}
                      style={[TP.resultRow, { borderBottomColor: colors.border }]}
                      onPress={() => addWaypoint(r, activeAddIdx)}
                      activeOpacity={0.75}
                    >
                      <Feather name="map-pin" size={14} color={colors.primary} />
                      <View style={{ flex: 1 }}>
                        <Text style={[TP.resultPrimary, { color: colors.foreground }]} numberOfLines={1}>{primary}</Text>
                        {secondary ? (
                          <Text style={[TP.resultSecondary, { color: colors.mutedForeground }]} numberOfLines={1}>{secondary}</Text>
                        ) : null}
                      </View>
                    </TouchableOpacity>
                  );
                })}
              </View>
            )}

            {/* Error */}
            {calcError ? (
              <View style={TP.errorRow}>
                <Feather name="alert-circle" size={14} color="#ef4444" />
                <Text style={TP.errorTxt}>{calcError}</Text>
              </View>
            ) : null}

            {/* Leg summary */}
            {legs.length > 0 && (
              <View style={[TP.legsCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <Text style={[TP.legsTitle, { color: colors.foreground }]}>Route Summary</Text>
                {legs.map((leg, i) => (
                  <View key={i} style={[TP.legRow, { borderBottomColor: colors.border }]}>
                    <View style={[TP.legNum, { backgroundColor: colors.primary + "20" }]}>
                      <Text style={[TP.legNumTxt, { color: colors.primary }]}>{i + 1}</Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={[TP.legTo, { color: colors.foreground }]} numberOfLines={1}>{leg.toLabel}</Text>
                      <Text style={[TP.legMeta, { color: colors.mutedForeground }]}>
                        {formatDistance(leg.distanceKm)} · {formatDuration(leg.durationMin)}
                      </Text>
                    </View>
                  </View>
                ))}
                <View style={[TP.totalRow, { backgroundColor: colors.primary + "12" }]}>
                  <Feather name="flag" size={14} color={colors.primary} />
                  <Text style={[TP.totalTxt, { color: colors.primary }]}>
                    Total: {formatDistance(totalKm)} · {formatDuration(totalMin)}
                  </Text>
                </View>
              </View>
            )}

            {/* Calculate */}
            <TouchableOpacity
              style={[TP.calcBtn, { backgroundColor: canCalculate ? colors.primary : colors.muted, opacity: calcBusy ? 0.75 : 1 }]}
              onPress={calculateTrip}
              disabled={calcBusy || !canCalculate}
              activeOpacity={0.85}
            >
              {calcBusy ? (
                <ActivityIndicator size={16} color="#fff" />
              ) : (
                <Feather name="map" size={16} color={canCalculate ? "#fff" : colors.mutedForeground} />
              )}
              <Text style={[TP.calcBtnTxt, { color: canCalculate ? "#fff" : colors.mutedForeground }]}>
                {calcBusy ? "Calculating…" : "Calculate Route"}
              </Text>
            </TouchableOpacity>

            {/* Start + Share */}
            {legs.length > 0 && (
              <View style={TP.actionsRow}>
                <TouchableOpacity
                  style={[TP.actionBtn, { backgroundColor: colors.primary, flex: 2 }]}
                  onPress={() => { onStartTrip(allCoords, waypoints, legs); onClose(); }}
                  activeOpacity={0.85}
                >
                  <Feather name="navigation-2" size={15} color="#fff" />
                  <Text style={TP.actionBtnTxt}>Start Trip</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[TP.actionBtn, { backgroundColor: "#3b82f6", flex: 1 }]}
                  onPress={handleSharePress}
                  disabled={sharing}
                  activeOpacity={0.85}
                >
                  {sharing ? (
                    <ActivityIndicator size={14} color="#fff" />
                  ) : (
                    <>
                      <Feather name="share-2" size={14} color="#fff" />
                      <Text style={TP.actionBtnTxt}>Share</Text>
                    </>
                  )}
                </TouchableOpacity>
              </View>
            )}
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// ─── Main screen ───────────────────────────────────────────────────────────────
// ── Active Session floating banner ────────────────────────────────────────────
// Defined outside MapScreen so the 1-second elapsed timer re-renders only this
// component, not the 8k-line MapScreen.
function ActiveSessionMapBanner({
  session,
  bottomInset,
}: {
  session: ActiveSessionData;
  bottomInset: number;
}) {
  const elapsed = useSessionElapsed();
  return (
    <TouchableOpacity
      onPress={() =>
        router.push({
          pathname: "/active-session",
          params: {
            sessionId: session.sessionId,
            stationId: String(session.stationId),
            stationName: session.stationName,
            chargerType: session.chargerType,
            kwh: String(session.targetKwh),
            totalCost: String((session.totalCostCents / 100).toFixed(2)),
            date: new Date(session.startedAt).toLocaleString([], { dateStyle: "medium", timeStyle: "short" } as Intl.DateTimeFormatOptions),
          },
        } as any)
      }
      style={{
        position: "absolute",
        bottom: bottomInset + TAB_BAR_HEIGHT + 10,
        left: 16,
        right: 16,
        backgroundColor: "#0D9E7E",
        borderRadius: 14,
        paddingVertical: 11,
        paddingHorizontal: 14,
        flexDirection: "row",
        alignItems: "center",
        gap: 10,
        shadowColor: "#000",
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.22,
        shadowRadius: 8,
        elevation: 10,
        zIndex: 999,
      }}
      activeOpacity={0.9}
      accessibilityRole="button"
      accessibilityLabel={`Return to charging session at ${session.stationName}`}
    >
      <View
        style={{
          width: 32, height: 32, borderRadius: 16,
          backgroundColor: "rgba(255,255,255,0.2)",
          alignItems: "center", justifyContent: "center",
        }}
      >
        <Ionicons name="flash" size={18} color="#fff" />
      </View>
      <View style={{ flex: 1 }}>
        <Text
          style={{ color: "#fff", fontSize: 13, fontWeight: "700", fontFamily: "Inter_700Bold" }}
          numberOfLines={1}
        >
          {session.stationName}
        </Text>
        <Text style={{ color: "rgba(255,255,255,0.85)", fontSize: 11, fontFamily: "Inter_400Regular" }}>
          {fmtElapsedSession(elapsed)} · {session.displayKwh.toFixed(2)} kWh
        </Text>
      </View>
      <Ionicons name="chevron-forward" size={18} color="rgba(255,255,255,0.75)" />
    </TouchableOpacity>
  );
}

function MapScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const isWeb = Platform.OS === "web";
  const { session } = useSession();
  const mapRef = useRef<MapView>(null);

  // favorites – used to show heart badge on map markers
  const { data: favoritesData } = useListFavorites();
  const favoritedIds = React.useMemo(() => {
    const ids = new Set<number>();
    for (const f of favoritesData ?? []) {
      if (f.source === "community") {
        const n = Number(f.id);
        if (!isNaN(n)) ids.add(n);
      }
    }
    return ids;
  }, [favoritesData]);

  // primary vehicle — auto-seed connector filter on first load
  const primaryVehicle = usePrimaryVehicle();
  const { batteryPercent } = useBatteryState();
  const { minArrivalSoc, setMinArrivalSoc } = useMinArrivalSoc();
  const [connectorFilter, setConnectorFilter] = useState<string[]>([]);
  React.useEffect(() => {
    const plugTypes = (primaryVehicle?.plugTypes ?? []).filter(Boolean);
    if (plugTypes.length > 0 && connectorFilter.length === 0) {
      setConnectorFilter(plugTypes);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [primaryVehicle?.id]);

  // wallpaper picker
  const [pickerOpen, setPickerOpen] = useState(false);

  // location
  const [userLoc, setUserLoc] = useState<LatLng | null>(null);
  const [cachedRegion, setCachedRegion] = useState<{ latitude: number; longitude: number; latitudeDelta: number; longitudeDelta: number } | null>(null);
  const [locLoading, setLocLoading] = useState(false);
  const [locDenied, setLocDenied] = useState(false);
  const [stationFetchError, setStationFetchError] = useState(false);

  // search
  const [searchOpen, setSearchOpen] = useState(false);
  const [activeSearchField, setActiveSearchField] = useState<"from" | "to">("to");
  const [destQuery, setDestQuery] = useState("");
  const [searchResults, setSearchResults] = useState<NominatimResult[]>([]);
  const [searchBusy, setSearchBusy] = useState(false);
  const [searchNoResults, setSearchNoResults] = useState(false);
  const [destLabel, setDestLabel] = useState("");
  const [dest, setDest] = useState<LatLng | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // custom origin (when user types a FROM address instead of using GPS)
  const [originQuery, setOriginQuery] = useState("");
  const [originResults, setOriginResults] = useState<NominatimResult[]>([]);
  const [originBusy, setOriginBusy] = useState(false);
  const [originNoResults, setOriginNoResults] = useState(false);
  const [customOrigin, setCustomOrigin] = useState<LatLng | null>(null);
  const [customOriginLabel, setCustomOriginLabel] = useState("");
  const originDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // route — primary + alternatives
  const [allRoutes, setAllRoutes] = useState<RouteResult[]>([]);
  const [altRoutes, setAltRoutes] = useState<AltRoute[]>([]);
  const [activeRouteIdx, setActiveRouteIdx] = useState(0); // 0 = primary
  const [routeLoading, setRouteLoading] = useState(false);

  // turn-by-turn
  const [currentStepIdx, setCurrentStepIdx] = useState(0);
  const [showStepList, setShowStepList] = useState(false);
  const [arrived, setArrived] = useState(false);
  const routeStepsRef = useRef<RouteStep[]>([]);

  // stations along route
  const [evStations, setEvStations] = useState<EvStation[]>([]);
  const [gasStations, setGasStations] = useState<GasStation[]>([]);
  const [stationsBusy, setStationsBusy] = useState(false);

  // nearby stations (no route mode) — always-visible on map open
  const [nearbyEv, setNearbyEv] = useState<EvStation[]>([]);
  const [nearbyGas, setNearbyGas] = useState<GasStation[]>([]);

  // live refresh
  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Phase 4 — bottom sheet snap state (0=PEEK, 1=PARTIAL, 2=FULL)
  const [sheetSnapIdx, setSheetSnapIdx] = useState(SHEET_SNAP_PEEK);
  // Phase 4 — available-only filter pill
  const [showAvailableOnly, setShowAvailableOnly] = useState(false);
  // Smart Charger Match — "Best for Me" mode
  const [bestForMeActive, setBestForMeActive] = useState(false);
  // Grade filter — show only A & B stations (only relevant when bestForMeActive)
  const [showBestOnly, setShowBestOnly] = useState(false);
  const [explainStation, setExplainStation] = useState<{ name: string; matchScore: number; matchGrade: "A" | "B" | "C" | "D"; matchFactors: import("@/lib/vehicleMatch").MatchFactor[] } | null>(null);
  const refreshIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const appStateRef = useRef<AppStateStatus>("active");
  const routeCoordRef = useRef<LatLng[]>([]);
  const hasRouteRef = useRef(false);
  const userLocRef = useRef<LatLng | null>(null);

  // selection
  const [selectedEv, setSelectedEv] = useState<EvStation | null>(null);
  const [selectedGas, setSelectedGas] = useState<GasStation | null>(null);
  const [selectedDest, setSelectedDest] = useState(false);
  const [selectedWaypoint, setSelectedWaypoint] = useState<TripWaypoint | null>(null);

  // map controls
  const [mapType, setMapType] = useState<MapViewType>("standard");
  const [is3D, setIs3D] = useState(false);
  const [isNavigating, setIsNavigating] = useState(false);
  const { setIsNavigating: setGlobalIsNavigating, setNavCardHeight: setGlobalNavCardHeight } = useNavState();
  // Keep the global NavStateContext in sync so overlays rendered outside this
  // screen (e.g. VoiceButton in _layout.tsx) know when navigation is active.
  // Also reset navCardHeight when nav ends so the button snaps back immediately.
  useEffect(() => {
    setGlobalIsNavigating(isNavigating);
    if (!isNavigating) setGlobalNavCardHeight(0);
  }, [isNavigating, setGlobalIsNavigating, setGlobalNavCardHeight]);
  const locWatchRef = useRef<Location.LocationSubscription | null>(null);

  // popup + rating
  const [rateSheetOpen, setRateSheetOpen] = useState(false);
  const [routeProgressIdx, setRouteProgressIdx] = useState(0);
  const [routeProgressInterp, setRouteProgressInterp] = useState<LatLng | null>(null);

  // ── Nearby places (popup dropdown) ────────────────────────────────────────
  type NearbyPlace = { id: string; name: string; category: string; lat: number; lng: number; distanceM: number; address?: string; phone?: string; website?: string };
  const [nearbyCategory, setNearbyCategory] = useState<string | null>(null);
  const [nearbyPlaces, setNearbyPlaces] = useState<NearbyPlace[]>([]);
  const [nearbyLoading, setNearbyLoading] = useState(false);
  const popupAnim = useRef(new Animated.Value(0)).current;
  // Prevents MapView.onPress from immediately clearing a pin selection
  const pinJustTappedRef = useRef(false);
  // Route error feedback
  const [routeError, setRouteError] = useState<string | null>(null);
  // Transport mode: driving / walking / cycling / transit
  const [navMode, setNavMode] = useState<"driving" | "walking" | "transit" | "cycling">("driving");
  const navModeRef = useRef<"driving" | "walking" | "transit" | "cycling">("driving");
  // Keep ref in sync so startNavigation can read mode without being recreated
  useEffect(() => { navModeRef.current = navMode; }, [navMode]);
  // Walking pace selector
  const [walkPace, setWalkPace] = useState<WalkPace>("normal");
  // Transit panel
  const [showTransitPanel, setShowTransitPanel] = useState(false);
  const [transitStops, setTransitStops] = useState<TransitStop[]>([]);
  const [transitLoading, setTransitLoading] = useState(false);
  // In-app transit itinerary
  const [transitItinerary, setTransitItinerary] = useState<TransitItinerary | null>(null);
  const [transitItinLoading, setTransitItinLoading] = useState(false);
  const [transitNoRoute, setTransitNoRoute] = useState(false);
  // Transitland live departures for the stop list
  const [tlNearbyStops, setTlNearbyStops] = useState<
    { id: string; name: string; lat: number; lng: number; departures: TlDeparture[] }[]
  >([]);
  // Debounce ref for region-change pin reload
  const regionChangeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Voice guidance
  const [voiceMuted, setVoiceMuted] = useState(false);
  const voiceMutedRef = useRef(false);
  // Voice settings (language + voice selection)
  const [navLanguage, setNavLanguage] = useState("en-US");
  const navLanguageRef = useRef("en-US");
  const [navVoiceId, setNavVoiceId] = useState<string | null>(null);
  const navVoiceIdRef = useRef<string | null>(null);
  const [voiceSettingsOpen, setVoiceSettingsOpen] = useState(false);
  const [availableVoices, setAvailableVoices] = useState<Speech.Voice[]>([]);
  const availableVoicesRef = useRef<Speech.Voice[]>([]);

  // Voice rate + pitch (user-adjustable, persisted)
  const [navVoiceRate, setNavVoiceRate] = useState(0.88);
  const navVoiceRateRef = useRef(0.88);
  const [navVoicePitch, setNavVoicePitch] = useState(1.02);
  const navVoicePitchRef = useRef(1.02);

  // Off-route rerouting
  const [isRecalculating, setIsRecalculating] = useState(false);
  const [recalcBannerVisible, setRecalcBannerVisible] = useState(false);
  const isRecalculatingRef = useRef(false);
  const lastRecalcTimeRef = useRef(0);
  const offRouteCountRef = useRef(0);    // consecutive GPS readings off-route
  const offRouteStartMsRef = useRef(0); // wall-clock ms when the current off-route streak started
  const lastProgressUpdateMsRef = useRef(0); // throttle visual polyline-progress re-renders
  const lastSpeedUpdateMsRef = useRef(0);    // throttle speed badge re-renders
  const wrongDirCountRef = useRef(0);    // consecutive backward-progress GPS ticks
  // Dedup guard: tracks the last instruction announced by postAdvanceSpeakTimerRef after
  // any reroute. Prevents the same maneuver from being re-announced on false-positive reroutes.
  // Cleared whenever the user genuinely advances to the next nav step.
  const lastRerouteInstructionRef = useRef("");
  const prevProgressIdxRef = useRef(-1); // closest polyline idx from previous GPS tick
  // Interpolated position on the polyline from closestRoutePoint — stored in a ref so the voice
  // zone block (which runs outside the routeCoordRef.current.length > 0 scope) can access it for
  // route-arc distance calculation without re-running the O(n) polyline scan.
  const navInterpRef = useRef<LatLng | null>(null);
  // Build #209 diagnostic refs — GPS timing and voice-zone distance series.
  // __DEV__-only; no navigation logic reads or writes these.
  const lastGpsTickMsRef    = useRef(0);  // epoch ms of the previous _posHandler call
  const prevDistToNextMRef  = useRef(-1); // distToNextM from the previous voice-zone tick
  // Route version — incremented each time a new route replaces the old one (reroute or start).
  // Captured at announce-trigger time; checked inside the TTS settle timer to discard utterances
  // that were queued for a route that has since been replaced.
  const routeVersionRef = useRef(0);
  // Missed-turn tracker — detects when user enters a turn zone then drives past without turning
  const missedTurnRef = useRef<{ idx: number; minDist: number; wasClose: boolean } | null>(null);
  // Adaptive sensitivity multiplier (1.0 = default; <1 = tighter; >1 = looser).
  // Persisted across sessions via AsyncStorage; adjusted after each reroute outcome.
  const recalcSensitivityRef = useRef(1.0);
  // Tracks a reroute to check 45 s later whether it was a good call (learning)
  const recalcCheckRef = useRef<{ checkAt: number } | null>(null);
  // Timer for post-step-advance "then, turn …" voice cue (must be tracked so teardown cancels it)
  const postAdvanceSpeakTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Background→foreground GPS watch restoration (wakeNavRef stores a function
  // that removes the suspended foreground watch and starts a fresh one when the
  // app returns from background during active navigation).
  const wakeNavRef = useRef<(() => void) | null>(null);
  // Stored so wakeNavRef can restart the watch with the identical opts + handler.
  const navPositionHandlerRef = useRef<((pos: Location.LocationObject) => void) | null>(null);
  const navWatchOptsRef = useRef<{ accuracy: number; timeInterval: number; distanceInterval: number } | null>(null);

  // Distance-based voice pre-announcements per step index
  const voiceAnnouncedRef = useRef<Record<number, Set<string>>>({});
  // Throttle: timestamp of last speech utterance (prevents rapid-fire cutoff)
  const lastSpeakTimeRef = useRef<number>(0);

  // Live GPS speed in mph (shown in ETA strip while driving)
  const [currentSpeedMph, setCurrentSpeedMph] = useState<number | null>(null);

  // Speed unit preference (mph / kph)
  const [speedUnit, setSpeedUnit] = useState<"mph" | "kph">("mph");
  const speedUnitRef = useRef<"mph" | "kph">("mph");

  // Faster route suggestion during active navigation
  const [fasterRoute, setFasterRoute] = useState<{ result: RouteResult & { altRoutes: AltRoute[] }; savesMin: number } | null>(null);
  const fasterRouteTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const currentRouteDurationRef = useRef<number>(0);

  // Alternative routes shown after recalculation (full step data)
  const [recalcAltRoutes, setRecalcAltRoutes] = useState<RouteResult[]>([]);
  const [recalcAltVisible, setRecalcAltVisible] = useState(false);
  const recalcAltTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Tracks the 2-second hide-banner delay after recalculation finishes.
  // Must be a ref so every teardown path (clearRoute, stopNavigation, arrival,
  // unmount) can cancel it — otherwise the naked setTimeout fires setState
  // on a cleared or unmounted component and causes a native crash on iOS.
  const recalcBannerTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Component-mounted sentinel — set false in unmount cleanup so that any
  // in-flight async callbacks (fetchAllRoutes, fetchRoute) can guard their
  // setState calls and not update an unmounted component.
  const isMountedRef = useRef(true);

  // Voice announcement level: quiet = final-turn only, normal = 3 per turn, verbose = all
  const [navVoiceLevel, setNavVoiceLevel] = useState<"quiet" | "normal" | "verbose">("normal");
  const navVoiceLevelRef = useRef<"quiet" | "normal" | "verbose">("normal");

  // Voice volume (0.0–1.0, persisted via AsyncStorage)
  const [navVoiceVolume, setNavVoiceVolume] = useState(1.0);
  const navVoiceVolumeRef = useRef(1.0);

  // Single deferred-speak timer — prevents rapid GPS ticks from stacking Speech.stop() calls,
  // which was the primary cause of voice cutoffs and native audio session crashes on iOS.
  const speakTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Synchronous speaking-state flag — set true immediately before Speech.speak(), cleared by
  // onDone / onStopped / onError callbacks. Replaces the old isSpeakingAsync() async check
  // which had a TOCTOU race: two navSpeak calls on the same GPS tick both resolved
  // isSpeakingAsync() as false before either Speech.speak() fired, causing two utterances
  // to queue back-to-back on iOS → audible garble.
  const isSpeakingRef = useRef(false);

  // Watchdog timer: if iOS TTS never fires onDone (known expo-speech bug on audio
  // interruptions / background switches), isSpeakingRef can get stuck true and silently
  // drop all future non-forced announcements. The watchdog auto-resets after 20 s.
  const isSpeakingWatchdogRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Single-slot queue for non-forced announcements. When a non-forced navSpeak arrives
  // while speech is in progress, it replaces any previously queued item (so only the
  // most-recent announcement waits). Played automatically via onDone drain logic.
  // Structured so the drain can emit a dispatch log with the original zone's context
  // (routeVersion, stepIdx, navSpeak entry time) rather than the prior utterance's.
  const speakQueueRef = useRef<{ text: string; routeVersion: number; stepIdx: number; tNavSpeak: number } | null>(null);
  // Shared timing anchors for maneuver-reached delta calculations.
  // tZone  = epoch ms when the last zone (a1/a2/a3) fired.
  // tSpeak = epoch ms when Speech.speak() actually executed.
  // stepIdx = the nextIdx the zone was targeting (so we can detect step mismatch in the log).
  // tSpeak is reset to 0 each time a new zone fires so stale deltas are never reported.
  const navVoiceTraceRef = useRef({ tZone: 0, tSpeak: 0, stepIdx: -1 });

  // ── Legacy navigation timing refs (no diagnostic overlay is mounted) ─────────
  // Kept for the existing trace logs; they do not trigger React updates.
  const navDebugSpeedMsRef = useRef(0);
  // Text and timestamp of the most recent navSpeak call (both paths: forced + non-forced).
  const navDebugLastSpeakRef = useRef<{ text: string; timeMs: number }>({ text: '', timeMs: 0 });
  // Build #212 timing values remain trace-only; the one-maneuver capture below
  // does not read these refs or poll them.
  const navDebugPosAgeRef        = useRef(0);            // ms — GPS fix age at last tick
  const navDebugIntervalRef      = useRef(0);            // ms — wall-clock gap between ticks
  const navDebugDistRef          = useRef(0);            // m  — current arc distToNextM
  const navDebugDistPrevRef      = useRef(-1);           // m  — previous arc distToNextM
  const navDebugStraightRef      = useRef(0);            // m  — haversine straight-line
  const navDebugZoneRef          = useRef('—');          // last zone fired: a1 / a2 / a3
  const navDebugSinceNavSpeakRef = useRef<number | null>(null); // ms: navSpeak() → Speech.speak()
  const navDebugTtsElapsedRef    = useRef<number | null>(null); // ms: navSpeak() → ttsOnDone

  // The evidence capture is intentionally inert unless enabled in the dedicated
  // diagnostic build. It takes one explicit a3 snapshot and never updates from
  // ordinary GPS ticks, timers, effects, storage, or navigation teardown.
  const [navEvidenceCapture, setNavEvidenceCapture] = useState<NavEvidenceCaptureState>(
    createNavEvidenceCaptureState,
  );
  const navEvidenceCaptureRef = useRef<NavEvidenceCaptureState>(navEvidenceCapture);
  const updateNavEvidenceCapture = useCallback((
    transition: (state: NavEvidenceCaptureState) => NavEvidenceCaptureState,
  ) => {
    if (!NAV_EVIDENCE_CAPTURE_ENABLED) return navEvidenceCaptureRef.current;
    const next = transition(navEvidenceCaptureRef.current);
    if (next === navEvidenceCaptureRef.current) return next;
    navEvidenceCaptureRef.current = next;
    if (isMountedRef.current) setNavEvidenceCapture(next);
    return next;
  }, []);
  const armEvidenceCapture = useCallback(() => {
    updateNavEvidenceCapture(armNextA3Capture);
  }, [updateNavEvidenceCapture]);
  const resetEvidenceCaptureSession = useCallback(() => {
    updateNavEvidenceCapture(resetNavEvidenceCaptureSession);
  }, [updateNavEvidenceCapture]);

  // Pill visibility: next-turn preview shows at 2 miles (10 s), again at 500 m until step advances
  const [pillVisible, setPillVisible] = useState(false);
  const pillVisibleRef = useRef(false);
  const pillTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Navigation camera lock: user can freely zoom/pan the map during navigation.
  // Auto-follow resumes 10 s after the last gesture; tapping the center button re-locks immediately.
  const userInteractingRef = useRef(false);
  const [navCameraFree, setNavCameraFree] = useState(false);
  const navCameraFreeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Nav pill auto-minimize: minimized by default; expand on voice announcement for 40 s
  const [navPillsVisible, setNavPillsVisible] = useState(false);
  const navPillsVisibleRef = useRef(false);
  const navPillsTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Destination near: shows a persistent "Destination ahead" card within 500 m
  const [destNear, setDestNear] = useState(false);
  const destNearRef = useRef(false);

  // EV Arrival Card — appears 2–3 minutes before reaching an EV station destination
  const [evArrivalVisible, setEvArrivalVisible] = useState(false);
  const evArrivalRef = useRef(false);
  // Station snapshot captured when navigation starts (so we can show details in the card)
  const navDestEvRef = useRef<EvStation | null>(null);

  // Startup cue: speaks the departure instruction on the first GPS tick of each session
  const startupCueSpokenRef = useRef(false);

  // Destination history (Recents) + saved places (Favorites)
  const [destHistory, setDestHistory] = useState<DestHistoryEntry[]>([]);
  const [savedPlaces, setSavedPlaces] = useState<SavedPlace[]>([]);

  // Calendar integration
  const [calendarEvents, setCalendarEvents] = useState<CalEvt[]>([]);
  const [calPermission, setCalPermission] = useState<"granted" | "denied" | "undetermined">("undetermined");
  const [geocodingEventId, setGeocodingEventId] = useState<string | null>(null);
  const [editPlaceOpen, setEditPlaceOpen] = useState(false);
  const [editPlaceTarget, setEditPlaceTarget] = useState<{ place: SavedPlace | null; pendingLabel: string; pendingLat: number; pendingLng: number } | null>(null);
  const [editPlaceName, setEditPlaceName] = useState("");

  // Trip planning
  const [tripOpen, setTripOpen] = useState(false);
  const [tripWaypoints, setTripWaypoints] = useState<TripWaypoint[]>([]);
  const [tripLegs, setTripLegs] = useState<TripLeg[]>([]);
  const [tripInitialWaypoints, setTripInitialWaypoints] = useState<TripWaypoint[]>([]);

  // Open trip planner, optionally pre-seeded with the current destination + a new stop
  const openTripWithStop = useCallback(
    (stopLoc: LatLng, stopLabel: string) => {
      const stops: TripWaypoint[] = [];
      // If there's already a single-dest route active, make it the first stop
      if (dest && destLabel) {
        stops.push({ id: `wp-dest-${Date.now()}`, label: destLabel, loc: dest });
      }
      stops.push({ id: `wp-${Date.now()}`, label: stopLabel, loc: stopLoc });
      setTripInitialWaypoints(stops);
      setTripOpen(true);
      Haptics.selectionAsync();
    },
    [dest, destLabel]
  );

  // Open trip planner pre-seeded with the current single destination
  const convertRouteToTrip = useCallback(() => {
    if (!dest || !destLabel) return;
    const stops: TripWaypoint[] = [
      { id: `wp-dest-${Date.now()}`, label: destLabel, loc: dest },
    ];
    setTripInitialWaypoints(stops);
    setTripOpen(true);
    Haptics.selectionAsync();
  }, [dest, destLabel]);

  // ── Fetch nearby transit stops from OSM Overpass ───────────────────────────
  const fetchTransitStops = useCallback(async (loc: LatLng) => {
    setTransitLoading(true);
    try {
      const { latitude: lat, longitude: lng } = loc;
      const q = [
        `[out:json][timeout:15];`,
        `(`,
        `node["highway"="bus_stop"](around:800,${lat},${lng});`,
        `node["railway"="station"](around:800,${lat},${lng});`,
        `node["railway"="halt"](around:800,${lat},${lng});`,
        `node["railway"="subway_entrance"](around:800,${lat},${lng});`,
        `node["amenity"="bus_station"](around:800,${lat},${lng});`,
        `node["railway"="tram_stop"](around:800,${lat},${lng});`,
        `node["public_transport"="platform"]["bus"="yes"](around:800,${lat},${lng});`,
        `);`,
        `out body;`,
      ].join("");
      const resp = await fetch("https://overpass-api.de/api/interpreter", {
        method: "POST",
        body: `data=${encodeURIComponent(q)}`,
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
      });
      if (!resp.ok) return;
      const data = await resp.json();
      const toRad = (d: number) => (d * Math.PI) / 180;
      const seen = new Set<string>();
      const stops: TransitStop[] = (data.elements ?? [])
        .filter((el: any) => el.tags?.name)
        .map((el: any): TransitStop => {
          const dlat = toRad(el.lat - lat);
          const dlng = toRad(el.lon - lng);
          const a =
            Math.sin(dlat / 2) ** 2 +
            Math.cos(toRad(lat)) * Math.cos(toRad(el.lat)) * Math.sin(dlng / 2) ** 2;
          const distanceM = Math.round(6371000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
          let stopType: TransitStop["stopType"] = "bus";
          if (el.tags.railway === "station" || el.tags.railway === "halt") stopType = "train";
          else if (el.tags.railway === "subway_entrance") stopType = "subway";
          else if (el.tags.railway === "tram_stop") stopType = "tram";
          return {
            id: String(el.id),
            name: el.tags.name,
            stopType,
            lat: el.lat,
            lng: el.lon,
            routes: el.tags.route_ref ?? el.tags.ref ?? "",
            operator: el.tags.operator ?? el.tags.network ?? "",
            distanceM,
          };
        })
        .filter((s: TransitStop) => {
          const key = `${s.name.toLowerCase()}:${Math.round(s.lat * 1000)}:${Math.round(s.lng * 1000)}`;
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        })
        .sort((a: TransitStop, b: TransitStop) => a.distanceM - b.distanceM)
        .slice(0, 12);
      setTransitStops(stops);
    } catch {
      setTransitStops([]);
    } finally {
      setTransitLoading(false);
    }
  }, []);

  // Fetch transit stops + live Transitland departures when panel opens
  useEffect(() => {
    if (!showTransitPanel || !userLoc) return;
    fetchTransitStops(userLoc);
    // Fetch Transitland departure times (best-effort, does not block OSM stops)
    fetch(
      `${BASE}/api/transit/nearby?lat=${userLoc.latitude}&lng=${userLoc.longitude}&radius=600`
    )
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { stops?: { id: string; name: string; lat: number; lng: number; departures: TlDeparture[] }[] } | null) => {
        if (data?.stops) setTlNearbyStops(data.stops);
      })
      .catch(() => {}); // silent — live times are optional
  }, [showTransitPanel, userLoc, fetchTransitStops]);

  // Clear itinerary whenever destination changes
  useEffect(() => {
    setTransitItinerary(null);
    setTransitNoRoute(false);
  }, [dest]);

  // Plan an in-app transit route: walk → bus/train → walk
  const planTransitRoute = useCallback(async () => {
    if (!dest || !userLoc) return;
    setTransitItinLoading(true);
    setTransitItinerary(null);
    setTransitNoRoute(false);

    const toRad = (d: number) => (d * Math.PI) / 180;
    const distMeters = (a: LatLng, b: LatLng) => {
      const dlat = toRad(b.latitude - a.latitude);
      const dlng = toRad(b.longitude - a.longitude);
      const x =
        Math.sin(dlat / 2) ** 2 +
        Math.cos(toRad(a.latitude)) * Math.cos(toRad(b.latitude)) * Math.sin(dlng / 2) ** 2;
      return 6_371_000 * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
    };

    // Fetch bus/rail stops near a point via Overpass, returning routes as string[]
    const fetchStopsForRouting = async (lat: number, lng: number, radius = 700) => {
      const q = [
        `[out:json][timeout:15];(`,
        `node["highway"="bus_stop"](around:${radius},${lat},${lng});`,
        `node["public_transport"="stop_position"](around:${radius},${lat},${lng});`,
        `node["railway"="station"](around:${radius},${lat},${lng});`,
        `node["railway"="halt"](around:${radius},${lat},${lng});`,
        `node["railway"="tram_stop"](around:${radius},${lat},${lng});`,
        `node["railway"="subway_entrance"](around:${radius},${lat},${lng});`,
        `);out body;`,
      ].join("");
      try {
        const res = await fetch("https://overpass-api.de/api/interpreter", {
          method: "POST",
          body: `data=${encodeURIComponent(q)}`,
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
        });
        if (!res.ok) return [];
        const data = await res.json();
        return (data.elements ?? [])
          .filter(
            (el: Record<string, unknown>) =>
              (el.tags as Record<string, string>)?.name &&
              ((el.tags as Record<string, string>)?.route_ref ||
                (el.tags as Record<string, string>)?.ref)
          )
          .map((el: Record<string, unknown>) => {
            const tags = el.tags as Record<string, string>;
            return {
              id: String(el.id),
              name: tags.name,
              lat: el.lat as number,
              lng: el.lon as number,
              operator: tags.operator ?? tags.network ?? "",
              routes: (tags.route_ref ?? tags.ref ?? "")
                .split(/[;,]/)
                .map((r: string) => r.trim())
                .filter(Boolean) as string[],
            };
          });
      } catch {
        return [];
      }
    };

    try {
      const [originStops, destStops] = await Promise.all([
        fetchStopsForRouting(userLoc.latitude, userLoc.longitude),
        fetchStopsForRouting(dest.latitude, dest.longitude),
      ]);

      // Sort origin stops closest-first, then build route → stop map
      const sortedOrigin = [...originStops].sort(
        (a, b) =>
          distMeters({ latitude: a.lat, longitude: a.lng }, userLoc) -
          distMeters({ latitude: b.lat, longitude: b.lng }, userLoc)
      );
      const routeToOriginStop = new Map<string, (typeof sortedOrigin)[0]>();
      for (const s of sortedOrigin) {
        for (const r of s.routes) {
          if (!routeToOriginStop.has(r)) routeToOriginStop.set(r, s);
        }
      }

      // Find the closest destination stop that shares a route with an origin stop
      let boardStop: (typeof sortedOrigin)[0] | null = null;
      let alightStop: (typeof destStops)[0] | null = null;
      let sharedRoute = "";
      const sortedDest = [...destStops].sort(
        (a, b) =>
          distMeters({ latitude: a.lat, longitude: a.lng }, dest) -
          distMeters({ latitude: b.lat, longitude: b.lng }, dest)
      );
      for (const s of sortedDest) {
        for (const r of s.routes) {
          if (routeToOriginStop.has(r)) {
            boardStop = routeToOriginStop.get(r)!;
            alightStop = s;
            sharedRoute = r;
            break;
          }
        }
        if (boardStop) break;
      }

      if (!boardStop || !alightStop) {
        setTransitNoRoute(true);
        return;
      }

      const boardLoc: LatLng = { latitude: boardStop.lat, longitude: boardStop.lng };
      const alightLoc: LatLng = { latitude: alightStop.lat, longitude: alightStop.lng };

      // Fetch the two walking legs in parallel
      const [walk1, walk2] = await Promise.all([
        fetchRoute(userLoc, boardLoc, "walking"),
        fetchRoute(alightLoc, dest, "walking"),
      ]);

      const legs: TransitLeg[] = [];

      if (walk1 && walk1.distanceKm > 0.015) {
        legs.push({
          type: "walk",
          fromLabel: "Your location",
          toLabel: boardStop.name,
          from: userLoc,
          to: boardLoc,
          durationMin: walk1.durationMin,
          distanceM: Math.round(walk1.distanceKm * 1000),
          coordinates: walk1.coordinates,
        });
      }

      // Fetch live departures from Transitland for the boarding stop
      let nextDepartures: TlDeparture[] = [];
      try {
        const deptRes = await fetch(
          `${BASE}/api/transit/departures?lat=${boardStop.lat}&lng=${boardStop.lng}`
        );
        if (deptRes.ok) {
          const deptData = await deptRes.json() as { departures?: TlDeparture[] };
          nextDepartures = deptData.departures ?? [];
        }
      } catch { /* live times are best-effort */ }

      legs.push({
        type: "transit",
        fromLabel: boardStop.name,
        toLabel: alightStop.name,
        from: boardLoc,
        to: alightLoc,
        durationMin: 0,
        distanceM: Math.round(distMeters(boardLoc, alightLoc)),
        coordinates: [boardLoc, alightLoc],
        routeName: sharedRoute,
        operator: boardStop.operator || alightStop.operator,
        nextDepartures,
      });

      if (walk2 && walk2.distanceKm > 0.015) {
        legs.push({
          type: "walk",
          fromLabel: alightStop.name,
          toLabel: destLabel ?? "Destination",
          from: alightLoc,
          to: dest,
          durationMin: walk2.durationMin,
          distanceM: Math.round(walk2.distanceKm * 1000),
          coordinates: walk2.coordinates,
        });
      }

      const totalDurationMin = legs.reduce((sum, l) => sum + l.durationMin, 0);
      setTransitItinerary({ legs, totalDurationMin });

      // Fit map to show the full itinerary
      const allCoords = legs.flatMap((l) => l.coordinates);
      if (allCoords.length >= 2) {
        mapRef.current?.fitToCoordinates(allCoords, {
          edgePadding: { top: 160, bottom: 320, left: 50, right: 50 },
          animated: true,
        });
      }
    } catch {
      setTransitNoRoute(true);
    } finally {
      setTransitItinLoading(false);
    }
  }, [userLoc, dest, destLabel]);

  // ── Fetch nearby stations (no-route mode) ─────────────────────────────────
  const fetchNearby = useCallback(async (loc: LatLng, silent = false) => {
    if (!silent) setIsRefreshing(true);
    setStationFetchError(false);
    try {
      const [evResp, gasResp] = await Promise.all([
        fetch(`${BASE}/api/ev-stations?lat=${loc.latitude}&lng=${loc.longitude}&radius=5`),
        fetch(`${BASE}/api/gas-stations?lat=${loc.latitude}&lng=${loc.longitude}&radius=5`),
      ]);
      if (!evResp.ok && !gasResp.ok) {
        setStationFetchError(true);
        return;
      }
      const [evData, gasData] = await Promise.all([evResp.json(), gasResp.json()]);
      setNearbyEv(Array.isArray(evData) ? evData : []);
      setNearbyGas(Array.isArray(gasData) ? gasData : []);
      setLastRefreshed(new Date());
    } catch {
      if (!silent) setStationFetchError(true);
    } finally {
      if (!silent) setIsRefreshing(false);
    }
  }, []);

  // ── Refresh route stations (route mode) ───────────────────────────────────
  const refreshRouteStations = useCallback(async (coords: LatLng[], silent = false) => {
    if (!silent) setIsRefreshing(true);
    try {
      const { ev, gas } = await fetchStationsAlongRoute(coords);
      setEvStations(ev);
      setGasStations(gas);
      setLastRefreshed(new Date());
    } catch {
    } finally {
      if (!silent) setIsRefreshing(false);
    }
  }, []);

  // ── Master refresh (called by interval + manual) ──────────────────────────
  const doRefresh = useCallback((silent = false) => {
    if (appStateRef.current !== "active") return;
    if (hasRouteRef.current && routeCoordRef.current.length > 0) {
      refreshRouteStations(routeCoordRef.current, silent);
    } else if (userLocRef.current) {
      fetchNearby(userLocRef.current, silent);
    }
  }, [fetchNearby, refreshRouteStations]);

  // ── Polling: 30s nearby, 90s route stations ───────────────────────────────
  useEffect(() => {
    const INTERVAL_MS = 30_000;
    refreshIntervalRef.current = setInterval(() => {
      doRefresh(true);
    }, INTERVAL_MS);

    const sub = AppState.addEventListener("change", (next: AppStateStatus) => {
      appStateRef.current = next;
      if (next === "active") {
        // Resume: refresh immediately when app comes back to foreground
        doRefresh(true);
      }
    });

    return () => {
      if (refreshIntervalRef.current) clearInterval(refreshIntervalRef.current);
      sub.remove();
    };
  }, [doRefresh]);

  // ── Location ──────────────────────────────────────────────────────────────
  const getLocation = useCallback(async () => {
    setLocLoading(true);
    setLocDenied(false);
    try {
      logStartup("Location.requestForegroundPermissionsAsync:before");
      const { status } = await Location.requestForegroundPermissionsAsync();
      logStartup("Location.requestForegroundPermissionsAsync:after status=" + status);
      if (status !== "granted") {
        setLocDenied(true);
        return;
      }
      logStartup("Location.getCurrentPositionAsync:before");
      const pos = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.High,
      });
      logStartup("Location.getCurrentPositionAsync:after");
      const loc: LatLng = {
        latitude: pos.coords.latitude,
        longitude: pos.coords.longitude,
      };
      setUserLoc(loc);
      userLocRef.current = loc;
      updateCarPlayLocation(loc);
      AsyncStorage.setItem("@chargebridge/last_location", JSON.stringify(loc)).catch(() => {});
      mapRef.current?.animateToRegion(
        { ...loc, latitudeDelta: 0.06, longitudeDelta: 0.06 },
        800
      );
      // Initial nearby fetch as soon as we have the location
      fetchNearby(loc, false);
    } catch (e) {
      logStartup("getLocation:catch err=" + String(e));
      setLocDenied(true);
    } finally {
      setLocLoading(false);
    }
  }, [fetchNearby]);

  // Keep voice-settings refs in sync with state
  useEffect(() => { navLanguageRef.current = navLanguage; }, [navLanguage]);
  useEffect(() => { navVoiceIdRef.current = navVoiceId; }, [navVoiceId]);
  useEffect(() => { navVoiceRateRef.current = navVoiceRate; }, [navVoiceRate]);
  useEffect(() => { navVoicePitchRef.current = navVoicePitch; }, [navVoicePitch]);
  useEffect(() => { availableVoicesRef.current = availableVoices; }, [availableVoices]);
  useEffect(() => { navVoiceLevelRef.current = navVoiceLevel; }, [navVoiceLevel]);
  useEffect(() => { navVoiceVolumeRef.current = navVoiceVolume; }, [navVoiceVolume]);

  // Load language / voice / speed-unit / history / saved-places from AsyncStorage
  useEffect(() => {
    if (isWeb) return;
    logStartup("startup:begin");
    AsyncStorage.getItem("@chargebridge/speed_unit").then((v) => {
      if (v === "mph" || v === "kph") { setSpeedUnit(v); speedUnitRef.current = v; }
    }).catch(() => {});
    AsyncStorage.getItem("@chargebridge/recalc_sensitivity").then((v) => {
      const n = parseFloat(v ?? "");
      if (!isNaN(n) && n >= 0.6 && n <= 1.5) {
        recalcSensitivityRef.current = n;
        navState.recalcSensitivity   = n; // keep background path in sync
      }
    }).catch(() => {});
    AsyncStorage.getItem("@chargebridge/show_best_only").then((v) => {
      if (v === "1") setShowBestOnly(true);
    }).catch(() => {});
    AsyncStorage.multiGet(["@chargebridge/nav_language", "@chargebridge/nav_voice_id", "@chargebridge/nav_voice_rate", "@chargebridge/nav_voice_pitch", "@chargebridge/nav_voice_level", "@chargebridge/nav_voice_volume", "@chargebridge/nav_voice_muted"]).then((pairs) => {
      const lang = pairs[0][1];
      const voiceId = pairs[1][1];
      const rate = parseFloat(pairs[2][1] ?? "");
      const pitch = parseFloat(pairs[3][1] ?? "");
      const level = pairs[4][1];
      const vol = parseFloat(pairs[5][1] ?? "");
      const muted = pairs[6][1];
      if (lang) { setNavLanguage(lang); navLanguageRef.current = lang; }
      if (voiceId) { setNavVoiceId(voiceId); navVoiceIdRef.current = voiceId; }
      if (!isNaN(rate) && rate > 0) { setNavVoiceRate(rate); navVoiceRateRef.current = rate; }
      if (!isNaN(pitch) && pitch > 0) { setNavVoicePitch(pitch); navVoicePitchRef.current = pitch; }
      if (level === "quiet" || level === "normal" || level === "verbose") { setNavVoiceLevel(level); navVoiceLevelRef.current = level; }
      if (!isNaN(vol) && vol >= 0 && vol <= 1) { setNavVoiceVolume(vol); navVoiceVolumeRef.current = vol; }
      if (muted === "1") { setVoiceMuted(true); voiceMutedRef.current = true; }
    }).catch(() => {});
    // CB-DIAG build 159: Speech.getAvailableVoicesAsync() disabled to test whether
    // it is the source of the iOS crash in builds 155–158. The NSArray it returns
    // is bridged via convertNSArrayToJSIArray which crashes on nil voice properties.
    // Re-enable (set false) for build 160 if crash continues; if crash stops,
    // Speech is confirmed as the source and the voice list will need a nil-safe wrapper.
    const CB_DIAG_DISABLE_SPEECH = true;
    if (!CB_DIAG_DISABLE_SPEECH) {
      logStartup("Speech.getAvailableVoicesAsync:before");
      Speech.getAvailableVoicesAsync()
        .then((voices) => {
          logStartup(
            "Speech.getAvailableVoicesAsync:after count=" +
              (Array.isArray(voices) ? voices.length : "invalid:" + typeof voices)
          );
          try {
            const safeVoices = Array.isArray(voices) ? voices : [];
            setAvailableVoices(safeVoices);
            AsyncStorage.getItem("@chargebridge/nav_voice_id").then((saved) => {
              try {
                if (saved) return;
                if (!safeVoices.length) return;
                const lang = (navLanguageRef.current ?? "en-US").split("-")[0];
                const femNames = ["samantha", "karen", "ava", "serena", "allison", "tessa", "zoe", "moira", "fiona"];
                const pick = safeVoices.find(
                  (v) =>
                    typeof v?.language === "string" &&
                    v.language.startsWith(lang) &&
                    femNames.some((n) => typeof v?.name === "string" && v.name.toLowerCase().includes(n))
                );
                if (pick) {
                  setNavVoiceId(pick.identifier);
                  navVoiceIdRef.current = pick.identifier;
                  AsyncStorage.setItem("@chargebridge/nav_voice_id", pick.identifier).catch(() => {});
                }
              } catch (e) {
                console.warn("[CB] voicePick threw", String(e));
              }
            }).catch(() => {});
          } catch (e) {
            logStartup("Speech.getAvailableVoicesAsync:then-threw err=" + String(e));
            console.warn("[CB] getAvailableVoices.then threw", String(e));
          }
        })
        .catch((e) => {
          logStartup("Speech.getAvailableVoicesAsync:rejected err=" + String(e));
          console.warn("[CB] getAvailableVoicesAsync rejected", String(e));
        });
    } else {
      logStartup("Speech.getAvailableVoicesAsync:skipped-build159-diag");
    }
    // Calendar — silently restore if permission already granted (no prompt)
    logStartup("Calendar.getCalendarPermissionsAsync:before");
    try {
      Calendar.getCalendarPermissionsAsync()
        .then((result) => {
          try {
            logStartup("Calendar.getCalendarPermissionsAsync:after status=" + (result?.status ?? "null"));
            if (result?.status === "granted") loadCalendarEvents();
          } catch (e) {
            console.warn("[CB] getCalendarPermissionsAsync.then threw", String(e));
          }
        })
        .catch((e) => {
          logStartup("Calendar.getCalendarPermissionsAsync:rejected err=" + String(e));
          console.warn("[CB] getCalendarPermissionsAsync rejected", String(e));
        });
    } catch (e) {
      logStartup("Calendar.getCalendarPermissionsAsync:sync-threw err=" + String(e));
      console.warn("[CB] getCalendarPermissionsAsync sync threw", String(e));
    }
    // Destination history (Recents)
    AsyncStorage.getItem("@chargebridge/dest_history").then((v) => {
      if (!v) return;
      const all: DestHistoryEntry[] = JSON.parse(v);
      const cutoff = Date.now() - 30 * 24 * 3600 * 1000;
      setDestHistory(all.filter((e) => e.timestamp > cutoff));
    }).catch(() => {});
    // Saved places (Favorites)
    AsyncStorage.getItem("@chargebridge/saved_places").then((v) => {
      if (!v) return;
      setSavedPlaces(JSON.parse(v));
    }).catch(() => {});
    logStartup("startup:dispatched-all");
  }, []);

  // Persist grade filter preference
  useEffect(() => {
    if (isWeb) return;
    AsyncStorage.setItem("@chargebridge/show_best_only", showBestOnly ? "1" : "0").catch(() => {});
  }, [showBestOnly]);

  // ── Voice guidance ─────────────────────────────────────────────────────────
  useEffect(() => {
    voiceMutedRef.current = voiceMuted;
    if (!isWeb) AsyncStorage.setItem("@chargebridge/nav_voice_muted", voiceMuted ? "1" : "0").catch(() => {});
  }, [voiceMuted]);

  // navSpeak: serialized speech engine for turn-by-turn navigation.
  //
  // Design goals:
  //   1. No concurrent utterances — eliminates the primary garble source
  //   2. Non-forced calls queue (single slot, newest wins) so the current
  //      announcement finishes before the next one starts
  //   3. Forced calls (a3 near-turn) interrupt and clear the queue — these
  //      are always time-critical and must be heard immediately
  //   4. Fully synchronous state tracking via isSpeakingRef — replaces the
  //      old isSpeakingAsync() async check which had a TOCTOU race where two
  //      navSpeak calls on the same 500ms GPS tick both saw "not speaking"
  //      and both called Speech.speak(), causing iOS to queue/overlap them
  const navSpeak = useCallback((
    text: string,
    force = false,
    evidenceContext?: NavEvidenceA3Context,
  ) => {
    if (isWeb || voiceMutedRef.current) return;
    // "quiet" level only allows forced (final-approach) announcements
    if (!force && navVoiceLevelRef.current === "quiet") return;

    const _tSpeak = Date.now();
    const _capturedRouteVersion = routeVersionRef.current;
    const _capturedStepIdx = navVoiceTraceRef.current.stepIdx;
    const evidenceState = evidenceContext
      ? updateNavEvidenceCapture((state) => captureArmedA3(
          state,
          evidenceContext,
          _tSpeak,
          isNavigatingRef.current,
        ))
      : null;
    const evidenceCaptureToken = evidenceState?.record?.captureToken ?? null;
    const recordEvidenceTerminalOutcome = (outcome: "completed" | "stopped" | "error") => {
      if (evidenceCaptureToken == null) return;
      updateNavEvidenceCapture((state) => recordEvidenceTtsOutcome(
        state,
        evidenceCaptureToken,
        Date.now(),
        outcome,
      ));
    };
    const _navSpeakLine = buildNavSpeakLogLine(_tSpeak, force, _capturedRouteVersion, _capturedStepIdx, text);
    console.log(_navSpeakLine);

    // Record for the dev debug overlay — both forced and non-forced paths.
    navDebugLastSpeakRef.current = { text, timeMs: _tSpeak };

    // Expand nav pills on every announcement; auto-hide after 40 s
    setNavPillsVisible(true);
    navPillsVisibleRef.current = true;
    if (navPillsTimerRef.current) clearTimeout(navPillsTimerRef.current);
    navPillsTimerRef.current = setTimeout(() => {
      navPillsTimerRef.current = null;
      if (!isMountedRef.current) return;
      setNavPillsVisible(false);
      navPillsVisibleRef.current = false;
    }, 40000);

    // Watchdog helpers — arm before every Speech.speak(), clear in every terminal callback.
    // Guards against iOS TTS silently swallowing onDone (known expo-speech edge case on
    // audio-session interruptions), which would leave isSpeakingRef stuck true and cause
    // all subsequent non-forced announcements to queue forever and never play.
    const clearWatchdog = () => {
      if (isSpeakingWatchdogRef.current) {
        clearTimeout(isSpeakingWatchdogRef.current);
        isSpeakingWatchdogRef.current = null;
      }
    };
    const armWatchdog = () => {
      clearWatchdog();
      isSpeakingWatchdogRef.current = setTimeout(() => {
        isSpeakingWatchdogRef.current = null;
        isSpeakingRef.current = false;
        speakQueueRef.current = null;
      }, 20000);
    };

    // Build opts fresh each call so rate/pitch/voice/language changes apply immediately.
    // Voice ID is validated against the live availableVoicesRef before use — an
    // unrecognised identifier causes AVSpeechSynthesizer to throw an ObjC exception
    // that is NOT catchable by the JS try-catch, crashing the app under newArchEnabled.
    const makeOpts = (): Speech.SpeechOptions => {
      const rawId = navVoiceIdRef.current;
      const voices = availableVoicesRef.current;
      const safeId = rawId && voices.length > 0 && voices.some((v) => v.identifier === rawId)
        ? rawId
        : null;
      return ({
      language: navLanguageRef.current,
      rate: navVoiceRateRef.current,
      pitch: navVoicePitchRef.current,
      volume: navVoiceVolumeRef.current,
      ...(safeId ? { voice: safeId } : {}),
      onDone: () => {
        const _ttsOnDoneLine = `[NavVoice][TRACE] ttsOnDone elapsed=${Date.now() - _tSpeak}ms routeVersion=${_capturedRouteVersion} stepIdx=${_capturedStepIdx} stale=${routeVersionRef.current !== _capturedRouteVersion}`;
        console.log(_ttsOnDoneLine);
        navDebugTtsElapsedRef.current = Date.now() - _tSpeak;
        recordEvidenceTerminalOutcome("completed");
        clearWatchdog();
        isSpeakingRef.current = false;
        if (force) {
          // After a forced near-turn cue, discard any stale distance phrase that queued
          // during the settle window — playing "In 300 feet" AFTER "Turn right" is
          // backwards and confusing.
          speakQueueRef.current = null;
        } else {
          // Drain: play queued non-forced announcement if one arrived while we were speaking
          drainQueue();
        }
      },
      onStopped: () => { const _l = `[NavVoice][TRACE] TTS onStopped elapsed=${Date.now() - _tSpeak}ms routeVersion=${_capturedRouteVersion} stepIdx=${_capturedStepIdx}`; console.log(_l); recordEvidenceTerminalOutcome("stopped"); clearWatchdog(); isSpeakingRef.current = false; speakQueueRef.current = null; },
      onError:   () => { const _l = `[NavVoice][TRACE] TTS onError elapsed=${Date.now() - _tSpeak}ms routeVersion=${_capturedRouteVersion} stepIdx=${_capturedStepIdx}`; console.log(_l); recordEvidenceTerminalOutcome("error"); clearWatchdog(); isSpeakingRef.current = false; speakQueueRef.current = null; },
    });
    };

    // Drain helper — dispatches the next queued item (if any) with its own diagnostic
    // context, then calls itself recursively so every non-forced utterance plays in
    // order and each gets correct routeVersion/stepIdx/stale logs.
    const drainQueue = () => {
      const queued = speakQueueRef.current;
      speakQueueRef.current = null;
      if (!queued || !isNavigatingRef.current || voiceMutedRef.current) return;
      // Reject items queued for a route that has since been replaced — prevents
      // old-route "Turn left onto I-5" from playing after a reroute completes.
      if (routeVersionRef.current !== queued.routeVersion) {
        const _drainDropLine = `[NavVoice][TRACE] drainQueue dropped stale item routeVersion=${queued.routeVersion} current=${routeVersionRef.current} text="${queued.text.slice(0, 40)}"`;
        console.log(_drainDropLine);
        return;
      }
      isSpeakingRef.current = true;
      lastSpeakTimeRef.current = Date.now();
      armWatchdog();
      const _tQueueDispatch = Date.now();
      const _qRv = queued.routeVersion;
      const _qSi = queued.stepIdx;
      const _ttsQueuedLine = `[NavVoice][TRACE] ttsQueued dispatch routeVersion=${_qRv} stepIdx=${_qSi} queuedFor=${_tQueueDispatch - queued.tNavSpeak}ms t=${_tQueueDispatch}`;
      console.log(_ttsQueuedLine);
      const baseOpts = makeOpts();
      const qOpts: Speech.SpeechOptions = {
        ...baseOpts,
        onDone: () => {
          const _ttsOnDoneQLine = `[NavVoice][TRACE] ttsOnDone elapsed=${Date.now() - _tQueueDispatch}ms routeVersion=${_qRv} stepIdx=${_qSi} stale=${routeVersionRef.current !== _qRv}`;
          console.log(_ttsOnDoneQLine);
          clearWatchdog();
          isSpeakingRef.current = false;
          drainQueue(); // continue drain chain for any subsequent queued item
        },
        onStopped: () => { const _l = `[NavVoice][TRACE] TTS onStopped (queued) elapsed=${Date.now() - _tQueueDispatch}ms routeVersion=${_qRv} stepIdx=${_qSi}`; console.log(_l); clearWatchdog(); isSpeakingRef.current = false; speakQueueRef.current = null; },
        onError:   () => { const _l = `[NavVoice][TRACE] TTS onError (queued) elapsed=${Date.now() - _tQueueDispatch}ms routeVersion=${_qRv} stepIdx=${_qSi}`; console.log(_l); clearWatchdog(); isSpeakingRef.current = false; speakQueueRef.current = null; },
      };
      try { Speech.speak(queued.text, qOpts); } catch { isSpeakingRef.current = false; clearWatchdog(); }
    };

    if (force) {
      // Forced (a3 near-turn, rerouting, GPS-skip safety): always interrupt — never queue behind anything.
      // Delegates to scheduleForcedSpeak (utils/navSpeakScheduler.ts) which owns the
      // unconditional-stop + settle-delay contract so it can be unit-tested independently.
      speakQueueRef.current = null;
      if (speakTimerRef.current) { clearTimeout(speakTimerRef.current); speakTimerRef.current = null; }
      lastSpeakTimeRef.current = Date.now();
      let _settleMs = 0; // set inside the callback after scheduleForcedSpeak runs
      const { settleMs: _sm, timerId: _forcedTimerId } = scheduleForcedSpeak(
        text,
        _capturedRouteVersion,
        { isSpeaking: isSpeakingRef, routeVersion: routeVersionRef, isNavigating: isNavigatingRef, voiceMuted: voiceMutedRef },
        {
          clearWatchdog,
          armWatchdog,
          stop: () => { Speech.stop(); },
          speak: (t, opts) => {
            const _tSpeakForced = Date.now();
            navVoiceTraceRef.current.tSpeak = _tSpeakForced;
            const _speakForcedLine = `[NavVoice][TRACE] Speech.speak(forced) t=${_tSpeakForced} since_navSpeak=${_tSpeakForced - _tSpeak}ms settle=${_settleMs}ms routeVersion=${_capturedRouteVersion} stepIdx=${_capturedStepIdx}`;
            console.log(_speakForcedLine);
            navDebugSinceNavSpeakRef.current = _tSpeakForced - _tSpeak;
            try {
              Speech.speak(t, opts as Speech.SpeechOptions);
              if (evidenceCaptureToken != null) {
                updateNavEvidenceCapture((state) => recordEvidenceTtsDispatch(
                  state,
                  evidenceCaptureToken,
                  _tSpeakForced,
                ));
              }
            } catch (error) {
              recordEvidenceTerminalOutcome("error");
              throw error;
            }
          },
          makeOpts,
          onTimerFired: () => { speakTimerRef.current = null; },
        },
      );
      _settleMs = _sm;
      speakTimerRef.current = _forcedTimerId;
    } else {
      // Non-forced (a1 early, a2 mid, startup cue): never interrupt a playing announcement.
      if (isSpeakingRef.current || speakTimerRef.current) {
        // Already speaking or a forced speak is pending — queue this, replacing any stale item
        speakQueueRef.current = { text, routeVersion: _capturedRouteVersion, stepIdx: _capturedStepIdx, tNavSpeak: _tSpeak };
        const _nsQueuedLine = `[NavVoice][TRACE] navSpeak queued routeVersion=${_capturedRouteVersion} stepIdx=${_capturedStepIdx} (speaking=${isSpeakingRef.current}) t=${Date.now()}`;
        console.log(_nsQueuedLine);
      } else {
        lastSpeakTimeRef.current = Date.now();
        isSpeakingRef.current = true;
        armWatchdog();
        const _tSpeakNonForced = Date.now();
        navVoiceTraceRef.current.tSpeak = _tSpeakNonForced;
        const _speakNFLine = `[NavVoice][TRACE] Speech.speak(non-forced) t=${_tSpeakNonForced} since_navSpeak=${_tSpeakNonForced - _tSpeak}ms routeVersion=${_capturedRouteVersion} stepIdx=${_capturedStepIdx}`;
        navDebugSinceNavSpeakRef.current = _tSpeakNonForced - _tSpeak;
        console.log(_speakNFLine);
        try { Speech.speak(text, makeOpts()); } catch { isSpeakingRef.current = false; clearWatchdog(); }
      }
    }
  }, []);

  // resetRouteRefs: single helper called by all three reroute branches (wrong-dir,
  // off-route, missed-turn) so the reset logic cannot silently diverge.
  // Increments routeVersionRef so any voice announcement queued for the old route
  // is rejected by the drainQueue stale-version guard.
  const resetRouteRefs = useCallback((primary: RouteResult) => {
    routeVersionRef.current += 1;
    const _rerouteCompleteLine = `[NavRoute][TRACE] reroute_complete routeVersion=${routeVersionRef.current} steps=${primary.steps.length} first="${primary.steps[1]?.instruction?.slice(0, 60) ?? ""}"`;
    console.log(_rerouteCompleteLine);
    routeCoordRef.current = primary.coordinates;
    routeStepsRef.current = primary.steps;
    setAllRoutes([primary]);
    setCurrentStepIdx(0);
    voiceAnnouncedRef.current = {};
    offRouteCountRef.current = 0;
    wrongDirCountRef.current = 0;
    prevProgressIdxRef.current = 0;
    missedTurnRef.current = null;
    if (navState.isActive) {
      navState.steps = primary.steps.map((s) => ({
        instruction: s.instruction,
        featherIcon: s.featherIcon,
        coordinate: s.coordinate,
      }));
      navState.currentStepIdx = 0;
      // Reset so the foreground dedup sync on the next background→active
      // transition does not suppress voice guidance for the new route's steps.
      navState.lastNotifiedStepIdx = -1;
      navState.notifiedStepIndices = new Set();
      // Sync route polyline so background off-route detection uses the
      // updated geometry after a reroute.  Counter reset prevents the stale
      // streak from immediately triggering a second reroute on the new route.
      navState.routeCoords      = primary.coordinates;
      navState.offRouteCount    = 0;
      navState.offRouteStartMs  = 0;
      navState.offRouteDetected = false;
    }
  }, []);

  // Arrival announcement (forced — always plays)
  useEffect(() => {
    if (isWeb) return;
    if (!arrived || voiceMutedRef.current) return;
    lastSpeakTimeRef.current = Date.now();
    // Validate voice ID the same way makeOpts() does in navSpeak — an unrecognised
    // AVSpeechSynthesisVoice identifier throws an uncatchable ObjC exception under
    // newArchEnabled:true and kills the process.
    const rawArrId = navVoiceIdRef.current;
    const arrVoices = availableVoicesRef.current;
    const safeArrId = rawArrId && arrVoices.length > 0 && arrVoices.some((v) => v.identifier === rawArrId)
      ? rawArrId : null;
    const opts: Speech.SpeechOptions = {
      language: navLanguageRef.current,
      rate: navVoiceRateRef.current,
      pitch: navVoicePitchRef.current,
      volume: navVoiceVolumeRef.current,
      ...(safeArrId ? { voice: safeArrId } : {}),
      onDone: () => { isSpeakingRef.current = false; speakQueueRef.current = null; },
      onStopped: () => { isSpeakingRef.current = false; speakQueueRef.current = null; },
      onError: () => { isSpeakingRef.current = false; speakQueueRef.current = null; },
    };
    speakQueueRef.current = null;
    if (speakTimerRef.current) { clearTimeout(speakTimerRef.current); speakTimerRef.current = null; }
    try { Speech.stop(); } catch {}
    isSpeakingRef.current = false;
    const timer = setTimeout(() => {
      isSpeakingRef.current = true;
      try { Speech.speak("You have arrived at your destination.", opts); } catch { isSpeakingRef.current = false; }
    }, 250);
    return () => clearTimeout(timer);
  }, [arrived]);

  useEffect(() => () => {
    if (!isWeb) { try { Speech.stop(); } catch {} }
    isSpeakingRef.current = false;
    speakQueueRef.current = null;
  }, []);

  // Keep ref in sync so faster-route poller can compare without stale closure
  useEffect(() => {
    const d = allRoutes[0]?.durationMin;
    if (d != null) currentRouteDurationRef.current = d;
  }, [allRoutes]);

  // ── Load cached location from storage and request GPS on mount ───────────
  useEffect(() => {
    if (isWeb) return;
    AsyncStorage.getItem("@chargebridge/last_location").then((val) => {
      if (val && !userLocRef.current) {
        try {
          const { latitude, longitude } = JSON.parse(val) as { latitude: number; longitude: number };
          setCachedRegion({ latitude, longitude, latitudeDelta: 0.06, longitudeDelta: 0.06 });
        } catch {}
      }
    }).catch(() => {});
    getLocation();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useFocusEffect(
    useCallback(() => {
      track("screen_viewed", { screen_name: "map" });
    }, []),
  );

  // ── "Best for Me" one-tap activation from dashboard ──────────────────────
  useFocusEffect(
    useCallback(() => {
      AsyncStorage.getItem("@chargebridge/activate_best_for_me").then((flag) => {
        if (flag === "1") {
          setBestForMeActive(true);
          setSheetSnapIdx(1); // PARTIAL
          AsyncStorage.removeItem("@chargebridge/activate_best_for_me");
        }
      });
    }, []),
  );

  // ── Auto-center on current location whenever this tab gains focus ─────────
  useFocusEffect(
    useCallback(() => {
      if (isWeb) return;
      if (userLocRef.current) {
        // Already have a location — just re-center the map smoothly
        mapRef.current?.animateToRegion(
          { ...userLocRef.current, latitudeDelta: 0.06, longitudeDelta: 0.06 },
          600
        );
        fetchNearby(userLocRef.current, true);
      } else {
        // No location yet — fetch it (also centers + loads stations)
        getLocation();
      }
    }, [getLocation, fetchNearby])
  );

  // ── Destination search (debounced) ───────────────────────────────────────
  const handleDestSearch = useCallback((text: string) => {
    setDestQuery(text);
    setSearchNoResults(false);
    if (text.length < 2) {
      setSearchResults([]);
      setSearchBusy(false);
      if (debounceRef.current) clearTimeout(debounceRef.current);
      return;
    }
    setSearchBusy(true);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      try {
        const results = await searchAddress(
          text,
          userLoc?.latitude,
          userLoc?.longitude
        );
        setSearchResults(results);
        setSearchNoResults(results.length === 0);
      } catch {
        setSearchNoResults(true);
      } finally {
        setSearchBusy(false);
      }
    }, 400);
  }, [userLoc]);

  // ── Origin search (debounced) — for custom FROM address ────────────────────
  const handleOriginSearch = useCallback((text: string) => {
    setOriginQuery(text);
    setOriginNoResults(false);
    if (!text) {
      setCustomOrigin(null);
      setCustomOriginLabel("");
    }
    if (text.length < 2) {
      setOriginResults([]);
      setOriginBusy(false);
      if (originDebounceRef.current) clearTimeout(originDebounceRef.current);
      return;
    }
    setOriginBusy(true);
    if (originDebounceRef.current) clearTimeout(originDebounceRef.current);
    originDebounceRef.current = setTimeout(async () => {
      try {
        const results = await searchAddress(
          text,
          userLoc?.latitude,
          userLoc?.longitude
        );
        setOriginResults(results);
        setOriginNoResults(results.length === 0);
      } catch {
        setOriginNoResults(true);
      } finally {
        setOriginBusy(false);
      }
    }, 400);
  }, [userLoc]);

  // ── Select a custom origin from results ────────────────────────────────────
  const selectOrigin = useCallback((result: NominatimResult) => {
    const loc: LatLng = {
      latitude: parseFloat(result.lat),
      longitude: parseFloat(result.lon),
    };
    const label = (result.display_name ?? "").split(",").slice(0, 2).join(", ");
    setCustomOrigin(loc);
    setCustomOriginLabel(label);
    setOriginQuery(label);
    setOriginResults([]);
    setOriginNoResults(false);
    // Move focus to destination field
    setActiveSearchField("to");
    Haptics.selectionAsync();
  }, []);

  // ── Calendar: load upcoming events with locations ─────────────────────────
  const loadCalendarEvents = useCallback(async () => {
    try {
      const { status } = await Calendar.requestCalendarPermissionsAsync();
      setCalPermission(status === "granted" ? "granted" : "denied");
      if (status !== "granted") return;
      const cals = await Calendar.getCalendarsAsync(Calendar.EntityTypes.EVENT);
      const now = new Date();
      const weekOut = new Date(now.getTime() + 7 * 24 * 3600 * 1000);
      const raw = await Calendar.getEventsAsync(cals.map((c) => c.id), now, weekOut);
      setCalendarEvents(
        raw
          .filter((e) => e.location && e.location.trim().length > 3)
          .sort((a, b) => +new Date(a.startDate) - +new Date(b.startDate))
          .slice(0, 5)
          .map((e) => ({
            id: e.id,
            title: e.title || "Untitled",
            location: e.location!.trim(),
            startDate: new Date(e.startDate),
          }))
      );
    } catch {}
  }, []);

  // ── Core routing engine — called from search results AND popup "Navigate" ────
  const startNavigationTo = useCallback(
    async (destLoc: LatLng, label: string) => {
      setSelectedEv(null);
      setSelectedGas(null);
      setDest(destLoc);
      setDestLabel(label);
      setDestQuery(label);
      setRouteError(null);
      setAllRoutes([]);
      setAltRoutes([]);
      setActiveRouteIdx(0);
      setCurrentStepIdx(0);
      setArrived(false);
      routeCoordRef.current = [];
      hasRouteRef.current = false;

      let origin: LatLng | null = customOrigin ?? userLoc ?? null;
      if (!origin) {
        // Auto-request location before showing the error — covers the common
        // case where the user taps "Navigate" from a station card or photo
        // before the app has obtained location permission.
        if (!isWeb) {
          try {
            const { status } = await Location.requestForegroundPermissionsAsync();
            if (status === "granted") {
              const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
              origin = { latitude: pos.coords.latitude, longitude: pos.coords.longitude };
              setUserLoc(origin);
              userLocRef.current = origin;
            }
          } catch {}
        }
        if (!origin) {
          setRouteError("Turn on location or enter a starting address to get directions.");
          return;
        }
      }

      if (navMode === "transit") {
        // Show the in-app transit panel; user taps "Get Transit Directions" to open Maps
        setShowTransitPanel(true);
        return;
      }

      setRouteLoading(true);
      setEvStations([]);
      setGasStations([]);

      const result = await fetchRoute(origin, destLoc, navMode);
      setRouteLoading(false);

      if (!result) {
        setRouteError("Couldn't calculate route — check your connection and try again.");
        return;
      }

      const primary: RouteResult = {
        coordinates: result.coordinates,
        distanceKm: result.distanceKm,
        durationMin: result.durationMin,
        steps: result.steps,
      };
      const altAsResults: RouteResult[] = result.altRoutes.map(
        (a) => ({ ...a, steps: [] })
      );
      setAllRoutes([primary, ...altAsResults]);
      setAltRoutes(result.altRoutes);
      setActiveRouteIdx(0);
      routeStepsRef.current = primary.steps;

      mapRef.current?.fitToCoordinates(result.coordinates, {
        edgePadding: { top: 160, bottom: 240, left: 50, right: 50 },
        animated: true,
      });

      routeCoordRef.current = result.coordinates;
      hasRouteRef.current = true;

      setStationsBusy(true);
      try {
        const { ev, gas } = await fetchStationsAlongRoute(result.coordinates);
        setEvStations(ev);
        setGasStations(gas);
        setLastRefreshed(new Date());
      } catch {} finally {
        setStationsBusy(false);
      }
    },
    [userLoc, navMode, customOrigin]
  );

  // ── Calendar: geocode an event's location and start navigation ─────────────
  const geocodeAndNavigate = useCallback(async (evt: CalEvt) => {
    if (geocodingEventId) return;
    setGeocodingEventId(evt.id);
    Haptics.selectionAsync();
    try {
      const results = await searchAddress(evt.location, userLoc?.latitude, userLoc?.longitude);
      if (!results.length) {
        Alert.alert(
          "Location not found",
          `"${evt.location}" couldn't be found on the map. Try editing the event's location in your calendar.`
        );
        return;
      }
      const r = results[0];
      const loc: LatLng = { latitude: parseFloat(r.lat), longitude: parseFloat(r.lon) };
      const label = `${evt.title} — ${(r.display_name ?? "").split(",").slice(0, 2).join(", ")}`;
      await startNavigationTo(loc, label);
      setSearchOpen(false);
      Keyboard.dismiss();
    } catch {
      Alert.alert("Error", "Could not look up this address. Please try again.");
    } finally {
      setGeocodingEventId(null);
    }
  }, [geocodingEventId, userLoc, startNavigationTo]);

  // ── Consume in-app navigation intent (from "Get Directions" in other screens) ─
  useFocusEffect(
    useCallback(() => {
      if (isWeb) return;
      const pending = consumeNavigationIntent();
      if (pending) {
        startNavigationTo(
          { latitude: pending.lat, longitude: pending.lng },
          pending.label
        ).catch(() => {});
      }
    }, [startNavigationTo])
  );

  // ── Select any route by its index in allRoutes (0 = primary, 1+ = alts) ──
  const selectRoute = useCallback(
    (idx: number) => {
      if (idx < 0 || idx >= allRoutes.length) return;
      const target = allRoutes[idx];

      setActiveRouteIdx(idx);
      setCurrentStepIdx(0);
      routeCoordRef.current = target.coordinates;
      routeStepsRef.current = target.steps;
      hasRouteRef.current = true;
      // Sync navState so the background task evaluates the newly selected route
      // geometry.  If the user selects an alt route while the app backgrounds,
      // the background off-route detection must use this polyline — not the
      // previously active one.  Reset the counter and any pending signal so a
      // stale off-route streak from the old route does not immediately reroute
      // on the new route.
      navState.routeCoords      = target.coordinates;
      navState.offRouteCount    = 0;
      navState.offRouteStartMs  = 0;
      navState.offRouteDetected = false;
      Haptics.selectionAsync();
      mapRef.current?.fitToCoordinates(target.coordinates, {
        edgePadding: { top: 160, bottom: 240, left: 50, right: 50 },
        animated: true,
      });

      // Fetch full step data for any route that only has geometry (no steps yet)
      if (target.steps.length === 0 && userLoc && dest) {
        const mode = (navMode === "transit" ? "driving" : navMode) as
          | "driving"
          | "walking"
          | "cycling";
        fetchAllRoutes(userLoc, dest, mode).then((allR) => {
          if (!allR.length) return;
          // Merge fetched step data into allRoutes without changing the order
          setAllRoutes((prev) => prev.map((r, i) => allR[i] ?? r));
          const fetched = allR[idx] ?? allR[0];
          if (!fetched) return;
          routeStepsRef.current = fetched.steps;
          routeCoordRef.current = fetched.coordinates;
          // Deferred fetch resolved — keep navState in sync so background
          // detection does not evaluate the placeholder stub geometry.
          navState.routeCoords = fetched.coordinates;
        });
      }
    },
    [allRoutes, userLoc, dest, navMode]
  );

  // Alias kept so map-polyline onPress can still use the old name internally
  const selectAltRoute = useCallback(
    (altIdx: number) => selectRoute(altIdx + 1),
    [selectRoute]
  );

  // ── Recalculate when user changes transport mode ───────────────────────────
  const destRef = useRef<{ loc: LatLng; label: string } | null>(null);
  useEffect(() => {
    if (dest && destLabel) destRef.current = { loc: dest, label: destLabel };
    else destRef.current = null;
  }, [dest, destLabel]);

  useEffect(() => {
    if (destRef.current && userLoc) {
      startNavigationTo(destRef.current.loc, destRef.current.label).catch(() => {});
    }
    // Only fire when navMode changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navMode]);

  // ── Destination history helpers ───────────────────────────────────────────
  const addToHistory = useCallback((label: string, lat: number, lng: number) => {
    setDestHistory((prev) => {
      const cutoff = Date.now() - 30 * 24 * 3600 * 1000;
      const deduped = prev.filter(
        (e) => e.timestamp > cutoff && !(Math.abs(e.lat - lat) < 0.0005 && Math.abs(e.lng - lng) < 0.0005)
      );
      const next = [
        { id: `h-${Date.now()}`, label, lat, lng, timestamp: Date.now() },
        ...deduped,
      ].slice(0, 20);
      AsyncStorage.setItem("@chargebridge/dest_history", JSON.stringify(next)).catch(() => {});
      return next;
    });
  }, []);

  const savePlace = useCallback((name: string, label: string, lat: number, lng: number, existingId?: string) => {
    setSavedPlaces((prev) => {
      const filtered = existingId ? prev.filter((p) => p.id !== existingId) : prev;
      const next = [{ id: existingId ?? `sp-${Date.now()}`, name, label, lat, lng }, ...filtered];
      AsyncStorage.setItem("@chargebridge/saved_places", JSON.stringify(next)).catch(() => {});
      return next;
    });
  }, []);

  const removeSavedPlace = useCallback((id: string) => {
    setSavedPlaces((prev) => {
      const next = prev.filter((p) => p.id !== id);
      AsyncStorage.setItem("@chargebridge/saved_places", JSON.stringify(next)).catch(() => {});
      return next;
    });
  }, []);

  const navigateToLatLng = useCallback(async (lat: number, lng: number, label: string) => {
    setSearchOpen(false);
    Keyboard.dismiss();
    addToHistory(label, lat, lng);
    try { await startNavigationTo({ latitude: lat, longitude: lng }, label); } catch {}
  }, [startNavigationTo, addToHistory]);

  const selectDestination = useCallback(
    async (result: NominatimResult) => {
      Keyboard.dismiss();
      const lat = parseFloat(result.lat);
      const lng = parseFloat(result.lon);
      const label = (result.display_name ?? "").split(",").slice(0, 2).join(", ");
      addToHistory(label, lat, lng);
      setSearchResults([]);
      setSearchNoResults(false);
      setSearchOpen(false);
      try { await startNavigationTo({ latitude: lat, longitude: lng }, label); } catch {}
    },
    [startNavigationTo, addToHistory]
  );

  // ── Reload pins when map is panned (non-route mode) ───────────────────────
  const onRegionChangeComplete = useCallback(
    (region: { latitude: number; longitude: number }) => {
      if (hasRouteRef.current) return;
      if (regionChangeTimer.current) clearTimeout(regionChangeTimer.current);
      regionChangeTimer.current = setTimeout(() => {
        fetchNearby({ latitude: region.latitude, longitude: region.longitude }, true);
      }, 800);
    },
    [fetchNearby]
  );

  const clearRoute = useCallback(() => {
    // ── Navigation resource teardown ────────────────────────────────────────
    // Must run even when called from the arrived-overlay "Done" button,
    // because arrival only stops the GPS watch — not timers/subscriptions.
    locWatchRef.current?.remove();
    locWatchRef.current = null;
    appStateSubRef.current?.remove();
    appStateSubRef.current = null;
    isNavigatingRef.current = false;
    isRecalculatingRef.current = false;
    wakeNavRef.current = null;
    navPositionHandlerRef.current = null;
    navWatchOptsRef.current = null;
    wrongDirCountRef.current = 0;
    prevProgressIdxRef.current = -1;
    missedTurnRef.current = null;
    recalcCheckRef.current = null;
    if (postAdvanceSpeakTimerRef.current) { clearTimeout(postAdvanceSpeakTimerRef.current); postAdvanceSpeakTimerRef.current = null; }
    navState.isActive = false;
    if (fasterRouteTimerRef.current) { clearInterval(fasterRouteTimerRef.current); fasterRouteTimerRef.current = null; }
    if (recalcAltTimerRef.current) { clearTimeout(recalcAltTimerRef.current); recalcAltTimerRef.current = null; }
    if (recalcBannerTimerRef.current) { clearTimeout(recalcBannerTimerRef.current); recalcBannerTimerRef.current = null; }
    if (speakTimerRef.current) { clearTimeout(speakTimerRef.current); speakTimerRef.current = null; }
    if (isSpeakingWatchdogRef.current) { clearTimeout(isSpeakingWatchdogRef.current); isSpeakingWatchdogRef.current = null; }
    try { Speech.stop(); } catch {}
    isSpeakingRef.current = false;
    speakQueueRef.current = null;
    setAudioModeAsync({ shouldPlayInBackground: false, playsInSilentMode: false, allowsRecording: false }).catch(() => {});
    cancelNavNotifications().catch(() => {});
    // Stop background location task inline (stopBgLocationTask is declared later)
    if (!isWeb) {
      Location.hasStartedLocationUpdatesAsync(BACKGROUND_NAV_TASK)
        .then((running) => { if (running) Location.stopLocationUpdatesAsync(BACKGROUND_NAV_TASK).catch(() => {}); })
        .catch(() => {});
    }
    // ── UI state reset ──────────────────────────────────────────────────────
    setIsNavigating(false);
    setIs3D(false);
    setArrived(false);
    setFasterRoute(null);
    setRecalcAltVisible(false);
    setCurrentSpeedMph(null);
    setIsRecalculating(false);
    setRecalcBannerVisible(false);
    setDest(null);
    setDestLabel("");
    setDestQuery("");
    setAllRoutes([]);
    setAltRoutes([]);
    setActiveRouteIdx(0);
    setCurrentStepIdx(0);
    setShowStepList(false);
    setRouteError(null);
    setEvStations([]);
    setGasStations([]);
    setSelectedEv(null);
    setSelectedGas(null);
    setCustomOrigin(null);
    setCustomOriginLabel("");
    setOriginQuery("");
    setOriginResults([]);
    routeStepsRef.current = [];
    hasRouteRef.current = false;
    routeCoordRef.current = [];
    voiceAnnouncedRef.current = {};
    offRouteCountRef.current = 0;
    offRouteStartMsRef.current = 0;
    if (userLoc) {
      mapRef.current?.animateCamera({ pitch: 0 }, { duration: 400 });
      mapRef.current?.animateToRegion(
        { ...userLoc, latitudeDelta: 0.06, longitudeDelta: 0.06 },
        600
      );
      fetchNearby(userLoc, false);
    }
  }, [userLoc, fetchNearby]);

  const handleStartTrip = useCallback((allCoords: LatLng[], waypoints: TripWaypoint[], legs: TripLeg[]) => {
    setTripWaypoints(waypoints);
    setTripLegs(legs);
    const combined: RouteResult = {
      coordinates: allCoords,
      distanceKm: legs.reduce((s, l) => s + l.distanceKm, 0),
      durationMin: legs.reduce((s, l) => s + l.durationMin, 0),
      steps: [],
    };
    setAllRoutes([combined]);
    setAltRoutes([]);
    setActiveRouteIdx(0);
    const lastWp = waypoints[waypoints.length - 1];
    setDest(lastWp.loc);
    setDestLabel(lastWp.label);
    routeCoordRef.current = allCoords;
    hasRouteRef.current = true;
    setEvStations([]);
    setGasStations([]);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setTimeout(() => {
      mapRef.current?.fitToCoordinates(allCoords, {
        edgePadding: { top: 160, bottom: 240, left: 50, right: 50 },
        animated: true,
      });
    }, 300);
  }, []);

  // ── Navigation mode (camera follows user, step-by-step, arrival detect) ─────
  const appStateSubRef = useRef<ReturnType<typeof AppState.addEventListener> | null>(null);
  const isNavigatingRef = useRef(false);

  const startBgLocationTask = useCallback(async () => {
    if (isWeb) return;
    try {
      const alreadyRunning = await Location.hasStartedLocationUpdatesAsync(BACKGROUND_NAV_TASK).catch(() => false);
      if (!alreadyRunning) {
        await Location.startLocationUpdatesAsync(BACKGROUND_NAV_TASK, {
          accuracy: Location.Accuracy.BestForNavigation,
          timeInterval: 3000,
          distanceInterval: 10,
          foregroundService: {
            notificationTitle: "ChargeBridge Navigation",
            notificationBody: "Turn-by-turn directions are active.",
            notificationColor: "#0D9E7E",
          },
          pausesUpdatesAutomatically: false,
          showsBackgroundLocationIndicator: true,
        });
      }
    } catch {
      // Background location may be unavailable (simulator, web) — ignore
    }
  }, []);

  const stopBgLocationTask = useCallback(async () => {
    if (isWeb) return;
    try {
      const running = await Location.hasStartedLocationUpdatesAsync(BACKGROUND_NAV_TASK).catch(() => false);
      if (running) {
        await Location.stopLocationUpdatesAsync(BACKGROUND_NAV_TASK);
      }
    } catch {}
  }, []);

  const startNavigation = useCallback(async () => {
    if (!dest) return;
    const isWalking = navModeRef.current === "walking";
    const isCycling = navModeRef.current === "cycling";

    // Always tear down any existing GPS watch/subscription before starting a
    // fresh session.  Prevents a double-watch crash when the user switches
    // travel mode (walking → cycling, etc.) while navigation is already active:
    // without this, two _posHandler closures run in parallel and race on state.
    locWatchRef.current?.remove();
    locWatchRef.current = null;
    // appStateSubRef is cleaned up and immediately re-assigned a few lines below
    // via AppState.addEventListener — do NOT null it here or TS narrows .current
    // to null for the rest of the function (causes "remove on never" error).
    appStateSubRef.current?.remove();
    wakeNavRef.current = null;
    navPositionHandlerRef.current = null;
    isRecalculatingRef.current = false;
    wrongDirCountRef.current = 0;
    prevProgressIdxRef.current = -1;
    missedTurnRef.current = null;
    recalcCheckRef.current = null;
    if (postAdvanceSpeakTimerRef.current) { clearTimeout(postAdvanceSpeakTimerRef.current); postAdvanceSpeakTimerRef.current = null; }

    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    // Keep the audio session alive in background so expo-speech continues to
    // fire turn-by-turn instructions even when the user switches to another app.
    // UIBackgroundModes:audio in app.json + staysActiveInBackground here tells
    // iOS to keep the JS thread (and AVAudioSession) running while backgrounded.
    //
    // IMPORTANT: do NOT await this call. Awaiting setAudioModeAsync locks the
    // AVAudioSession into expo-audio's .playback category BEFORE AVSpeechSynthesizer
    // runs. iOS serialises audio-session ownership, so the synthesiser silently
    // produces no audio when the session is held by expo-audio. Fire-and-forget lets
    // Speech.speak fire first (using the default session) while expo-audio configures
    // background/silent-mode settings in parallel — no session conflict, full audio.
    setAudioModeAsync({
      shouldPlayInBackground: true,
      playsInSilentMode: true,   // voice fires even on ring/silent switch
      allowsRecording: false,
    }).catch(() => {});
    setIsNavigating(true);
    isNavigatingRef.current = true;
    resetEvidenceCaptureSession();

    setIs3D(!isWalking && !isCycling);  // walking/cycling stay top-down; driving uses 3D
    setCurrentStepIdx(0);
    setArrived(false);
    voiceAnnouncedRef.current = {};
    offRouteCountRef.current = 0;
    offRouteStartMsRef.current = 0;
    destNearRef.current = false;
    evArrivalRef.current = false;
    startupCueSpokenRef.current = false;
    setDestNear(false);
    setEvArrivalVisible(false);
    // Capture the destination EV station snapshot for the Arrival Card
    navDestEvRef.current = selectedEv;
    setPillVisible(false);
    pillVisibleRef.current = false;
    if (pillTimerRef.current) { clearTimeout(pillTimerRef.current); pillTimerRef.current = null; }
    if (navPillsTimerRef.current) { clearTimeout(navPillsTimerRef.current); navPillsTimerRef.current = null; }
    setNavPillsVisible(false);
    navPillsVisibleRef.current = false;
    if (speakTimerRef.current) { clearTimeout(speakTimerRef.current); speakTimerRef.current = null; }
    if (isSpeakingWatchdogRef.current) { clearTimeout(isSpeakingWatchdogRef.current); isSpeakingWatchdogRef.current = null; }
    isSpeakingRef.current = false;
    speakQueueRef.current = null;

    // Populate shared singleton so background task can read nav state
    navState.isActive = true;
    navState.steps = routeStepsRef.current.map((s) => ({
      instruction: s.instruction,
      featherIcon: s.featherIcon,
      coordinate: s.coordinate,
    }));
    navState.currentStepIdx = 0;
    navState.destLatitude = dest.latitude;
    navState.destLongitude = dest.longitude;
    navState.destLabel = destLabel;
    navState.lastNotifiedStepIdx = -1;
    navState.notifiedStepIndices = new Set();
    // Background off-route detection state — reset on every nav start so
    // counters from a previous session do not carry over.
    navState.routeCoords = routeCoordRef.current;
    navState.travelMode =
      navModeRef.current === "walking" ? "walking"
      : navModeRef.current === "cycling" ? "cycling"
      : "driving";
    navState.offRouteCount    = 0;
    navState.offRouteStartMs  = 0;
    navState.lastBgOffRouteMs = 0;
    navState.offRouteDetected = false;

    // Request notification permission (non-blocking; fires once per session)
    requestNavNotifPermissions().catch(() => {});

    // Faster-route polling: background-check every 90 s for savings ≥ 2 min (driving only)
    if (!isWeb && navModeRef.current !== "walking" && navModeRef.current !== "cycling") {
      if (fasterRouteTimerRef.current) clearInterval(fasterRouteTimerRef.current);
      fasterRouteTimerRef.current = setInterval(() => {
        if (!isNavigatingRef.current || isRecalculatingRef.current || !userLocRef.current) return;
        fetchRoute(userLocRef.current, { latitude: dest.latitude, longitude: dest.longitude }, "driving", true)
          .then((r) => {
            if (!r || !isNavigatingRef.current || !isMountedRef.current) return;
            const savesMin = Math.round(currentRouteDurationRef.current - r.durationMin);
            if (savesMin >= 2) setFasterRoute({ result: r, savesMin });
          }).catch(() => {});
      }, 90000);
    }

    // AppState subscription: switch between foreground watch ↔ background task
    appStateSubRef.current?.remove();
    appStateSubRef.current = AppState.addEventListener("change", (next: AppStateStatus) => {
      try {
        if (!isNavigatingRef.current) return;
        if (next === "background" || next === "inactive") {
          startBgLocationTask();
        } else if (next === "active") {
          stopBgLocationTask();
          // Advance the generation counter BEFORE the sync so that any
          // showTurnNotification().then() callbacks that fire after this point
          // see a mismatched generation and do not add stale indices to
          // notifiedStepIndices.  This makes the one-time sync below atomic:
          // exactly the steps confirmed before this transition are stamped.
          navState.activeGeneration += 1;
          cancelNavNotifications().catch(() => {});
          // Sync background-notified steps into the foreground voice dedup ref
          // so the GPS handler does not re-announce a turn the background push
          // already played while the app was backgrounded.
          syncBgNotifiedIntoVoiceAnnounced(navState.notifiedStepIndices, voiceAnnouncedRef);
          // Consume background off-route signal exactly once.  Prefer the
          // background task's freshest location (navState.lastBgLoc) over the
          // potentially stale foreground ref (userLocRef) — iOS may have
          // suspended the foreground GPS watch while backgrounded, so
          // userLocRef can be null or hold an old fix.
          //
          // If BOTH are null (app was just launched cold), leave the signal set
          // (offRouteDetected = true) so the GPS handler's first foreground fix
          // consumes it immediately, bypassing the normal offCount accumulation.
          if (!isRecalculatingRef.current) {
            const _rerouteLoc = navState.lastBgLoc ?? userLocRef.current;
            if (_rerouteLoc) {
              consumeBgOffRoute(navState, () => {
                offRouteCountRef.current    = 0;
                offRouteStartMsRef.current  = 0;
                lastRecalcTimeRef.current   = Date.now();
                isRecalculatingRef.current  = true;
                setIsRecalculating(true);
                setRecalcBannerVisible(true);
                const _bgMode =
                  navModeRef.current === "walking" ? "walking"
                  : navModeRef.current === "cycling" ? "cycling"
                  : "driving";
                console.log(`[NavRoute][TRACE] bg_offroute_reroute_start loc=${JSON.stringify(_rerouteLoc)}`);
                fetchAllRoutes(_rerouteLoc, { latitude: dest.latitude, longitude: dest.longitude }, _bgMode, true)
                  .then((results) => {
                    try {
                      const [primary] = results;
                      if (!primary || !isNavigatingRef.current || !isMountedRef.current) return;
                      resetRouteRefs(primary);
                      navSpeak("Rerouting", true);
                    } catch {}
                  })
                  .catch(() => {})
                  .finally(() => {
                    isRecalculatingRef.current = false;
                    if (!isMountedRef.current) return;
                    setIsRecalculating(false);
                    if (recalcBannerTimerRef.current) clearTimeout(recalcBannerTimerRef.current);
                    recalcBannerTimerRef.current = setTimeout(() => {
                      recalcBannerTimerRef.current = null;
                      if (isMountedRef.current) setRecalcBannerVisible(false);
                    }, 2000);
                  });
              });
              // else: no location available — offRouteDetected stays true;
              // the GPS handler consumes it on the first foreground fix.
            }
          }
          // iOS may have suspended or killed the foreground GPS watch while the
          // app was backgrounded. Restart it immediately so turn-by-turn guidance
          // and camera tracking resume from the user's current position.
          wakeNavRef.current?.();
        }
      } catch {}
    });

    // Immediately snap to the best available position before the continuous watch fires
    // its first update. This ensures the route tracks from the device's true current
    // location (not a stale cached fix) the moment navigation begins.
    try {
      const _snapPos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.BestForNavigation });
      if (isMountedRef.current && isNavigatingRef.current) {
        const _snapLoc: LatLng = { latitude: _snapPos.coords.latitude, longitude: _snapPos.coords.longitude };
        setUserLoc(_snapLoc);
        userLocRef.current = _snapLoc;
        updateCarPlayLocation(_snapLoc);
      }
    } catch {}

    const _watchOpts = {
      accuracy: Location.Accuracy.BestForNavigation,
      // timeInterval: 0 tells iOS to deliver GPS fixes as fast as the hardware
      // can (sensor-fused ~1 Hz for BestForNavigation, no artificial throttle).
      // Walking/cycling get a modest floor so the JS thread isn't flooded.
      timeInterval: isWalking ? 500 : isCycling ? 300 : 0,
      distanceInterval: isWalking ? 1 : isCycling ? 1 : 0,
    };
    navWatchOptsRef.current = _watchOpts;
    const _posHandler = (pos: Location.LocationObject) => {
      // Crash guard: exit immediately if the component unmounted OR if navigation
      // has been stopped (mode switch, stopNavigation, arrival, clearRoute).
      // The isNavigatingRef check is essential when iOS fires a queued location
      // update for a stale _posHandler after locWatchRef.remove() was called.
      if (!isMountedRef.current || !isNavigatingRef.current) return;
      try {
      const loc: LatLng = {
        latitude: pos.coords.latitude,
        longitude: pos.coords.longitude,
      };
      const _gpsReceivedAtMs = Date.now();
      const _gpsTimestampMs = pos.timestamp ?? _gpsReceivedAtMs;
      const _gpsFixAgeMs = _gpsReceivedAtMs - _gpsTimestampMs;
      const _gpsIntervalMs = lastGpsTickMsRef.current > 0 ? _gpsReceivedAtMs - lastGpsTickMsRef.current : 0;
      // Build #210 diagnostic — GPS position age and tick interval.
      // posAge  = how old was the fix timestamp when _posHandler fired (ms).
      //           A large value means CoreLocation delivered a stale position.
      // interval = wall-clock gap since the previous _posHandler call (ms).
      //           A large value reveals throttling despite timeInterval:0.
      // Not __DEV__-gated: must fire in TestFlight builds. Remove in the fix build.
      if (isNavigatingRef.current) {
        lastGpsTickMsRef.current = _gpsReceivedAtMs;
        navDebugPosAgeRef.current = _gpsFixAgeMs;
        navDebugIntervalRef.current = _gpsIntervalMs;
        const _gpsLine = `[NavGPS][TRACE] t=${_gpsReceivedAtMs} posAge=${_gpsFixAgeMs}ms interval=${_gpsIntervalMs}ms`
          + ` spd=${Math.round((pos.coords.speed ?? 0) * 2.237)}mph`
          + ` acc=${Math.round(pos.coords.accuracy ?? 99)}m`;
        console.log(_gpsLine);
      }
      // Stationary noise filter: when nearly stopped with poor GPS accuracy,
      // skip updates that are just sensor drift (< 5 m of apparent movement).
      // Prevents false off-route triggers and position jumps at red lights.
      const _rawSpeed = pos.coords.speed ?? 0;
      // Preserve the legacy trace speed ref without causing a React update.
      navDebugSpeedMsRef.current = Math.max(0, _rawSpeed);
      if (_rawSpeed < 0.5 && userLocRef.current && (pos.coords.accuracy ?? 100) > 25) {
        if (haversineKm(userLocRef.current, loc) * 1000 < 5) return;
      }
      setUserLoc(loc);
      userLocRef.current = loc;
      updateCarPlayLocation(loc);

          // Live speed display (throttled to 2 Hz — badge doesn't need every GPS tick)
          {
            const _nowSp = Date.now();
            if (_nowSp - lastSpeedUpdateMsRef.current >= 500) {
              lastSpeedUpdateMsRef.current = _nowSp;
              if (pos.coords.speed != null && pos.coords.speed >= 0) {
                setCurrentSpeedMph(Math.round(pos.coords.speed * 2.237));
              } else {
                setCurrentSpeedMph(null);
              }
            }
          }

          // Compute closest polyline point once — reused for both progress rendering
          // and off-route detection so we don't run the O(n) scan twice per GPS tick.
          if (routeCoordRef.current.length > 0) {
            // Pass the previous progress index as a hint so closestRoutePoint
            // searches a 50-segment window instead of scanning the whole polyline.
            const _hint = prevProgressIdxRef.current >= 0 ? prevProgressIdxRef.current : 0;
            const { idx, interp } = closestRoutePoint(routeCoordRef.current, loc, _hint);
            // Store interpolated position so the voice zone block (outside this scope) can use it
            // for route-arc distance calculation without re-running the polyline scan.
            navInterpRef.current = interp;
            // Throttle visual progress updates to ~7 Hz — the polyline rendering
            // does not need to fire on every raw GPS tick (saves re-renders).
            const _nowV = Date.now();
            if (_nowV - lastProgressUpdateMsRef.current >= 150) {
              lastProgressUpdateMsRef.current = _nowV;
              setRouteProgressIdx(idx);
              setRouteProgressInterp(interp);
            }

            // Wrong-direction detection: speed-adaptive. At highway speeds (>30 mph)
            // 3 consecutive backward ticks (~1.5 s) is enough to be certain; at
            // lower speeds we wait for 4 ticks. Cooldown shortened to 20 s so the
            // user isn't stuck after a genuine wrong turn.
            {
              const speedMphWd = Math.round((pos.coords.speed ?? 0) * 2.237);
              const wdCountThresh = speedMphWd > 30 ? 3 : 4;

              const prevIdx = prevProgressIdxRef.current;
              if (prevIdx >= 0 && idx < prevIdx - 3) {
                wrongDirCountRef.current += 1;
              } else {
                wrongDirCountRef.current = 0;
              }
              prevProgressIdxRef.current = idx;
              const nowWd = Date.now();
              if (
                wrongDirCountRef.current >= wdCountThresh &&
                !isRecalculatingRef.current &&
                (nowWd - lastRecalcTimeRef.current) > 20000
              ) {
                wrongDirCountRef.current = 0;
                missedTurnRef.current = null;
                lastRecalcTimeRef.current = nowWd;
                isRecalculatingRef.current = true;
                setIsRecalculating(true);
                setRecalcBannerVisible(true);
                const _rsWdLine = `[NavRoute][TRACE] reroute_start routeVersion=${routeVersionRef.current} reason=wrong_dir`; console.log(_rsWdLine);
                fetchAllRoutes(loc, { latitude: dest.latitude, longitude: dest.longitude }, isWalking ? "walking" : isCycling ? "cycling" : "driving", true)
                  .then((results) => {
                    try {
                      const [primary] = results;
                      if (!primary || !isNavigatingRef.current || !isMountedRef.current) return;
                      resetRouteRefs(primary);
                      // "Rerouting" is announced AFTER resetRouteRefs so it captures the new
                      // routeVersion — if called pre-fetch it captures the old version and the
                      // forced-settle stale check drops it when resetRouteRefs increments the ref.
                      navSpeak("Rerouting", true);
                      // Announce first maneuver of the new route after a brief pause
                      if (primary.steps.length > 1) {
                        if (postAdvanceSpeakTimerRef.current) clearTimeout(postAdvanceSpeakTimerRef.current);
                        postAdvanceSpeakTimerRef.current = setTimeout(() => {
                          postAdvanceSpeakTimerRef.current = null;
                          if (!isNavigatingRef.current || !isMountedRef.current) return;
                          const firstStep = routeStepsRef.current[1];
                          if (firstStep && firstStep.instruction !== lastRerouteInstructionRef.current) {
                            lastRerouteInstructionRef.current = firstStep.instruction;
                            navSpeak(firstStep.instruction, false);
                          }
                        }, 800);
                      }
                      // Schedule adaptive-learning outcome check in 45 s
                      recalcCheckRef.current = { checkAt: Date.now() + 45000 };
                    } catch {}
                  })
                  .catch(() => {}) // network / server error — state reset handled by .finally
                  .finally(() => {
                    isRecalculatingRef.current = false;
                    if (!isMountedRef.current) return;
                    setIsRecalculating(false);
                    if (recalcBannerTimerRef.current) clearTimeout(recalcBannerTimerRef.current);
                    recalcBannerTimerRef.current = setTimeout(() => {
                      recalcBannerTimerRef.current = null;
                      if (isMountedRef.current) setRecalcBannerVisible(false);
                    }, 2000);
                  });
              } else if (wrongDirCountRef.current >= wdCountThresh && !isRecalculatingRef.current) {
                // Cooldown is still active — reroute suppressed. Emit a visible trace so testers
                // can distinguish "nav is stuck" from "cooldown blocked a valid reroute attempt".
                const _cbWdLine = `[NavRoute][TRACE] cooldown_blocked routeVersion=${routeVersionRef.current} reason=wrong_dir`; console.log(_cbWdLine);
              }
            }

          // Pending background off-route signal — first-fix fast path.
          // The active-transition handler leaves offRouteDetected = true when
          // both navState.lastBgLoc and userLocRef were null (cold resume with
          // suspended GPS watch).  Consume it here on the very first foreground
          // GPS fix so the reroute fires without waiting for offCount readings.
          if (navState.offRouteDetected && !isRecalculatingRef.current) {
            navState.offRouteDetected  = false;
            offRouteCountRef.current   = 0;
            offRouteStartMsRef.current = 0;
            lastRecalcTimeRef.current  = Date.now();
            isRecalculatingRef.current = true;
            setIsRecalculating(true);
            setRecalcBannerVisible(true);
            const _bgFirstFixMode =
              isWalking ? "walking" : isCycling ? "cycling" : "driving";
            const _bgFirstFixLine = `[NavRoute][TRACE] bg_offroute_reroute_start reason=first_fix loc=${JSON.stringify(loc)}`; console.log(_bgFirstFixLine);
            fetchAllRoutes(loc, { latitude: dest.latitude, longitude: dest.longitude }, _bgFirstFixMode, true)
              .then((results) => {
                try {
                  const [primary] = results;
                  if (!primary || !isNavigatingRef.current || !isMountedRef.current) return;
                  resetRouteRefs(primary);
                  navSpeak("Rerouting", true);
                } catch {}
              })
              .catch(() => {})
              .finally(() => {
                isRecalculatingRef.current = false;
                if (!isMountedRef.current) return;
                setIsRecalculating(false);
                if (recalcBannerTimerRef.current) clearTimeout(recalcBannerTimerRef.current);
                recalcBannerTimerRef.current = setTimeout(() => {
                  recalcBannerTimerRef.current = null;
                  if (isMountedRef.current) setRecalcBannerVisible(false);
                }, 2000);
              });
          }

          // Off-route detection — speed-adaptive thresholds.
          // Highway (>50 mph): 3 readings × 50 m + 30 s cooldown.
          // Urban (25–50 mph): 4 readings × 80 m + 45 s cooldown.
          // Slow / pedestrian: 4–5 readings × 30–100 m.
          // All distances scale by recalcSensitivityRef (1.0 default; learned over time).
          // Rerouting is now announced verbally so the user knows it's happening.
          if (!isRecalculatingRef.current) {
            const distToPolyM = haversineKm(loc, interp) * 1000;
            const now = Date.now();
            // Speed-adaptive thresholds from shared utility — any background path
            // that also performs off-route detection must call the same helper so
            // both paths stay in sync.  Changing navOffRouteThreshold.ts propagates
            // to all callers and causes backgroundNavOffRoute.test.ts to fail if
            // the breakpoints drift.
            const { offDistM, offCount, offCooldown, minOffRouteMs } =
              navOffRouteThreshold(
                pos.coords.speed ?? 0,
                isWalking,
                isCycling,
                recalcSensitivityRef.current,
              );

            if (distToPolyM > offDistM) {
              if (offRouteCountRef.current === 0) offRouteStartMsRef.current = now;
              offRouteCountRef.current += 1;
            } else {
              offRouteCountRef.current = 0;
              offRouteStartMsRef.current = 0;
            }
            if (
              offRouteCountRef.current >= offCount &&
              (now - offRouteStartMsRef.current) >= minOffRouteMs &&
              (now - lastRecalcTimeRef.current) > offCooldown
            ) {
              offRouteCountRef.current = 0;
              missedTurnRef.current = null;
              lastRecalcTimeRef.current = now;
              isRecalculatingRef.current = true;
              setIsRecalculating(true);
              setRecalcBannerVisible(true);
              const _rsOrLine = `[NavRoute][TRACE] reroute_start routeVersion=${routeVersionRef.current} reason=off_route distToPolyM=${Math.round(haversineKm(loc, interp) * 1000)}m`; console.log(_rsOrLine);
              fetchAllRoutes(loc, { latitude: dest.latitude, longitude: dest.longitude }, isWalking ? "walking" : isCycling ? "cycling" : "driving", true)
                .then((results) => {
                  try {
                    const [primary, ...alts] = results;
                    if (!primary || !isNavigatingRef.current || !isMountedRef.current) return;
                    resetRouteRefs(primary);
                    // "Rerouting" announced after resetRouteRefs so it captures the new routeVersion
                    navSpeak("Rerouting", true);
                    // Announce first maneuver of new route after a brief pause
                    if (primary.steps.length > 1) {
                      if (postAdvanceSpeakTimerRef.current) clearTimeout(postAdvanceSpeakTimerRef.current);
                      postAdvanceSpeakTimerRef.current = setTimeout(() => {
                        postAdvanceSpeakTimerRef.current = null;
                        if (!isNavigatingRef.current || !isMountedRef.current) return;
                        const firstStep = routeStepsRef.current[1];
                        if (firstStep && firstStep.instruction !== lastRerouteInstructionRef.current) {
                          lastRerouteInstructionRef.current = firstStep.instruction;
                          navSpeak(firstStep.instruction, false);
                        }
                      }, 800);
                    }
                    // Show alternative routes strip for 8 s if OSRM returned extras
                    if (alts.length > 0) {
                      if (recalcAltTimerRef.current) clearTimeout(recalcAltTimerRef.current);
                      setRecalcAltRoutes(alts);
                      setRecalcAltVisible(true);
                      recalcAltTimerRef.current = setTimeout(() => {
                        if (isMountedRef.current) setRecalcAltVisible(false);
                      }, 8000);
                    }
                    // Schedule adaptive-learning outcome check in 45 s
                    recalcCheckRef.current = { checkAt: Date.now() + 45000 };
                  } catch {}
                })
                .catch(() => {}) // network / server error — state reset handled by .finally
                .finally(() => {
                  isRecalculatingRef.current = false;
                  if (!isMountedRef.current) return;
                  setIsRecalculating(false);
                  if (recalcBannerTimerRef.current) clearTimeout(recalcBannerTimerRef.current);
                  recalcBannerTimerRef.current = setTimeout(() => {
                    recalcBannerTimerRef.current = null;
                    if (isMountedRef.current) setRecalcBannerVisible(false);
                  }, 2000);
                });
            } else if (
              offRouteCountRef.current >= offCount &&
              (now - offRouteStartMsRef.current) >= minOffRouteMs
            ) {
              // Cooldown is still active — reroute suppressed. Emit a visible trace so testers
              // can distinguish "nav is stuck" from "cooldown blocked a valid reroute attempt".
              const _cbOrLine = `[NavRoute][TRACE] cooldown_blocked routeVersion=${routeVersionRef.current} reason=off_route`; console.log(_cbOrLine);
            }

            // ── Adaptive-learning outcome check ────────────────────────────────
            // 45 s after a reroute, check if the user is on the new route.
            // On → tighten sensitivity (detect wrong turns faster next time).
            // Off → loosen (the previous recalc was premature — false positive).
            if (recalcCheckRef.current && now > recalcCheckRef.current.checkAt) {
              recalcCheckRef.current = null;
              const r = recalcSensitivityRef.current;
              if (distToPolyM < 40) {
                recalcSensitivityRef.current = Math.max(0.65, Math.round(r * 95) / 100);
              } else {
                recalcSensitivityRef.current = Math.min(1.50, Math.round(r * 108) / 100);
              }
              navState.recalcSensitivity = recalcSensitivityRef.current; // keep background in sync
              AsyncStorage.setItem("@chargebridge/recalc_sensitivity", String(recalcSensitivityRef.current)).catch(() => {});
            }
          }
          } // end: routeCoordRef.current.length > 0

          // ── Distance-based voice pre-announcements (3 per turn) ─────────────
          // IMPORTANT: this block must run BEFORE setCurrentStepIdx so that
          // navState.currentStepIdx still holds the OLD (pre-advance) value.
          //
          // Three announcement slots per step, each guarded by voiceAnnouncedRef.
          // Thresholds scale with current GPS speed so the user hears each cue
          // with a consistent lead-time regardless of driving speed:
          //   a1 (~70 s early):  "In X miles / half a mile / quarter mile, turn left"
          //   a2 (~22 s mid):    "In X feet / meters, turn left"
          //   a3 (~7 s near):    forced — always plays — "Turn left"
          // Adjacent zones are contiguous (a1 ends where a2 begins, a2 ends where
          // a3 begins) so the same GPS tick cannot trigger two zones simultaneously.
          {
            const steps = routeStepsRef.current;
            const curIdx = navState.currentStepIdx;
            const nextIdx = curIdx + 1;
            if (nextIdx < steps.length) {
              // Use route-arc distance (metres along the road polyline) rather than straight-line
              // haversine so that curved approaches — highway cloverleafs, roundabout entries,
              // on-ramp loops — don't fire zones too early.  Falls back to straight-line on the
              // very first GPS tick (before closestRoutePoint has run) and on web builds.
              const distToNextM =
                navInterpRef.current != null && prevProgressIdxRef.current >= 0 && routeCoordRef.current.length > 0
                  ? routeArcDistM(routeCoordRef.current, prevProgressIdxRef.current, navInterpRef.current, steps[nextIdx].coordinate)
                  : haversineKm(loc, steps[nextIdx].coordinate) * 1000;
              // Build #210 diagnostic — distance series per voice-zone tick.
              // prev: distToNextM from the previous tick (reveals how far the car
              //       jumped between evaluations — large jumps indicate throttling).
              // cur/arc: the arc distance the voice zone is actually using this tick.
              // straight: haversine fallback for comparison (arc > straight on curves).
              // step: which maneuver index is being evaluated.
              // Not __DEV__-gated: must fire in TestFlight builds. Remove in the fix build.
              {
                const _tDist = Date.now();
                const _straight = Math.round(haversineKm(loc, steps[nextIdx].coordinate) * 1000);
                const _prevStr = prevDistToNextMRef.current < 0
                  ? 'n/a' : `${Math.round(prevDistToNextMRef.current)}m`;
                const _distLine = `[NavVoice][DIST] t=${_tDist} step=${nextIdx}`
                  + ` prev=${_prevStr} cur=${Math.round(distToNextM)}m`
                  + ` arc=${Math.round(distToNextM)}m straight=${_straight}m`;
                console.log(_distLine);
                navDebugDistPrevRef.current = navDebugDistRef.current;
                navDebugDistRef.current = Math.round(distToNextM);
                navDebugStraightRef.current = _straight;
                prevDistToNextMRef.current = distToNextM;
              }
              if (!voiceAnnouncedRef.current[nextIdx]) voiceAnnouncedRef.current[nextIdx] = new Set();
              const announced = voiceAnnouncedRef.current[nextIdx];
              const isQuiet = navVoiceLevelRef.current === "quiet";

              // Speed-adaptive thresholds (GPS speed in m/s).
              // All minimums are now speed-scaled so at low city speeds (5–10 m/s)
              // announcements are not fired hundreds of metres too early:
              // At 10 mph ( 4.5 m/s): a3≈ 54m (12s), a2≈198m (44s), a1≈383m (85s)
              // At 30 mph (13.4 m/s): a3≈161m (12s), a2≈590m (44s), a1≈1139m (85s)
              // At 65 mph (29.0 m/s): a3≈348m (12s), a2≈1276m (44s), a1≈2465m (85s)
              const speedMs = Math.max(0, pos.coords.speed ?? 0);
              // time-to-maneuver (seconds) — used to tune a3 for reliable voice lead time
              const timeToNextS = speedMs > 1.5 ? distToNextM / speedMs : 999;
              const a3Hi = isWalking
                ? Math.max(50,  Math.min(100,  Math.round(speedMs * 10)))
                : isCycling
                  ? Math.max(80,  Math.min(150,  Math.round(speedMs * 10)))
                  // Drive: fire at ~12 s before maneuver; absolute floor 60m, cap 500m.
                  // If time-to-maneuver is already < 13 s and we haven't spoken yet, trigger.
                  : (timeToNextS < 13 && speedMs > 2)
                    ? distToNextM + 1   // immediate trigger
                    : Math.min(500, Math.max(speedMs * 12, 60));
              // Build #210 arc-vs-straight diagnostic — filter "[NavVoice][ARC]" in Console.app.
              // Confirms corrected routeArcDistM is close to straight-line on straight roads and
              // appropriately longer on curves.
              // Not __DEV__-gated: must fire in TestFlight builds. Remove in the fix build.
              {
                const _straightM = Math.round(haversineKm(loc, steps[nextIdx].coordinate) * 1000);
                const _arcLine = `[NavVoice][ARC] step=${nextIdx}`
                  + ` arc=${Math.round(distToNextM)}m straight=${_straightM}m`
                  + ` a3Hi=${Math.round(a3Hi ?? 0)}m speed=${Math.round(speedMs * 2.237)}mph`;
                console.log(_arcLine);
              }
              const a2Hi = isWalking
                ? Math.max(150, Math.min(350,  Math.round(speedMs * 25)))
                : isCycling
                  ? Math.max(200, Math.min(600,  Math.round(speedMs * 25)))
                  // Drive: ~44 s lead; speed-scaled floor (no static 700m minimum)
                  : Math.min(1800, Math.max(speedMs * 44, 200));
              const a1Hi = (isWalking || isCycling)
                ? 800
                // Drive: ~85 s lead; speed-scaled floor (no static 1200m minimum)
                : Math.min(6000, Math.max(speedMs * 85, 400));
              const a3Lo = 15;

              // a1 — early warning (skipped in quiet mode)
              if (!isQuiet && distToNextM < a1Hi && distToNextM >= a2Hi && !announced.has("a1")) {
                announced.add("a1");
                const mi = distToNextM / 1609.34;
                const distStr = mi >= 1.5 ? `In ${Math.round(mi)} miles,`
                              : mi >= 0.7 ? "In about a mile,"
                              : mi >= 0.4 ? "In half a mile,"
                              :             "In a quarter mile,";
                const _tZoneA1 = Date.now();
                navVoiceTraceRef.current = { tZone: _tZoneA1, tSpeak: 0, stepIdx: nextIdx };
                const _zoneA1Log = buildNavZoneLogLine(steps, curIdx, distToNextM, "a1", routeVersionRef.current, pos.timestamp, _tZoneA1);
                navDebugZoneRef.current = 'a1';
                if (_zoneA1Log) console.log(_zoneA1Log);
                navSpeak(`${distStr} ${steps[nextIdx].instruction}`);
              }
              // a2 — mid-range warning (skipped in quiet mode)
              if (!isQuiet && distToNextM < a2Hi && distToNextM >= a3Hi && !announced.has("a2")) {
                announced.add("a2");
                const ft = Math.round(distToNextM * 3.281);
                const distStr = speedUnitRef.current === "kph"
                  ? `In ${Math.round(distToNextM / 100) * 100} meters,`
                  : ft >= 2640 ? "In half a mile,"
                  : ft >= 1320 ? "In a quarter mile,"
                  : ft >= 800  ? "In a thousand feet,"
                  : ft >= 450  ? "In 500 feet,"
                  : ft >= 250  ? "In 300 feet,"
                  : ft >= 150  ? "In 200 feet,"
                  :              "In 100 feet,";
                const _tZoneA2 = Date.now();
                navVoiceTraceRef.current = { tZone: _tZoneA2, tSpeak: 0, stepIdx: nextIdx };
                const _zoneA2Log = buildNavZoneLogLine(steps, curIdx, distToNextM, "a2", routeVersionRef.current, pos.timestamp, _tZoneA2);
                navDebugZoneRef.current = 'a2';
                if (_zoneA2Log) console.log(_zoneA2Log);
                navSpeak(`${distStr} ${steps[nextIdx].instruction}`);
              }
              // a3 — near/forced: always plays regardless of quiet mode
              if (distToNextM < a3Hi && distToNextM > a3Lo && !announced.has("a3")) {
                announced.add("a3");
                const _tZoneA3 = Date.now();
                navVoiceTraceRef.current = { tZone: _tZoneA3, tSpeak: 0, stepIdx: nextIdx };
                const _zoneA3Log = buildNavZoneLogLine(steps, curIdx, distToNextM, "a3", routeVersionRef.current, pos.timestamp, _tZoneA3);
                navDebugZoneRef.current = 'a3';
                if (_zoneA3Log) console.log(_zoneA3Log);
                const evidenceContext = NAV_EVIDENCE_CAPTURE_ENABLED && navEvidenceCaptureRef.current.armed
                  ? {
                      gpsTimestampMs: _gpsTimestampMs,
                      gpsReceivedAtMs: _gpsReceivedAtMs,
                      gpsIntervalMs: _gpsIntervalMs,
                      gpsFixAgeMs: _gpsFixAgeMs,
                      latitude: pos.coords.latitude,
                      longitude: pos.coords.longitude,
                      accuracyM: pos.coords.accuracy ?? null,
                      speedMs: pos.coords.speed ?? null,
                      routeArcDistanceM: distToNextM,
                      straightDistanceM: haversineKm(loc, steps[nextIdx].coordinate) * 1000,
                      maneuverLatitude: steps[nextIdx].coordinate.latitude,
                      maneuverLongitude: steps[nextIdx].coordinate.longitude,
                      maneuverInstruction: steps[nextIdx].instruction,
                      stepIndex: nextIdx,
                      routeVersion: routeVersionRef.current,
                      zone: "a3" as const,
                    }
                  : undefined;
                navSpeak(steps[nextIdx].instruction, true, evidenceContext);
              }
            }
          }

          // ── Pill visibility (next-turn preview in ETA strip) ─────────────────
          // Shows at 2 miles for 10 s, then again at 500 m until the step advances.
          // Local streets (step distance < 600 m) stay visible until step advances.
          {
            const nextIdx = navState.currentStepIdx + 1;
            if (nextIdx < routeStepsRef.current.length) {
              const distToNextM = haversineKm(loc, routeStepsRef.current[nextIdx].coordinate) * 1000;
              const curCoord = routeStepsRef.current[navState.currentStepIdx]?.coordinate;
              const nextCoord = routeStepsRef.current[nextIdx].coordinate;
              const stepDistM = curCoord ? haversineKm(curCoord, nextCoord) * 1000 : 9999;
              const isLocalStreet = stepDistM < 600;

              if (distToNextM < 3218 && !pillVisibleRef.current) {
                setPillVisible(true);
                pillVisibleRef.current = true;
                if (!isLocalStreet && distToNextM > 500) {
                  // Non-local: show for 10 s then hide until 500m zone
                  if (pillTimerRef.current) clearTimeout(pillTimerRef.current);
                  pillTimerRef.current = setTimeout(() => {
                    pillTimerRef.current = null;
                    if (!isMountedRef.current) return;
                    setPillVisible(false);
                    pillVisibleRef.current = false;
                  }, 10000);
                }
                // Local street or already within 500m: stay on until step advances
              } else if (distToNextM < 500 && !pillVisibleRef.current) {
                // Re-enter 500m zone after the 10s hide: show again until step advances
                if (pillTimerRef.current) { clearTimeout(pillTimerRef.current); pillTimerRef.current = null; }
                setPillVisible(true);
                pillVisibleRef.current = true;
              }
            }
          }

          // ── Advance turn step when close to next step's maneuver point ────────
          // Threshold is speed-adaptive: at highway speeds the GPS interval can
          // span 20-30 m per tick, so a fixed 25 m threshold risks missing the
          // advance window. At >40 mph → 45 m; >20 mph → 35 m.
          // The missed-turn tracker monitors approach (within threshold × 3.5)
          // and proximity (within threshold × 1.5). If the user was that close
          // but the step never advanced, it triggers an immediate reroute.
          const _prevStepIdx = navState.currentStepIdx;
          {
            const steps = routeStepsRef.current;
            if (steps.length > 0) {
              const next = _prevStepIdx + 1;
              if (next < steps.length) {
                const distM = haversineKm(loc, steps[next].coordinate) * 1000;
                const speedMphSA = Math.round((pos.coords.speed ?? 0) * 2.237);
                // Step-advance threshold: how close (metres) to the maneuver point
                // before we flip the banner to the next instruction.  Values are tuned
                // so the advance happens right as the user reaches/completes the turn
                // (~2–3 s lead time at speed), rather than 4+ s early (the old 120 m
                // highway value caused the banner to jump to the next-next instruction
                // while the user was still 4 s from the current turn).
                // iOS BestForNavigation fires ~1 Hz; at 65 mph that's ~29 m/tick, so
                // 65 m gives one reliable trigger window before passing the maneuver.
                // Shared production function from utils/navStepAdvance — the same one
                // imported by backgroundNav.ts and __tests__/backgroundNavThreshold.test.ts.
                const advancedIdx = foregroundAdvanceStepIdx(
                  _prevStepIdx, steps, loc, pos.coords.speed ?? 0, isWalking, isCycling,
                );
                // Threshold retained for logging and missed-turn zone calculations.
                // Uses the shared navMissedTurnThreshold helper so that tests pin this
                // exact production value and an accidental revert to motorised-only is caught.
                const threshold = navMissedTurnThreshold(pos.coords.speed ?? 0, isWalking, isCycling);
                if (advancedIdx !== _prevStepIdx) {
                  console.log(`[NavStep][TRACE] advance stepIdx=${_prevStepIdx}→${next} distM=${Math.round(distM)}m speedMph=${speedMphSA} threshold=${threshold}m`);
                  navState.currentStepIdx = next;
                  setCurrentStepIdx(next);
                  missedTurnRef.current = null; // turn made — clear tracker
                  lastRerouteInstructionRef.current = ""; // allow fresh reroute announce after advance
                } else {
                  // Missed-turn tracking: user enters zone → gets close → departs
                  const nearZone = threshold * 3.5;
                  const wasCloseZone = threshold * 1.5;
                  const mt = missedTurnRef.current;
                  if (distM < nearZone) {
                    if (!mt || mt.idx !== next) {
                      missedTurnRef.current = { idx: next, minDist: distM, wasClose: distM < wasCloseZone };
                    } else {
                      if (distM < mt.minDist) mt.minDist = distM;
                      if (distM < wasCloseZone) mt.wasClose = true;
                    }
                  } else if (mt && mt.idx === next && mt.wasClose) {
                    // Was very close to the turn but now moving away without advancing — missed it
                    missedTurnRef.current = null;
                    const nowMt = Date.now();
                    if (!isRecalculatingRef.current && (nowMt - lastRecalcTimeRef.current) > 20000) {
                      lastRecalcTimeRef.current = nowMt;
                      isRecalculatingRef.current = true;
                      offRouteCountRef.current = 0;
                      wrongDirCountRef.current = 0;
                      setIsRecalculating(true);
                      setRecalcBannerVisible(true);
                      const _rsMtLine = `[NavRoute][TRACE] reroute_start routeVersion=${routeVersionRef.current} reason=missed_turn`; console.log(_rsMtLine);

                      fetchAllRoutes(loc, { latitude: dest.latitude, longitude: dest.longitude }, isWalking ? "walking" : isCycling ? "cycling" : "driving", true)
                        .then((results) => {
                          try {
                            const [primary] = results;
                            if (!primary || !isNavigatingRef.current || !isMountedRef.current) return;
                            resetRouteRefs(primary);
                            // "Rerouting" announced after resetRouteRefs so it captures the new routeVersion
                            navSpeak("Rerouting", true);
                            if (primary.steps.length > 1) {
                              if (postAdvanceSpeakTimerRef.current) clearTimeout(postAdvanceSpeakTimerRef.current);
                              postAdvanceSpeakTimerRef.current = setTimeout(() => {
                                postAdvanceSpeakTimerRef.current = null;
                                if (!isNavigatingRef.current || !isMountedRef.current) return;
                                const firstStep = routeStepsRef.current[1];
                                if (firstStep && firstStep.instruction !== lastRerouteInstructionRef.current) {
                                  lastRerouteInstructionRef.current = firstStep.instruction;
                                  navSpeak(firstStep.instruction, false);
                                }
                              }, 800);
                            }
                            recalcCheckRef.current = { checkAt: Date.now() + 45000 };
                          } catch {}
                        })
                        .catch(() => {}) // network / server error — state reset handled by .finally
                        .finally(() => {
                          isRecalculatingRef.current = false;
                          if (!isMountedRef.current) return;
                          setIsRecalculating(false);
                          if (recalcBannerTimerRef.current) clearTimeout(recalcBannerTimerRef.current);
                          recalcBannerTimerRef.current = setTimeout(() => {
                            recalcBannerTimerRef.current = null;
                            if (isMountedRef.current) setRecalcBannerVisible(false);
                          }, 2000);
                        });
                    } else if (!isRecalculatingRef.current) {
                      // Cooldown is still active — reroute suppressed. Emit a visible trace so testers
                      // can distinguish "nav is stuck" from "cooldown blocked a valid reroute attempt".
                      const _cbMtLine = `[NavRoute][TRACE] cooldown_blocked routeVersion=${routeVersionRef.current} reason=missed_turn`; console.log(_cbMtLine);
                    }
                  } else if (mt && mt.idx !== next) {
                    missedTurnRef.current = null; // active step changed — reset
                  }
                }
              }
            }
          }

          // ── Post-advance side-effects (notifications + GPS-skip voice) ────────
          {
            const advancedIdx = navState.currentStepIdx;
            if (advancedIdx !== _prevStepIdx) {
              const steps = routeStepsRef.current;
              // ── Maneuver-reached timing trace ───────────────────────────────────
              // Logs the delta from zone-detection → maneuver and Speech.speak() →
              // maneuver so TestFlight analysis can isolate GPS, TTS, or logic lag.
              {
                const _tManeuver = Date.now();
                const { tZone, tSpeak, stepIdx: traceStep } = navVoiceTraceRef.current;
                const distToManeuver = steps[advancedIdx]
                  ? Math.round(haversineKm(loc, steps[advancedIdx].coordinate) * 1000)
                  : -1;
                const _maneuverLine =
                  `[NavVoice][TRACE] maneuver-reached step=${_prevStepIdx}→${advancedIdx}` +
                  ` dist=${distToManeuver}m` +
                  ` since_zone=${tZone > 0 ? (_tManeuver - tZone) + "ms" : "n/a"}` +
                  ` since_speak=${tSpeak > 0 ? (_tManeuver - tSpeak) + "ms" : "n/a"}` +
                  ` traceStep=${traceStep}` +
                  ` t=${_tManeuver}`;
                console.log(_maneuverLine);
              }
              const step = steps[advancedIdx];
              if (step) {
                // Background push notification when app is not in foreground.
                // Record the notified step index in notifiedStepIndices only after
                // showTurnNotification resolves AND only if the app has not yet
                // transitioned back to active (generation check).  This prevents a
                // late-resolving .then() from adding an index after the one-time sync
                // has already run, which would otherwise leave the step un-stamped and
                // allow the foreground GPS handler to speak it — producing a
                // push-notification + voice duplicate for the same maneuver.
                if (AppState.currentState !== "active") {
                  const nextStep = steps[advancedIdx + 1] ?? null;
                  const distToNext = nextStep
                    ? haversineKm(loc, nextStep.coordinate) * 1000
                    : haversineKm(loc, { latitude: navState.destLatitude, longitude: navState.destLongitude }) * 1000;
                  const _notifyIdx = advancedIdx;
                  const _capturedGeneration = navState.activeGeneration;
                  showTurnNotification(
                    { instruction: step.instruction, featherIcon: step.featherIcon, coordinate: step.coordinate },
                    nextStep ? { instruction: nextStep.instruction, featherIcon: nextStep.featherIcon, coordinate: nextStep.coordinate } : null,
                    distToNext
                  ).then(() => {
                    // Only record if the app is still in the same inactive session
                    // (activeGeneration unchanged → active transition has not fired yet).
                    if (navState.activeGeneration === _capturedGeneration) {
                      navState.notifiedStepIndices.add(_notifyIdx);
                    }
                  }).catch(() => {});
                }
                // GPS-skip safety net: if "near" (a3) was never announced
                // (GPS jumped from >120 m to <40 m in one update), speak now
                const wasNearAnnounced = voiceAnnouncedRef.current[advancedIdx]?.has("a3") ?? false;
                const wasTurnAnnounced = voiceAnnouncedRef.current[advancedIdx]?.has("turn") ?? false;
                if (!wasNearAnnounced && !wasTurnAnnounced) {
                  if (!voiceAnnouncedRef.current[advancedIdx]) voiceAnnouncedRef.current[advancedIdx] = new Set();
                  voiceAnnouncedRef.current[advancedIdx].add("turn");
                  navSpeak(step.instruction, true);
                }
                // Reset pill so it will re-trigger for the new step
                setPillVisible(false);
                pillVisibleRef.current = false;
                if (pillTimerRef.current) { clearTimeout(pillTimerRef.current); pillTimerRef.current = null; }

                // ── Immediate next-step announcement after turn advance ──────────
                // On dense urban streets the NEXT turn may already be inside the
                // a2 window. Without this the user drives in silence until the
                // next GPS tick re-evaluates the announcement zones.
                {
                  const newNextIdx = advancedIdx + 1;
                  if (newNextIdx < steps.length) {
                    const distToNewNextM = haversineKm(loc, steps[newNextIdx].coordinate) * 1000;
                    if (!voiceAnnouncedRef.current[newNextIdx]) voiceAnnouncedRef.current[newNextIdx] = new Set();
                    const newNextAnn = voiceAnnouncedRef.current[newNextIdx];
                    if (!newNextAnn.has("a2") && !newNextAnn.has("a3")) {
                      const speedMs = Math.max(0, pos.coords.speed ?? 0);
                      const a2HiNn = isWalking ? Math.max(150, Math.min(350, Math.round(speedMs * 25)))
                        : isCycling ? Math.max(200, Math.min(600, Math.round(speedMs * 25)))
                        : Math.max(700, Math.min(1800, Math.round(speedMs * 44)));
                      if (distToNewNextM < a2HiNn) {
                        newNextAnn.add("a2");
                        if (postAdvanceSpeakTimerRef.current) clearTimeout(postAdvanceSpeakTimerRef.current);
                        postAdvanceSpeakTimerRef.current = setTimeout(() => {
                          postAdvanceSpeakTimerRef.current = null;
                          if (!isNavigatingRef.current || !isMountedRef.current) return;
                          const liveSteps = routeStepsRef.current;
                          if (newNextIdx >= liveSteps.length) return;
                          const ft = Math.round(distToNewNextM * 3.281);
                          const distStr = speedUnitRef.current === "kph"
                            ? `In ${Math.round(distToNewNextM / 100) * 100} meters,`
                            : ft >= 2640 ? "In half a mile,"
                            : ft >= 1320 ? "In a quarter mile,"
                            : ft >= 800  ? "In a thousand feet,"
                            : ft >= 450  ? "In 500 feet,"
                            : ft >= 250  ? "In 300 feet,"
                            :              "In 100 feet,";
                          navSpeak(`${distStr} ${liveSteps[newNextIdx].instruction}`, false);
                        }, 600);
                      }
                    }
                  }
                }
              }
            }
          }

          // Arrival detection: 20m for walking, 30m for cycling, 60m for driving
          const arrivalThreshold = isWalking ? 20 : isCycling ? 30 : 60;
          const distToDestM = haversineKm(loc, { latitude: dest.latitude, longitude: dest.longitude }) * 1000;
          if (distToDestM < arrivalThreshold) {
            // Full teardown before setting arrived — prevents fasterRouteTimer
            // and AppState subscription firing on stale state (source of crash)
            isNavigatingRef.current = false;
            locWatchRef.current?.remove();
            locWatchRef.current = null;
            appStateSubRef.current?.remove();
            appStateSubRef.current = null;
            navState.isActive = false;
            navState.destLabel = "";
            if (fasterRouteTimerRef.current) { clearInterval(fasterRouteTimerRef.current); fasterRouteTimerRef.current = null; }
            if (recalcAltTimerRef.current) { clearTimeout(recalcAltTimerRef.current); recalcAltTimerRef.current = null; }
            isRecalculatingRef.current = false;
            missedTurnRef.current = null;
            recalcCheckRef.current = null;
            if (postAdvanceSpeakTimerRef.current) { clearTimeout(postAdvanceSpeakTimerRef.current); postAdvanceSpeakTimerRef.current = null; }
            if (speakTimerRef.current) { clearTimeout(speakTimerRef.current); speakTimerRef.current = null; }
            if (isSpeakingWatchdogRef.current) { clearTimeout(isSpeakingWatchdogRef.current); isSpeakingWatchdogRef.current = null; }
            if (recalcBannerTimerRef.current) { clearTimeout(recalcBannerTimerRef.current); recalcBannerTimerRef.current = null; }
            try { Speech.stop(); } catch {}
            isSpeakingRef.current = false;
            speakQueueRef.current = null;
            stopBgLocationTask();
            cancelNavNotifications().catch(() => {});
            setIsNavigating(false);
            setIs3D(false);
            setFasterRoute(null);
            setCurrentSpeedMph(null);
            setRecalcAltVisible(false);
            setIsRecalculating(false);
            setRecalcBannerVisible(false);
            setArrived(true);
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            showArrivalNotification().catch(() => {});
            return;
          }

          // EV Arrival Card — appears 2–3 min before reaching the destination.
          // Trigger distance is speed-scaled (2 min × current speed) but capped at 1 km.
          // navDestEvRef.current is set when nav starts from an EV station pin.
          if (!evArrivalRef.current && navDestEvRef.current && distToDestM > arrivalThreshold) {
            const evArrivalMs = Math.max(0, pos.coords.speed ?? 0);
            const evArrivalDistM = Math.min(1000, Math.max(300, evArrivalMs * 120)); // 2 min at speed
            if (distToDestM < evArrivalDistM) {
              evArrivalRef.current = true;
              setEvArrivalVisible(true);
              if (!destNearRef.current) { destNearRef.current = true; setDestNear(true); }
            }
          }

          // 500 m "Destination ahead" card — shows once and persists until arrival
          if (!destNearRef.current && distToDestM < 500 && distToDestM > arrivalThreshold) {
            destNearRef.current = true;
            setDestNear(true);
          }

          // Startup departure cue — speaks the first step instruction once on the
          // very first GPS tick so the user hears audio confirmation that navigation
          // has started (e.g. "Head out on Main St"). Only fires if no a1/a2/a3
          // announcement has already triggered (i.e. the first turn is far away).
          if (!startupCueSpokenRef.current) {
            startupCueSpokenRef.current = true;
            const depStep = routeStepsRef.current[0];
            if (depStep && !voiceAnnouncedRef.current[0]?.has("a1") && !voiceAnnouncedRef.current[0]?.has("a2") && !voiceAnnouncedRef.current[0]?.has("a3")) {
              navSpeak(depStep.instruction);
            }
          }

          // Camera: guard against race during teardown, walking top-down, driving 3D.
          // Skip when the user is manually zooming/panning — auto-follow resumes after 10 s.
          if (!isNavigatingRef.current) return;
          if (!userInteractingRef.current) {
            // Sanitize heading: ?? 0 passes NaN through (NaN !== null/undefined).
            // MapKit throws an ObjC exception for non-finite or negative heading values
            // under newArchEnabled:true, which bypasses JS try-catch and kills the process.
            const rawH = pos.coords.heading;
            const safeHeading = rawH != null && Number.isFinite(rawH) && rawH >= 0 ? rawH : 0;
            // Speed-adaptive zoom: faster → more zoomed out so the driver can see farther ahead.
            const camSpeedMs = Math.max(0, pos.coords.speed ?? 0);
            const camSpeedKph = camSpeedMs * 3.6;
            const driveZoom = camSpeedKph > 90 ? 14.5 : camSpeedKph > 70 ? 15 : camSpeedKph > 50 ? 15.5 : camSpeedKph > 30 ? 16 : 16.5;
            const driveAlt  = camSpeedKph > 90 ? 700 : camSpeedKph > 70 ? 550 : camSpeedKph > 50 ? 420 : camSpeedKph > 30 ? 320 : 240;
            mapRef.current?.animateCamera(
              isWalking
                ? { center: loc, pitch: 0, heading: safeHeading, zoom: 19, altitude: 80 }
                : isCycling
                  ? { center: loc, pitch: 0, heading: safeHeading, zoom: 18, altitude: 120 }
                  : { center: loc, pitch: 60, heading: safeHeading, zoom: driveZoom, altitude: driveAlt },
              { duration: 200 }
            );
          }
      } catch { /* safety: no single GPS-tick error should terminate navigation */ }
    };
    navPositionHandlerRef.current = _posHandler;

    // Background→foreground restoration: when iOS suspends the foreground GPS
    // watch while the app is backgrounded, calling wakeNavRef.current() on
    // return to foreground restarts it cleanly — no navigation state is reset
    // (route, steps, current step, ETA and destination all persist).
    wakeNavRef.current = () => {
      if (!isNavigatingRef.current || !isMountedRef.current) return;
      locWatchRef.current?.remove();
      locWatchRef.current = null;
      Location.watchPositionAsync(_watchOpts, _posHandler)
        .then((sub) => {
          if (isMountedRef.current && isNavigatingRef.current) locWatchRef.current = sub;
        })
        .catch(() => {});
    };

    try {
      locWatchRef.current = await Location.watchPositionAsync(_watchOpts, _posHandler);
    } catch {
      setIsNavigating(false);
      isNavigatingRef.current = false;
      setIs3D(false);
      navState.isActive = false;
      wakeNavRef.current = null;
      navPositionHandlerRef.current = null;
      setRouteError("Could not start navigation — check location permissions and try again.");
    }
  }, [dest, startBgLocationTask, stopBgLocationTask]);

  const stopNavigation = useCallback(() => {
    locWatchRef.current?.remove();
    locWatchRef.current = null;
    appStateSubRef.current?.remove();
    appStateSubRef.current = null;
    isNavigatingRef.current = false;
    wakeNavRef.current = null;
    navPositionHandlerRef.current = null;
    navWatchOptsRef.current = null;
    wrongDirCountRef.current = 0;
    prevProgressIdxRef.current = -1;
    missedTurnRef.current = null;
    recalcCheckRef.current = null;
    if (postAdvanceSpeakTimerRef.current) { clearTimeout(postAdvanceSpeakTimerRef.current); postAdvanceSpeakTimerRef.current = null; }
    navState.isActive = false;
    navState.destLabel = "";
    setIsNavigating(false);
    setIs3D(false);
    if (speakTimerRef.current) { clearTimeout(speakTimerRef.current); speakTimerRef.current = null; }
    if (isSpeakingWatchdogRef.current) { clearTimeout(isSpeakingWatchdogRef.current); isSpeakingWatchdogRef.current = null; }
    if (recalcBannerTimerRef.current) { clearTimeout(recalcBannerTimerRef.current); recalcBannerTimerRef.current = null; }
    if (navCameraFreeTimerRef.current) { clearTimeout(navCameraFreeTimerRef.current); navCameraFreeTimerRef.current = null; }
    userInteractingRef.current = false;
    setNavCameraFree(false);
    try { Speech.stop(); } catch {}
    isSpeakingRef.current = false;
    speakQueueRef.current = null;
    setAudioModeAsync({ shouldPlayInBackground: false, playsInSilentMode: false, allowsRecording: false }).catch(() => {});
    cancelNavNotifications().catch(() => {});
    stopBgLocationTask();
    mapRef.current?.animateCamera({ pitch: 0 }, { duration: 400 });
    // Clear route-suggestion timers and banners
    if (fasterRouteTimerRef.current) { clearInterval(fasterRouteTimerRef.current); fasterRouteTimerRef.current = null; }
    if (recalcAltTimerRef.current) { clearTimeout(recalcAltTimerRef.current); recalcAltTimerRef.current = null; }
    if (pillTimerRef.current) { clearTimeout(pillTimerRef.current); pillTimerRef.current = null; }
    if (navPillsTimerRef.current) { clearTimeout(navPillsTimerRef.current); navPillsTimerRef.current = null; }
    setPillVisible(false);
    pillVisibleRef.current = false;
    setNavPillsVisible(false);
    navPillsVisibleRef.current = false;
    setDestNear(false);
    destNearRef.current = false;
    setEvArrivalVisible(false);
    evArrivalRef.current = false;
    setFasterRoute(null);
    setRecalcAltVisible(false);
    setCurrentSpeedMph(null);
  }, [stopBgLocationTask]);

  // Unmount cleanup — runs when the user navigates away from the map tab.
  // Must stop every subscription and timer that references component state;
  // failing to do so causes setState-on-unmounted-component crashes on iOS.
  useEffect(() => {
    return () => {
      // Signal in-flight async callbacks (fetchAllRoutes, fetchRoute .then())
      // that the component is gone so they skip their setState calls.
      isMountedRef.current = false;
      // Stop the GPS watcher and subscriptions first so no more callbacks fire
      locWatchRef.current?.remove();
      locWatchRef.current = null;
      appStateSubRef.current?.remove();
      appStateSubRef.current = null;
      // Mark navigation dead so any still-resolving promises skip setState
      isNavigatingRef.current = false;
      navState.isActive = false;
      navState.destLabel = "";
      // Cancel every timer that could call setState after unmount
      if (fasterRouteTimerRef.current) { clearInterval(fasterRouteTimerRef.current); fasterRouteTimerRef.current = null; }
      if (recalcAltTimerRef.current) { clearTimeout(recalcAltTimerRef.current); recalcAltTimerRef.current = null; }
      if (recalcBannerTimerRef.current) { clearTimeout(recalcBannerTimerRef.current); recalcBannerTimerRef.current = null; }
      if (speakTimerRef.current) { clearTimeout(speakTimerRef.current); speakTimerRef.current = null; }
      if (isSpeakingWatchdogRef.current) { clearTimeout(isSpeakingWatchdogRef.current); isSpeakingWatchdogRef.current = null; }
      if (pillTimerRef.current) { clearTimeout(pillTimerRef.current); pillTimerRef.current = null; }
      if (navPillsTimerRef.current) { clearTimeout(navPillsTimerRef.current); navPillsTimerRef.current = null; }
      if (navCameraFreeTimerRef.current) { clearTimeout(navCameraFreeTimerRef.current); navCameraFreeTimerRef.current = null; }
      if (postAdvanceSpeakTimerRef.current) { clearTimeout(postAdvanceSpeakTimerRef.current); postAdvanceSpeakTimerRef.current = null; }
      missedTurnRef.current = null;
      recalcCheckRef.current = null;
      if (!isWeb) { try { Speech.stop(); } catch {} }
      isSpeakingRef.current = false;
      speakQueueRef.current = null;
      setAudioModeAsync({ shouldPlayInBackground: false, playsInSilentMode: false, allowsRecording: false }).catch(() => {});
    };
  }, []);

  // ── Map control toggles ───────────────────────────────────────────────────
  const toggleMapType = useCallback(() => {
    Haptics.selectionAsync();
    setMapType((t) => (t === "standard" ? "hybrid" : "standard"));
  }, []);

  const toggle3D = useCallback(() => {
    const next = !is3D;
    setIs3D(next);
    Haptics.selectionAsync();
    const center = userLoc ?? { latitude: 37.7749, longitude: -122.4194 };
    mapRef.current?.animateCamera(
      { center, pitch: next ? 60 : 0, zoom: 15, altitude: next ? 400 : 1000 },
      { duration: 500 }
    );
  }, [is3D, userLoc]);

  const centerOnUser = useCallback(() => {
    if (!userLoc) {
      getLocation();
      return;
    }
    Haptics.selectionAsync();
    // Re-lock nav camera if it was freed by user interaction
    if (navCameraFreeTimerRef.current) { clearTimeout(navCameraFreeTimerRef.current); navCameraFreeTimerRef.current = null; }
    userInteractingRef.current = false;
    setNavCameraFree(false);
    mapRef.current?.animateCamera(
      { center: userLoc, pitch: is3D ? 60 : 0, zoom: 15, altitude: is3D ? 400 : 1000 },
      { duration: 500 }
    );
  }, [userLoc, is3D, getLocation]);

  const clearSelection = useCallback(() => {
    // Marker.onPress and MapView.onPress both fire on a pin tap.
    // The flag prevents MapView from immediately wiping the selection.
    if (pinJustTappedRef.current) {
      pinJustTappedRef.current = false;
      return;
    }
    setSelectedEv(null);
    setSelectedGas(null);
    setSelectedDest(false);
    setSelectedWaypoint(null);
    setNearbyCategory(null);
    setNearbyPlaces([]);
  }, []);

  const fetchNearbyPlaces = useCallback(async (lat: number, lng: number, category: string) => {
    if (nearbyCategory === category) {
      setNearbyCategory(null);
      setNearbyPlaces([]);
      return;
    }
    setNearbyCategory(category);
    setNearbyPlaces([]);
    setNearbyLoading(true);
    try {
      const r = await fetch(`${BASE}/api/nearby-places?lat=${lat}&lng=${lng}&category=${category}&radius=600`);
      if (r.ok) {
        const data = await r.json() as { places: { id: string; name: string; category: string; lat: number; lng: number; distanceM: number; address?: string; phone?: string; website?: string }[] };
        setNearbyPlaces(data.places ?? []);
      }
    } catch {}
    setNearbyLoading(false);
  }, [nearbyCategory]);

  // ── Popup slide-in animation ──────────────────────────────────────────────
  const anySelected = !!(selectedEv || selectedGas || selectedDest || selectedWaypoint);
  useEffect(() => {
    Animated.spring(popupAnim, {
      toValue: anySelected ? 1 : 0,
      useNativeDriver: true,
      bounciness: 5,
      speed: 14,
    }).start();
  }, [anySelected]);

  // ── Derived ───────────────────────────────────────────────────────────────
  const activeRoute = allRoutes[activeRouteIdx] ?? null;
  const route = activeRoute?.coordinates ?? [];
  const routeInfo = activeRoute
    ? { distanceKm: activeRoute.distanceKm, durationMin: activeRoute.durationMin }
    : null;
  const routeSteps = activeRoute?.steps ?? [];
  const hasRoute = route.length > 0;
  const topPad = insets.top;
  // Smart Charger Match — calls POST /api/stations/match with vehicle spec
  const smartMatch = useSmartChargerMatch(
    userLoc?.latitude ?? null,
    userLoc?.longitude ?? null,
    primaryVehicle,
    {
      minArrivalSocPercent: minArrivalSoc,
      currentSocPercent: batteryPercent ?? undefined,
    },
  );

  const allEv = React.useMemo(() => {
    const base = hasRoute ? evStations : nearbyEv;
    let filtered = base;
    if (connectorFilter.length > 0) {
      filtered = filtered.filter((s) => {
        if (!s.connectorTypes?.length) return true;
        return s.connectorTypes.some((ct) =>
          connectorFilter.some(
            (f) => ct.toLowerCase().includes(f.toLowerCase()) || f.toLowerCase().includes(ct.toLowerCase()),
          ),
        );
      });
    }
    if (showAvailableOnly) {
      filtered = filtered.filter((s) => s.status === "available");
    }
    if (showBestOnly && bestForMeActive) {
      const goodIds = new Set(
        smartMatch.rankedStations
          .filter((s) => s.matchGrade === "A" || s.matchGrade === "B")
          .map((s) => s.id),
      );
      filtered = filtered.filter((s) => goodIds.has(s.id));
    }
    return filtered;
  }, [hasRoute, evStations, nearbyEv, connectorFilter, showAvailableOnly, showBestOnly, bestForMeActive, smartMatch.rankedStations]);

  // Phase 4 — station list items for the bottom sheet (EvStation → StationRowItem)
  const stationListItems = React.useMemo((): StationRowItem[] => {
    if (bestForMeActive) {
      return smartMatch.rankedStations.map((s) => ({
        id: s.id,
        name: s.name,
        address: s.address ?? null,
        city: s.city ?? null,
        status: s.status as StationRowItem["status"],
        chargerType: s.chargerType as StationRowItem["chargerType"],
        powerKw: s.powerKw ?? null,
        pricePerKwh: s.pricePerKwh ?? null,
        priceText: s.isFree
          ? "Free"
          : s.pricePerKwh
            ? `$${Number(s.pricePerKwh).toFixed(2)}/kWh`
            : null,
        isFree: s.isFree,
        availablePorts: s.availablePorts ?? null,
        totalPorts: s.totalPorts ?? null,
        distanceMiles: s.distanceMiles,
        network: s.network ?? null,
        matchScore: s.matchScore,
        matchGrade: s.matchGrade as StationRowItem["matchGrade"],
        matchReasons: s.matchReasons,
        matchFactors: (s as any).matchFactors ?? [],
        connectorCompatible: s.connectorCompatible,
      }));
    }
    return allEv.map((s) => ({
      id: s.id,
      name: s.name,
      address: s.address,
      city: s.city,
      status: s.status,
      chargerType: s.chargerType,
      powerKw: s.powerKw,
      pricePerKwh: s.pricePerKwh,
      priceText: s.priceText,
      isFree: s.isFree,
      availablePorts: s.availablePorts,
      totalPorts: s.totalPorts,
      distanceMiles: s.distanceMiles,
      network: s.network,
    }));
  }, [allEv, bestForMeActive, smartMatch.rankedStations]);

  // Build a fast id→grade lookup for map pin badges
  const gradeMap = React.useMemo((): Map<string, "A" | "B" | "C" | "D"> => {
    if (!bestForMeActive) return new Map();
    const m = new Map<string, "A" | "B" | "C" | "D">();
    for (const s of smartMatch.rankedStations) {
      if (s.matchGrade) m.set(s.id, s.matchGrade as "A" | "B" | "C" | "D");
    }
    return m;
  }, [bestForMeActive, smartMatch.rankedStations]);

  const allGas = React.useMemo(() => hasRoute ? gasStations : nearbyGas, [hasRoute, gasStations, nearbyGas]);

  // Current + next step for turn banner
  const currentStep = isNavigating && routeSteps.length > 0 ? routeSteps[currentStepIdx] ?? null : null;
  const nextStep = isNavigating && routeSteps.length > 0 ? routeSteps[currentStepIdx + 1] ?? null : null;
  // displayStep: the UPCOMING maneuver (nextStep when available, else the final arrive step).
  // This is what the banner shows — always the instruction you're heading toward, never the one
  // you already executed.  currentStep still represents the road segment you're currently on
  // (used for road-name label in the ETA strip).
  const displayStep = isNavigating ? (nextStep ?? currentStep) : null;
  // afterNextStep: the turn after the upcoming one, shown in the "then" preview pill.
  const afterNextStep = isNavigating && routeSteps.length > 0 ? routeSteps[currentStepIdx + 2] ?? null : null;

  // ETA: remaining time estimate from route progress
  const remainingFraction = route.length > 1 && routeProgressIdx > 0
    ? Math.max(0, 1 - routeProgressIdx / route.length)
    : 1;
  const remainingMin = Math.max(0, Math.round((routeInfo?.durationMin ?? 0) * remainingFraction));
  const remainingKm = (routeInfo?.distanceKm ?? 0) * remainingFraction;
  const etaDate = routeInfo
    ? new Date(Date.now() + remainingMin * 60000)
    : null;
  const etaStr = etaDate
    ? etaDate.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : null;

  // ── Walking live stats (derived from remaining route fraction) ───────────
  const walkTotalSteps    = routeInfo ? walkSteps(routeInfo.distanceKm) : 0;
  const walkTotalCalories = routeInfo ? walkCalories(routeInfo.distanceKm, walkPace) : 0;
  const walkRemainingSteps    = Math.round(walkTotalSteps * remainingFraction);
  const walkBurnedCalories    = Math.round(walkTotalCalories * (1 - remainingFraction));

  const lastUpdatedText = lastRefreshed
    ? (() => {
        const secs = Math.floor((Date.now() - lastRefreshed.getTime()) / 1000);
        if (secs < 10) return "just now";
        if (secs < 60) return `${secs}s ago`;
        return `${Math.floor(secs / 60)}m ago`;
      })()
    : null;

  // Safe polyline slices — memoized so GPS ticks only allocate new arrays when coords actually change
  const passedCoords = React.useMemo(() => {
    if (!isNavigating || routeProgressIdx <= 0) return [];
    if (routeProgressInterp) return [...route.slice(0, routeProgressIdx + 1), routeProgressInterp];
    return route.slice(0, routeProgressIdx + 1);
  }, [isNavigating, routeProgressIdx, routeProgressInterp, route]);
  const remainingCoords = React.useMemo(() => {
    if (isNavigating && routeProgressInterp) return [routeProgressInterp, ...route.slice(routeProgressIdx + 1)];
    return route;
  }, [isNavigating, routeProgressInterp, routeProgressIdx, route]);
  const safeAltRoutes = altRoutes.filter((a) => a.coordinates.length >= 2);

  // ══════════════════════════════════════════════════════════════════════════
  // WEB FALLBACK
  // ══════════════════════════════════════════════════════════════════════════
  if (isWeb) {
    return (
      <View style={[S.root, { backgroundColor: colors.background }]}>
        <View style={[S.webHeader, { paddingTop: topPad + 14, backgroundColor: colors.background, borderBottomColor: colors.border }]}>
          <Text style={[S.title, { color: colors.foreground }]}>Live Map</Text>
          <Text style={[S.sub, { color: colors.mutedForeground }]}>Web preview — open on device for full navigation</Text>
        </View>
        <View style={{ flex: 1, position: "relative" }}>
          <WebLeafletMap stations={evStations} userLat={userLoc?.latitude ?? null} userLng={userLoc?.longitude ?? null} />
        </View>
      </View>
    );
  }

  // ══════════════════════════════════════════════════════════════════════════
  // NATIVE MAP
  // ══════════════════════════════════════════════════════════════════════════
  return (
    <View style={S.root}>
      <WallpaperLayer tab="map" />
      <AllTabsWallpaperPicker visible={pickerOpen} onClose={() => setPickerOpen(false)} />
      {/* ── Active Session floating banner ── */}
      {session && (
        <ActiveSessionMapBanner session={session} bottomInset={insets.bottom} />
      )}
      {/* ── Full-screen map ── */}
      <MapView
        ref={mapRef}
        style={StyleSheet.absoluteFill}
        provider={Platform.OS === "android" ? PROVIDER_GOOGLE : PROVIDER_DEFAULT}
        mapType={mapType}
        userInterfaceStyle="dark"
        showsTraffic={true}
        showsUserLocation={true}
        showsMyLocationButton={false}
        showsCompass={true}
        showsScale={false}
        pitchEnabled={true}
        rotateEnabled={true}
        initialRegion={
          userLoc
            ? { ...userLoc, latitudeDelta: 0.06, longitudeDelta: 0.06 }
            : cachedRegion ?? { latitude: 37.7749, longitude: -122.4194, latitudeDelta: 0.3, longitudeDelta: 0.3 }
        }
        onPress={clearSelection}
        onRegionChangeComplete={onRegionChangeComplete}
        onPanDrag={() => {
          if (!isNavigatingRef.current) return;
          if (!userInteractingRef.current) {
            userInteractingRef.current = true;
            setNavCameraFree(true);
          }
          if (navCameraFreeTimerRef.current) clearTimeout(navCameraFreeTimerRef.current);
          navCameraFreeTimerRef.current = setTimeout(() => {
            navCameraFreeTimerRef.current = null;
            userInteractingRef.current = false;
            if (isMountedRef.current) setNavCameraFree(false);
          }, 10000);
        }}
      >
        {/* Alternative routes (gray, tappable) — all non-active routes */}
        {!isNavigating && allRoutes
          .map((r, i) => ({ r, i }))
          .filter(({ i, r }) => i !== activeRouteIdx && r.coordinates.length >= 2)
          .map(({ r, i }) => (
            <Polyline
              key={`alt-${i}`}
              coordinates={r.coordinates}
              strokeColor="#94a3b8"
              strokeWidth={5}
              lineCap="round"
              lineJoin="round"
              tappable
              onPress={() => selectRoute(i)}
            />
          ))}

        {/* Route: passed segment (gray) */}
        {passedCoords.length >= 2 && (
          <Polyline
            coordinates={passedCoords}
            strokeColor="#64748b"
            strokeWidth={5}
            lineCap="round"
            lineJoin="round"
          />
        )}
        {/* Route: remaining segment (teal) */}
        {remainingCoords.length >= 2 && (
          <Polyline
            coordinates={remainingCoords}
            strokeColor="#0D9E7E"
            strokeWidth={7}
            lineCap="round"
            lineJoin="round"
          />
        )}

        {/* Transit itinerary leg polylines */}
        {transitItinerary && transitItinerary.legs.map((leg, i) =>
          leg.coordinates.length >= 2 ? (
            <Polyline
              key={`transit-leg-${i}`}
              coordinates={leg.coordinates}
              strokeColor={leg.type === "transit" ? "#6366f1" : "#0D9E7E"}
              strokeWidth={leg.type === "transit" ? 5 : 5}
              lineDashPattern={leg.type === "transit" ? [12, 6] : undefined}
              lineCap="round"
              lineJoin="round"
            />
          ) : null
        )}
        {/* Boarding / alighting stop markers */}
        {transitItinerary && (() => {
          const tLeg = transitItinerary.legs.find((l) => l.type === "transit");
          if (!tLeg) return null;
          return (
            <>
              <Marker coordinate={tLeg.from} anchor={{ x: 0.5, y: 0.5 }}>
                <View style={{ width: 16, height: 16, borderRadius: 8, backgroundColor: "#6366f1", borderWidth: 2, borderColor: "#fff" }} />
              </Marker>
              <Marker coordinate={tLeg.to} anchor={{ x: 0.5, y: 0.5 }}>
                <View style={{ width: 16, height: 16, borderRadius: 8, backgroundColor: "#6366f1", borderWidth: 2, borderColor: "#fff" }} />
              </Marker>
            </>
          );
        })()}

        {/* Destination pin */}
        {dest && (
          <Marker
            coordinate={dest}
            pinColor={selectedDest ? "#c0392b" : "#ef4444"}
            onPress={() => {
              pinJustTappedRef.current = true;
              setSelectedDest(true);
              setSelectedEv(null);
              setSelectedGas(null);
              setSelectedWaypoint(null);
              Haptics.selectionAsync();
              mapRef.current?.animateToRegion(
                { latitude: dest.latitude, longitude: dest.longitude, latitudeDelta: 0.018, longitudeDelta: 0.018 },
                400
              );
            }}
          />
        )}

        {/* Trip waypoint markers (intermediate stops) */}
        {tripWaypoints.slice(0, -1).map((wp, idx) => (
          <Marker
            key={wp.id}
            coordinate={wp.loc}
            onPress={() => {
              pinJustTappedRef.current = true;
              setSelectedWaypoint(wp);
              setSelectedEv(null);
              setSelectedGas(null);
              setSelectedDest(false);
              Haptics.selectionAsync();
              mapRef.current?.animateToRegion(
                { latitude: wp.loc.latitude, longitude: wp.loc.longitude, latitudeDelta: 0.018, longitudeDelta: 0.018 },
                400
              );
            }}
          >
            <View style={[S.tripWpPin, selectedWaypoint?.id === wp.id && { backgroundColor: "#2563eb" }]}>
              <Text style={S.tripWpPinTxt}>{idx + 1}</Text>
            </View>
          </Marker>
        ))}

        {/* EV station pins (all modes unified) */}
        {allEv.map((s) => (
          <Marker
            key={`ev-${s.id}`}
            coordinate={{ latitude: s.lat, longitude: s.lng }}
            tracksViewChanges={false}
            onPress={() => {
              pinJustTappedRef.current = true;
              setSelectedEv(s);
              setSelectedGas(null);
              Haptics.selectionAsync();
              mapRef.current?.animateToRegion(
                { latitude: s.lat, longitude: s.lng, latitudeDelta: 0.018, longitudeDelta: 0.018 },
                400
              );
            }}
          >
            <EvPin status={s.status} selected={selectedEv?.id === s.id} availablePorts={s.availablePorts} totalPorts={s.totalPorts} isFavorited={/^\d+$/.test(s.id) && favoritedIds.has(Number(s.id))} matchGrade={gradeMap.get(s.id) ?? null} bestForMeActive={bestForMeActive} />
          </Marker>
        ))}

        {/* Gas station pins (all modes unified) */}
        {allGas.map((s, idx) => (
          <Marker
            key={`gas-${s.id ?? `${s.lat.toFixed(5)},${s.lng.toFixed(5)}`}-${idx}`}
            coordinate={{ latitude: s.lat, longitude: s.lng }}
            tracksViewChanges={false}
            onPress={() => {
              pinJustTappedRef.current = true;
              setSelectedGas(s);
              setSelectedEv(null);
              Haptics.selectionAsync();
              mapRef.current?.animateToRegion(
                { latitude: s.lat, longitude: s.lng, latitudeDelta: 0.018, longitudeDelta: 0.018 },
                400
              );
            }}
          >
            <GasPin selected={selectedGas?.id === s.id} />
          </Marker>
        ))}
      </MapView>

      {/* ── Phase 4: Station discovery bottom sheet ── */}
      {!isNavigating && !arrived && (
        <MapBottomSheet
          snapIdx={sheetSnapIdx}
          onSnapChange={setSheetSnapIdx}
          stationCount={allEv.length}
          lastRefreshed={lastRefreshed}
          isRefreshing={isRefreshing}
          onRefresh={() => doRefresh(false)}
          hidden={anySelected}
          filterContent={
            <View>
              <MapFilterPills
                activeTypes={connectorFilter}
                showAvailableOnly={showAvailableOnly}
                bestForMeActive={bestForMeActive}
                showBestOnly={showBestOnly}
                hasPrimaryVehicle={primaryVehicle != null}
                onToggleType={(type) =>
                  setConnectorFilter((prev) =>
                    prev.includes(type)
                      ? prev.filter((t) => t !== type)
                      : [...prev, type],
                  )
                }
                onToggleAvailable={() => setShowAvailableOnly((v) => !v)}
                onToggleBestForMe={() => {
                  setBestForMeActive((v) => {
                    if (v) setShowBestOnly(false);
                    return !v;
                  });
                }}
                onToggleBestOnly={() => setShowBestOnly((v) => !v)}
                onClearAll={() => {
                  setConnectorFilter([]);
                  setShowAvailableOnly(false);
                  setBestForMeActive(false);
                  setShowBestOnly(false);
                }}
              />
              {/* Min-arrival SoC picker — shown only when Best for Me is active */}
              {bestForMeActive && primaryVehicle != null && (
                <View style={S.socPickerRow}>
                  <Text style={S.socPickerLabel}>Reserve on arrival</Text>
                  {[5, 10, 15, 20, 25].map((pct) => (
                    <TouchableOpacity
                      key={pct}
                      onPress={() => {
                        Haptics.selectionAsync();
                        setMinArrivalSoc(pct);
                      }}
                      style={[
                        S.socChip,
                        minArrivalSoc === pct && S.socChipActive,
                      ]}
                    >
                      <Text
                        style={[
                          S.socChipText,
                          minArrivalSoc === pct && S.socChipTextActive,
                        ]}
                      >
                        {pct}%
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              )}
            </View>
          }
        >
          {/* Best Match Banner — shown above the list when "Best for Me" is active */}
          {bestForMeActive && smartMatch.topStation != null && primaryVehicle != null && (
            <BestMatchBanner
              stationName={smartMatch.topStation.name}
              matchGrade={smartMatch.topStation.matchGrade ?? "B"}
              matchScore={smartMatch.topStation.matchScore ?? 0}
              matchReasons={smartMatch.topStation.matchReasons ?? []}
              matchFactors={(smartMatch.topStation as any).matchFactors ?? []}
              vehicleName={[primaryVehicle.make, primaryVehicle.model].filter(Boolean).join(" ") || "your vehicle"}
              onWhyPress={() => {
                const top = smartMatch.topStation!;
                const factors = (top as any).matchFactors as import("@/lib/vehicleMatch").MatchFactor[] | undefined;
                if (factors?.length && top.matchGrade && top.matchScore != null) {
                  setExplainStation({
                    name: top.name,
                    matchScore: top.matchScore,
                    matchGrade: top.matchGrade as "A" | "B" | "C" | "D",
                    matchFactors: factors,
                  });
                }
              }}
              onPress={() => {
                const top = smartMatch.topStation!;
                // Try to find the station in allEv for full detail sheet.
                // If not found (NREL/OCM source), animate map to coordinates directly.
                const ev = allEv.find((e) => e.id === top.id);
                pinJustTappedRef.current = true;
                if (ev) {
                  setSelectedEv(ev);
                  setSelectedGas(null);
                }
                setSheetSnapIdx(SHEET_SNAP_PEEK);
                mapRef.current?.animateToRegion(
                  { latitude: top.lat, longitude: top.lng, latitudeDelta: 0.018, longitudeDelta: 0.018 },
                  400,
                );
              }}
            />
          )}
          <FlatList
            data={stationListItems}
            keyExtractor={(item) => item.id}
            renderItem={({ item }) => (
              <StationListRow
                station={item}
                isSelected={selectedEv?.id === item.id}
                onPress={(s) => {
                  const ev = allEv.find((e) => e.id === s.id);
                  if (!ev) return;
                  pinJustTappedRef.current = true;
                  setSelectedEv(ev);
                  setSelectedGas(null);
                  Haptics.selectionAsync();
                  setSheetSnapIdx(SHEET_SNAP_PEEK);
                  mapRef.current?.animateToRegion(
                    {
                      latitude: ev.lat,
                      longitude: ev.lng,
                      latitudeDelta: 0.018,
                      longitudeDelta: 0.018,
                    },
                    400,
                  );
                }}
                onWhyPress={
                  bestForMeActive
                    ? (s) => {
                        if (s.matchFactors?.length && s.matchGrade && s.matchScore != null) {
                          setExplainStation({
                            name: s.name,
                            matchScore: s.matchScore,
                            matchGrade: s.matchGrade,
                            matchFactors: s.matchFactors,
                          });
                        }
                      }
                    : undefined
                }
              />
            )}
            showsVerticalScrollIndicator={false}
            contentContainerStyle={{ paddingBottom: 120 }}
            ListEmptyComponent={
              isRefreshing ? (
                <View style={{ paddingHorizontal: 16, paddingVertical: 8, gap: 8 }}>
                  <SkeletonCard lines={2} />
                  <SkeletonCard lines={2} />
                  <SkeletonCard lines={2} />
                </View>
              ) : !userLoc ? (
                <EmptyState
                  compact
                  icon={<Ionicons name="location-outline" size={28} color="#1bc99a" />}
                  iconColor="#1bc99a"
                  title="Location Required"
                  body="Enable location permissions to find nearby charging stations"
                />
              ) : (
                <EmptyState
                  compact
                  icon={<Ionicons name="flash-outline" size={28} color="#94a3b8" />}
                  iconColor="#94a3b8"
                  title="No stations match"
                  body={
                    bestForMeActive
                      ? "No compatible stations found nearby. Try clearing Best for Me or zooming out."
                      : connectorFilter.length > 0 || showAvailableOnly
                        ? "Try clearing your filters or zooming out"
                        : "No stations found in this area"
                  }
                  action={
                    connectorFilter.length > 0 || showAvailableOnly || bestForMeActive
                      ? {
                          label: "Clear Filters",
                          onPress: () => {
                            setConnectorFilter([]);
                            setShowAvailableOnly(false);
                            setBestForMeActive(false);
                          },
                          variant: "secondary" as const,
                        }
                      : undefined
                  }
                />
              )
            }
          />
        </MapBottomSheet>
      )}

      {/* ── Match Explanation Sheet ("Why?" modal) ── */}
      {explainStation != null && (
        <MatchExplanationSheet
          visible
          stationName={explainStation.name}
          matchScore={explainStation.matchScore}
          matchGrade={explainStation.matchGrade}
          matchFactors={explainStation.matchFactors}
          onClose={() => setExplainStation(null)}
        />
      )}

      {/* ── Turn-by-turn banner (replaces search bar during active navigation) ── */}
      {isNavigating && !arrived && (
        <>
          {recalcBannerVisible ? (
            <View style={[S.recalcBanner, { top: topPad + 10 }]}>
              <ActivityIndicator size={16} color="#fff" />
              <Text style={S.recalcBannerTxt}>Recalculating…</Text>
            </View>
          ) : currentStep ? (
            navPillsVisible ? (
              <View style={[S.turnBanner, { top: topPad + 10 }]}>
                <TouchableOpacity style={{ flex: 1 }} onPress={() => setShowStepList(true)} activeOpacity={0.95}>
                  {/* ── Main instruction row ── */}
                  {/* displayStep = nextStep ?? currentStep: always shows the UPCOMING maneuver,
                      never the road segment the user is already on.  Distance counter still
                      counts down to nextStep.coordinate so the number and label stay in sync. */}
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                    {/* Maneuver icon */}
                    <View style={S.turnIconBox}>
                      <Feather name={(displayStep ?? currentStep)!.featherIcon as "arrow-up"} size={22} color="#fff" />
                    </View>
                    {/* Instruction + street name */}
                    <View style={{ flex: 1 }}>
                      <Text style={S.turnInstruction} numberOfLines={2}>{(displayStep ?? currentStep)!.instruction}</Text>
                      {(displayStep ?? currentStep)!.streetName ? (
                        <Text style={S.turnStreet} numberOfLines={1}>{(displayStep ?? currentStep)!.streetName}</Text>
                      ) : null}
                    </View>
                    {/* Distance to next maneuver */}
                    <View style={S.turnDistBox}>
                      <Text style={S.turnDist}>
                        {nextStep ? distToPoint(userLoc, nextStep.coordinate) : "Arrive"}
                      </Text>
                      <Feather name="list" size={8} color="#64748b" style={{ marginTop: 3 }} />
                    </View>
                  </View>

                  {/* ── Lane guidance for the upcoming maneuver ── */}
                  {(displayStep ?? currentStep)!.lanes && (displayStep ?? currentStep)!.lanes!.length > 0 && (
                    <View style={S.laneSection}>
                      <Text style={S.laneLabel}>LANES</Text>
                      <View style={{ flexDirection: "row", gap: 4 }}>
                        {(displayStep ?? currentStep)!.lanes!.map((lane, i) => (
                          <View key={i} style={[S.laneBox, lane.valid && S.laneBoxValid]}>
                            <Text style={[S.laneArrow, lane.valid && S.laneArrowValid]}>
                              {laneIndToArrow(lane.indications[0] ?? "straight")}
                            </Text>
                            {lane.valid && <Text style={S.laneUse}>USE</Text>}
                          </View>
                        ))}
                      </View>
                    </View>
                  )}

                  {/* ── After-next preview ("then …") ── */}
                  {/* afterNextStep is currentStepIdx+2 — the turn after the one already shown above */}
                  {afterNextStep && (
                    <View style={S.thenPill}>
                      <Text style={S.thenLabel}>then</Text>
                      <Feather name={afterNextStep.featherIcon as "arrow-up"} size={8} color="#6b7280" />
                      <Text style={S.thenTxt} numberOfLines={1}>{afterNextStep.instruction}</Text>
                    </View>
                  )}
                </TouchableOpacity>

                {/* ── Voice controls ── */}
                <View style={{ gap: 3, alignItems: "center", paddingLeft: 2 }}>
                  <TouchableOpacity
                    onPress={() => { setVoiceMuted((m) => !m); Haptics.selectionAsync(); }}
                    style={{ padding: 4 }}
                    hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                    activeOpacity={0.7}
                  >
                    <Feather name={voiceMuted ? "volume-x" : "volume-2"} size={10} color={voiceMuted ? "#475569" : "#fff"} />
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={() => { setVoiceSettingsOpen(true); Haptics.selectionAsync(); }}
                    style={{ padding: 4 }}
                    hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                    activeOpacity={0.7}
                  >
                    <Feather name="settings" size={8} color="#64748b" />
                  </TouchableOpacity>
                </View>
              </View>
            ) : (
              <TouchableOpacity
                style={[S.navPillMinBar, { top: topPad + 10 }]}
                onPress={() => { setNavPillsVisible(true); navPillsVisibleRef.current = true; if (navPillsTimerRef.current) clearTimeout(navPillsTimerRef.current); navPillsTimerRef.current = setTimeout(() => { navPillsTimerRef.current = null; if (!isMountedRef.current) return; setNavPillsVisible(false); navPillsVisibleRef.current = false; }, 40000); Haptics.selectionAsync(); }}
                activeOpacity={0.85}
              >
                <Feather name={(displayStep ?? currentStep)!.featherIcon as "arrow-up"} size={28} color="#fff" />
                <View style={{ flex: 1 }}>
                  <Text style={S.navPillMinTxt} numberOfLines={1}>{(displayStep ?? currentStep)!.instruction}</Text>
                  {/* Lane guidance — shown in minimized pill so driver sees which lane to take */}
                  {(displayStep ?? currentStep)!.lanes && (displayStep ?? currentStep)!.lanes!.length > 0 && (
                    <View style={S.pillMinLaneRow}>
                      {(displayStep ?? currentStep)!.lanes!.map((lane, i) => (
                        <Text key={i} style={[S.pillMinLaneArrow, lane.valid && S.pillMinLaneArrowValid]}>
                          {laneIndToArrow(lane.indications[0] ?? "straight")}
                        </Text>
                      ))}
                    </View>
                  )}
                </View>
                <Text style={S.navPillMinDist}>{nextStep ? distToPoint(userLoc, nextStep.coordinate) : "Arrive"}</Text>
                <Feather name="chevron-down" size={22} color="rgba(255,255,255,0.4)" />
              </TouchableOpacity>
            )
          ) : null}
        </>
      )}

      {NAV_EVIDENCE_CAPTURE_ENABLED && isNavigating && !arrived ? (
        <View style={[S.navEvidenceCaptureHost, { top: topPad + 138 }]}>
          <NavEvidenceCapturePanel
            capture={navEvidenceCapture}
            onArm={armEvidenceCapture}
          />
        </View>
      ) : null}

      {/* ── EV Arrival Card (2–3 min out) / Destination Ahead card (500m) ── */}
      {isNavigating && !arrived && destNear && (() => {
        const ev = navDestEvRef.current;
        if (ev && evArrivalVisible) {
          // Rich EV Arrival Card — unique to ChargeBridge
          const priceLabel = ev.isFree ? "Free charging" : ev.priceText ?? (ev.pricePerKwh ? `$${Number(ev.pricePerKwh).toFixed(2)}/kWh` : null);
          const portLabel = ev.totalPorts != null
            ? ev.availablePorts != null
              ? `${ev.availablePorts}/${ev.totalPorts} ports available`
              : `${ev.totalPorts} ports`
            : null;
          return (
            <Animated.View style={[S.evArrivalCard, { top: topPad + 72 }]}>
              {/* Header row */}
              <View style={S.evArrivalHeader}>
                <View style={S.evArrivalIconWrap}>
                  <Ionicons name="flash" size={18} color="#0D9E7E" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={S.evArrivalHeadline}>⚡ Arriving Soon</Text>
                  <Text style={S.evArrivalStation} numberOfLines={1}>{ev.name}</Text>
                </View>
                <TouchableOpacity
                  onPress={() => { setEvArrivalVisible(false); Haptics.selectionAsync(); }}
                  style={{ padding: 6 }}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                  <Feather name="x" size={14} color="#64748b" />
                </TouchableOpacity>
              </View>
              {/* Details grid */}
              <View style={S.evArrivalGrid}>
                {priceLabel && (
                  <View style={S.evArrivalChip}>
                    <Feather name="dollar-sign" size={10} color="#0D9E7E" />
                    <Text style={S.evArrivalChipTxt}>{priceLabel}</Text>
                  </View>
                )}
                {portLabel && (
                  <View style={[S.evArrivalChip, (ev.availablePorts ?? 0) > 0 ? S.evArrivalChipAvail : S.evArrivalChipBusy]}>
                    <Feather name="zap" size={10} color={(ev.availablePorts ?? 0) > 0 ? "#22c55e" : "#f97316"} />
                    <Text style={[S.evArrivalChipTxt, { color: (ev.availablePorts ?? 0) > 0 ? "#22c55e" : "#f97316" }]}>{portLabel}</Text>
                  </View>
                )}
                {ev.chargerType && (
                  <View style={S.evArrivalChip}>
                    <Feather name="cpu" size={10} color="#60a5fa" />
                    <Text style={[S.evArrivalChipTxt, { color: "#60a5fa" }]}>{ev.chargerType}</Text>
                  </View>
                )}
                {ev.connectorTypes?.length > 0 && (
                  <View style={S.evArrivalChip}>
                    <Feather name="link" size={10} color="#a78bfa" />
                    <Text style={[S.evArrivalChipTxt, { color: "#a78bfa" }]} numberOfLines={1}>{ev.connectorTypes.slice(0,2).join(" · ")}</Text>
                  </View>
                )}
              </View>
              {/* CTA */}
              <TouchableOpacity
                style={S.evArrivalBtn}
                onPress={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                  setEvArrivalVisible(false);
                }}
                activeOpacity={0.85}
              >
                <Ionicons name="flash" size={14} color="#fff" />
                <Text style={S.evArrivalBtnTxt}>Ready to Charge on Arrival</Text>
              </TouchableOpacity>
            </Animated.View>
          );
        }
        // Fallback: simple destination-ahead card for non-EV destinations
        return (
          <View style={[S.destNearCard, { top: topPad + 72 }]}>
            <View style={S.destNearIconWrap}>
              <Feather name="map-pin" size={18} color="#0D9E7E" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={S.destNearLabel}>Destination Ahead</Text>
              <Text style={S.destNearName} numberOfLines={1}>{destLabel || "Your destination"}</Text>
            </View>
          </View>
        );
      })()}

      {/* ── Faster route available banner ── */}
      {isNavigating && !arrived && fasterRoute && (
        <View style={[S.fasterRouteBanner, { top: topPad + 88 }]}>
          <Feather name="zap" size={13} color="#4ade80" />
          <Text style={S.fasterRouteTxt} numberOfLines={1}>
            Faster route — saves {fasterRoute.savesMin} min
          </Text>
          <TouchableOpacity
            style={S.fasterRouteAcceptBtn}
            onPress={() => {
              const r = fasterRoute.result;
              routeCoordRef.current = r.coordinates;
              routeStepsRef.current = r.steps;
              setAllRoutes([r]);
              setAltRoutes(r.altRoutes);
              setCurrentStepIdx(0);
              voiceAnnouncedRef.current = {};
              offRouteCountRef.current = 0;
              navState.steps = r.steps.map((s) => ({
                instruction: s.instruction, featherIcon: s.featherIcon, coordinate: s.coordinate,
              }));
              navState.currentStepIdx = 0;
              // Reset so the next background→active sync does not suppress
              // voice guidance for the new (faster) route's steps.
              navState.lastNotifiedStepIdx = -1;
              navState.notifiedStepIndices = new Set();
              navState.routeCoords      = r.coordinates;
              navState.offRouteCount    = 0;
              navState.offRouteStartMs  = 0;
              navState.offRouteDetected = false;
              setFasterRoute(null);
              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            }}
            activeOpacity={0.85}
          >
            <Text style={{ color: "#fff", fontSize: 12, fontWeight: "700", fontFamily: "Inter_700Bold" }}>Use</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => setFasterRoute(null)} style={{ padding: 5 }} hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}>
            <Feather name="x" size={14} color="#64748b" />
          </TouchableOpacity>
        </View>
      )}

      {/* ── Alternative routes strip (shown after recalculation) ── */}
      {isNavigating && !arrived && recalcAltVisible && recalcAltRoutes.length > 0 && (
        <View style={[S.recalcAltContainer, { top: topPad + (fasterRoute ? 130 : 88) }]}>
          <Text style={S.recalcAltLabel}>Also available:</Text>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ gap: 8, paddingRight: 4 }}
          >
            {recalcAltRoutes.map((alt, i) => (
              <TouchableOpacity
                key={i}
                style={S.recalcAltChip}
                onPress={() => {
                  routeCoordRef.current = alt.coordinates;
                  routeStepsRef.current = alt.steps;
                  setAllRoutes([alt]);
                  setCurrentStepIdx(0);
                  voiceAnnouncedRef.current = {};
                  offRouteCountRef.current = 0;
                  navState.steps = alt.steps.map((s) => ({
                    instruction: s.instruction, featherIcon: s.featherIcon, coordinate: s.coordinate,
                  }));
                  navState.currentStepIdx = 0;
                  // Reset so the next background→active sync does not suppress
                  // voice guidance for the selected alternative route's steps.
                  navState.lastNotifiedStepIdx = -1;
                  navState.notifiedStepIndices = new Set();
                  navState.routeCoords      = alt.coordinates;
                  navState.offRouteCount    = 0;
                  navState.offRouteStartMs  = 0;
                  navState.offRouteDetected = false;
                  setRecalcAltVisible(false);
                  Haptics.selectionAsync();
                }}
                activeOpacity={0.8}
              >
                <Text style={S.recalcAltChipLabel}>Option {i + 2}</Text>
                <Text style={S.recalcAltChipTime}>{formatDuration(alt.durationMin)}</Text>
                <Text style={S.recalcAltChipDist}>{formatDistance(alt.distanceKm)}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>
      )}

      {/* ── Search bar (hidden during navigation) ── */}
      {!isNavigating && (
        <View style={[S.searchBar, { top: topPad + 10 }]} pointerEvents="box-none">
          {/* Wallpaper picker button — top-right corner */}
          <TouchableOpacity
            style={S.mapWallpaperBtn}
            onPress={() => { setPickerOpen(true); Haptics.selectionAsync(); }}
            activeOpacity={0.85}
          >
            <Ionicons name="color-palette-outline" size={17} color="#0D9E7E" />
          </TouchableOpacity>

          <TouchableOpacity
            style={S.searchPill}
            onPress={() => {
              setDestQuery("");
              setSearchResults([]);
              setSearchNoResults(false);
              setSearchBusy(false);
              setActiveSearchField("to");
              if (debounceRef.current) clearTimeout(debounceRef.current);
              setSearchOpen(true);
              Haptics.selectionAsync();
            }}
            activeOpacity={0.9}
          >
            <View style={S.searchIcon}>
              <Feather name="search" size={16} color="#0D9E7E" />
            </View>
            <View style={{ flex: 1 }}>
              {destLabel ? (
                <>
                  <Text style={S.searchTo} numberOfLines={1}>{destLabel}</Text>
                  <Text style={S.searchFrom}>From: My Location</Text>
                </>
              ) : (
                <Text style={S.searchPlaceholder}>Where to? Search destination…</Text>
              )}
            </View>
            {destLabel ? (
              <TouchableOpacity onPress={clearRoute} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                <Feather name="x" size={18} color="#94a3b8" />
              </TouchableOpacity>
            ) : null}
          </TouchableOpacity>

          {/* Plan Trip button — only when no active destination */}
          {!dest && !routeLoading && (
            <TouchableOpacity
              style={S.tripPlanBtn}
              onPress={() => { setTripInitialWaypoints([]); setTripOpen(true); Haptics.selectionAsync(); }}
              activeOpacity={0.85}
            >
              <Feather name="list" size={13} color="#0D9E7E" />
              <Text style={S.tripPlanBtnTxt}>Plan Multi-Stop Trip</Text>
            </TouchableOpacity>
          )}

          {/* Transit Near You — always accessible without a destination */}
          {!dest && !routeLoading && (
            <TouchableOpacity
              style={[S.tripPlanBtn, { backgroundColor: "#6366f114", borderColor: "#6366f130" }]}
              onPress={() => { setShowTransitPanel(true); Haptics.selectionAsync(); }}
              activeOpacity={0.85}
            >
              <Ionicons name="bus-outline" size={14} color="#6366f1" />
              <Text style={[S.tripPlanBtnTxt, { color: "#6366f1" }]}>Transit Near You</Text>
            </TouchableOpacity>
          )}

          {/* Add Stop button — when a single-destination route is active */}
          {dest && !routeLoading && !isNavigating && (
            <TouchableOpacity
              style={S.addStopBtn}
              onPress={convertRouteToTrip}
              activeOpacity={0.85}
            >
              <Feather name="plus-circle" size={13} color="#3b82f6" />
              <Text style={S.addStopBtnTxt}>Add a Stop</Text>
            </TouchableOpacity>
          )}

          {/* Transport mode selector — visible whenever a destination is active */}
          {(dest || routeLoading) && (
            <View style={S.modeRow} pointerEvents="box-none">
              {(
                [
                  { key: "driving",  feather: "truck",   label: "Drive"   },
                  { key: "walking",  feather: "user",    label: "Walk"    },
                  { key: "cycling",  feather: null,      label: "Bike"    },
                  { key: "transit",  feather: "map",     label: "Transit" },
                ] as { key: "driving" | "walking" | "cycling" | "transit"; feather: string | null; label: string }[]
              ).map(({ key, feather, label }) => (
                <TouchableOpacity
                  key={key}
                  style={[S.modeBtn, navMode === key && S.modeBtnActive]}
                  onPress={() => {
                    Haptics.selectionAsync();
                    setNavMode(key);
                  }}
                  activeOpacity={0.8}
                >
                  {feather
                    ? <Feather name={feather as "truck"} size={13} color={navMode === key ? "#fff" : "#64748b"} />
                    : <Ionicons name="bicycle-outline" size={15} color={navMode === key ? "#fff" : "#64748b"} />
                  }
                  <Text style={[S.modeBtnTxt, navMode === key && { color: "#fff" }]}>{label}</Text>
                </TouchableOpacity>
              ))}
            </View>
          )}

          {/* ── Transit panel ── */}
          {showTransitPanel && (
            <View style={S.transitPanel}>
              {/* Header */}
              <View style={S.transitHeader}>
                <Ionicons name="bus-outline" size={16} color="#6366f1" />
                <Text style={S.transitHeaderTxt}>Transit Near You</Text>
                {transitLoading && <ActivityIndicator size={12} color="#6366f1" style={{ marginLeft: 4 }} />}
                <TouchableOpacity
                  style={S.transitCloseBtn}
                  onPress={() => { setShowTransitPanel(false); if (navMode === "transit") setNavMode("driving"); }}
                  hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                >
                  <Feather name="x" size={15} color="#94a3b8" />
                </TouchableOpacity>
              </View>

              {/* Stop list */}
              {!transitLoading && transitStops.length === 0 && (
                <Text style={S.transitEmpty}>No transit stops found nearby.</Text>
              )}
              {transitStops.length > 0 && (
                <ScrollView
                  style={{ maxHeight: 220 }}
                  showsVerticalScrollIndicator={false}
                  nestedScrollEnabled
                >
                  {transitStops.map((stop) => {
                    const typeIcon =
                      stop.stopType === "train" ? "train-outline" :
                      stop.stopType === "subway" ? "subway-outline" :
                      stop.stopType === "tram" ? "train-outline" : "bus-outline";
                    const typeColor =
                      stop.stopType === "train" ? "#f59e0b" :
                      stop.stopType === "subway" ? "#8b5cf6" :
                      stop.stopType === "tram" ? "#10b981" : "#6366f1";
                    const distStr = stop.distanceM < 1000
                      ? `${stop.distanceM} m`
                      : `${(stop.distanceM / 1609.34).toFixed(1)} mi`;
                    const mapsUrl = Platform.OS === "ios"
                      ? `maps://maps.apple.com/?ll=${stop.lat},${stop.lng}&q=${encodeURIComponent(stop.name)}`
                      : `https://maps.google.com/?q=${stop.lat},${stop.lng}`;
                    return (
                      <View key={stop.id} style={S.transitStopRow}>
                        <View style={[S.transitStopIcon, { backgroundColor: typeColor + "18" }]}>
                          <Ionicons name={typeIcon as "bus-outline"} size={16} color={typeColor} />
                        </View>
                        <View style={{ flex: 1 }}>
                          <Text style={S.transitStopName} numberOfLines={1}>{stop.name}</Text>
                          <View style={{ flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                            {stop.routes ? (
                              <Text style={S.transitRoutes} numberOfLines={1}>
                                {stop.stopType === "bus" ? "Lines: " : ""}
                                {stop.routes}
                              </Text>
                            ) : null}
                            {stop.operator ? (
                              <Text style={S.transitOperator} numberOfLines={1}>· {stop.operator}</Text>
                            ) : null}
                            <Text style={S.transitDist}>{distStr}</Text>
                          </View>
                          {/* Live departures from Transitland — matched by proximity */}
                          {(() => {
                            const stopLoc = { latitude: stop.lat, longitude: stop.lng };
                            const toRad2 = (d: number) => (d * Math.PI) / 180;
                            const closest = tlNearbyStops
                              .map((ts) => {
                                const dlat = toRad2(ts.lat - stop.lat);
                                const dlng = toRad2(ts.lng - stop.lng);
                                const a = Math.sin(dlat / 2) ** 2 + Math.cos(toRad2(stop.lat)) * Math.cos(toRad2(ts.lat)) * Math.sin(dlng / 2) ** 2;
                                return { ts, dist: 6_371_000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)) };
                              })
                              .filter((x) => x.dist < 120)
                              .sort((a, b) => a.dist - b.dist)[0];
                            void stopLoc;
                            if (!closest || closest.ts.departures.length === 0) return null;
                            return (
                              <View style={S.transitDeptRow}>
                                {closest.ts.departures.slice(0, 3).map((d, di) => (
                                  <View key={di} style={S.transitDeptChip}>
                                    <Text style={S.transitDeptChipTxt}>
                                      {d.route ? `${d.route} · ` : ""}
                                      {d.minutesAway === 0 ? "Now" : `${d.minutesAway} min`}
                                    </Text>
                                  </View>
                                ))}
                              </View>
                            );
                          })()}
                        </View>
                        <TouchableOpacity
                          style={S.transitLiveBtn}
                          onPress={() => {
                            Haptics.selectionAsync();
                            Linking.openURL(mapsUrl).catch(() =>
                              Linking.openURL(`https://maps.google.com/?q=${stop.lat},${stop.lng}`)
                            );
                          }}
                          activeOpacity={0.75}
                        >
                          <Text style={S.transitLiveTxt}>Live</Text>
                          <Feather name="external-link" size={10} color="#6366f1" />
                        </TouchableOpacity>
                      </View>
                    );
                  })}
                </ScrollView>
              )}

              {/* ── In-app transit routing ── */}
              {dest && (
                <>
                  {/* Itinerary legs */}
                  {transitItinerary && (
                    <View style={S.transitItin}>
                      {transitItinerary.legs.map((leg, i) => {
                        const isTransit = leg.type === "transit";
                        const legColor = isTransit ? "#6366f1" : "#10b981";
                        const legIcon = isTransit ? "bus-outline" : "walk-outline";
                        const distStr = leg.distanceM < 1000
                          ? `${leg.distanceM} m`
                          : `${(leg.distanceM / 1609.34).toFixed(1)} mi`;
                        return (
                          <View key={i} style={S.transitLegRow}>
                            <View style={[S.transitLegIcon, { backgroundColor: legColor + "18" }]}>
                              <Ionicons name={legIcon as "bus-outline"} size={15} color={legColor} />
                            </View>
                            <View style={{ flex: 1 }}>
                              <Text style={S.transitLegLabel}>
                                {isTransit
                                  ? `Take line ${leg.routeName}${leg.operator ? ` · ${leg.operator}` : ""}`
                                  : "Walk"}
                              </Text>
                              <Text style={S.transitLegMeta} numberOfLines={1}>
                                {leg.fromLabel} → {leg.toLabel}
                              </Text>
                              <Text style={S.transitLegTime}>
                                {distStr}{leg.durationMin > 0 ? ` · ${leg.durationMin} min` : ""}
                              </Text>
                              {/* Live departure times on transit leg */}
                              {isTransit && leg.nextDepartures && leg.nextDepartures.length > 0 && (
                                <View style={S.transitDeptRow}>
                                  {leg.nextDepartures.slice(0, 3).map((d, di) => (
                                    <View key={di} style={[S.transitDeptChip, { backgroundColor: "#6366f118", borderColor: "#6366f130" }]}>
                                      <Text style={[S.transitDeptChipTxt, { color: "#6366f1" }]}>
                                        {d.minutesAway === 0 ? "Now" : `${d.minutesAway} min`}
                                        {d.headsign ? ` → ${d.headsign.split(" ").slice(0, 2).join(" ")}` : ""}
                                      </Text>
                                    </View>
                                  ))}
                                </View>
                              )}
                              {isTransit && (!leg.nextDepartures || leg.nextDepartures.length === 0) && (
                                <Text style={[S.transitLegTime, { fontStyle: "italic" }]}>Schedule unavailable for this area</Text>
                              )}
                            </View>
                          </View>
                        );
                      })}

                      {/* Total + navigate */}
                      <View style={S.transitItinFooter}>
                        <Text style={S.transitItinTotal}>
                          ~{transitItinerary.totalDurationMin} min total
                        </Text>
                        <TouchableOpacity
                          style={S.transitNavBtn}
                          onPress={() => {
                            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                            const tLeg = transitItinerary.legs.find((l) => l.type === "transit");
                            if (tLeg) {
                              setShowTransitPanel(false);
                              startNavigationTo(tLeg.from, `Walk to ${tLeg.fromLabel}`).catch(() => {});
                            }
                          }}
                          activeOpacity={0.85}
                        >
                          <Ionicons name="navigate-outline" size={13} color="#fff" />
                          <Text style={S.transitNavBtnTxt}>Start Walk</Text>
                        </TouchableOpacity>
                      </View>

                      {/* Recalculate */}
                      <TouchableOpacity
                        style={S.transitRecalcBtn}
                        onPress={() => { Haptics.selectionAsync(); planTransitRoute(); }}
                        activeOpacity={0.8}
                      >
                        <Feather name="refresh-cw" size={12} color="#6366f1" />
                        <Text style={S.transitRecalcTxt}>Recalculate</Text>
                      </TouchableOpacity>
                    </View>
                  )}

                  {/* No connection found */}
                  {transitNoRoute && !transitItinerary && (
                    <View style={S.transitNoRoute}>
                      <Ionicons name="alert-circle-outline" size={15} color="#f59e0b" />
                      <Text style={S.transitNoRouteTxt}>
                        No direct transit connection found nearby. Try expanding your search or a different destination.
                      </Text>
                    </View>
                  )}

                  {/* Plan Route button */}
                  {!transitItinerary && (
                    <TouchableOpacity
                      style={[S.transitDirBtn, transitItinLoading && { opacity: 0.7 }]}
                      onPress={() => { if (!transitItinLoading) { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); planTransitRoute(); } }}
                      activeOpacity={0.85}
                      disabled={transitItinLoading}
                    >
                      {transitItinLoading
                        ? <ActivityIndicator size={14} color="#fff" />
                        : <Ionicons name="navigate-outline" size={15} color="#fff" />
                      }
                      <Text style={S.transitDirTxt}>
                        {transitItinLoading ? "Finding route…" : "Plan Transit Route"}
                      </Text>
                    </TouchableOpacity>
                  )}
                </>
              )}
            </View>
          )}

          {/* Route info pill */}
          {routeInfo && (
            <View style={S.routeInfoPill}>
              <Feather name="navigation" size={13} color="#0D9E7E" />
              <Text style={S.routeInfoText}>
                {formatDistance(routeInfo.distanceKm)} · {formatDuration(routeInfo.durationMin)}
              </Text>
              {stationsBusy ? (
                <ActivityIndicator size={11} color="#0D9E7E" style={{ marginLeft: 6 }} />
              ) : (
                <Text style={S.routeInfoStations}>
                  {evStations.length > 0 || gasStations.length > 0
                    ? `· ⚡${evStations.length} ⛽${gasStations.length} along route`
                    : ""}
                </Text>
              )}
            </View>
          )}

          {/* ── Walking options panel (pace + stats) ── */}
          {navMode === "walking" && routeInfo && !isNavigating && (
            <View style={S.walkPanel}>
              <View style={S.walkPaceRow}>
                <Ionicons name="walk-outline" size={14} color="#10b981" />
                <Text style={S.walkPaceLbl}>Pace:</Text>
                {(["leisurely", "normal", "brisk"] as WalkPace[]).map((p) => (
                  <TouchableOpacity
                    key={p}
                    style={[S.walkPaceBtn, walkPace === p && S.walkPaceBtnActive]}
                    onPress={() => { setWalkPace(p); Haptics.selectionAsync(); }}
                    activeOpacity={0.8}
                  >
                    <Text style={[S.walkPaceBtnTxt, walkPace === p && { color: "#fff" }]}>
                      {WALK_PACE_CONFIG[p].label}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
              <View style={S.walkStatsRow}>
                <View style={S.walkStat}>
                  <Text style={S.walkStatVal}>{walkSteps(routeInfo.distanceKm).toLocaleString()}</Text>
                  <Text style={S.walkStatLbl}>👟 steps</Text>
                </View>
                <View style={S.walkStatDiv} />
                <View style={S.walkStat}>
                  <Text style={S.walkStatVal}>{walkCalories(routeInfo.distanceKm, walkPace)}</Text>
                  <Text style={S.walkStatLbl}>🔥 kcal</Text>
                </View>
                <View style={S.walkStatDiv} />
                <View style={S.walkStat}>
                  <Text style={S.walkStatVal}>{walkDuration(routeInfo.durationMin, walkPace)}</Text>
                  <Text style={S.walkStatLbl}>⏱ min</Text>
                </View>
              </View>
            </View>
          )}

          {/* Alternatives strip — tappable route options */}
          {!routeLoading && allRoutes.length > 1 && routeInfo && (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={S.altStrip}
              contentContainerStyle={{ gap: 8, paddingHorizontal: 2 }}
            >
              {/* Primary "Fastest" chip — tappable to revert from an alt */}
              <TouchableOpacity
                style={[S.altChip, activeRouteIdx === 0 && S.altChipActive]}
                onPress={() => selectRoute(0)}
                activeOpacity={0.8}
              >
                <Text style={[S.altChipLabel, activeRouteIdx === 0 && { color: "#0D9E7E" }]}>
                  {navMode === "walking" || navMode === "cycling" ? "Quickest" : "Fastest"}
                </Text>
                <Text style={S.altChipTime}>{formatDuration(allRoutes[0].durationMin)}</Text>
                <Text style={S.altChipDist}>{formatDistance(allRoutes[0].distanceKm)}</Text>
              </TouchableOpacity>

              {/* Alt route chips (index 1+ in allRoutes) */}
              {allRoutes.slice(1).map((alt, i) => {
                const routeIdx = i + 1;
                const isActive = activeRouteIdx === routeIdx;
                return (
                  <TouchableOpacity
                    key={routeIdx}
                    style={[S.altChip, isActive && S.altChipActive]}
                    onPress={() => selectRoute(routeIdx)}
                    activeOpacity={0.8}
                  >
                    <Text style={[S.altChipLabel, isActive && { color: "#0D9E7E" }]}>
                      {navMode === "walking"
                        ? (i === 0 ? "Shorter Path" : "Scenic Route")
                        : navMode === "cycling"
                          ? (i === 0 ? "Shorter Ride" : "Quieter Roads")
                          : `Option ${routeIdx + 1}`}
                    </Text>
                    <Text style={S.altChipTime}>{formatDuration(alt.durationMin)}</Text>
                    <Text style={S.altChipDist}>{formatDistance(alt.distanceKm)}</Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          )}

          {routeLoading && (
            <View style={S.routeInfoPill}>
              <ActivityIndicator size={13} color="#0D9E7E" />
              <Text style={S.routeInfoText}>Calculating route…</Text>
            </View>
          )}

          {routeError && !routeLoading && (
            <TouchableOpacity
              style={S.routeErrorPill}
              onPress={() => setRouteError(null)}
              activeOpacity={0.8}
            >
              <Feather name="alert-circle" size={13} color="#ef4444" />
              <Text style={S.routeErrorText}>{routeError}</Text>
              <Feather name="x" size={12} color="#ef444488" />
            </TouchableOpacity>
          )}

          {/* Live data indicator */}
          <View style={S.liveRow} pointerEvents="box-none">
            <View style={S.liveDot} />
            <Text style={S.liveTxt}>Live</Text>
            {lastUpdatedText && (
              <Text style={S.liveAge}> · {lastUpdatedText}</Text>
            )}
            <TouchableOpacity
              style={S.liveRefreshBtn}
              onPress={() => doRefresh(false)}
              activeOpacity={0.75}
            >
              {isRefreshing ? (
                <ActivityIndicator size={12} color="#0D9E7E" />
              ) : (
                <Feather name="refresh-cw" size={12} color="#0D9E7E" />
              )}
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* ── Right-side floating controls ── */}
      <View style={[S.controls, { top: isNavigating ? topPad + 10 : topPad + 80 }]} pointerEvents="box-none">
        {/* Satellite / standard toggle */}
        <TouchableOpacity
          style={[S.ctrlBtn, mapType === "hybrid" && S.ctrlBtnActive]}
          onPress={toggleMapType}
          activeOpacity={0.85}
        >
          <Ionicons
            name="earth"
            size={20}
            color={mapType === "hybrid" ? "#fff" : "#0D9E7E"}
          />
        </TouchableOpacity>

        {/* 3D toggle */}
        {!isNavigating && (
          <TouchableOpacity
            style={[S.ctrlBtn, is3D && S.ctrlBtnActive]}
            onPress={toggle3D}
            activeOpacity={0.85}
          >
            <Text style={[S.ctrlLabel3D, is3D && { color: "#fff" }]}>3D</Text>
          </TouchableOpacity>
        )}

        {/* Center on user — glows teal when nav camera is free so user knows to tap to re-lock */}
        <TouchableOpacity
          style={[S.ctrlBtn, isNavigating && navCameraFree && S.ctrlBtnActive]}
          onPress={centerOnUser}
          activeOpacity={0.85}
        >
          {locLoading ? (
            <ActivityIndicator size={18} color={isNavigating && navCameraFree ? "#fff" : "#0D9E7E"} />
          ) : (
            <Feather name="navigation" size={18} color={isNavigating && navCameraFree ? "#fff" : "#0D9E7E"} />
          )}
        </TouchableOpacity>

        {/* Speed badge — visible during navigation when GPS speed available; tap to toggle mph/km/h */}
        {isNavigating && currentSpeedMph != null && (
          <TouchableOpacity
            style={S.ctrlSpeedBadge}
            onPress={() => {
              const next: "mph" | "kph" = speedUnit === "mph" ? "kph" : "mph";
              setSpeedUnit(next);
              speedUnitRef.current = next;
              AsyncStorage.setItem("@chargebridge/speed_unit", next).catch(() => {});
              Haptics.selectionAsync();
            }}
            activeOpacity={0.8}
          >
            <Text style={S.ctrlSpeedVal}>
              {speedUnit === "mph"
                ? Math.round(currentSpeedMph)
                : Math.round(currentSpeedMph * 1.60934)}
            </Text>
            <Text style={S.ctrlSpeedUnit}>{speedUnit === "mph" ? "mph" : "km/h"}</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* ── ETA strip (during navigation) ── */}
      {isNavigating && !arrived && routeInfo && (
        navPillsVisible ? (
          <View
            style={[S.etaStrip, { bottom: insets.bottom + TAB_BAR_HEIGHT + 10 }]}
            onLayout={(e: LayoutChangeEvent) => setGlobalNavCardHeight(e.nativeEvent.layout.height)}
          >
            {/* ── Upcoming turns lookahead — only when pill is visible ── */}
            {pillVisible && routeStepsRef.current.length > currentStepIdx + 2 && (() => {
              // Start from +2: the top banner already shows currentStepIdx+1 (the immediate next
              // turn), so this strip shows what comes AFTER that — giving extra lookahead.
              const upcoming = routeStepsRef.current.slice(currentStepIdx + 2, currentStepIdx + 5);
              const [next, ...rest] = upcoming;
              return (
                <View style={{ marginBottom: 6 }}>
                  <View style={S.nextTurnPill}>
                    <View style={S.nextTurnIconCircle}>
                      <Feather name={next.featherIcon as "arrow-up"} size={9} color="#fff" />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={S.nextTurnLabel}>AFTER THAT</Text>
                      <Text style={S.nextTurnInstruction} numberOfLines={1}>{next.instruction}</Text>
                      {next.streetName ? (
                        <Text style={S.nextTurnStreet} numberOfLines={1}>{next.streetName}</Text>
                      ) : null}
                    </View>
                    <Text style={S.nextTurnDist}>{distToPoint(userLoc, next.coordinate)}</Text>
                  </View>
                  {rest.length > 0 && (
                    <ScrollView
                      horizontal
                      showsHorizontalScrollIndicator={false}
                      contentContainerStyle={{ gap: 4, paddingTop: 4 }}
                    >
                      {rest.map((s, i) => (
                        <View key={i} style={S.upcomingChip}>
                          <Feather name={s.featherIcon as "arrow-up"} size={8} color="#94a3b8" />
                          <Text style={S.upcomingTxt} numberOfLines={1}>{s.instruction}</Text>
                        </View>
                      ))}
                    </ScrollView>
                  )}
                </View>
              );
            })()}
            {/* Main row: ETA info | speed badge | END button */}
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
              <View style={{ flex: 1 }}>
                {(currentStep?.streetName || currentStep?.instruction) ? (
                  <Text style={S.etaRoadName} numberOfLines={1}>
                    {currentStep.streetName
                      ? currentStep.streetName.toUpperCase()
                      : currentStep!.instruction.replace(/^(Turn|Keep|Continue|Head|Make|At)\s/i, "").split(" ").slice(0, 4).join(" ").toUpperCase()}
                  </Text>
                ) : null}
                <Text style={S.etaTime}>{remainingMin} min</Text>
                <Text style={S.etaMeta}>
                  {formatDistance(remainingKm)} · Arrive {etaStr}
                </Text>
                {navMode === "walking" && (
                  <Text style={S.etaWalkStats}>
                    👟 {walkRemainingSteps.toLocaleString()} steps · 🔥 {walkBurnedCalories} kcal burned
                  </Text>
                )}
                {navMode === "cycling" && routeInfo && (
                  <Text style={S.etaWalkStats}>
                    🚴 {Math.round(routeInfo.distanceKm * (1 - remainingFraction) * 32)} kcal burned
                  </Text>
                )}
              </View>
              {/* Speed badge — tappable to toggle mph ↔ km/h */}
              {navMode !== "walking" && currentSpeedMph != null && (
                <TouchableOpacity
                  style={S.etaSpeedBadge}
                  onPress={() => {
                    const next: "mph" | "kph" = speedUnit === "mph" ? "kph" : "mph";
                    setSpeedUnit(next);
                    speedUnitRef.current = next;
                    AsyncStorage.setItem("@chargebridge/speed_unit", next).catch(() => {});
                    Haptics.selectionAsync();
                  }}
                  activeOpacity={0.75}
                >
                  <Text style={{ color: "#1C1C1E", fontSize: 11, fontWeight: "800", fontFamily: "Inter_700Bold", lineHeight: 13 }}>
                    {speedUnit === "mph"
                      ? Math.round(currentSpeedMph)
                      : Math.round(currentSpeedMph * 1.60934)}
                  </Text>
                  <Text style={{ color: "#6b7280", fontSize: 7, fontFamily: "Inter_400Regular", marginTop: -1 }}>
                    {speedUnit === "mph" ? "mph" : "km/h"}
                  </Text>
                </TouchableOpacity>
              )}
              {/* END ROUTE */}
              <TouchableOpacity
                style={S.etaEndBtn}
                onPress={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                  stopNavigation();
                }}
                activeOpacity={0.85}
              >
                <Text style={S.etaEndTxt}>End</Text>
              </TouchableOpacity>
            </View>
            {/* Secondary row: Add Stop */}
            <TouchableOpacity
              style={S.etaAddStopBtn}
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                stopNavigation();
                convertRouteToTrip();
              }}
              activeOpacity={0.85}
            >
              <Feather name="plus" size={9} color="#3b82f6" />
              <Text style={S.etaAddStopTxt}>Add a Stop</Text>
            </TouchableOpacity>
          </View>
        ) : (
          /* Minimized bottom bar — tap to expand, End always accessible */
          <View
            style={[S.navPillMinBarBottom, { bottom: insets.bottom + TAB_BAR_HEIGHT + 10 }]}
            onLayout={(e: LayoutChangeEvent) => setGlobalNavCardHeight(e.nativeEvent.layout.height)}
          >
            <TouchableOpacity
              style={{ flex: 1, flexDirection: "row", alignItems: "center", gap: 8 }}
              onPress={() => { setNavPillsVisible(true); navPillsVisibleRef.current = true; if (navPillsTimerRef.current) clearTimeout(navPillsTimerRef.current); navPillsTimerRef.current = setTimeout(() => { navPillsTimerRef.current = null; if (!isMountedRef.current) return; setNavPillsVisible(false); navPillsVisibleRef.current = false; }, 40000); Haptics.selectionAsync(); }}
              activeOpacity={0.85}
            >
              <Feather name="chevron-up" size={12} color="rgba(255,255,255,0.4)" />
              <Text style={S.navPillMinTime}>{remainingMin} min</Text>
              <Text style={S.navPillMinEta}>{formatDistance(remainingKm)} · {etaStr}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={S.navPillMinEnd}
              onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); stopNavigation(); }}
              activeOpacity={0.85}
            >
              <Text style={S.etaEndTxt}>End</Text>
            </TouchableOpacity>
          </View>
        )
      )}

      {/* ── Navigate button (shown when route is set, not yet navigating) ── */}
      {hasRoute && !isNavigating && !selectedEv && !selectedGas && (
        <TouchableOpacity
          style={[S.navBtn, { bottom: insets.bottom + TAB_BAR_HEIGHT + 10 }]}
          onPress={startNavigation}
          activeOpacity={0.9}
        >
          <Feather name="navigation-2" size={18} color="#fff" />
          <Text style={S.navBtnTxt}>Start Navigation</Text>
        </TouchableOpacity>
      )}

      {/* ── Arrived overlay ── */}
      {arrived && (() => {
        const ev = navDestEvRef.current;
        const priceLabel = ev ? (ev.isFree ? "Free charging" : ev.priceText ?? (ev.pricePerKwh ? `$${Number(ev.pricePerKwh).toFixed(2)}/kWh` : null)) : null;
        const portLabel = ev?.totalPorts != null
          ? ev.availablePorts != null
            ? `${ev.availablePorts} of ${ev.totalPorts} ports open`
            : `${ev.totalPorts} ports`
          : null;
        return (
          <View style={S.arrivedOverlay} pointerEvents="box-none">
            <View style={[S.arrivedCard, ev ? S.arrivedCardEv : undefined]}>
              {/* Icon */}
              <View style={S.arrivedIcon}>
                {ev
                  ? <Ionicons name="flash" size={32} color="#0D9E7E" />
                  : <Feather name="flag" size={28} color="#0D9E7E" />}
              </View>
              <Text style={S.arrivedTitle}>{ev ? "You've arrived!" : "You have arrived!"}</Text>
              <Text style={S.arrivedSub} numberOfLines={2}>{destLabel}</Text>

              {/* EV station details */}
              {ev && (
                <View style={S.arrivedEvDetails}>
                  {portLabel && (
                    <View style={S.arrivedDetailRow}>
                      <Feather name="zap" size={13} color={(ev.availablePorts ?? 0) > 0 ? "#22c55e" : "#f97316"} />
                      <Text style={[S.arrivedDetailTxt, { color: (ev.availablePorts ?? 0) > 0 ? "#22c55e" : "#94a3b8" }]}>{portLabel}</Text>
                    </View>
                  )}
                  {priceLabel && (
                    <View style={S.arrivedDetailRow}>
                      <Feather name="dollar-sign" size={13} color="#0D9E7E" />
                      <Text style={S.arrivedDetailTxt}>{priceLabel}</Text>
                    </View>
                  )}
                  {ev.chargerType && (
                    <View style={S.arrivedDetailRow}>
                      <Feather name="cpu" size={13} color="#60a5fa" />
                      <Text style={[S.arrivedDetailTxt, { color: "#60a5fa" }]}>{ev.chargerType}</Text>
                    </View>
                  )}
                </View>
              )}

              {/* Buttons */}
              {ev && (
                <TouchableOpacity
                  style={S.arrivedChargeBtn}
                  onPress={() => {
                    clearRoute();
                    if (/^\d+$/.test(ev.id)) {
                      router.push(`/station/${ev.id}?charge=1` as any);
                    }
                  }}
                  activeOpacity={0.85}
                >
                  <Ionicons name="flash" size={16} color="#fff" />
                  <Text style={S.arrivedChargeBtnTxt}>Start Charging</Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity
                style={[S.arrivedBtn, ev ? S.arrivedBtnSecondary : undefined]}
                onPress={clearRoute}
                activeOpacity={0.85}
              >
                <Text style={[S.arrivedBtnTxt, ev ? { color: "#64748b" } : undefined]}>{ev ? "Dismiss" : "Done"}</Text>
              </TouchableOpacity>
            </View>
          </View>
        );
      })()}

      {/* ── Station popup (tapping a pin shows this) ── */}
      <Animated.View
        pointerEvents={anySelected ? "box-none" : "none"}
        style={[
          S.popup,
          {
            bottom: insets.bottom + TAB_BAR_HEIGHT + 10,
            opacity: popupAnim,
            transform: [{ translateY: popupAnim.interpolate({ inputRange: [0, 1], outputRange: [200, 0] }) }],
          },
        ]}
      >
        {/* Close button */}
        <TouchableOpacity
          style={S.popupCloseBtn}
          onPress={clearSelection}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <View style={S.popupCloseCircle}>
            <Feather name="x" size={14} color="#64748b" />
          </View>
        </TouchableOpacity>

        {/* EV station content */}
        {selectedEv && (() => {
          const dot = evStatusColor(selectedEv.status);
          const price = selectedEv.isFree ? "Free" : selectedEv.priceText ?? (selectedEv.pricePerKwh ? `$${Number(selectedEv.pricePerKwh).toFixed(2)}/kWh` : "See charger");
          const dist = liveDistance(userLoc, selectedEv.lat, selectedEv.lng);
          return (
            <>
              <View style={S.popupRow}>
                <View style={[S.popupIcon, { backgroundColor: "#0D9E7E12" }]}>
                  <Ionicons name="flash" size={24} color="#0D9E7E" />
                  <View style={[S.popupStatusDot, { backgroundColor: dot }]} />
                </View>
                <View style={S.popupBody}>
                  <Text style={S.popupName} numberOfLines={1}>{selectedEv.name}</Text>
                  <Text style={S.popupAddr} numberOfLines={1}>
                    {[selectedEv.address, selectedEv.city].filter(Boolean).join(", ") || "EV Station"}
                  </Text>
                  <View style={S.popupMeta}>
                    <TypeBadge type={selectedEv.chargerType} />
                    <StatusChip status={selectedEv.status} />
                    {selectedEv.source === "nrel" && (
                      <View style={[S.popupBadge, { backgroundColor: "#7c3aed18", borderColor: "#7c3aed30" }]}>
                        <Text style={[S.popupBadgeTxt, { color: "#7c3aed" }]}>NREL</Text>
                      </View>
                    )}
                    {selectedEv.source === "ocm" && (
                      <View style={[S.popupBadge, { backgroundColor: "#0369a118", borderColor: "#0369a130" }]}>
                        <Text style={[S.popupBadgeTxt, { color: "#0369a1" }]}>OCM</Text>
                      </View>
                    )}
                    {selectedEv.totalPorts != null && (
                      <View style={[S.popupBadge, {
                        backgroundColor: selectedEv.availablePorts
                          ? "#22c55e22"
                          : "#94a3b822",
                      }]}>
                        <Text style={[S.popupBadgeTxt, {
                          color: selectedEv.availablePorts
                            ? "#16a34a"
                            : "#64748b",
                        }]}>
                          {selectedEv.availablePorts ?? 0}/{selectedEv.totalPorts} ports
                        </Text>
                      </View>
                    )}
                    <Text style={S.popupPrice}>{price}</Text>
                  </View>
                  {selectedEv.connectorTypes?.length > 0 && (
                    <Text style={{ fontSize: 11, color: "#64748b", marginTop: 3 }}>
                      {selectedEv.connectorTypes.join("  ·  ")}
                    </Text>
                  )}
                </View>
              </View>

              {/* Charge Confidence Score */}
              {(() => {
                const conf = computeChargeConfidence(
                  { ...selectedEv, connectorTypes: selectedEv.connectorTypes ?? [] },
                  primaryVehicle ?? undefined
                );
                const est =
                  primaryVehicle?.batteryKwh
                    ? computeChargeEstimates(
                        { ...selectedEv, connectorTypes: selectedEv.connectorTypes ?? [] },
                        primaryVehicle
                      )
                    : null;
                return (
                  <>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginTop: 8, marginBottom: 2 }}>
                      {/* Score badge */}
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 7, backgroundColor: conf.tint + "18", borderRadius: 10, paddingHorizontal: 10, paddingVertical: 7, borderWidth: 1, borderColor: conf.tint + "40", flex: 1 }}>
                        <View style={{ width: 30, height: 30, borderRadius: 15, backgroundColor: conf.tint, alignItems: "center", justifyContent: "center" }}>
                          <Text style={{ fontSize: 11, fontWeight: "800", color: "#fff" }}>{conf.score}</Text>
                        </View>
                        <View style={{ flex: 1 }}>
                          <Text style={{ fontSize: 12, fontWeight: "700", color: conf.tint }} numberOfLines={1}>{conf.label}</Text>
                          <Text style={{ fontSize: 10, color: "#64748b" }} numberOfLines={1}>{conf.explanation}</Text>
                        </View>
                      </View>
                      {/* Compatibility chip */}
                      {conf.compatible !== null && (
                        <View style={{ flexDirection: "row", alignItems: "center", backgroundColor: conf.compatible ? "#22c55e18" : "#ef444418", borderRadius: 8, paddingHorizontal: 8, paddingVertical: 6, borderWidth: 1, borderColor: conf.compatible ? "#22c55e40" : "#ef444440" }}>
                          <Text style={{ fontSize: 11, color: conf.compatible ? "#16a34a" : "#dc2626", fontWeight: "700" }}>
                            {conf.compatible ? "✓ Fit" : "✗ Plug?"}
                          </Text>
                        </View>
                      )}
                    </View>

                    {/* Personalized estimates */}
                    {est && (est.minsTo80 != null || est.estimatedCost != null) && (
                      <View style={{ flexDirection: "row", gap: 5, marginBottom: 4, marginTop: 2 }}>
                        {est.minsTo80 != null && (
                          <View style={{ backgroundColor: "#0D9E7E14", borderRadius: 7, paddingHorizontal: 8, paddingVertical: 4 }}>
                            <Text style={{ fontSize: 10, color: "#0D9E7E", fontWeight: "600" }}>~{est.minsTo80} min → 80%</Text>
                          </View>
                        )}
                        {est.estimatedCost != null && (
                          <View style={{ backgroundColor: "#0D9E7E14", borderRadius: 7, paddingHorizontal: 8, paddingVertical: 4 }}>
                            <Text style={{ fontSize: 10, color: "#0D9E7E", fontWeight: "600" }}>~${est.estimatedCost.toFixed(2)} full</Text>
                          </View>
                        )}
                        {est.milesPerMin != null && (
                          <View style={{ backgroundColor: "#0D9E7E14", borderRadius: 7, paddingHorizontal: 8, paddingVertical: 4 }}>
                            <Text style={{ fontSize: 10, color: "#0D9E7E", fontWeight: "600" }}>{est.milesPerMin} mi/min</Text>
                          </View>
                        )}
                      </View>
                    )}
                  </>
                );
              })()}

              {dist !== "" && (
                <View style={S.popupDistRow}>
                  <Feather name="navigation" size={12} color="#0D9E7E" />
                  <Text style={S.popupDistTxt}>{dist}</Text>
                  {isNavigating && <Text style={S.popupDistLive}> · live</Text>}
                </View>
              )}

              <TouchableOpacity
                style={S.popupRateRow}
                onPress={() => { Haptics.selectionAsync(); setRateSheetOpen(true); }}
                activeOpacity={0.8}
              >
                <View style={{ flexDirection: "row", gap: 3 }}>
                  {[1, 2, 3, 4, 5].map(i => (
                    <Ionicons key={i} name="star-outline" size={16} color="#f59e0b" />
                  ))}
                </View>
                <Text style={S.popupRateTxt}>Tap to rate & review</Text>
                <Feather name="chevron-right" size={13} color="#94a3b8" />
              </TouchableOpacity>

              {/* Street View link */}
              <TouchableOpacity
                style={S.popupStreetView}
                onPress={() => {
                  Haptics.selectionAsync();
                  Linking.openURL(
                    `https://maps.google.com/maps?q=&layer=c&cbll=${selectedEv.lat},${selectedEv.lng}`
                  );
                }}
                activeOpacity={0.75}
              >
                <Feather name="eye" size={12} color="#64748b" />
                <Text style={S.popupStreetViewTxt}>Street View</Text>
              </TouchableOpacity>

              <View style={S.popupActions}>
                {/* Primary: in-app Navigate */}
                <TouchableOpacity
                  style={[S.popupBtn, S.popupBtnPrimary]}
                  onPress={() => {
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                    startNavigationTo({ latitude: selectedEv.lat, longitude: selectedEv.lng }, selectedEv.name).catch(() => {});
                  }}
                  activeOpacity={0.85}
                >
                  <Feather name="navigation-2" size={15} color="#fff" />
                  <Text style={S.popupBtnTxtWhite}>Navigate</Text>
                </TouchableOpacity>

                {/* Add to Trip */}
                <TouchableOpacity
                  style={[S.popupBtn, { borderColor: "#3b82f640" }]}
                  onPress={() => {
                    clearSelection();
                    openTripWithStop({ latitude: selectedEv.lat, longitude: selectedEv.lng }, selectedEv.name);
                  }}
                  activeOpacity={0.85}
                >
                  <Feather name="plus-circle" size={15} color="#3b82f6" />
                  <Text style={[S.popupBtnTxt, { color: "#3b82f6" }]}>Add Stop</Text>
                </TouchableOpacity>

                {/* Third action: network app → Charge Here (community+priced) → Review */}
                {(() => {
                  const appInfo = matchNetworkApp(selectedEv.network);
                  if (appInfo) {
                    return (
                      <TouchableOpacity
                        style={S.popupBtn}
                        onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); openNetworkApp(selectedEv); }}
                        activeOpacity={0.85}
                      >
                        <Ionicons name="phone-portrait-outline" size={15} color="#0D9E7E" />
                        <Text style={[S.popupBtnTxt, { color: "#0D9E7E" }]} numberOfLines={1}>{appInfo.label}</Text>
                      </TouchableOpacity>
                    );
                  }
                  const isCommunity = selectedEv.source === "community";
                  const hasPrice = selectedEv.pricePerKwh != null && !selectedEv.isFree;
                  if (isCommunity && hasPrice) {
                    return (
                      <TouchableOpacity
                        style={[S.popupBtn, { borderColor: "#0D9E7E40" }]}
                        onPress={() => {
                          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                          clearSelection();
                          router.push(`/station/${selectedEv.id}?charge=1` as any);
                        }}
                        activeOpacity={0.85}
                      >
                        <Ionicons name="flash" size={15} color="#0D9E7E" />
                        <Text style={[S.popupBtnTxt, { color: "#0D9E7E" }]}>Charge Here</Text>
                      </TouchableOpacity>
                    );
                  }
                  return (
                    <TouchableOpacity
                      style={S.popupBtn}
                      onPress={() => { Haptics.selectionAsync(); setRateSheetOpen(true); }}
                      activeOpacity={0.85}
                    >
                      <Ionicons name="star-outline" size={15} color="#0D9E7E" />
                      <Text style={[S.popupBtnTxt, { color: "#0D9E7E" }]}>Review</Text>
                    </TouchableOpacity>
                  );
                })()}
              </View>

              {/* ── Nearby Places dropdown ── */}
              {(() => {
                const NEARBY_CATS = [
                  { key: "restaurant", label: "Food", icon: "🍽️" },
                  { key: "cafe",       label: "Coffee", icon: "☕" },
                  { key: "hotel",      label: "Hotel", icon: "🏨" },
                  { key: "parking",    label: "Parking", icon: "🅿️" },
                  { key: "hospital",   label: "Hospital", icon: "🏥" },
                ] as const;
                return (
                  <View style={{ marginTop: 12, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: "#e2e8f0", paddingTop: 12 }}>
                    <Text style={{ fontSize: 11, fontWeight: "700", color: "#94a3b8", fontFamily: "Inter_700Bold", textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 8 }}>Nearby</Text>
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
                      {NEARBY_CATS.map((cat) => {
                        const active = nearbyCategory === cat.key;
                        return (
                          <TouchableOpacity
                            key={cat.key}
                            onPress={() => { Haptics.selectionAsync(); fetchNearbyPlaces(selectedEv!.lat, selectedEv!.lng, cat.key); }}
                            activeOpacity={0.75}
                            style={{
                              flexDirection: "row", alignItems: "center", gap: 5,
                              paddingHorizontal: 11, paddingVertical: 7,
                              borderRadius: 20, borderWidth: 1,
                              backgroundColor: active ? "#0D9E7E15" : "#f8fafc",
                              borderColor: active ? "#0D9E7E50" : "#e2e8f0",
                            }}
                          >
                            <Text style={{ fontSize: 13 }}>{cat.icon}</Text>
                            <Text style={{ fontSize: 12, fontWeight: "600", fontFamily: "Inter_600SemiBold", color: active ? "#0D9E7E" : "#475569" }}>{cat.label}</Text>
                            {active && nearbyLoading && <ActivityIndicator size={10} color="#0D9E7E" style={{ marginLeft: 2 }} />}
                          </TouchableOpacity>
                        );
                      })}
                    </ScrollView>

                    {/* Results list */}
                    {nearbyCategory && !nearbyLoading && nearbyPlaces.length === 0 && (
                      <Text style={{ fontSize: 12, color: "#94a3b8", fontFamily: "Inter_400Regular", marginTop: 8 }}>No places found nearby</Text>
                    )}
                    {nearbyPlaces.length > 0 && (
                      <View style={{ marginTop: 8, gap: 6 }}>
                        {nearbyPlaces.slice(0, 5).map((place) => {
                          const distLabel = place.distanceM < 1000
                            ? `${place.distanceM}m`
                            : `${(place.distanceM / 1609).toFixed(1)}mi`;
                          return (
                            <TouchableOpacity
                              key={place.id}
                              onPress={() => {
                                Haptics.selectionAsync();
                                startNavigationTo({ latitude: place.lat, longitude: place.lng }, place.name).catch(() => {});
                              }}
                              activeOpacity={0.75}
                              style={{ flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "#f1f5f9" }}
                            >
                              <View style={{ flex: 1 }}>
                                <Text style={{ fontSize: 13, fontWeight: "600", color: "#0f172a", fontFamily: "Inter_600SemiBold" }} numberOfLines={1}>{place.name}</Text>
                                {place.address ? <Text style={{ fontSize: 11, color: "#64748b", fontFamily: "Inter_400Regular" }} numberOfLines={1}>{place.address}</Text> : null}
                              </View>
                              <Text style={{ fontSize: 11, color: "#0D9E7E", fontFamily: "Inter_600SemiBold", fontWeight: "600" }}>{distLabel}</Text>
                              <Feather name="navigation-2" size={13} color="#0D9E7E" />
                            </TouchableOpacity>
                          );
                        })}
                      </View>
                    )}
                  </View>
                );
              })()}
            </>
          );
        })()}

        {/* Gas station content */}
        {selectedGas && (() => {
          const reg = selectedGas.prices?.regularCents ? `$${(selectedGas.prices.regularCents / 100).toFixed(2)}` : null;
          const diesel = selectedGas.prices?.dieselCents ? `$${(selectedGas.prices.dieselCents / 100).toFixed(2)}` : null;
          const dist = liveDistance(userLoc, selectedGas.lat, selectedGas.lng);
          return (
            <>
              <View style={S.popupRow}>
                <View style={[S.popupIcon, { backgroundColor: "#f59e0b12" }]}>
                  <Feather name="droplet" size={24} color="#f59e0b" />
                </View>
                <View style={S.popupBody}>
                  <Text style={S.popupName} numberOfLines={1}>{selectedGas.name || selectedGas.brand || "Gas Station"}</Text>
                  <Text style={S.popupAddr} numberOfLines={1}>
                    {[selectedGas.address, selectedGas.city].filter(Boolean).join(", ") || "Gas Station"}
                  </Text>
                  <View style={S.popupMeta}>
                    {reg && <View style={[S.popupBadge, { backgroundColor: "#f59e0b22" }]}><Text style={[S.popupBadgeTxt, { color: "#d97706" }]}>Regular {reg}</Text></View>}
                    {diesel && <View style={[S.popupBadge, { backgroundColor: "#f59e0b11" }]}><Text style={[S.popupBadgeTxt, { color: "#d97706" }]}>Diesel {diesel}</Text></View>}
                  </View>
                </View>
              </View>

              {dist !== "" && (
                <View style={S.popupDistRow}>
                  <Feather name="navigation" size={12} color="#f59e0b" />
                  <Text style={[S.popupDistTxt, { color: "#d97706" }]}>{dist}</Text>
                  {isNavigating && <Text style={S.popupDistLive}> · live</Text>}
                </View>
              )}

              {/* Street View link */}
              <TouchableOpacity
                style={S.popupStreetView}
                onPress={() => {
                  Haptics.selectionAsync();
                  Linking.openURL(
                    `https://maps.google.com/maps?q=&layer=c&cbll=${selectedGas.lat},${selectedGas.lng}`
                  );
                }}
                activeOpacity={0.75}
              >
                <Feather name="eye" size={12} color="#64748b" />
                <Text style={S.popupStreetViewTxt}>Street View</Text>
              </TouchableOpacity>

              <View style={[S.popupActions, { marginTop: 10 }]}>
                <TouchableOpacity
                  style={[S.popupBtn, { backgroundColor: "#f59e0b", borderColor: "#f59e0b" }]}
                  onPress={() => {
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                    startNavigationTo(
                      { latitude: selectedGas.lat, longitude: selectedGas.lng },
                      selectedGas.name ?? selectedGas.brand ?? "Gas Station"
                    );
                  }}
                  activeOpacity={0.85}
                >
                  <Feather name="navigation-2" size={15} color="#fff" />
                  <Text style={S.popupBtnTxtWhite}>Navigate</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[S.popupBtn, { borderColor: "#3b82f640" }]}
                  onPress={() => {
                    const label = selectedGas.name ?? selectedGas.brand ?? "Gas Station";
                    clearSelection();
                    openTripWithStop({ latitude: selectedGas.lat, longitude: selectedGas.lng }, label);
                  }}
                  activeOpacity={0.85}
                >
                  <Feather name="plus-circle" size={15} color="#3b82f6" />
                  <Text style={[S.popupBtnTxt, { color: "#3b82f6" }]}>Add Stop</Text>
                </TouchableOpacity>
              </View>
            </>
          );
        })()}

        {/* ── Destination pin popup ── */}
        {selectedDest && dest && (() => {
          const dist = liveDistance(userLoc, dest.latitude, dest.longitude);
          return (
            <>
              <View style={S.popupRow}>
                <View style={[S.popupIcon, { backgroundColor: "#ef444412" }]}>
                  <Feather name="map-pin" size={22} color="#ef4444" />
                </View>
                <View style={S.popupBody}>
                  <Text style={S.popupName} numberOfLines={1}>{destLabel || "Destination"}</Text>
                  <Text style={S.popupAddr} numberOfLines={1}>
                    {`${dest.latitude.toFixed(5)}, ${dest.longitude.toFixed(5)}`}
                  </Text>
                  <View style={S.popupMeta}>
                    <View style={[S.popupBadge, { backgroundColor: "#ef444418" }]}>
                      <Text style={[S.popupBadgeTxt, { color: "#ef4444" }]}>Destination</Text>
                    </View>
                  </View>
                </View>
              </View>
              {dist !== "" && (
                <View style={S.popupDistRow}>
                  <Feather name="navigation" size={12} color="#ef4444" />
                  <Text style={S.popupDistTxt}>{dist}</Text>
                </View>
              )}
              <View style={S.popupActions}>
                <TouchableOpacity
                  style={[S.popupBtn, { backgroundColor: "#ef4444", borderColor: "#ef4444" }]}
                  onPress={() => {
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                    clearSelection();
                    startNavigationTo(dest, destLabel || "Destination").catch(() => {});
                  }}
                  activeOpacity={0.85}
                >
                  <Feather name="navigation-2" size={15} color="#fff" />
                  <Text style={S.popupBtnTxtWhite}>Navigate</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[S.popupBtn, { borderColor: "#3b82f640" }]}
                  onPress={() => {
                    clearSelection();
                    openTripWithStop(dest, destLabel || "Destination");
                  }}
                  activeOpacity={0.85}
                >
                  <Feather name="plus-circle" size={15} color="#3b82f6" />
                  <Text style={[S.popupBtnTxt, { color: "#3b82f6" }]}>Add Stop</Text>
                </TouchableOpacity>
              </View>
            </>
          );
        })()}

        {/* ── Trip waypoint pin popup ── */}
        {selectedWaypoint && (() => {
          const wp = selectedWaypoint;
          const wpIdx = tripWaypoints.findIndex((w) => w.id === wp.id);
          const dist = liveDistance(userLoc, wp.loc.latitude, wp.loc.longitude);
          const stopLabel = wpIdx >= 0 ? `Stop ${wpIdx + 1}` : "Stop";
          return (
            <>
              <View style={S.popupRow}>
                <View style={[S.popupIcon, { backgroundColor: "#3b82f612" }]}>
                  <Feather name="flag" size={22} color="#3b82f6" />
                  <View style={[S.popupStatusDot, { backgroundColor: "#3b82f6" }]} />
                </View>
                <View style={S.popupBody}>
                  <Text style={S.popupName} numberOfLines={1}>{wp.label}</Text>
                  <Text style={S.popupAddr} numberOfLines={1}>{stopLabel} · Trip waypoint</Text>
                  <View style={S.popupMeta}>
                    <View style={[S.popupBadge, { backgroundColor: "#3b82f618" }]}>
                      <Text style={[S.popupBadgeTxt, { color: "#3b82f6" }]}>{stopLabel}</Text>
                    </View>
                  </View>
                </View>
              </View>
              {dist !== "" && (
                <View style={S.popupDistRow}>
                  <Feather name="navigation" size={12} color="#3b82f6" />
                  <Text style={S.popupDistTxt}>{dist}</Text>
                </View>
              )}
              <View style={S.popupActions}>
                <TouchableOpacity
                  style={[S.popupBtn, S.popupBtnPrimary]}
                  onPress={() => {
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                    clearSelection();
                    startNavigationTo(wp.loc, wp.label).catch(() => {});
                  }}
                  activeOpacity={0.85}
                >
                  <Feather name="navigation-2" size={15} color="#fff" />
                  <Text style={S.popupBtnTxtWhite}>Navigate Here</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[S.popupBtn, { borderColor: "#3b82f640" }]}
                  onPress={() => {
                    clearSelection();
                    openTripWithStop(wp.loc, wp.label);
                  }}
                  activeOpacity={0.85}
                >
                  <Feather name="plus-circle" size={15} color="#3b82f6" />
                  <Text style={[S.popupBtnTxt, { color: "#3b82f6" }]}>Add Stop</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[S.popupBtn, { borderColor: "#ef444440" }]}
                  onPress={() => {
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                    clearSelection();
                    setTripWaypoints((prev) => prev.filter((w) => w.id !== wp.id));
                  }}
                  activeOpacity={0.85}
                >
                  <Feather name="trash-2" size={15} color="#ef4444" />
                  <Text style={[S.popupBtnTxt, { color: "#ef4444" }]}>Remove</Text>
                </TouchableOpacity>
              </View>
            </>
          );
        })()}
      </Animated.View>

      {/* ── Step list modal ── */}
      <Modal
        visible={showStepList}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setShowStepList(false)}
      >
        <View style={[S.modalRoot, { paddingTop: insets.top + 16 }]}>
          <View style={S.modalHeader}>
            <View>
              <Text style={S.modalTitle}>Directions</Text>
              {destLabel ? (
                <Text style={[S.resultSecondary, { marginTop: 2 }]} numberOfLines={1}>To: {destLabel}</Text>
              ) : null}
            </View>
            <TouchableOpacity
              onPress={() => setShowStepList(false)}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              <View style={S.modalCloseBtn}>
                <Feather name="x" size={16} color="#475569" />
              </View>
            </TouchableOpacity>
          </View>
          {routeInfo && (
            <View style={[S.routeInfoPill, { marginBottom: 12, alignSelf: "flex-start" }]}>
              <Feather name="navigation" size={13} color="#0D9E7E" />
              <Text style={S.routeInfoText}>
                {formatDistance(routeInfo.distanceKm)} · {formatDuration(routeInfo.durationMin)}
              </Text>
            </View>
          )}
          <ScrollView showsVerticalScrollIndicator={false} style={{ flex: 1 }}>
            {routeSteps.map((step, idx) => {
              const isCurrent = isNavigating && idx === currentStepIdx;
              return (
                <View
                  key={idx}
                  style={[S.stepRow, isCurrent && S.stepRowActive]}
                >
                  <View style={[S.stepIconBox, isCurrent && { backgroundColor: "#0D9E7E" }]}>
                    <Feather
                      name={step.featherIcon as "arrow-up"}
                      size={18}
                      color={isCurrent ? "#fff" : "#64748b"}
                    />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[S.stepInstruction, isCurrent && { color: "#0D9E7E", fontFamily: "Inter_700Bold" }]}>
                      {step.instruction}
                    </Text>
                    {step.distanceM > 0 && (
                      <Text style={S.stepDist}>
                        {step.distanceM < 1000
                          ? `${Math.round(step.distanceM)} m`
                          : `${(step.distanceM / 1609.34).toFixed(1)} mi`}
                      </Text>
                    )}
                  </View>
                </View>
              );
            })}
            <View style={{ height: 40 }} />
          </ScrollView>
        </View>
      </Modal>

      {/* ── Quick Rate Sheet ── */}
      <TripPlanModal
        visible={tripOpen}
        userLoc={userLoc}
        navMode={navMode}
        onClose={() => setTripOpen(false)}
        onStartTrip={handleStartTrip}
        initialWaypoints={tripInitialWaypoints}
      />

      <QuickRateSheet
        visible={rateSheetOpen}
        stationId={selectedEv && !isNaN(Number(selectedEv.id)) ? Number(selectedEv.id) : undefined}
        externalId={selectedEv && isNaN(Number(selectedEv.id)) ? selectedEv.id : undefined}
        stationName={selectedEv?.name ?? ""}
        onClose={() => setRateSheetOpen(false)}
      />

      {/* ── Destination search modal ── */}
      <Modal
        visible={searchOpen}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => { setSearchOpen(false); Keyboard.dismiss(); }}
      >
        <View style={[S.modalRoot, { paddingTop: insets.top + 16 }]}>
          <View style={S.modalHeader}>
            <Text style={S.modalTitle}>Where to?</Text>
            <TouchableOpacity
              onPress={() => { setSearchOpen(false); Keyboard.dismiss(); }}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              <View style={S.modalCloseBtn}>
                <Feather name="x" size={16} color="#475569" />
              </View>
            </TouchableOpacity>
          </View>

          {/* ── FROM row (editable) ── */}
          <TouchableOpacity
            style={S.modalRow}
            onPress={() => setActiveSearchField("from")}
            activeOpacity={0.9}
          >
            <View style={S.modalDotCol}>
              <View style={[S.modalDot, { backgroundColor: "#0D9E7E" }]} />
              <View style={S.modalDotLine} />
            </View>
            <View style={[S.modalInput, activeSearchField === "from" && S.modalInputFocused]}>
              <View style={{ flexDirection: "row", alignItems: "center" }}>
                <View style={{ flex: 1 }}>
                  <Text style={S.modalInputLabel}>FROM</Text>
                  {activeSearchField === "from" ? (
                    <TextInput
                      style={S.modalInputText}
                      placeholder={userLoc ? "My Location (GPS)" : "Enter starting address…"}
                      placeholderTextColor="#94a3b8"
                      value={originQuery}
                      onChangeText={handleOriginSearch}
                      autoFocus
                      returnKeyType="search"
                      autoCorrect={false}
                      autoCapitalize="words"
                    />
                  ) : (
                    <Text style={[S.modalInputValue, customOriginLabel ? { color: "#0f172a" } : {}]} numberOfLines={1}>
                      {customOriginLabel || (userLoc ? "My Location (GPS)" : "Enter starting address…")}
                    </Text>
                  )}
                </View>
                {activeSearchField === "from" && originBusy && (
                  <ActivityIndicator size={16} color="#0D9E7E" style={{ marginLeft: 8 }} />
                )}
                {activeSearchField === "from" && !originBusy && originQuery.length > 0 && (
                  <TouchableOpacity
                    onPress={() => handleOriginSearch("")}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  >
                    <View style={S.clearBtn}>
                      <Feather name="x" size={12} color="#64748b" />
                    </View>
                  </TouchableOpacity>
                )}
                {activeSearchField !== "from" && customOriginLabel ? (
                  <Feather name="check-circle" size={14} color="#0D9E7E" />
                ) : null}
              </View>
            </View>
          </TouchableOpacity>

          {/* ── TO row (editable) ── */}
          <TouchableOpacity
            style={S.modalRow}
            onPress={() => setActiveSearchField("to")}
            activeOpacity={0.9}
          >
            <View style={S.modalDotCol}>
              <View style={[S.modalDot, { backgroundColor: "#ef4444" }]} />
            </View>
            <View style={[S.modalInput, activeSearchField === "to" && S.modalInputFocused]}>
              <View style={{ flexDirection: "row", alignItems: "center" }}>
                <View style={{ flex: 1 }}>
                  <Text style={S.modalInputLabel}>TO</Text>
                  {activeSearchField === "to" ? (
                    <TextInput
                      style={S.modalInputText}
                      placeholder="Search address, city, or place…"
                      placeholderTextColor="#94a3b8"
                      value={destQuery}
                      onChangeText={handleDestSearch}
                      autoFocus={activeSearchField === "to"}
                      returnKeyType="search"
                      autoCorrect={false}
                      autoCapitalize="words"
                      onSubmitEditing={() => {
                        if (searchResults.length > 0) {
                          selectDestination(searchResults[0]);
                        } else if (destQuery.length >= 2 && !searchBusy) {
                          // Force an immediate search then pick the first result
                          if (debounceRef.current) clearTimeout(debounceRef.current);
                          setSearchBusy(true);
                          searchAddress(destQuery, userLoc?.latitude, userLoc?.longitude).then((results) => {
                            setSearchResults(results);
                            setSearchNoResults(results.length === 0);
                            if (results.length > 0) selectDestination(results[0]);
                          }).finally(() => setSearchBusy(false));
                        }
                      }}
                    />
                  ) : (
                    <Text style={[S.modalInputValue, destLabel ? { color: "#0f172a" } : {}]} numberOfLines={1}>
                      {destLabel || "Search address, city, or place…"}
                    </Text>
                  )}
                </View>
                {activeSearchField === "to" && searchBusy && (
                  <ActivityIndicator size={16} color="#0D9E7E" style={{ marginLeft: 8 }} />
                )}
                {activeSearchField === "to" && !searchBusy && destQuery.length > 0 && (
                  <TouchableOpacity
                    onPress={() => handleDestSearch("")}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  >
                    <View style={S.clearBtn}>
                      <Feather name="x" size={12} color="#64748b" />
                    </View>
                  </TouchableOpacity>
                )}
                {activeSearchField !== "to" && destLabel ? (
                  <Feather name="check-circle" size={14} color="#ef4444" />
                ) : null}
              </View>
            </View>
          </TouchableOpacity>

          {/* ── Results list ── */}
          <ScrollView
            keyboardShouldPersistTaps="handled"
            style={S.resultsList}
            showsVerticalScrollIndicator={false}
          >
            {/* FROM field results */}
            {activeSearchField === "from" && (() => {
              const busy = originBusy;
              const noResults = originNoResults;
              const query = originQuery;
              const results = originResults;
              return (
                <>
                  {/* Use GPS option when FROM is active */}
                  {userLoc && (
                    <TouchableOpacity
                      style={S.resultRow}
                      onPress={() => {
                        setCustomOrigin(null);
                        setCustomOriginLabel("");
                        setOriginQuery("");
                        setOriginResults([]);
                        setActiveSearchField("to");
                        Haptics.selectionAsync();
                      }}
                      activeOpacity={0.75}
                    >
                      <View style={[S.resultIcon, { backgroundColor: "#0D9E7E18" }]}>
                        <Feather name="crosshair" size={16} color="#0D9E7E" />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={S.resultPrimary}>My Location (GPS)</Text>
                        <Text style={S.resultSecondary}>Use your current GPS position</Text>
                      </View>
                      {!customOrigin && <Feather name="check" size={14} color="#0D9E7E" />}
                    </TouchableOpacity>
                  )}
                  {busy && query.length >= 2 && results.length === 0 && (
                    <View style={S.resultFeedback}>
                      <ActivityIndicator size={20} color="#0D9E7E" />
                      <Text style={S.resultFeedbackTxt}>Searching for "{query}"…</Text>
                    </View>
                  )}
                  {!busy && noResults && query.length >= 2 && (
                    <View style={S.resultFeedback}>
                      <Feather name="alert-circle" size={20} color="#94a3b8" />
                      <Text style={S.resultFeedbackTxt}>No results for "{query}"</Text>
                      <Text style={S.resultFeedbackSub}>Try a different address or city</Text>
                    </View>
                  )}
                  {!busy && query.length < 2 && results.length === 0 && !userLoc && (
                    <View style={S.resultFeedback}>
                      <Feather name="search" size={22} color="#cbd5e1" />
                      <Text style={S.resultFeedbackTxt}>Enter a starting address</Text>
                      <Text style={S.resultFeedbackSub}>Or enable GPS for your current location</Text>
                    </View>
                  )}
                  {results.map((r) => {
                    const parts = (r.display_name ?? "").split(",");
                    const primary = parts.slice(0, 2).join(",").trim();
                    const secondary = parts.slice(2, 5).join(",").trim();
                    return (
                      <TouchableOpacity
                        key={r.place_id}
                        style={S.resultRow}
                        onPress={() => selectOrigin(r)}
                        activeOpacity={0.75}
                      >
                        <View style={S.resultIcon}>
                          <Feather name="map-pin" size={16} color="#0D9E7E" />
                        </View>
                        <View style={{ flex: 1 }}>
                          <Text style={S.resultPrimary} numberOfLines={1}>{primary}</Text>
                          {secondary ? (
                            <Text style={S.resultSecondary} numberOfLines={1}>{secondary}</Text>
                          ) : null}
                        </View>
                        <Feather name="arrow-up-left" size={14} color="#cbd5e1" />
                      </TouchableOpacity>
                    );
                  })}
                </>
              );
            })()}

            {/* TO field results */}
            {activeSearchField === "to" && (() => {
              const busy = searchBusy;
              const noResults = searchNoResults;
              const query = destQuery;
              const results = searchResults;
              return (
                <>
                  {busy && query.length >= 2 && results.length === 0 && (
                    <View style={S.resultFeedback}>
                      <ActivityIndicator size={20} color="#0D9E7E" />
                      <Text style={S.resultFeedbackTxt}>Searching for "{query}"…</Text>
                    </View>
                  )}
                  {!busy && noResults && query.length >= 2 && (
                    <View style={S.resultFeedback}>
                      <Feather name="alert-circle" size={20} color="#94a3b8" />
                      <Text style={S.resultFeedbackTxt}>No results for "{query}"</Text>
                      <Text style={S.resultFeedbackSub}>Try a different address or city</Text>
                    </View>
                  )}
                  {/* Favorites + Recents when idle */}
                  {!busy && query.length < 2 && results.length === 0 && (() => {
                    const cutoff = Date.now() - 30 * 24 * 3600 * 1000;
                    const recentItems = destHistory.filter((e) => e.timestamp > cutoff);
                    return (
                      <>
                        {/* Favorites (Saved Places) */}
                        {savedPlaces.length > 0 && (
                          <>
                            <View style={S.historyHeader}>
                              <Ionicons name="star" size={13} color="#f59e0b" />
                              <Text style={S.historyHeaderTxt}>Favorites</Text>
                            </View>
                            {savedPlaces.map((sp) => (
                              <View key={sp.id} style={S.resultRow}>
                                <TouchableOpacity
                                  style={{ flex: 1, flexDirection: "row", alignItems: "center", gap: 10 }}
                                  onPress={() => navigateToLatLng(sp.lat, sp.lng, sp.name)}
                                  activeOpacity={0.75}
                                >
                                  <View style={[S.resultIcon, { backgroundColor: "#f59e0b18" }]}>
                                    <Ionicons name="star" size={16} color="#f59e0b" />
                                  </View>
                                  <View style={{ flex: 1 }}>
                                    <Text style={S.resultPrimary} numberOfLines={1}>{sp.name}</Text>
                                    <Text style={S.resultSecondary} numberOfLines={1}>{sp.label}</Text>
                                  </View>
                                </TouchableOpacity>
                                <TouchableOpacity
                                  onPress={() => {
                                    setEditPlaceTarget({ place: sp, pendingLabel: sp.label, pendingLat: sp.lat, pendingLng: sp.lng });
                                    setEditPlaceName(sp.name);
                                    setEditPlaceOpen(true);
                                    Haptics.selectionAsync();
                                  }}
                                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                                  style={{ padding: 6 }}
                                >
                                  <Feather name="edit-2" size={14} color="#94a3b8" />
                                </TouchableOpacity>
                              </View>
                            ))}
                          </>
                        )}

                        {/* Recents (Destination History) */}
                        {recentItems.length > 0 && (
                          <>
                            <View style={S.historyHeader}>
                              <Feather name="clock" size={13} color="#64748b" />
                              <Text style={S.historyHeaderTxt}>Recents</Text>
                            </View>
                            {recentItems.map((h) => (
                              <View key={h.id} style={S.resultRow}>
                                <TouchableOpacity
                                  style={{ flex: 1, flexDirection: "row", alignItems: "center", gap: 10 }}
                                  onPress={() => navigateToLatLng(h.lat, h.lng, h.label)}
                                  activeOpacity={0.75}
                                >
                                  <View style={S.resultIcon}>
                                    <Feather name="clock" size={16} color="#64748b" />
                                  </View>
                                  <View style={{ flex: 1 }}>
                                    <Text style={S.resultPrimary} numberOfLines={1}>{h.label}</Text>
                                  </View>
                                </TouchableOpacity>
                                <TouchableOpacity
                                  onPress={() => {
                                    setEditPlaceTarget({ place: null, pendingLabel: h.label, pendingLat: h.lat, pendingLng: h.lng });
                                    setEditPlaceName(h.label.split(",")[0]);
                                    setEditPlaceOpen(true);
                                    Haptics.selectionAsync();
                                  }}
                                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                                  style={{ padding: 6 }}
                                >
                                  <Ionicons name="star-outline" size={16} color="#94a3b8" />
                                </TouchableOpacity>
                              </View>
                            ))}
                          </>
                        )}

                        {/* Upcoming Calendar Events */}
                        {calPermission !== "denied" && (
                          <>
                            <View style={S.historyHeader}>
                              <Feather name="calendar" size={13} color="#64748b" />
                              <Text style={S.historyHeaderTxt}>Upcoming</Text>
                            </View>
                            {calPermission === "undetermined" && (
                              <TouchableOpacity style={S.resultRow} onPress={loadCalendarEvents} activeOpacity={0.75}>
                                <View style={[S.resultIcon, { backgroundColor: "#eff6ff" }]}>
                                  <Feather name="calendar" size={16} color="#3b82f6" />
                                </View>
                                <View style={{ flex: 1 }}>
                                  <Text style={S.resultPrimary}>Connect Calendar</Text>
                                  <Text style={S.resultSecondary}>Route to upcoming meetings with addresses</Text>
                                </View>
                                <Feather name="chevron-right" size={14} color="#cbd5e1" />
                              </TouchableOpacity>
                            )}
                            {calPermission === "granted" && calendarEvents.length === 0 && (
                              <Text style={S.calEmptyTxt}>No upcoming events with locations in the next 7 days</Text>
                            )}
                            {calPermission === "granted" && calendarEvents.map((evt) => (
                              <TouchableOpacity key={evt.id} style={S.resultRow} onPress={() => geocodeAndNavigate(evt)} activeOpacity={0.75}>
                                <View style={[S.resultIcon, { backgroundColor: "#eff6ff" }]}>
                                  {geocodingEventId === evt.id
                                    ? <ActivityIndicator size={16} color="#3b82f6" />
                                    : <Feather name="calendar" size={16} color="#3b82f6" />}
                                </View>
                                <View style={{ flex: 1 }}>
                                  <Text style={S.resultPrimary} numberOfLines={1}>{evt.title}</Text>
                                  <Text style={S.resultSecondary} numberOfLines={1}>{formatEventTime(evt.startDate)} · {evt.location}</Text>
                                </View>
                                {geocodingEventId !== evt.id && <Feather name="chevron-right" size={14} color="#cbd5e1" />}
                              </TouchableOpacity>
                            ))}
                          </>
                        )}

                        {savedPlaces.length === 0 && recentItems.length === 0 && calPermission === "denied" && (
                          <View style={S.resultFeedback}>
                            <Feather name="search" size={22} color="#cbd5e1" />
                            <Text style={S.resultFeedbackTxt}>Start typing to search</Text>
                            <Text style={S.resultFeedbackSub}>Search by street address, city, zip, or landmark</Text>
                          </View>
                        )}
                      </>
                    );
                  })()}
                  {results.map((r) => {
                    const parts = (r.display_name ?? "").split(",");
                    const primary = parts.slice(0, 2).join(",").trim();
                    const secondary = parts.slice(2, 5).join(",").trim();
                    return (
                      <View key={r.place_id} style={S.resultRow}>
                        <TouchableOpacity
                          style={{ flex: 1, flexDirection: "row", alignItems: "center", gap: 10 }}
                          onPress={() => selectDestination(r)}
                          activeOpacity={0.75}
                        >
                          <View style={S.resultIcon}>
                            <Feather name="map-pin" size={16} color="#ef4444" />
                          </View>
                          <View style={{ flex: 1 }}>
                            <Text style={S.resultPrimary} numberOfLines={1}>{primary}</Text>
                            {secondary ? (
                              <Text style={S.resultSecondary} numberOfLines={1}>{secondary}</Text>
                            ) : null}
                          </View>
                        </TouchableOpacity>
                        <TouchableOpacity
                          onPress={() => {
                            const lat = parseFloat(r.lat);
                            const lng = parseFloat(r.lon);
                            const label = (r.display_name ?? "").split(",").slice(0, 2).join(", ");
                            setEditPlaceTarget({ place: null, pendingLabel: label, pendingLat: lat, pendingLng: lng });
                            setEditPlaceName(label.split(",")[0]);
                            setEditPlaceOpen(true);
                            Haptics.selectionAsync();
                          }}
                          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                          style={{ padding: 6 }}
                        >
                          <Ionicons name="star-outline" size={16} color="#94a3b8" />
                        </TouchableOpacity>
                      </View>
                    );
                  })}
                </>
              );
            })()}
          </ScrollView>
        </View>
      </Modal>

      {/* ── Save / Edit Place Modal ── */}
      <Modal
        visible={editPlaceOpen}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setEditPlaceOpen(false)}
      >
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
          <View style={{ flex: 1, backgroundColor: "#fff", paddingTop: insets.top + 20 }}>
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 20, paddingBottom: 16, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "#e2e8f0" }}>
              <Text style={{ color: "#0f172a", fontSize: 18, fontWeight: "700", fontFamily: "Inter_700Bold" }}>
                {editPlaceTarget?.place ? "Edit Favorite" : "Save to Favorites"}
              </Text>
              <TouchableOpacity onPress={() => setEditPlaceOpen(false)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <Feather name="x" size={20} color="#64748b" />
              </TouchableOpacity>
            </View>
            <View style={{ padding: 20, gap: 16 }}>
              <View>
                <Text style={{ color: "#64748b", fontSize: 12, fontWeight: "600", fontFamily: "Inter_600SemiBold", textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 8 }}>Name</Text>
                <TextInput
                  value={editPlaceName}
                  onChangeText={setEditPlaceName}
                  placeholder="e.g. Home, Work, Mom's House…"
                  placeholderTextColor="#94a3b8"
                  autoFocus
                  style={{ borderWidth: 1, borderColor: "#e2e8f0", borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: 16, color: "#0f172a", fontFamily: "Inter_400Regular" }}
                />
              </View>
              {editPlaceTarget?.pendingLabel ? (
                <View style={{ backgroundColor: "#f8fafc", borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12 }}>
                  <Text style={{ color: "#64748b", fontSize: 12, fontFamily: "Inter_400Regular" }}>Address</Text>
                  <Text style={{ color: "#0f172a", fontSize: 14, fontFamily: "Inter_400Regular", marginTop: 2 }} numberOfLines={2}>{editPlaceTarget.pendingLabel}</Text>
                </View>
              ) : null}
              <TouchableOpacity
                style={{ backgroundColor: "#0D9E7E", borderRadius: 14, paddingVertical: 14, alignItems: "center", marginTop: 8 }}
                onPress={() => {
                  const name = editPlaceName.trim();
                  if (!name || !editPlaceTarget) return;
                  savePlace(
                    name,
                    editPlaceTarget.pendingLabel,
                    editPlaceTarget.pendingLat,
                    editPlaceTarget.pendingLng,
                    editPlaceTarget.place?.id
                  );
                  setEditPlaceOpen(false);
                  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                }}
                activeOpacity={0.85}
              >
                <Text style={{ color: "#fff", fontSize: 16, fontWeight: "700", fontFamily: "Inter_700Bold" }}>
                  {editPlaceTarget?.place ? "Save Changes" : "Add to Favorites"}
                </Text>
              </TouchableOpacity>
              {editPlaceTarget?.place && (
                <TouchableOpacity
                  style={{ borderWidth: 1, borderColor: "#fca5a5", borderRadius: 14, paddingVertical: 14, alignItems: "center" }}
                  onPress={() => {
                    if (editPlaceTarget.place) removeSavedPlace(editPlaceTarget.place.id);
                    setEditPlaceOpen(false);
                    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
                  }}
                  activeOpacity={0.85}
                >
                  <Text style={{ color: "#ef4444", fontSize: 15, fontWeight: "600", fontFamily: "Inter_600SemiBold" }}>Remove from Favorites</Text>
                </TouchableOpacity>
              )}
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* ── Voice & Language Settings Modal ── */}
      <Modal
        visible={voiceSettingsOpen}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setVoiceSettingsOpen(false)}
      >
        <View style={{ flex: 1, backgroundColor: "#0F172A" }}>
          {/* Header */}
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 20, paddingTop: 20, paddingBottom: 14, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "#1e293b" }}>
            <Text style={{ color: "#f1f5f9", fontSize: 18, fontWeight: "700", fontFamily: "Inter_700Bold" }}>Voice &amp; Language</Text>
            <TouchableOpacity onPress={() => setVoiceSettingsOpen(false)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Feather name="x" size={20} color="#94a3b8" />
            </TouchableOpacity>
          </View>

          <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 20, gap: 24 }}>
            {/* Language */}
            <View>
              <Text style={{ color: "#94a3b8", fontSize: 12, fontWeight: "600", fontFamily: "Inter_600SemiBold", textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 10 }}>Language</Text>
              {[
                { code: "en-US", label: "English (US)" },
                { code: "en-GB", label: "English (UK)" },
                { code: "es-ES", label: "Spanish" },
                { code: "fr-FR", label: "French" },
                { code: "de-DE", label: "German" },
                { code: "it-IT", label: "Italian" },
                { code: "pt-BR", label: "Portuguese (Brazil)" },
                { code: "ja-JP", label: "Japanese" },
                { code: "zh-CN", label: "Chinese (Simplified)" },
                { code: "ko-KR", label: "Korean" },
              ].map((opt) => (
                <TouchableOpacity
                  key={opt.code}
                  onPress={() => {
                    setNavLanguage(opt.code);
                    navLanguageRef.current = opt.code;
                    setNavVoiceId(null);
                    navVoiceIdRef.current = null;
                    AsyncStorage.multiSet([["@chargebridge/nav_language", opt.code], ["@chargebridge/nav_voice_id", ""]]).catch(() => {});
                    Speech.getAvailableVoicesAsync().then((voices) => {
                      setAvailableVoices(voices);
                      const lang = opt.code.split("-")[0];
                      const femNames = ["samantha", "karen", "ava", "serena", "allison", "tessa", "zoe", "moira", "fiona"];
                      const pick = voices.find((v) => v.language.startsWith(lang) && femNames.some((n) => v.name.toLowerCase().includes(n)));
                      if (pick) {
                        setNavVoiceId(pick.identifier);
                        navVoiceIdRef.current = pick.identifier;
                        AsyncStorage.setItem("@chargebridge/nav_voice_id", pick.identifier).catch(() => {});
                      }
                    }).catch(() => {});
                    Haptics.selectionAsync();
                  }}
                  activeOpacity={0.75}
                  style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "#1e293b" }}
                >
                  <Text style={{ color: navLanguage === opt.code ? "#0D9E7E" : "#e2e8f0", fontSize: 15, fontFamily: "Inter_400Regular" }}>{opt.label}</Text>
                  {navLanguage === opt.code && <Feather name="check" size={16} color="#0D9E7E" />}
                </TouchableOpacity>
              ))}
            </View>

            {/* Voice selection */}
            {availableVoices.length > 0 && (
              <View>
                <Text style={{ color: "#94a3b8", fontSize: 12, fontWeight: "600", fontFamily: "Inter_600SemiBold", textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 10 }}>Voice</Text>
                {availableVoices
                  .filter((v) => v.language.startsWith(navLanguage.split("-")[0]))
                  .map((v) => (
                    <TouchableOpacity
                      key={v.identifier}
                      onPress={() => {
                        setNavVoiceId(v.identifier);
                        navVoiceIdRef.current = v.identifier;
                        AsyncStorage.setItem("@chargebridge/nav_voice_id", v.identifier).catch(() => {});
                        if (speakTimerRef.current) { clearTimeout(speakTimerRef.current); speakTimerRef.current = null; }
                        if (isSpeakingWatchdogRef.current) { clearTimeout(isSpeakingWatchdogRef.current); isSpeakingWatchdogRef.current = null; }
                        try { Speech.stop(); } catch {}
                        isSpeakingRef.current = false;
                        speakQueueRef.current = null;
                        const _selId = availableVoicesRef.current.some((av) => av.identifier === v.identifier) ? v.identifier : null;
                        Speech.speak("Navigation voice selected.", { language: navLanguage, rate: navVoiceRate, pitch: navVoicePitch, volume: navVoiceVolume, ...(_selId ? { voice: _selId } : {}), onDone: () => { isSpeakingRef.current = false; }, onStopped: () => { isSpeakingRef.current = false; }, onError: () => { isSpeakingRef.current = false; } });
                        Haptics.selectionAsync();
                      }}
                      activeOpacity={0.75}
                      style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "#1e293b" }}
                    >
                      <View>
                        <Text style={{ color: navVoiceId === v.identifier ? "#0D9E7E" : "#e2e8f0", fontSize: 15, fontFamily: "Inter_400Regular" }}>{v.name}</Text>
                        <Text style={{ color: "#64748b", fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 1 }}>{v.language}</Text>
                      </View>
                      {navVoiceId === v.identifier ? (
                        <Feather name="check" size={16} color="#0D9E7E" />
                      ) : (
                        <Feather name="volume-2" size={14} color="#475569" />
                      )}
                    </TouchableOpacity>
                  ))}
              </View>
            )}

            {/* Speaking speed */}
            <View style={{ paddingVertical: 14, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: "#1e293b" }}>
              <Text style={{ color: "#94a3b8", fontSize: 12, fontWeight: "600", fontFamily: "Inter_600SemiBold", textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 12 }}>Speaking Speed</Text>
              <View style={{ flexDirection: "row", gap: 8 }}>
                {([{ label: "Slow", rate: 0.75 }, { label: "Normal", rate: 0.88 }, { label: "Fast", rate: 1.0 }] as { label: string; rate: number }[]).map((opt) => {
                  const active = Math.abs(navVoiceRate - opt.rate) < 0.05;
                  return (
                    <TouchableOpacity
                      key={opt.label}
                      style={{ flex: 1, paddingVertical: 10, borderRadius: 10, alignItems: "center", backgroundColor: active ? "#0D9E7E22" : "#1e293b", borderWidth: 1, borderColor: active ? "#0D9E7E" : "#334155" }}
                      onPress={() => {
                        setNavVoiceRate(opt.rate);
                        navVoiceRateRef.current = opt.rate;
                        AsyncStorage.setItem("@chargebridge/nav_voice_rate", String(opt.rate)).catch(() => {});
                        if (speakTimerRef.current) { clearTimeout(speakTimerRef.current); speakTimerRef.current = null; }
                        if (isSpeakingWatchdogRef.current) { clearTimeout(isSpeakingWatchdogRef.current); isSpeakingWatchdogRef.current = null; }
                        try { Speech.stop(); } catch {}
                        isSpeakingRef.current = false;
                        speakQueueRef.current = null;
                        const _spdId = navVoiceId && availableVoicesRef.current.some((av) => av.identifier === navVoiceId) ? navVoiceId : null;
                        Speech.speak("Speed updated.", { language: navLanguage, rate: opt.rate, pitch: navVoicePitch, volume: navVoiceVolume, ...(_spdId ? { voice: _spdId } : {}), onDone: () => { isSpeakingRef.current = false; }, onStopped: () => { isSpeakingRef.current = false; }, onError: () => { isSpeakingRef.current = false; } });
                        Haptics.selectionAsync();
                      }}
                      activeOpacity={0.75}
                    >
                      <Text style={{ color: active ? "#0D9E7E" : "#94a3b8", fontSize: 14, fontFamily: "Inter_600SemiBold", fontWeight: "600" }}>{opt.label}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>

            {/* Announcement level */}
            <View style={{ paddingVertical: 14, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: "#1e293b" }}>
              <Text style={{ color: "#94a3b8", fontSize: 12, fontWeight: "600", fontFamily: "Inter_600SemiBold", textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 4 }}>Announcement Level</Text>
              <Text style={{ color: "#475569", fontSize: 12, fontFamily: "Inter_400Regular", marginBottom: 12 }}>How often voice guidance fires per turn</Text>
              <View style={{ flexDirection: "row", gap: 8 }}>
                {([
                  { level: "quiet" as const, label: "Quiet", sub: "Turn only" },
                  { level: "normal" as const, label: "Normal", sub: "3 per turn" },
                  { level: "verbose" as const, label: "Verbose", sub: "Early + all" },
                ]).map((opt) => {
                  const active = navVoiceLevel === opt.level;
                  return (
                    <TouchableOpacity
                      key={opt.level}
                      style={{ flex: 1, paddingVertical: 10, borderRadius: 10, alignItems: "center", backgroundColor: active ? "#0D9E7E22" : "#1e293b", borderWidth: 1, borderColor: active ? "#0D9E7E" : "#334155" }}
                      onPress={() => {
                        setNavVoiceLevel(opt.level);
                        navVoiceLevelRef.current = opt.level;
                        AsyncStorage.setItem("@chargebridge/nav_voice_level", opt.level).catch(() => {});
                        Haptics.selectionAsync();
                      }}
                      activeOpacity={0.75}
                    >
                      <Text style={{ color: active ? "#0D9E7E" : "#94a3b8", fontSize: 13, fontFamily: "Inter_600SemiBold", fontWeight: "600" }}>{opt.label}</Text>
                      <Text style={{ color: active ? "#5eead4" : "#475569", fontSize: 10, fontFamily: "Inter_400Regular", marginTop: 2 }}>{opt.sub}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>

            {/* Volume */}
            <View style={{ paddingVertical: 14, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: "#1e293b" }}>
              <Text style={{ color: "#94a3b8", fontSize: 12, fontWeight: "600", fontFamily: "Inter_600SemiBold", textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 4 }}>Volume</Text>
              <Text style={{ color: "#475569", fontSize: 12, fontFamily: "Inter_400Regular", marginBottom: 12 }}>Navigation voice loudness</Text>
              <View style={{ flexDirection: "row", gap: 8 }}>
                {([{ label: "25%", vol: 0.25 }, { label: "50%", vol: 0.5 }, { label: "75%", vol: 0.75 }, { label: "100%", vol: 1.0 }] as { label: string; vol: number }[]).map((opt) => {
                  const active = Math.abs(navVoiceVolume - opt.vol) < 0.05;
                  return (
                    <TouchableOpacity
                      key={opt.label}
                      style={{ flex: 1, paddingVertical: 10, borderRadius: 10, alignItems: "center", backgroundColor: active ? "#0D9E7E22" : "#1e293b", borderWidth: 1, borderColor: active ? "#0D9E7E" : "#334155" }}
                      onPress={() => {
                        setNavVoiceVolume(opt.vol);
                        navVoiceVolumeRef.current = opt.vol;
                        AsyncStorage.setItem("@chargebridge/nav_voice_volume", String(opt.vol)).catch(() => {});
                        Haptics.selectionAsync();
                      }}
                      activeOpacity={0.75}
                    >
                      <Text style={{ color: active ? "#0D9E7E" : "#94a3b8", fontSize: 13, fontFamily: "Inter_600SemiBold", fontWeight: "600" }}>{opt.label}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>

            {/* Mute toggle */}
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 14, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: "#1e293b" }}>
              <View>
                <Text style={{ color: "#e2e8f0", fontSize: 15, fontFamily: "Inter_400Regular" }}>Mute voice guidance</Text>
                <Text style={{ color: "#64748b", fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2 }}>Turn off all spoken instructions</Text>
              </View>
              <TouchableOpacity
                onPress={() => { setVoiceMuted((m) => !m); Haptics.selectionAsync(); }}
                style={{ width: 48, height: 28, borderRadius: 14, backgroundColor: voiceMuted ? "#0D9E7E" : "#334155", alignItems: "center", justifyContent: "center" }}
              >
                <View style={{ width: 22, height: 22, borderRadius: 11, backgroundColor: "#fff", position: "absolute", left: voiceMuted ? 22 : 3 }} />
              </TouchableOpacity>
            </View>
          </ScrollView>
        </View>
      </Modal>
    </View>
  );
}

const S = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#000" },

  // Web header
  webHeader: { paddingHorizontal: 18, paddingBottom: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  title: { fontSize: 22, fontWeight: "700", fontFamily: "Inter_700Bold" },
  sub: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 1 },

  // Search bar
  searchBar: { position: "absolute", left: 12, right: 12, zIndex: 30, gap: 8 },
  mapWallpaperBtn: {
    alignSelf: "flex-end",
    width: 38, height: 38, borderRadius: 19,
    backgroundColor: "#fff",
    alignItems: "center", justifyContent: "center",
    shadowColor: "#000", shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15, shadowRadius: 6, elevation: 4,
  },
  searchPill: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#fff",
    borderRadius: 22,
    paddingVertical: 11,
    paddingHorizontal: 14,
    gap: 10,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.14,
    shadowRadius: 12,
    elevation: 6,
  },
  searchIcon: {
    width: 32,
    height: 32,
    borderRadius: 10,
    backgroundColor: "#0D9E7E18",
    alignItems: "center",
    justifyContent: "center",
  },
  searchPlaceholder: { fontSize: 14, color: "#94a3b8", fontFamily: "Inter_400Regular" },
  searchTo: { fontSize: 14, fontWeight: "700", color: "#0f172a", fontFamily: "Inter_700Bold" },
  searchFrom: { fontSize: 11, color: "#94a3b8", fontFamily: "Inter_400Regular", marginTop: 1 },

  // Route info
  routeInfoPill: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#1C1C1E",
    borderRadius: 22,
    paddingVertical: 9,
    paddingHorizontal: 16,
    gap: 7,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.28,
    shadowRadius: 10,
    elevation: 6,
  },
  routeInfoText: { fontSize: 13, fontWeight: "700", color: "#fff", fontFamily: "Inter_700Bold" },
  routeInfoStations: { fontSize: 11, color: "rgba(255,255,255,0.5)", fontFamily: "Inter_400Regular" },

  // Controls
  controls: {
    position: "absolute",
    right: 12,
    zIndex: 30,
    gap: 10,
  },
  ctrlBtn: {
    width: 44,
    height: 44,
    borderRadius: 14,
    backgroundColor: "#fff",
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.16,
    shadowRadius: 6,
    elevation: 4,
  },
  ctrlBtnActive: { backgroundColor: "#0D9E7E" },
  ctrlLabel3D: { fontSize: 13, fontWeight: "800", color: "#0D9E7E", fontFamily: "Inter_700Bold" },

  // Navigate button
  navBtn: {
    position: "absolute",
    right: 16,
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    backgroundColor: "#0D9E7E",
    paddingVertical: 13,
    paddingHorizontal: 22,
    borderRadius: 28,
    shadowColor: "#0D9E7E",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.45,
    shadowRadius: 12,
    elevation: 8,
    zIndex: 40,
  },
  navBtnTxt: { fontSize: 15, fontWeight: "700", color: "#fff", fontFamily: "Inter_700Bold" },

  // Pins
  pinOuter: {
    borderWidth: 2.5,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 4,
  },

  // Floating station popup card
  popup: {
    position: "absolute",
    left: 12,
    right: 12,
    backgroundColor: "#fff",
    borderRadius: 22,
    padding: 16,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.18,
    shadowRadius: 20,
    elevation: 24,
    zIndex: 50,
  },
  popupCloseBtn: {
    position: "absolute",
    top: 12,
    right: 12,
    zIndex: 10,
  },
  popupCloseCircle: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: "#f1f5f9",
    alignItems: "center",
    justifyContent: "center",
  },
  popupRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
    paddingRight: 30,
  },
  popupIcon: {
    width: 50,
    height: 50,
    borderRadius: 15,
    alignItems: "center",
    justifyContent: "center",
    position: "relative",
    flexShrink: 0,
  },
  popupStatusDot: {
    position: "absolute",
    bottom: 5,
    right: 5,
    width: 11,
    height: 11,
    borderRadius: 5.5,
    borderWidth: 2,
    borderColor: "#fff",
  },
  popupBody: { flex: 1, minWidth: 0 },
  popupName: {
    fontSize: 16,
    fontWeight: "700",
    color: "#0f172a",
    fontFamily: "Inter_700Bold",
  },
  popupAddr: {
    fontSize: 12,
    color: "#94a3b8",
    fontFamily: "Inter_400Regular",
    marginTop: 2,
  },
  popupMeta: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: 7,
    flexWrap: "wrap",
  },
  popupBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
  },
  popupBadgeTxt: {
    fontSize: 11,
    fontWeight: "700",
    fontFamily: "Inter_700Bold",
  },
  popupPrice: {
    fontSize: 12,
    fontWeight: "700",
    color: "#0f172a",
    fontFamily: "Inter_600SemiBold",
  },
  popupDistRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    marginTop: 10,
    paddingTop: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "#f1f5f9",
  },
  popupDistTxt: {
    fontSize: 13,
    fontWeight: "700",
    color: "#0D9E7E",
    fontFamily: "Inter_700Bold",
  },
  popupDistLive: {
    fontSize: 11,
    color: "#94a3b8",
    fontFamily: "Inter_400Regular",
  },
  popupRateRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "#f1f5f9",
  },
  popupRateTxt: {
    flex: 1,
    fontSize: 12,
    color: "#64748b",
    fontFamily: "Inter_400Regular",
  },
  popupActions: {
    flexDirection: "row",
    gap: 10,
    marginTop: 12,
  },
  popupBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 11,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: "#e2e8f0",
  },
  popupBtnPrimary: {
    backgroundColor: "#0D9E7E",
    borderColor: "#0D9E7E",
  },
  popupBtnTxtWhite: {
    fontSize: 14,
    fontWeight: "700",
    color: "#fff",
    fontFamily: "Inter_700Bold",
  },
  popupBtnTxt: {
    fontSize: 14,
    fontWeight: "700",
    fontFamily: "Inter_700Bold",
  },

  // Transport mode selector
  modeRow: {
    flexDirection: "row",
    gap: 8,
    paddingHorizontal: 2,
  },
  modeBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 5,
    paddingVertical: 8,
    borderRadius: 14,
    backgroundColor: "#fff",
    borderWidth: 1.5,
    borderColor: "#e2e8f0",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.07,
    shadowRadius: 4,
    elevation: 2,
  },
  modeBtnActive: {
    backgroundColor: "#0D9E7E",
    borderColor: "#0D9E7E",
  },
  modeBtnTxt: {
    fontSize: 12,
    fontWeight: "700",
    color: "#64748b",
    fontFamily: "Inter_700Bold",
  },

  // Street View inline link
  popupStreetView: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    marginTop: 10,
    paddingTop: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "#f1f5f9",
  },
  popupStreetViewTxt: {
    fontSize: 12,
    color: "#64748b",
    fontFamily: "Inter_400Regular",
  },

  // Route error pill
  routeErrorPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "#1C1C1E",
    borderRadius: 22,
    paddingVertical: 9,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: "#FF3B3044",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.28,
    shadowRadius: 10,
    elevation: 5,
  },
  routeErrorText: {
    flex: 1,
    fontSize: 12,
    color: "#ef4444",
    fontFamily: "Inter_400Regular",
  },

  // Live indicator
  liveRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 4,
    paddingVertical: 2,
    gap: 2,
    alignSelf: "flex-start",
  },
  liveDot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
    backgroundColor: "#22c55e",
    marginRight: 3,
  },
  liveTxt: {
    fontSize: 11,
    fontWeight: "700",
    color: "#22c55e",
    fontFamily: "Inter_700Bold",
    letterSpacing: 0.3,
    textShadowColor: "rgba(0,0,0,0.5)",
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  liveAge: {
    fontSize: 11,
    color: "#fff",
    fontFamily: "Inter_400Regular",
    textShadowColor: "rgba(0,0,0,0.5)",
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  liveRefreshBtn: {
    marginLeft: 6,
    width: 24,
    height: 24,
    borderRadius: 8,
    backgroundColor: "rgba(255,255,255,0.85)",
    alignItems: "center",
    justifyContent: "center",
  },

  // Modal
  modalRoot: { flex: 1, backgroundColor: "#fff", paddingHorizontal: 18 },
  modalHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 20,
  },
  modalTitle: { fontSize: 20, fontWeight: "700", color: "#0f172a", fontFamily: "Inter_700Bold" },
  modalCloseBtn: {
    width: 32, height: 32, borderRadius: 16,
    backgroundColor: "#f1f5f9",
    alignItems: "center", justifyContent: "center",
  },
  modalRow: { flexDirection: "row", alignItems: "flex-start", gap: 10, marginBottom: 6 },
  modalDotCol: { alignItems: "center", paddingTop: 14, width: 20 },
  modalDot: { width: 12, height: 12, borderRadius: 6, flexShrink: 0 },
  modalDotLine: { width: 2, height: 20, backgroundColor: "#e2e8f0", marginTop: 4 },
  modalInput: {
    flex: 1,
    backgroundColor: "#f8fafc",
    borderRadius: 14,
    padding: 12,
    borderWidth: 1.5,
    borderColor: "#e2e8f0",
  },
  modalInputFocused: { borderColor: "#0D9E7E", backgroundColor: "#fff" },
  modalInputLabel: { fontSize: 9, fontWeight: "700", color: "#94a3b8", letterSpacing: 1, fontFamily: "Inter_700Bold" },
  modalInputValue: { fontSize: 14, color: "#64748b", marginTop: 3, fontFamily: "Inter_400Regular" },
  modalInputText: { fontSize: 15, color: "#0f172a", marginTop: 3, fontFamily: "Inter_400Regular", minHeight: 22 },
  clearBtn: {
    width: 22, height: 22, borderRadius: 11,
    backgroundColor: "#e2e8f0",
    alignItems: "center", justifyContent: "center",
    marginLeft: 8,
  },
  resultsList: { marginTop: 16, flex: 1 },
  resultFeedback: {
    alignItems: "center",
    paddingTop: 48,
    gap: 10,
  },
  resultFeedbackTxt: {
    fontSize: 14, fontWeight: "600", color: "#64748b",
    fontFamily: "Inter_600SemiBold", textAlign: "center",
  },
  resultFeedbackSub: {
    fontSize: 12, color: "#94a3b8",
    fontFamily: "Inter_400Regular", textAlign: "center",
    paddingHorizontal: 24,
  },
  resultRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#f1f5f9",
  },
  resultIcon: {
    width: 38,
    height: 38,
    borderRadius: 11,
    backgroundColor: "#0D9E7E15",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  resultPrimary: { fontSize: 14, fontWeight: "600", color: "#0f172a", fontFamily: "Inter_600SemiBold" },
  resultSecondary: { fontSize: 12, color: "#94a3b8", fontFamily: "Inter_400Regular", marginTop: 2 },

  // ── Turn-by-turn banner ────────────────────────────────────────────────────
  turnBanner: {
    position: "absolute",
    left: 12,
    right: 12,
    backgroundColor: "#0f172a",
    borderRadius: 16,
    flexDirection: "row",
    alignItems: "flex-start",
    paddingVertical: 11,
    paddingHorizontal: 11,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.40,
    shadowRadius: 16,
    elevation: 14,
    gap: 8,
  },
  navEvidenceCaptureHost: {
    alignItems: "center",
    left: 12,
    position: "absolute",
    right: 12,
    zIndex: 35,
  },
  turnBannerLeft: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  turnIconBox: {
    width: 46,
    height: 46,
    borderRadius: 13,
    backgroundColor: "#0D9E7E",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
    shadowColor: "#0D9E7E",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.45,
    shadowRadius: 6,
    elevation: 4,
  },
  turnInstruction: {
    fontSize: 15,
    fontWeight: "800",
    color: "#fff",
    fontFamily: "Inter_700Bold",
    lineHeight: 18,
    letterSpacing: -0.3,
  },
  turnNext: {
    fontSize: 9,
    color: "#94a3b8",
    fontFamily: "Inter_400Regular",
    marginTop: 2,
  },
  turnStreet: {
    fontSize: 11,
    color: "#5eead4",
    fontFamily: "Inter_600SemiBold",
    fontWeight: "600",
    marginTop: 3,
    letterSpacing: 0.1,
  },
  turnDistBox: {
    alignItems: "center",
    minWidth: 42,
    paddingTop: 2,
  },
  turnDist: {
    fontSize: 13,
    fontWeight: "800",
    color: "#fff",
    fontFamily: "Inter_700Bold",
    textAlign: "center",
    letterSpacing: -0.2,
  },
  laneSection: {
    marginTop: 7,
    paddingLeft: 56,
  },
  laneLabel: {
    fontSize: 7,
    fontWeight: "700",
    color: "#475569",
    fontFamily: "Inter_700Bold",
    letterSpacing: 1.0,
    marginBottom: 3,
  },
  laneUse: {
    fontSize: 6,
    fontWeight: "700",
    color: "#0D9E7E",
    fontFamily: "Inter_700Bold",
    letterSpacing: 0.6,
    marginTop: 1,
  },
  thenPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    marginTop: 5,
    paddingLeft: 56,
  },
  thenLabel: {
    fontSize: 7,
    fontWeight: "400",
    color: "#6b7280",
    fontFamily: "Inter_400Regular",
    letterSpacing: 0,
  },
  thenTxt: {
    fontSize: 7,
    color: "#9ca3af",
    fontFamily: "Inter_400Regular",
    flex: 1,
  },

  // ── Alternative routes strip ───────────────────────────────────────────────
  altStrip: {
    marginTop: 8,
    marginBottom: 4,
  },
  altChip: {
    backgroundColor: "rgba(255,255,255,0.9)",
    borderRadius: 12,
    paddingVertical: 8,
    paddingHorizontal: 12,
    alignItems: "center",
    borderWidth: 1.5,
    borderColor: "#94a3b8",
    minWidth: 80,
  },
  altChipActive: {
    borderColor: "#0D9E7E",
    backgroundColor: "#0D9E7E15",
  },
  altChipLabel: {
    fontSize: 10,
    fontWeight: "700",
    color: "#64748b",
    fontFamily: "Inter_700Bold",
    letterSpacing: 0.5,
  },
  altChipTime: {
    fontSize: 14,
    fontWeight: "700",
    color: "#0f172a",
    fontFamily: "Inter_700Bold",
    marginTop: 2,
  },
  altChipDist: {
    fontSize: 11,
    color: "#94a3b8",
    fontFamily: "Inter_400Regular",
    marginTop: 1,
  },

  // ── ETA strip (bottom, during navigation) ────────────────────────────────
  etaStrip: {
    position: "absolute",
    left: 12,
    right: 12,
    backgroundColor: "#1C1C1E",
    borderRadius: 14,
    flexDirection: "column",
    paddingVertical: 8,
    paddingHorizontal: 9,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.38,
    shadowRadius: 16,
    elevation: 12,
  },
  etaTime: {
    fontSize: 15,
    fontWeight: "800",
    color: "#fff",
    fontFamily: "Inter_700Bold",
    lineHeight: 17,
    letterSpacing: -0.3,
  },
  etaMeta: {
    fontSize: 8,
    color: "rgba(255,255,255,0.6)",
    fontFamily: "Inter_400Regular",
    marginTop: 1,
  },
  etaEndBtn: {
    backgroundColor: "#FF3B30",
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 7,
    paddingHorizontal: 9,
    minWidth: 36,
  },
  etaEndTxt: {
    fontSize: 8,
    fontWeight: "700",
    color: "#fff",
    fontFamily: "Inter_700Bold",
    letterSpacing: -0.1,
  },
  etaAddStopBtn: {
    backgroundColor: "rgba(255,255,255,0.08)",
    borderRadius: 8,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
    paddingVertical: 5,
    marginTop: 5,
  },
  etaAddStopTxt: {
    fontSize: 8,
    fontWeight: "600",
    color: "#60a5fa",
    fontFamily: "Inter_600SemiBold",
  },

  // ── Recents / Favorites sections in search ────────────────────────────────
  historyHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 4,
    paddingTop: 12,
    paddingBottom: 6,
  },
  historyHeaderTxt: {
    fontSize: 12,
    fontWeight: "600",
    color: "#94a3b8",
    fontFamily: "Inter_600SemiBold",
    textTransform: "uppercase",
    letterSpacing: 0.6,
  },

  // ── Calendar section ───────────────────────────────────────────────────────
  calEmptyTxt: {
    fontSize: 13,
    color: "#94a3b8",
    fontFamily: "Inter_400Regular",
    paddingHorizontal: 4,
    paddingVertical: 10,
    textAlign: "center",
  },

  // ── Arrived overlay ────────────────────────────────────────────────────────
  arrivedOverlay: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: "rgba(15,23,42,0.65)",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 50,
  },
  arrivedCard: {
    backgroundColor: "#fff",
    borderRadius: 24,
    paddingVertical: 36,
    paddingHorizontal: 32,
    alignItems: "center",
    width: "84%",
    maxWidth: 360,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.30,
    shadowRadius: 24,
    elevation: 22,
    gap: 10,
  },
  arrivedCardEv: {
    paddingVertical: 28,
    paddingHorizontal: 24,
  },
  arrivedIcon: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: "#0D9E7E18",
    borderWidth: 2,
    borderColor: "#0D9E7E33",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 4,
  },
  arrivedTitle: {
    fontSize: 24,
    fontWeight: "700",
    color: "#0f172a",
    fontFamily: "Inter_700Bold",
    textAlign: "center",
  },
  arrivedSub: {
    fontSize: 14,
    color: "#64748b",
    fontFamily: "Inter_400Regular",
    textAlign: "center",
    lineHeight: 20,
  },
  arrivedEvDetails: {
    width: "100%",
    backgroundColor: "#f8fafc",
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 14,
    gap: 6,
  },
  arrivedDetailRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  arrivedDetailTxt: {
    fontSize: 13,
    color: "#475569",
    fontFamily: "Inter_500Medium",
    fontWeight: "500",
  },
  arrivedChargeBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    width: "100%",
    backgroundColor: "#0D9E7E",
    borderRadius: 14,
    paddingVertical: 15,
    marginTop: 6,
  },
  arrivedChargeBtnTxt: {
    fontSize: 16,
    fontWeight: "700",
    color: "#fff",
    fontFamily: "Inter_700Bold",
  },
  arrivedBtn: {
    marginTop: 6,
    backgroundColor: "#0D9E7E",
    borderRadius: 14,
    paddingVertical: 14,
    paddingHorizontal: 40,
    width: "100%",
    alignItems: "center",
  },
  arrivedBtnSecondary: {
    backgroundColor: "transparent",
    borderWidth: 1,
    borderColor: "#e2e8f0",
    paddingVertical: 11,
  },
  arrivedBtnTxt: {
    fontSize: 16,
    fontWeight: "700",
    color: "#fff",
    fontFamily: "Inter_700Bold",
  },

  // ── Step list items ────────────────────────────────────────────────────────
  stepRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#f1f5f9",
  },
  stepRowActive: {
    backgroundColor: "#0D9E7E0D",
    borderRadius: 12,
    paddingHorizontal: 8,
    marginHorizontal: -8,
  },
  stepIconBox: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: "#f1f5f9",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  stepInstruction: {
    fontSize: 14,
    fontWeight: "600",
    color: "#0f172a",
    fontFamily: "Inter_600SemiBold",
    lineHeight: 20,
  },
  stepDist: {
    fontSize: 12,
    color: "#94a3b8",
    fontFamily: "Inter_400Regular",
    marginTop: 3,
  },

  // ── Walking options panel ─────────────────────────────────────────────────
  walkPanel: {
    backgroundColor: "#f0fdf4",
    borderRadius: 14,
    padding: 10,
    borderWidth: 1,
    borderColor: "#10b98125",
  },
  walkPaceRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginBottom: 8,
  },
  walkPaceLbl: {
    fontSize: 12,
    fontWeight: "600",
    fontFamily: "Inter_600SemiBold",
    color: "#374151",
    marginRight: 2,
  },
  walkPaceBtn: {
    flex: 1,
    alignItems: "center",
    paddingVertical: 5,
    borderRadius: 8,
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: "#d1fae5",
  },
  walkPaceBtnActive: {
    backgroundColor: "#10b981",
    borderColor: "#10b981",
  },
  walkPaceBtnTxt: {
    fontSize: 11,
    fontWeight: "600",
    fontFamily: "Inter_600SemiBold",
    color: "#10b981",
  },
  walkStatsRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  walkStat: {
    flex: 1,
    alignItems: "center",
  },
  walkStatVal: {
    fontSize: 16,
    fontWeight: "700",
    fontFamily: "Inter_700Bold",
    color: "#065f46",
  },
  walkStatLbl: {
    fontSize: 10,
    fontFamily: "Inter_400Regular",
    color: "#6b7280",
    marginTop: 1,
  },
  walkStatDiv: {
    width: 1,
    height: 28,
    backgroundColor: "#d1fae5",
  },
  etaWalkStats: {
    fontSize: 7,
    fontFamily: "Inter_400Regular",
    color: "rgba(255,255,255,0.5)",
    marginTop: 2,
  },

  // ── Nav pill minimized bars (auto-hide; tap to expand) ────────────────────
  navPillMinBar: {
    position: "absolute",
    left: "10%",
    right: "10%",
    backgroundColor: "rgba(15,23,42,0.92)",
    borderRadius: 26,
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 21,
    paddingHorizontal: 24,
    gap: 14,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.38,
    shadowRadius: 16,
    elevation: 12,
  },
  navPillMinBarBottom: {
    position: "absolute",
    left: 12,
    right: 12,
    backgroundColor: "rgba(28,28,30,0.92)",
    borderRadius: 14,
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 9,
    paddingHorizontal: 12,
    gap: 8,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.28,
    shadowRadius: 8,
    elevation: 8,
  },
  navPillMinTxt: {
    fontSize: 22,
    fontWeight: "800",
    color: "#fff",
    fontFamily: "Inter_700Bold",
    letterSpacing: -0.4,
  },
  navPillMinDist: {
    fontSize: 20,
    fontWeight: "800",
    color: "rgba(255,255,255,0.65)",
    fontFamily: "Inter_700Bold",
    flexShrink: 0,
  },
  navPillMinTime: {
    fontSize: 18,
    fontWeight: "800",
    color: "#fff",
    fontFamily: "Inter_700Bold",
  },
  navPillMinEta: {
    flex: 1,
    fontSize: 10,
    color: "rgba(255,255,255,0.5)",
    fontFamily: "Inter_400Regular",
  },
  navPillMinEnd: {
    backgroundColor: "#FF3B30",
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 6,
    paddingHorizontal: 10,
  },

  // ── Transit panel ────────────────────────────────────────────────────────────
  transitPanel: {
    backgroundColor: "#fff",
    borderRadius: 16,
    padding: 12,
    borderWidth: 1,
    borderColor: "#6366f120",
    shadowColor: "#6366f1",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 4,
  },
  transitHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginBottom: 10,
  },
  transitHeaderTxt: {
    flex: 1,
    fontSize: 13,
    fontWeight: "700",
    fontFamily: "Inter_700Bold",
    color: "#1e293b",
  },
  transitCloseBtn: {
    padding: 2,
  },
  transitEmpty: {
    fontSize: 13,
    color: "#94a3b8",
    fontFamily: "Inter_400Regular",
    textAlign: "center",
    paddingVertical: 8,
  },
  transitStopRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#f1f5f9",
  },
  transitStopIcon: {
    width: 34,
    height: 34,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  transitStopName: {
    fontSize: 13,
    fontWeight: "600",
    fontFamily: "Inter_600SemiBold",
    color: "#1e293b",
    marginBottom: 2,
  },
  transitRoutes: {
    fontSize: 11,
    fontFamily: "Inter_600SemiBold",
    color: "#6366f1",
  },
  transitOperator: {
    fontSize: 11,
    fontFamily: "Inter_400Regular",
    color: "#94a3b8",
  },
  transitDist: {
    fontSize: 11,
    fontFamily: "Inter_400Regular",
    color: "#64748b",
  },
  transitLiveBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    backgroundColor: "#6366f110",
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderWidth: 1,
    borderColor: "#6366f125",
  },
  transitLiveTxt: {
    fontSize: 11,
    fontWeight: "700",
    fontFamily: "Inter_700Bold",
    color: "#6366f1",
  },
  transitDirBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
    backgroundColor: "#6366f1",
    borderRadius: 12,
    paddingVertical: 11,
    marginTop: 10,
  },
  transitDirTxt: {
    fontSize: 13,
    fontWeight: "700",
    fontFamily: "Inter_700Bold",
    color: "#fff",
  },
  // ── In-app transit itinerary ────────────────────────────────────────────────
  transitItin: {
    marginTop: 10,
    borderTopWidth: 1,
    borderTopColor: "#e2e8f0",
    paddingTop: 10,
    gap: 8,
  },
  transitLegRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
  },
  transitLegIcon: {
    width: 30,
    height: 30,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
    marginTop: 1,
  },
  transitLegLabel: {
    fontSize: 13,
    fontWeight: "600",
    fontFamily: "Inter_600SemiBold",
    color: "#1e293b",
  },
  transitLegMeta: {
    fontSize: 11,
    fontFamily: "Inter_400Regular",
    color: "#64748b",
    marginTop: 1,
  },
  transitLegTime: {
    fontSize: 11,
    fontFamily: "Inter_400Regular",
    color: "#94a3b8",
    marginTop: 1,
  },
  transitItinFooter: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 4,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: "#f1f5f9",
  },
  transitItinTotal: {
    fontSize: 13,
    fontWeight: "700",
    fontFamily: "Inter_700Bold",
    color: "#1e293b",
  },
  transitNavBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    backgroundColor: "#6366f1",
    borderRadius: 10,
    paddingVertical: 7,
    paddingHorizontal: 12,
  },
  transitNavBtnTxt: {
    fontSize: 12,
    fontWeight: "700",
    fontFamily: "Inter_700Bold",
    color: "#fff",
  },
  transitRecalcBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 5,
    paddingVertical: 7,
    borderRadius: 10,
    backgroundColor: "#6366f10f",
    marginTop: 2,
  },
  transitRecalcTxt: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    color: "#6366f1",
  },
  transitNoRoute: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 7,
    backgroundColor: "#fef3c71a",
    borderRadius: 10,
    padding: 10,
    marginTop: 8,
    borderWidth: 1,
    borderColor: "#fde68a40",
  },
  transitNoRouteTxt: {
    flex: 1,
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    color: "#92400e",
    lineHeight: 17,
  },
  transitDeptRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 4,
    marginTop: 4,
  },
  transitDeptChip: {
    backgroundColor: "#10b98118",
    borderWidth: 1,
    borderColor: "#10b98130",
    borderRadius: 6,
    paddingHorizontal: 7,
    paddingVertical: 2,
  },
  transitDeptChipTxt: {
    fontSize: 11,
    fontFamily: "Inter_600SemiBold",
    fontWeight: "600",
    color: "#059669",
  },

  // ── Trip Plan button ────────────────────────────────────────────────────────
  tripPlanBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    backgroundColor: "#0D9E7E14",
    borderRadius: 12,
    paddingVertical: 9,
    marginTop: 6,
    borderWidth: 1,
    borderColor: "#0D9E7E30",
  },
  tripPlanBtnTxt: {
    fontSize: 13,
    fontWeight: "600",
    fontFamily: "Inter_600SemiBold",
    color: "#0D9E7E",
  },

  // ── Add Stop button (route active) ──────────────────────────────────────────
  addStopBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    backgroundColor: "#3b82f614",
    borderRadius: 12,
    paddingVertical: 9,
    marginTop: 0,
    borderWidth: 1,
    borderColor: "#3b82f630",
  },
  addStopBtnTxt: {
    fontSize: 13,
    fontWeight: "600",
    fontFamily: "Inter_600SemiBold",
    color: "#3b82f6",
  },

  // ── Trip waypoint pin ───────────────────────────────────────────────────────
  tripWpPin: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: "#3b82f6",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: "#fff",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 4,
  },
  tripWpPinTxt: {
    fontSize: 11,
    fontWeight: "700",
    color: "#fff",
    fontFamily: "Inter_700Bold",
  },

  // ── Recalculating banner ───────────────────────────────────────────────────
  recalcBanner: {
    position: "absolute",
    left: 40,
    right: 40,
    zIndex: 35,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    backgroundColor: "#1C1C1E",
    borderRadius: 100,
    paddingVertical: 11,
    paddingHorizontal: 20,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 10,
    elevation: 10,
  },
  recalcBannerTxt: {
    color: "rgba(255,255,255,0.9)",
    fontSize: 14,
    fontWeight: "600",
    fontFamily: "Inter_600SemiBold",
  },

  // ── Lane guidance arrows ───────────────────────────────────────────────────
  laneBox: {
    width: 44,
    height: 50,
    borderRadius: 10,
    backgroundColor: "#1e293b",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1.5,
    borderColor: "#334155",
    paddingVertical: 4,
  },
  laneBoxValid: {
    backgroundColor: "#0D9E7E18",
    borderColor: "#0D9E7E",
  },
  laneArrow: {
    fontSize: 22,
    color: "#475569",
  },
  laneArrowValid: {
    color: "#0D9E7E",
  },

  // ── Lane guidance in minimized pill ───────────────────────────────────────
  pillMinLaneRow: {
    flexDirection: "row",
    gap: 3,
    marginTop: 5,
  },
  pillMinLaneArrow: {
    fontSize: 20,
    color: "rgba(255,255,255,0.30)",
  },
  pillMinLaneArrowValid: {
    color: "#0D9E7E",
  },

  // ── EV Arrival Card (2–3 min before destination, EV stations only) ────────
  evArrivalCard: {
    position: "absolute",
    left: 12,
    right: 12,
    zIndex: 41,
    backgroundColor: "#0a1f1b",
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingTop: 12,
    paddingBottom: 14,
    borderWidth: 1.5,
    borderColor: "#0D9E7E",
    shadowColor: "#0D9E7E",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.40,
    shadowRadius: 12,
    elevation: 10,
    gap: 10,
  },
  evArrivalHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  evArrivalIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "#0D9E7E22",
    borderWidth: 1.5,
    borderColor: "#0D9E7E",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  evArrivalHeadline: {
    fontSize: 9,
    fontWeight: "700",
    color: "#5eead4",
    fontFamily: "Inter_700Bold",
    letterSpacing: 1.0,
    textTransform: "uppercase",
    marginBottom: 1,
  },
  evArrivalStation: {
    fontSize: 14,
    fontWeight: "700",
    color: "#e2e8f0",
    fontFamily: "Inter_700Bold",
    lineHeight: 17,
  },
  evArrivalGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
  },
  evArrivalChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: "#1e3a32",
    borderRadius: 20,
    paddingHorizontal: 9,
    paddingVertical: 5,
  },
  evArrivalChipAvail: {
    backgroundColor: "#14532d22",
  },
  evArrivalChipBusy: {
    backgroundColor: "#7c2d1222",
  },
  evArrivalChipTxt: {
    fontSize: 11,
    fontWeight: "600",
    color: "#94a3b8",
    fontFamily: "Inter_600SemiBold",
  },
  evArrivalBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
    backgroundColor: "#0D9E7E",
    borderRadius: 12,
    paddingVertical: 11,
  },
  evArrivalBtnTxt: {
    fontSize: 13,
    fontWeight: "700",
    color: "#fff",
    fontFamily: "Inter_700Bold",
  },

  // ── Destination near card ─────────────────────────────────────────────────
  destNearCard: {
    position: "absolute",
    left: 12,
    right: 12,
    zIndex: 40,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: "#0f2d26",
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderWidth: 1.5,
    borderColor: "#0D9E7E",
    shadowColor: "#0D9E7E",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.35,
    shadowRadius: 8,
    elevation: 6,
  },
  destNearIconWrap: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: "#0D9E7E22",
    borderWidth: 1.5,
    borderColor: "#0D9E7E",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  destNearLabel: {
    fontSize: 9,
    fontWeight: "700",
    color: "#5eead4",
    fontFamily: "Inter_700Bold",
    letterSpacing: 1.2,
    textTransform: "uppercase",
    marginBottom: 2,
  },
  destNearName: {
    fontSize: 15,
    fontWeight: "700",
    color: "#e2e8f0",
    fontFamily: "Inter_700Bold",
    lineHeight: 19,
  },

  // ── Upcoming turns lookahead (ETA panel) ──────────────────────────────────
  nextTurnPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "#2C2C2E",
    borderRadius: 10,
    paddingHorizontal: 7,
    paddingVertical: 6,
  },
  nextTurnIconCircle: {
    width: 19,
    height: 19,
    borderRadius: 10,
    backgroundColor: "#0D9E7E",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  nextTurnLabel: {
    fontSize: 6,
    fontWeight: "600",
    color: "rgba(255,255,255,0.4)",
    fontFamily: "Inter_600SemiBold",
    letterSpacing: 0.8,
    marginBottom: 1,
    textTransform: "uppercase",
  },
  nextTurnInstruction: {
    fontSize: 8,
    fontWeight: "700",
    color: "#fff",
    fontFamily: "Inter_700Bold",
    lineHeight: 10,
  },
  nextTurnStreet: {
    fontSize: 7,
    color: "#5eead4",
    fontFamily: "Inter_600SemiBold",
    marginTop: 1,
  },
  nextTurnDist: {
    fontSize: 7,
    fontWeight: "700",
    color: "rgba(255,255,255,0.5)",
    fontFamily: "Inter_700Bold",
    textAlign: "right",
    flexShrink: 0,
  },
  upcomingStrip: {
    marginBottom: 2,
  },
  upcomingChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    backgroundColor: "#3A3A3C",
    borderRadius: 100,
    paddingHorizontal: 10,
    paddingVertical: 5,
    maxWidth: 200,
  },
  upcomingTxt: {
    color: "rgba(255,255,255,0.65)",
    fontSize: 11,
    fontFamily: "Inter_400Regular",
    flexShrink: 1,
  },

  // ── ETA strip extras ──────────────────────────────────────────────────────
  etaRoadName: {
    color: "rgba(255,255,255,0.55)",
    fontSize: 7,
    fontFamily: "Inter_400Regular",
    marginBottom: 1,
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },
  etaSpeedBadge: {
    width: 28,
    height: 28,
    borderRadius: 7,
    backgroundColor: "#fff",
    alignItems: "center",
    justifyContent: "center",
    marginLeft: 4,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.15,
    shadowRadius: 4,
    elevation: 3,
  },

  // ── Speed badge in right-side controls column ─────────────────────────────
  ctrlSpeedBadge: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: "#0f172a",
    borderWidth: 2,
    borderColor: "#0D9E7E",
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.35,
    shadowRadius: 4,
    elevation: 5,
  },
  ctrlSpeedVal: {
    color: "#f1f5f9",
    fontSize: 15,
    fontWeight: "700",
    fontFamily: "Inter_700Bold",
    lineHeight: 16,
  },
  ctrlSpeedUnit: {
    color: "#0D9E7E",
    fontSize: 8,
    fontFamily: "Inter_600SemiBold",
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 0.3,
  },

  // ── Faster route banner ───────────────────────────────────────────────────
  fasterRouteBanner: {
    position: "absolute",
    left: 12,
    right: 12,
    zIndex: 34,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: "#1C1C1E",
    borderWidth: 1,
    borderColor: "rgba(52,199,89,0.35)",
    borderRadius: 18,
    paddingVertical: 11,
    paddingHorizontal: 16,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 10,
    elevation: 8,
  },
  fasterRouteTxt: {
    flex: 1,
    color: "#34C759",
    fontSize: 13,
    fontFamily: "Inter_600SemiBold",
    fontWeight: "600",
  },
  fasterRouteAcceptBtn: {
    backgroundColor: "#34C759",
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 7,
  },

  // ── Recalc alternative routes strip ──────────────────────────────────────
  recalcAltContainer: {
    position: "absolute",
    left: 12,
    right: 12,
    zIndex: 33,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "#1e293b",
    borderRadius: 14,
    paddingVertical: 10,
    paddingHorizontal: 12,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.2,
    shadowRadius: 5,
    elevation: 5,
  },
  recalcAltLabel: {
    color: "#94a3b8",
    fontSize: 11,
    fontFamily: "Inter_600SemiBold",
    fontWeight: "600",
    flexShrink: 0,
  },
  recalcAltChip: {
    backgroundColor: "#0f172a",
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#334155",
    paddingHorizontal: 12,
    paddingVertical: 7,
    alignItems: "center",
    minWidth: 80,
  },
  recalcAltChipLabel: {
    color: "#94a3b8",
    fontSize: 10,
    fontFamily: "Inter_600SemiBold",
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 0.4,
    marginBottom: 2,
  },
  recalcAltChipTime: {
    color: "#f1f5f9",
    fontSize: 14,
    fontFamily: "Inter_700Bold",
    fontWeight: "700",
  },
  recalcAltChipDist: {
    color: "#64748b",
    fontSize: 11,
    fontFamily: "Inter_400Regular",
    marginTop: 1,
  },

  // ── Min-arrival SoC picker (Best for Me filter area) ──────────────────────
  socPickerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 16,
    paddingBottom: 8,
    flexWrap: "wrap",
  },
  socPickerLabel: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    color: "#64748b",
    marginRight: 2,
  },
  socChip: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 100,
    borderWidth: 1,
    borderColor: "#1bc99a60",
    backgroundColor: "transparent",
  },
  socChipActive: {
    backgroundColor: "#1bc99a",
    borderColor: "#1bc99a",
  },
  socChipText: {
    fontSize: 12,
    fontFamily: "Inter_600SemiBold",
    color: "#1bc99a",
  },
  socChipTextActive: {
    color: "#fff",
  },
});

// ── Trip Plan Modal styles ──────────────────────────────────────────────────────
const TP = StyleSheet.create({
  root: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "flex-start",
    paddingHorizontal: 20,
    paddingBottom: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 12,
  },
  title: { fontSize: 20, fontWeight: "700", fontFamily: "Inter_700Bold" },
  sub: { fontSize: 13, fontFamily: "Inter_400Regular", marginTop: 2 },
  closeBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 2,
  },
  scroll: { padding: 16, gap: 0 },
  waypointRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderRadius: 12,
    borderWidth: 1,
    paddingRight: 12,
    paddingVertical: 12,
    marginBottom: 0,
    overflow: "hidden",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 3 },
    shadowRadius: 8,
    elevation: 6,
  },
  dragHandle: {
    paddingHorizontal: 12,
    paddingVertical: 4,
    alignItems: "center",
    justifyContent: "center",
    borderRightWidth: StyleSheet.hairlineWidth,
    alignSelf: "stretch",
  },
  waypointDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    flexShrink: 0,
  },
  waypointLabel: {
    flex: 1,
    fontSize: 14,
    fontFamily: "Inter_400Regular",
  },
  waypointActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginLeft: 4,
  },
  reorderBtn: {
    padding: 2,
  },
  moveModeActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginLeft: 4,
  },
  moveArrowBtn: {
    width: 32,
    height: 32,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  connector: {
    width: 2,
    height: 16,
    marginLeft: 18,
    marginVertical: 2,
  },
  addStopBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
    borderRadius: 12,
    borderWidth: 1,
    borderStyle: "dashed",
    paddingVertical: 11,
    marginTop: 0,
  },
  addStopTxt: {
    fontSize: 14,
    fontWeight: "600",
    fontFamily: "Inter_600SemiBold",
  },
  searchWrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  searchInput: {
    flex: 1,
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    paddingVertical: 2,
  },
  searchResults: {
    borderRadius: 12,
    borderWidth: 1,
    marginTop: 6,
    overflow: "hidden",
  },
  resultRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  resultPrimary: {
    fontSize: 14,
    fontWeight: "500",
    fontFamily: "Inter_500Medium",
  },
  resultSecondary: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    marginTop: 2,
  },
  errorRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 10,
    paddingHorizontal: 4,
    marginTop: 8,
  },
  errorTxt: {
    fontSize: 13,
    color: "#ef4444",
    fontFamily: "Inter_400Regular",
    flex: 1,
  },
  legsCard: {
    borderRadius: 14,
    borderWidth: 1,
    marginTop: 16,
    overflow: "hidden",
  },
  legsTitle: {
    fontSize: 13,
    fontWeight: "700",
    fontFamily: "Inter_700Bold",
    paddingHorizontal: 14,
    paddingTop: 12,
    paddingBottom: 8,
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },
  legRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  legNum: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  legNumTxt: {
    fontSize: 12,
    fontWeight: "700",
    fontFamily: "Inter_700Bold",
  },
  legTo: {
    fontSize: 14,
    fontWeight: "500",
    fontFamily: "Inter_500Medium",
  },
  legMeta: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    marginTop: 2,
  },
  totalRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 11,
  },
  totalTxt: {
    fontSize: 14,
    fontWeight: "700",
    fontFamily: "Inter_700Bold",
  },
  calcBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    borderRadius: 14,
    paddingVertical: 14,
    marginTop: 16,
  },
  calcBtnTxt: {
    fontSize: 15,
    fontWeight: "700",
    fontFamily: "Inter_700Bold",
  },
  actionsRow: {
    flexDirection: "row",
    gap: 10,
    marginTop: 10,
  },
  actionBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
    borderRadius: 12,
    paddingVertical: 13,
  },
  actionBtnTxt: {
    fontSize: 14,
    fontWeight: "700",
    fontFamily: "Inter_700Bold",
    color: "#fff",
  },
});

function MapErrorFallback({ resetError }: { error: Error; resetError: () => void }) {
  return (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 36, backgroundColor: "#F8F7F4" }}>
      <View style={{ width: 72, height: 72, borderRadius: 36, backgroundColor: "#0D9E7E18", alignItems: "center", justifyContent: "center", marginBottom: 20 }}>
        <Feather name="alert-triangle" size={32} color="#0D9E7E" />
      </View>
      <Text style={{ fontSize: 20, fontWeight: "700", color: "#1A2530", marginBottom: 8 }}>Map unavailable</Text>
      <Text style={{ fontSize: 15, color: "#6B6B6B", textAlign: "center", lineHeight: 22 }}>
        Something went wrong loading the map.{"\n"}Your other tabs are still working.
      </Text>
      <TouchableOpacity
        onPress={resetError}
        style={{ marginTop: 28, backgroundColor: "#0D9E7E", borderRadius: 12, paddingHorizontal: 28, paddingVertical: 13 }}
        activeOpacity={0.85}
      >
        <Text style={{ color: "#fff", fontSize: 16, fontWeight: "700" }}>Try Again</Text>
      </TouchableOpacity>
    </View>
  );
}

export default function MapTab() {
  return (
    <ErrorBoundary FallbackComponent={MapErrorFallback}>
      <MapScreen />
    </ErrorBoundary>
  );
}
