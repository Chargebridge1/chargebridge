import React, { useState, useRef, useCallback, useEffect } from "react";
import {
  View, Text, TextInput, TouchableOpacity, ScrollView, StyleSheet,
  ActivityIndicator, Platform, Alert, Modal, Linking,
} from "react-native";
import { router } from "expo-router";
import { Feather, Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Haptics from "expo-haptics";
import * as Print from "expo-print";
import * as Sharing from "expo-sharing";
import * as Location from "expo-location";
import { useColors } from "@/hooks/useColors";
import { VehiclePickerModal } from "@/components/VehiclePickerModal";
import type { Vehicle } from "@/components/VehiclePickerModal";
import { useVehicleCatalog, catalogToVehicle } from "@/hooks/useVehicleCatalog";

const BASE = `https://${process.env.EXPO_PUBLIC_DOMAIN}`;
const MAX_WAYPOINTS = 5;
const KM_TO_MI = 0.621371;
const MI_TO_KM = 1.60934;

// EPA-rated range in miles (best Long Range trim) for known electric vehicles
const EV_RANGE_MI: Record<string, number> = {
  "tesla-model-3": 358, "tesla-model-y": 330, "tesla-model-s": 405,
  "tesla-model-x": 348, "tesla-cybertruck": 340,
  "rivian-r1t-nacs": 410, "rivian-r1s-nacs": 410,
  "ford-mach-e-nacs": 312, "ford-mach-e-ccs": 312,
  "ford-f150-lightning-nacs": 320, "ford-f150-lightning-ccs": 320,
  "chevy-equinox-ev": 319, "chevy-silverado-ev": 450, "chevy-bolt-ev": 259,
  "vw-id4": 291, "hyundai-ioniq5": 303, "hyundai-ioniq6": 361,
  "kia-ev6": 310, "kia-ev9": 304,
  "bmw-i4": 301, "bmw-ix": 324, "bmw-i5": 295,
  "mercedes-eqs": 350, "mercedes-eqe": 305,
  "audi-etron-gt": 238, "audi-q4-etron": 241, "porsche-taycan": 246,
  "volvo-xc40-recharge": 223, "polestar-2": 270, "genesis-gv60": 248,
  "lucid-air": 516, "cadillac-lyriq": 314, "gmc-hummer-ev": 329,
  "honda-prologue": 296, "subaru-solterra": 228, "toyota-bz4x": 252,
  "mini-cooper-se": 114, "nissan-leaf": 226, "nissan-ariya": 304,
};

// Usable battery capacity (kWh) for known electric vehicles
const EV_BATTERY_KWH: Record<string, number> = {
  "tesla-model-3": 82, "tesla-model-y": 82, "tesla-model-s": 100,
  "tesla-model-x": 100, "tesla-cybertruck": 123,
  "rivian-r1t-nacs": 149, "rivian-r1s-nacs": 149,
  "ford-mach-e-nacs": 91, "ford-mach-e-ccs": 91,
  "ford-f150-lightning-nacs": 131, "ford-f150-lightning-ccs": 131,
  "chevy-equinox-ev": 85, "chevy-silverado-ev": 200, "chevy-bolt-ev": 65,
  "vw-id4": 82, "hyundai-ioniq5": 77, "hyundai-ioniq6": 77,
  "kia-ev6": 77, "kia-ev9": 100,
  "bmw-i4": 84, "bmw-ix": 112, "bmw-i5": 84,
  "mercedes-eqs": 108, "mercedes-eqe": 91,
  "audi-etron-gt": 93, "audi-q4-etron": 82, "porsche-taycan": 93,
  "volvo-xc40-recharge": 78, "polestar-2": 82, "genesis-gv60": 77,
  "lucid-air": 112, "cadillac-lyriq": 102, "gmc-hummer-ev": 212,
  "honda-prologue": 85, "subaru-solterra": 73, "toyota-bz4x": 73,
  "mini-cooper-se": 33, "nissan-leaf": 40, "nissan-ariya": 87,
};

const CONNECTORS = ["CCS", "NACS", "CHAdeMO", "J1772"] as const;
type ConnectorType = typeof CONNECTORS[number];

// ── Types ─────────────────────────────────────────────────────────────────────
interface GeoResult { place_id: string; display_name: string; lat: string; lon: string; }
interface TripStop { id: number; name: string; address: string; lat: number; lng: number; connectors: string[]; level2Ports: number; dcFastPorts: number; distanceFromOriginKm: number; }
interface TripStep { type: string; modifier?: string; name: string; distanceM: number; durationSec: number; }
interface TripLeg { distanceKm: number; durationSec: number; steps: TripStep[]; }
interface TripPlan { route: { distanceKm: number; durationSec: number }; stops: TripStop[]; legs?: TripLeg[]; rangeKm: number; }
interface SavedTrip { id: number; name: string; originLabel: string; destLabel: string; rangeKm: number; createdAt: string; }

interface SelectedVehicle {
  name: string;
  make: string;
  model: string;
  rangeKm: number;
  batteryKwh?: number;
  connectorType?: string;
  fuelCategory?: string;
}

interface GarageVehicle {
  id: number;
  nickname: string | null;
  make: string | null;
  model: string | null;
  year: string | null;
  connectorType: string | null;
  batteryKwh: number | null;
  rangePerCharge: number | null;
  fuelType: string | null;
  isPrimary: boolean;
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function formatDuration(sec: number) {
  const h = Math.floor(sec / 3600);
  const m = Math.round((sec % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function formatDist(m: number): string {
  return m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${m} m`;
}

function fmtRange(km: number, miles: boolean): string {
  return miles ? `${Math.round(km * KM_TO_MI)} mi` : `${Math.round(km)} km`;
}

function fmtDistKm(km: number, miles: boolean): string {
  return miles ? `${(km * KM_TO_MI).toFixed(1)} mi` : `${km} km`;
}

function maneuverIcon(type: string, modifier?: string): string {
  if (type === "depart") return "&#9658;";
  if (type === "arrive") return "&#9733;";
  if (type === "roundabout" || type === "rotary") return "&#8635;";
  if (modifier === "slight left") return "&#8598;";
  if (modifier === "slight right") return "&#8599;";
  if (modifier === "left" || modifier === "sharp left") return "&#8592;";
  if (modifier === "right" || modifier === "sharp right") return "&#8594;";
  if (type === "fork" && modifier?.includes("left")) return "&#8598;";
  if (type === "fork" && modifier?.includes("right")) return "&#8599;";
  return "&#8593;";
}

function buildInstruction(type: string, modifier: string | undefined, name: string): string {
  const road = name ? ` on ${name}` : "";
  switch (type) {
    case "depart": return `Depart${road}`;
    case "arrive": return "Arrive at destination";
    case "turn":
      if (modifier === "left") return `Turn left${road}`;
      if (modifier === "right") return `Turn right${road}`;
      if (modifier === "slight left") return `Bear left${road}`;
      if (modifier === "slight right") return `Bear right${road}`;
      if (modifier === "sharp left") return `Sharp left${road}`;
      if (modifier === "sharp right") return `Sharp right${road}`;
      return `Continue straight${road}`;
    case "continue": return `Continue straight${road}`;
    case "merge": return `Merge${road}`;
    case "ramp": case "on ramp": return `Take the ramp${road}`;
    case "off ramp": return `Take the exit${road}`;
    case "fork":
      if (modifier?.includes("left")) return `Keep left${road}`;
      if (modifier?.includes("right")) return `Keep right${road}`;
      return `Take the fork${road}`;
    case "roundabout": case "rotary": return `Enter the roundabout${road}`;
    case "end of road":
      if (modifier?.includes("left")) return `Turn left at end of road${road}`;
      if (modifier?.includes("right")) return `Turn right at end of road${road}`;
      return `End of road${road}`;
    default: return name ? `Continue on ${name}` : "Continue";
  }
}

function buildPdfHtml(params: {
  tripName: string;
  origin: GeoResult;
  dest: GeoResult;
  filledWaypoints: GeoResult[];
  plan: TripPlan;
}): string {
  const { tripName, origin, dest, filledWaypoints, plan } = params;
  const date = new Date().toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" });

  const legLabels: string[] = [];
  const allPoints = [origin, ...filledWaypoints, dest];
  for (let i = 0; i < allPoints.length - 1; i++) {
    legLabels.push(`${allPoints[i].display_name.split(",")[0]} → ${allPoints[i + 1].display_name.split(",")[0]}`);
  }

  const stepsHtml = (plan.legs ?? []).map((leg, li) => {
    const label = legLabels[li] ?? `Leg ${li + 1}`;
    const rows = leg.steps.map(s => {
      const instr = buildInstruction(s.type, s.modifier, s.name);
      const icon = maneuverIcon(s.type, s.modifier);
      const isArrive = s.type === "arrive";
      const isDepart = s.type === "depart";
      const rowBg = isArrive ? "#f0fdf4" : isDepart ? "#eff6ff" : "";
      return `
        <tr style="${rowBg ? `background:${rowBg};` : ""}">
          <td class="step-icon" style="color:${isArrive ? "#22c55e" : isDepart ? "#3b82f6" : "#0D9E7E"}">${icon}</td>
          <td class="step-text">
            <div class="step-instr">${instr}</div>
            ${s.name && s.name !== instr ? `<div class="step-road">${s.name}</div>` : ""}
          </td>
          <td class="step-dist">${s.distanceM > 0 ? formatDist(s.distanceM) : ""}</td>
        </tr>`;
    }).join("");

    return `
      <div class="leg-header">
        <div class="leg-dot" style="background:#0D9E7E"></div>
        <div class="leg-title">${label}</div>
        <div class="leg-dist">${leg.distanceKm} km &middot; ${formatDuration(leg.durationSec)}</div>
      </div>
      <table class="steps-table"><tbody>${rows}</tbody></table>`;
  }).join("");

  const stopsHtml = plan.stops.length === 0
    ? `<div style="padding:16px 20px;color:#22c55e;font-weight:600;">&#10003; No charging stops needed &mdash; all legs within range</div>`
    : plan.stops.map((stop, i) => {
        const tags = [
          stop.dcFastPorts > 0 ? `&#9889; DC Fast &times;${stop.dcFastPorts}` : "",
          stop.level2Ports > 0 ? `L2 &times;${stop.level2Ports}` : "",
          ...(stop.connectors ?? []).slice(0, 2),
        ].filter(Boolean).map(t => `<span class="tag">${t}</span>`).join("");
        return `
          <div class="stop-card">
            <div class="stop-card-header">
              <div class="stop-num">${i + 1}</div>
              <div class="stop-name">${stop.name}</div>
              <div style="margin-left:auto;font-size:11px;color:#6b7280;">${stop.distanceFromOriginKm} km from start</div>
            </div>
            <div class="stop-body">
              ${stop.address ? `<div class="stop-addr">${stop.address}</div>` : ""}
              ${tags ? `<div class="stop-tags">${tags}</div>` : ""}
            </div>
          </div>`;
      }).join("");

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8"/>
<style>
*{margin:0;padding:0;box-sizing:border-box;}
body{font-family:-apple-system,Helvetica,Arial,sans-serif;font-size:13px;color:#111;background:#fff;}
.header{background:linear-gradient(135deg,#0D9E7E,#085f4d);color:white;padding:22px 24px 18px;}
.header-brand{font-size:11px;font-weight:700;letter-spacing:1px;text-transform:uppercase;opacity:.8;margin-bottom:4px;}
.header-title{font-size:20px;font-weight:700;line-height:1.3;}
.header-route{font-size:12px;opacity:.85;margin-top:5px;}
.header-meta{font-size:10px;opacity:.65;margin-top:8px;}
.summary{display:flex;border:1.5px solid #e5e7eb;border-radius:10px;margin:16px 20px;overflow:hidden;}
.summary-item{flex:1;padding:12px;text-align:center;border-right:1px solid #e5e7eb;}
.summary-item:last-child{border-right:none;}
.summary-val{font-size:22px;font-weight:700;color:#0D9E7E;}
.summary-lbl{font-size:9px;text-transform:uppercase;letter-spacing:.6px;color:#6b7280;margin-top:2px;}
.section-title{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.7px;color:#6b7280;padding:14px 20px 6px;border-top:1px solid #f3f4f6;}
.leg-header{background:#f9fafb;padding:9px 20px;border-top:2px solid #0D9E7E;display:flex;align-items:center;gap:10px;}
.leg-dot{width:10px;height:10px;border-radius:5px;flex-shrink:0;}
.leg-title{font-size:13px;font-weight:700;color:#111;}
.leg-dist{margin-left:auto;font-size:11px;color:#6b7280;white-space:nowrap;}
.steps-table{width:100%;border-collapse:collapse;}
.steps-table tbody tr{border-bottom:1px solid #f3f4f6;}
.steps-table tbody tr:nth-child(even){background:#fafafa;}
.step-icon{width:36px;padding:9px 0 9px 16px;font-size:15px;vertical-align:top;}
.step-text{padding:9px 8px 9px 4px;}
.step-instr{font-size:13px;color:#111;}
.step-road{font-size:10px;color:#6b7280;margin-top:2px;}
.step-dist{width:72px;padding:9px 16px 9px 0;text-align:right;font-size:11px;color:#6b7280;vertical-align:top;white-space:nowrap;}
.stop-card{margin:8px 20px;border:1.5px solid #fde68a;border-radius:10px;overflow:hidden;}
.stop-card-header{background:#fffbeb;padding:10px 14px;display:flex;align-items:center;gap:10px;border-bottom:1px solid #fde68a;}
.stop-num{width:24px;height:24px;border-radius:12px;background:#f59e0b;color:white;font-size:12px;font-weight:700;text-align:center;line-height:24px;flex-shrink:0;}
.stop-name{font-size:14px;font-weight:600;color:#111;}
.stop-body{padding:8px 14px 10px;}
.stop-addr{font-size:12px;color:#6b7280;}
.stop-tags{display:flex;gap:6px;flex-wrap:wrap;margin-top:6px;}
.tag{background:#dcfce7;color:#166534;border-radius:6px;padding:2px 8px;font-size:10px;font-weight:600;}
.no-stops{padding:16px 20px;color:#22c55e;font-weight:600;}
.footer{margin-top:28px;padding:12px 20px;border-top:1px solid #f3f4f6;text-align:center;font-size:10px;color:#9ca3af;}
</style>
</head>
<body>
<div class="header">
  <div class="header-brand">ChargeBridge</div>
  <div class="header-title">${tripName || "EV Trip"}</div>
  <div class="header-route">${origin.display_name.split(",").slice(0,2).join(",")} &rarr; ${dest.display_name.split(",").slice(0,2).join(",")}</div>
  <div class="header-meta">Generated ${date}</div>
</div>

<div class="summary">
  <div class="summary-item"><div class="summary-val">${plan.route.distanceKm} km</div><div class="summary-lbl">Total distance</div></div>
  <div class="summary-item"><div class="summary-val">${formatDuration(plan.route.durationSec)}</div><div class="summary-lbl">Drive time</div></div>
  <div class="summary-item"><div class="summary-val">${plan.stops.length}</div><div class="summary-lbl">Charge stops</div></div>
  <div class="summary-item"><div class="summary-val">${plan.rangeKm} km</div><div class="summary-lbl">Vehicle range</div></div>
</div>

${plan.legs && plan.legs.length > 0 ? `
<div class="section-title">Turn-by-Turn Directions</div>
${stepsHtml}
` : ""}

<div class="section-title">Charging Stops</div>
${plan.stops.length === 0
  ? `<div class="no-stops">&#10003; No charging stops needed &mdash; all legs are within your vehicle range</div>`
  : stopsHtml}

<div class="footer">Generated by ChargeBridge &middot; EV Trip Planner &middot; ${date}</div>
</body>
</html>`;
}

// ── AddressField ──────────────────────────────────────────────────────────────
function AddressField({
  label,
  placeholder,
  value,
  onSelect,
  onClear,
  onTextChange,
  dotColor = "#0D9E7E",
  gpsLoading,
  gpsFilled,
  onGpsTap,
}: {
  label: string;
  placeholder: string;
  value: string;
  onSelect: (r: GeoResult) => void;
  onClear?: () => void;
  onTextChange?: () => void;
  dotColor?: string;
  gpsLoading?: boolean;
  gpsFilled?: boolean;
  onGpsTap?: () => void;
}) {
  const colors = useColors();
  const [q, setQ] = useState(value);
  const [results, setResults] = useState<GeoResult[]>([]);
  const [searching, setSearching] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => { setQ(value); }, [value]);

  const search = useCallback((text: string) => {
    setQ(text);
    onTextChange?.();
    clearTimeout(timer.current);
    if (!text.trim()) { setResults([]); return; }
    timer.current = setTimeout(async () => {
      setSearching(true);
      try {
        const r = await fetch(`${BASE}/api/geocode?q=${encodeURIComponent(text)}`);
        setResults(await r.json());
      } catch { setResults([]); }
      finally { setSearching(false); }
    }, 400);
  }, [onTextChange]);

  function handleClear() {
    setQ("");
    setResults([]);
    onClear?.();
  }

  return (
    <View style={{ marginBottom: 0 }}>
      <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 6 }}>
        <Text style={[TP.fieldLabel, { color: colors.mutedForeground }]}>{label}</Text>
        {gpsLoading && (
          <ActivityIndicator size="small" color={colors.primary} style={{ marginLeft: 6 }} />
        )}
        {!gpsLoading && gpsFilled && (
          <View style={{ flexDirection: "row", alignItems: "center", marginLeft: 6, gap: 2 }}>
            <Ionicons name="locate" size={10} color={colors.primary} />
            <Text style={{ fontSize: 10, color: colors.primary, fontFamily: "Inter_600SemiBold", letterSpacing: 0.4 }}>GPS</Text>
          </View>
        )}
        {!gpsLoading && !gpsFilled && onGpsTap && (
          <TouchableOpacity
            onPress={onGpsTap}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            style={{ marginLeft: 8 }}
          >
            <Ionicons name="locate-outline" size={15} color={colors.mutedForeground} />
          </TouchableOpacity>
        )}
      </View>
      <View style={{ position: "relative" }}>
        <View style={[TP.inputRow, { backgroundColor: colors.muted + "55", borderColor: colors.border }]}>
          <View style={[TP.dot, { backgroundColor: dotColor }]} />
          <TextInput
            style={[TP.input, { color: colors.foreground, flex: 1 }]}
            value={q}
            onChangeText={search}
            placeholder={gpsLoading ? "Getting your location…" : placeholder}
            placeholderTextColor={colors.mutedForeground + "99"}
            returnKeyType="search"
          />
          {searching && (
            <ActivityIndicator size="small" color={colors.primary} style={{ marginRight: 10 }} />
          )}
          {q.length > 0 && !searching && (
            <TouchableOpacity onPress={handleClear} style={{ padding: 6, marginRight: 4 }}>
              <Ionicons name="close-circle" size={16} color={colors.mutedForeground} />
            </TouchableOpacity>
          )}
        </View>
      </View>
      {results.length > 0 && (
        <View style={[TP.dropdown, { backgroundColor: colors.card, borderColor: colors.border }]}>
          {results.slice(0, 5).map(r => (
            <TouchableOpacity
              key={r.place_id}
              style={[TP.dropdownItem, { borderBottomColor: colors.border }]}
              onPress={() => {
                Haptics.selectionAsync();
                setQ(r.display_name.split(",")[0]);
                setResults([]);
                onSelect(r);
              }}
            >
              <Feather name="map-pin" size={12} color={colors.primary} style={{ marginRight: 8, marginTop: 1 }} />
              <Text style={[TP.dropdownTxt, { color: colors.foreground }]} numberOfLines={2}>{r.display_name}</Text>
            </TouchableOpacity>
          ))}
        </View>
      )}
    </View>
  );
}

// ── Main screen ───────────────────────────────────────────────────────────────
export default function TripPlannerScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const isWeb = Platform.OS === "web";
  const topPad = isWeb ? 67 : insets.top;

  // Route
  const [origin, setOrigin] = useState<GeoResult | null>(null);
  const [dest, setDest] = useState<GeoResult | null>(null);
  const [waypoints, setWaypoints] = useState<(GeoResult | null)[]>([]);
  const [gpsLoading, setGpsLoading] = useState(false);
  const [usingGpsOrigin, setUsingGpsOrigin] = useState(false);

  // Vehicle
  const [vehicleTab, setVehicleTab] = useState<"garage" | "search" | "manual">("garage");
  const [selectedVehicle, setSelectedVehicle] = useState<SelectedVehicle | null>(null);
  const [rangeKm, setRangeKm] = useState(400);
  const [usesMiles, setUsesMiles] = useState(() => {
    try { return Intl.DateTimeFormat().resolvedOptions().locale.toUpperCase().includes("US"); }
    catch { return false; }
  });
  const [vehiclePickerOpen, setVehiclePickerOpen] = useState(false);
  const [garageVehicles, setGarageVehicles] = useState<GarageVehicle[]>([]);
  const [garageLoading, setGarageLoading] = useState(false);

  // Manual entry
  const [manualMake, setManualMake] = useState("");
  const [manualModel, setManualModel] = useState("");
  const [manualRangeStr, setManualRangeStr] = useState("");
  const [manualBatteryStr, setManualBatteryStr] = useState("");
  const [manualConnector, setManualConnector] = useState<ConnectorType | null>(null);
  const [manualSuggestion, setManualSuggestion] = useState<Vehicle | null>(null);

  // Trip plan
  const [plan, setPlan] = useState<TripPlan | null>(null);
  const [loading, setLoading] = useState(false);
  const [tripError, setTripError] = useState<string | null>(null);

  // Saved trips
  const [savedTrips, setSavedTrips] = useState<SavedTrip[]>([]);
  const [tripName, setTripName] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveDone, setSaveDone] = useState(false);
  const [showSavedModal, setShowSavedModal] = useState(false);
  const [exportingPdf, setExportingPdf] = useState(false);

  const filledWaypoints = waypoints.filter(Boolean) as GeoResult[];
  const vehicleCatalog = useVehicleCatalog();

  useEffect(() => {
    if (Platform.OS !== "web") initGps();
    loadGarageVehicles();
    loadSavedTrips();
  }, []);

  // Auto-lookup vehicle specs as user types make + model in manual tab
  useEffect(() => {
    if (!manualMake.trim() || !manualModel.trim()) { setManualSuggestion(null); return; }
    const mk = manualMake.toLowerCase().trim();
    const mo = manualModel.toLowerCase().trim();
    const vehicles = vehicleCatalog.entries.map(catalogToVehicle);
    const found =
      vehicles.find(v => v.make.toLowerCase() === mk && v.model.toLowerCase() === mo) ??
      vehicles.find(v => v.make.toLowerCase() === mk && v.model.toLowerCase().includes(mo)) ??
      vehicles.find(v => v.name.toLowerCase().includes(mk) && v.name.toLowerCase().includes(mo));
    setManualSuggestion(found ?? null);
  }, [manualMake, manualModel, vehicleCatalog.entries]);

  async function initGps() {
    setGpsLoading(true);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== "granted") return;
      // Race against a 10-second timeout so the spinner never hangs indefinitely
      const loc = await Promise.race([
        Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error("GPS timeout")), 10000)),
      ]);
      const { latitude, longitude } = loc.coords;
      // Use device-native reverse geocoding — no server call required
      const [geo] = await Location.reverseGeocodeAsync({ latitude, longitude });
      const street = geo
        ? [
            geo.streetNumber && geo.street ? `${geo.streetNumber} ${geo.street}` : geo.street ?? null,
            geo.city ?? geo.district ?? geo.subregion ?? null,
            geo.region ?? null,
          ]
            .filter(Boolean)
            .join(", ")
        : null;
      const displayName = street || `${latitude.toFixed(4)}, ${longitude.toFixed(4)}`;
      setOrigin({
        place_id: "gps",
        display_name: displayName,
        lat: String(latitude),
        lon: String(longitude),
      });
      setUsingGpsOrigin(true);
    } catch { /* silent — user can type manually or tap the locate button */ }
    finally { setGpsLoading(false); }
  }

  async function handleGpsTap() {
    const { status: current } = await Location.getForegroundPermissionsAsync();
    if (current === "denied") {
      Alert.alert(
        "Location Access Required",
        "ChargeBridge needs location access to auto-fill your starting point. Please enable it in Settings.",
        [
          { text: "Cancel", style: "cancel" },
          { text: "Open Settings", onPress: () => Linking.openSettings() },
        ]
      );
      return;
    }
    await initGps();
  }

  async function loadGarageVehicles() {
    setGarageLoading(true);
    try {
      const r = await fetch(`${BASE}/api/me/vehicles`);
      if (r.ok) {
        const vehicles: GarageVehicle[] = await r.json();
        setGarageVehicles(vehicles);
        if (vehicles.length > 0) setVehicleTab("garage");
      }
    } catch {}
    finally { setGarageLoading(false); }
  }

  async function loadSavedTrips() {
    try {
      const r = await fetch(`${BASE}/api/trip/saved`);
      if (r.ok) setSavedTrips(await r.json());
    } catch {}
  }

  // ── Vehicle selection ─────────────────────────────────────────────────────
  function applyVehicle(sv: SelectedVehicle) {
    setSelectedVehicle(sv);
    setRangeKm(sv.rangeKm);
    Haptics.selectionAsync();
  }

  function selectGarageVehicle(gv: GarageVehicle) {
    const rangeMi = gv.rangePerCharge ?? 0;
    const rangeKmVal = rangeMi > 0 ? Math.round(rangeMi * MI_TO_KM) : 400;
    applyVehicle({
      name: gv.nickname ?? [gv.year, gv.make, gv.model].filter(Boolean).join(" "),
      make: gv.make ?? "",
      model: gv.model ?? "",
      rangeKm: rangeKmVal,
      batteryKwh: gv.batteryKwh ?? undefined,
      connectorType: gv.connectorType ?? undefined,
      fuelCategory: gv.fuelType === "electric" ? "electric" : gv.fuelType === "hybrid" ? "phev_hybrid" : gv.fuelType ? "gas_diesel" : undefined,
    });
  }

  function handlePickerSelect(v: Vehicle) {
    const rangeMi = EV_RANGE_MI[v.id];
    const rangeKmVal = rangeMi ? Math.round(rangeMi * MI_TO_KM) : rangeKm;
    applyVehicle({
      name: v.name,
      make: v.make,
      model: v.model,
      rangeKm: rangeKmVal,
      batteryKwh: EV_BATTERY_KWH[v.id],
      connectorType: v.dcConnector ?? v.acConnector ?? undefined,
      fuelCategory: v.fuelCategory,
    });
    setVehiclePickerOpen(false);
  }

  function applySuggestionSpecs() {
    if (!manualSuggestion) return;
    Haptics.selectionAsync();
    const rangeMi = EV_RANGE_MI[manualSuggestion.id] ?? manualSuggestion.rangeMiles ?? null;
    if (rangeMi) {
      const displayVal = usesMiles ? Math.round(rangeMi) : Math.round(rangeMi * MI_TO_KM);
      setManualRangeStr(String(displayVal));
    }
    const battery = EV_BATTERY_KWH[manualSuggestion.id] ?? manualSuggestion.batteryKwh ?? null;
    if (battery) setManualBatteryStr(String(battery));
    const conn = manualSuggestion.dcConnector ?? manualSuggestion.acConnector;
    if (conn && CONNECTORS.includes(conn as ConnectorType)) setManualConnector(conn as ConnectorType);
  }

  function applyManualVehicle() {
    const make = manualMake.trim();
    const model = manualModel.trim();
    if (!make || !model) { Alert.alert("Missing fields", "Enter Make and Model."); return; }
    const rangeVal = parseFloat(manualRangeStr);
    if (!rangeVal || isNaN(rangeVal) || rangeVal <= 0) { Alert.alert("Missing range", "Enter your vehicle's range."); return; }
    const rangeKmVal = usesMiles ? Math.round(rangeVal * MI_TO_KM) : Math.round(rangeVal);
    applyVehicle({
      name: `${make} ${model}`,
      make,
      model,
      rangeKm: rangeKmVal,
      batteryKwh: parseFloat(manualBatteryStr) || undefined,
      connectorType: manualConnector ?? undefined,
    });
  }

  // ── Route management ──────────────────────────────────────────────────────
  function addWaypoint() {
    if (waypoints.length < MAX_WAYPOINTS) {
      Haptics.selectionAsync();
      setWaypoints(prev => [...prev, null]);
    }
  }

  function removeWaypoint(i: number) {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setWaypoints(prev => prev.filter((_, idx) => idx !== i));
  }

  function updateWaypoint(i: number, r: GeoResult) {
    setWaypoints(prev => prev.map((wp, idx) => idx === i ? r : wp));
  }

  function clearWaypoint(i: number) {
    setWaypoints(prev => prev.map((wp, idx) => idx === i ? null : wp));
  }

  // ── Trip management ───────────────────────────────────────────────────────
  async function saveCurrentTrip() {
    if (!origin || !dest || !plan) return;
    setSaving(true);
    try {
      const name = tripName || [
        origin.display_name.split(",")[0],
        ...filledWaypoints.map(w => w.display_name.split(",")[0]),
        dest.display_name.split(",")[0],
      ].join(" → ");
      await fetch(`${BASE}/api/trip/saved`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name, originLabel: origin.display_name.split(",")[0],
          originLat: parseFloat(origin.lat), originLng: parseFloat(origin.lon),
          destLabel: dest.display_name.split(",")[0],
          destLat: parseFloat(dest.lat), destLng: parseFloat(dest.lon),
          rangeKm, stops: plan.stops,
        }),
      });
      setSaveDone(true);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      loadSavedTrips();
      setTimeout(() => setSaveDone(false), 3000);
    } catch {
      Alert.alert("Save failed", "Could not save trip. Please try again.");
    } finally { setSaving(false); }
  }

  async function deleteSavedTrip(id: number) {
    try {
      await fetch(`${BASE}/api/trip/saved/${id}`, { method: "DELETE" });
      setSavedTrips(prev => prev.filter(t => t.id !== id));
    } catch {}
  }

  async function exportPdf() {
    if (!plan || !origin || !dest) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setExportingPdf(true);
    try {
      const html = buildPdfHtml({ tripName, origin, dest, filledWaypoints, plan });
      const { uri } = await Print.printToFileAsync({ html, base64: false });
      const canShare = await Sharing.isAvailableAsync();
      if (canShare) {
        await Sharing.shareAsync(uri, { mimeType: "application/pdf", dialogTitle: tripName || "EV Trip Directions", UTI: "com.adobe.pdf" });
      } else {
        Alert.alert("PDF saved", `Trip directions saved to:\n${uri}`);
      }
    } catch (e: any) {
      Alert.alert("Export failed", e?.message ?? "Could not create PDF. Please try again.");
    } finally { setExportingPdf(false); }
  }

  async function planTrip() {
    if (!origin || !dest) { setTripError("Enter both a starting point and destination."); return; }
    setTripError(null);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setLoading(true);
    try {
      const params = new URLSearchParams({
        olat: origin.lat, olng: origin.lon, dlat: dest.lat, dlng: dest.lon, rangeKm: String(rangeKm),
      });
      if (filledWaypoints.length > 0) {
        params.set("waypoints", JSON.stringify(filledWaypoints.map(w => ({ lat: parseFloat(w.lat), lng: parseFloat(w.lon) }))));
      }
      if (selectedVehicle?.connectorType) params.set("connectorType", selectedVehicle.connectorType);
      const r = await fetch(`${BASE}/api/trip/plan?${params}`);
      if (!r.ok) throw new Error("Planning failed");
      const data = await r.json();
      setPlan(data);
      const labels = [origin, ...filledWaypoints, dest].map(p => p.display_name.split(",")[0]);
      setTripName(labels.join(" → "));
    } catch (e: any) {
      setTripError(e.message || "Could not plan route. Try again.");
    } finally { setLoading(false); }
  }

  const DOT_COLORS = ["#8b5cf6", "#6366f1", "#3b82f6", "#0ea5e9", "#06b6d4"];

  // ── Render vehicle card ───────────────────────────────────────────────────
  function renderVehicleCard() {
    return (
      <View style={[TP.card, { backgroundColor: colors.card, borderColor: colors.border, marginTop: 12 }]}>
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
          <Text style={[TP.sectionTitle, { color: colors.foreground }]}>Vehicle</Text>
          <TouchableOpacity
            style={[TP.unitToggle, { borderColor: colors.border, backgroundColor: colors.muted + "55" }]}
            onPress={() => setUsesMiles(m => !m)}
          >
            <Text style={[TP.unitToggleTxt, { color: usesMiles ? colors.primary : colors.mutedForeground, fontWeight: usesMiles ? "700" : "400" }]}>mi</Text>
            <Text style={[TP.unitToggleSep, { color: colors.border }]}>|</Text>
            <Text style={[TP.unitToggleTxt, { color: !usesMiles ? colors.primary : colors.mutedForeground, fontWeight: !usesMiles ? "700" : "400" }]}>km</Text>
          </TouchableOpacity>
        </View>

        {/* Tab pills */}
        <View style={[TP.vehTabs, { backgroundColor: colors.muted + "44", borderColor: colors.border }]}>
          {(["garage", "search", "manual"] as const).map(tab => (
            <TouchableOpacity
              key={tab}
              style={[TP.vehTab, vehicleTab === tab && { backgroundColor: colors.primary }]}
              onPress={() => { Haptics.selectionAsync(); setVehicleTab(tab); }}
              activeOpacity={0.8}
            >
              <Text style={[TP.vehTabTxt, { color: vehicleTab === tab ? "#fff" : colors.mutedForeground }]}>
                {tab === "garage" ? "My Garage" : tab === "search" ? "Search" : "Manual"}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Garage tab */}
        {vehicleTab === "garage" && (
          <View style={{ marginTop: 10 }}>
            {garageLoading ? (
              <ActivityIndicator size="small" color={colors.primary} style={{ marginVertical: 12 }} />
            ) : garageVehicles.length === 0 ? (
              <View style={{ alignItems: "center", paddingVertical: 16, gap: 6 }}>
                <Ionicons name="car-outline" size={28} color={colors.mutedForeground} />
                <Text style={{ fontSize: 13, color: colors.mutedForeground, textAlign: "center", fontFamily: "Inter_400Regular" }}>
                  No saved vehicles.{"\n"}Add one in Profile → My Garage.
                </Text>
              </View>
            ) : (
              garageVehicles.map(gv => {
                const isSelected = selectedVehicle?.name === (gv.nickname ?? [gv.year, gv.make, gv.model].filter(Boolean).join(" "));
                return (
                  <TouchableOpacity
                    key={gv.id}
                    style={[
                      TP.garageCard,
                      {
                        borderColor: isSelected ? colors.primary : colors.border,
                        backgroundColor: isSelected ? colors.primary + "10" : colors.muted + "33",
                      },
                    ]}
                    onPress={() => selectGarageVehicle(gv)}
                    activeOpacity={0.8}
                  >
                    <View style={{ flex: 1 }}>
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                        <Text style={[TP.garageCardName, { color: colors.foreground }]} numberOfLines={1}>
                          {gv.nickname ?? [gv.year, gv.make, gv.model].filter(Boolean).join(" ")}
                        </Text>
                        {gv.isPrimary && (
                          <View style={[TP.primaryBadge, { backgroundColor: colors.primary + "20" }]}>
                            <Text style={[TP.primaryBadgeTxt, { color: colors.primary }]}>Primary</Text>
                          </View>
                        )}
                      </View>
                      <View style={{ flexDirection: "row", gap: 8, marginTop: 3, flexWrap: "wrap" }}>
                        {gv.rangePerCharge && gv.rangePerCharge > 0 && (
                          <Text style={[TP.garageCardStat, { color: colors.mutedForeground }]}>
                            {fmtRange(Math.round(gv.rangePerCharge * MI_TO_KM), usesMiles)} range
                          </Text>
                        )}
                        {gv.batteryKwh && (
                          <Text style={[TP.garageCardStat, { color: colors.mutedForeground }]}>{gv.batteryKwh} kWh</Text>
                        )}
                        {gv.connectorType && (
                          <Text style={[TP.garageCardStat, { color: colors.mutedForeground }]}>{gv.connectorType}</Text>
                        )}
                      </View>
                    </View>
                    {isSelected && <Ionicons name="checkmark-circle" size={20} color={colors.primary} />}
                  </TouchableOpacity>
                );
              })
            )}
          </View>
        )}

        {/* Search tab */}
        {vehicleTab === "search" && (
          <View style={{ marginTop: 10 }}>
            <TouchableOpacity
              style={[TP.searchVehBtn, { borderColor: colors.primary + "60", backgroundColor: colors.primary + "08" }]}
              onPress={() => { Haptics.selectionAsync(); setVehiclePickerOpen(true); }}
              activeOpacity={0.8}
            >
              <Ionicons name="search" size={17} color={colors.primary} />
              <Text style={[TP.searchVehTxt, { color: colors.primary }]}>Browse Vehicle Database</Text>
              <Ionicons name="chevron-forward" size={16} color={colors.primary} style={{ marginLeft: "auto" }} />
            </TouchableOpacity>
            <Text style={{ fontSize: 12, color: colors.mutedForeground, marginTop: 8, fontFamily: "Inter_400Regular" }}>
              Search 100+ makes and models — EV specs auto-fill after selection.
            </Text>
          </View>
        )}

        {/* Manual tab */}
        {vehicleTab === "manual" && (
          <View style={{ marginTop: 10, gap: 10 }}>
            <View style={{ gap: 6 }}>
              <Text style={[TP.manualLabel, { color: colors.mutedForeground }]}>Make</Text>
              <TextInput
                style={[TP.manualInput, { backgroundColor: colors.muted + "55", borderColor: colors.border, color: colors.foreground }]}
                value={manualMake}
                onChangeText={setManualMake}
                placeholder="e.g. Tesla, Ford, Hyundai…"
                placeholderTextColor={colors.mutedForeground + "88"}
                autoCapitalize="words"
              />
            </View>
            <View style={{ gap: 6 }}>
              <Text style={[TP.manualLabel, { color: colors.mutedForeground }]}>Model</Text>
              <TextInput
                style={[TP.manualInput, { backgroundColor: colors.muted + "55", borderColor: colors.border, color: colors.foreground }]}
                value={manualModel}
                onChangeText={setManualModel}
                placeholder="e.g. Model 3, IONIQ 6, F-150…"
                placeholderTextColor={colors.mutedForeground + "88"}
                autoCapitalize="words"
              />
            </View>

            {/* Auto-suggest specs */}
            {manualSuggestion && (
              <TouchableOpacity
                style={[TP.suggestionRow, { borderColor: colors.primary + "40", backgroundColor: colors.primary + "08" }]}
                onPress={applySuggestionSpecs}
                activeOpacity={0.8}
              >
                <Ionicons name="flash" size={14} color={colors.primary} />
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 12, fontWeight: "600", color: colors.primary, fontFamily: "Inter_600SemiBold" }}>
                    Specs found: {manualSuggestion.name}
                  </Text>
                  <Text style={{ fontSize: 11, color: colors.mutedForeground, fontFamily: "Inter_400Regular" }}>
                    {EV_RANGE_MI[manualSuggestion.id]
                      ? `${usesMiles ? Math.round(EV_RANGE_MI[manualSuggestion.id]) : Math.round(EV_RANGE_MI[manualSuggestion.id] * MI_TO_KM)} ${usesMiles ? "mi" : "km"} EPA`
                      : manualSuggestion.typicalMpg ? `${manualSuggestion.typicalMpg} MPG` : ""
                    }
                    {manualSuggestion.dcConnector ? ` · ${manualSuggestion.dcConnector}` : manualSuggestion.acConnector ? ` · ${manualSuggestion.acConnector}` : ""}
                    {"  ·  Tap to apply"}
                  </Text>
                </View>
              </TouchableOpacity>
            )}

            {/* Range input */}
            <View style={{ gap: 6 }}>
              <Text style={[TP.manualLabel, { color: colors.mutedForeground }]}>Range</Text>
              <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
                <TextInput
                  style={[TP.manualInput, { flex: 1, backgroundColor: colors.muted + "55", borderColor: colors.border, color: colors.foreground }]}
                  value={manualRangeStr}
                  onChangeText={setManualRangeStr}
                  placeholder={usesMiles ? "e.g. 250" : "e.g. 400"}
                  placeholderTextColor={colors.mutedForeground + "88"}
                  keyboardType="decimal-pad"
                />
                <View style={[TP.unitMiniToggle, { borderColor: colors.border }]}>
                  {(["mi", "km"] as const).map(u => (
                    <TouchableOpacity
                      key={u}
                      style={[TP.unitMiniBtn, (u === "mi") === usesMiles && { backgroundColor: colors.primary }]}
                      onPress={() => {
                        const was = usesMiles;
                        const newUsesMiles = u === "mi";
                        if (was !== newUsesMiles) {
                          setUsesMiles(newUsesMiles);
                          const v = parseFloat(manualRangeStr);
                          if (!isNaN(v) && v > 0) {
                            setManualRangeStr(String(Math.round(newUsesMiles ? v * KM_TO_MI : v * MI_TO_KM)));
                          }
                        }
                      }}
                    >
                      <Text style={{ fontSize: 12, fontWeight: "700", color: (u === "mi") === usesMiles ? "#fff" : colors.mutedForeground }}>{u}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
            </View>

            {/* Battery */}
            <View style={{ gap: 6 }}>
              <Text style={[TP.manualLabel, { color: colors.mutedForeground }]}>Battery kWh <Text style={{ fontWeight: "400" }}>(optional)</Text></Text>
              <TextInput
                style={[TP.manualInput, { backgroundColor: colors.muted + "55", borderColor: colors.border, color: colors.foreground }]}
                value={manualBatteryStr}
                onChangeText={setManualBatteryStr}
                placeholder="e.g. 82"
                placeholderTextColor={colors.mutedForeground + "88"}
                keyboardType="decimal-pad"
              />
            </View>

            {/* Connector type */}
            <View style={{ gap: 6 }}>
              <Text style={[TP.manualLabel, { color: colors.mutedForeground }]}>Connector <Text style={{ fontWeight: "400" }}>(optional)</Text></Text>
              <View style={{ flexDirection: "row", gap: 6, flexWrap: "wrap" }}>
                {CONNECTORS.map(c => (
                  <TouchableOpacity
                    key={c}
                    style={[
                      TP.connPill,
                      {
                        borderColor: manualConnector === c ? colors.primary : colors.border,
                        backgroundColor: manualConnector === c ? colors.primary + "15" : colors.muted + "33",
                      },
                    ]}
                    onPress={() => { Haptics.selectionAsync(); setManualConnector(prev => prev === c ? null : c); }}
                  >
                    <Text style={{ fontSize: 12, fontWeight: "600", color: manualConnector === c ? colors.primary : colors.mutedForeground }}>{c}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>

            <TouchableOpacity
              style={[TP.applyManualBtn, { backgroundColor: colors.primary }]}
              onPress={applyManualVehicle}
              activeOpacity={0.85}
            >
              <Ionicons name="checkmark-circle" size={16} color="#fff" />
              <Text style={TP.applyManualTxt}>Use this vehicle</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Selected vehicle chip */}
        {selectedVehicle && (
          <View style={[TP.selectedChip, { borderColor: colors.primary + "50", backgroundColor: colors.primary + "08" }]}>
            <View style={{ flex: 1 }}>
              <Text style={[TP.selectedChipName, { color: colors.foreground }]} numberOfLines={1}>
                ✓ {selectedVehicle.name}
              </Text>
              <Text style={[TP.selectedChipStats, { color: colors.mutedForeground }]}>
                {fmtRange(selectedVehicle.rangeKm, usesMiles)}
                {selectedVehicle.batteryKwh ? ` · ${selectedVehicle.batteryKwh} kWh` : ""}
                {selectedVehicle.connectorType ? ` · ${selectedVehicle.connectorType}` : ""}
              </Text>
            </View>
            <TouchableOpacity onPress={() => setSelectedVehicle(null)} style={{ padding: 4 }}>
              <Ionicons name="close-circle" size={18} color={colors.mutedForeground} />
            </TouchableOpacity>
          </View>
        )}

        {/* Range note */}
        <Text style={[TP.rangeNote, { color: colors.mutedForeground, marginTop: selectedVehicle ? 8 : 12 }]}>
          {"Range: "}
          <Text style={{ color: colors.foreground, fontWeight: "600" }}>{fmtRange(rangeKm, usesMiles)}</Text>
          {"  ·  Stops every ~"}
          <Text style={{ color: colors.foreground, fontWeight: "600" }}>{fmtRange(Math.round(rangeKm * 0.75), usesMiles)}</Text>
        </Text>
      </View>
    );
  }

  // ── Main render ───────────────────────────────────────────────────────────
  return (
    <View style={[TP.root, { backgroundColor: colors.background }]}>
      {/* Nav bar */}
      <View style={[TP.navBar, { paddingTop: topPad + 8, backgroundColor: colors.background, borderBottomColor: colors.border }]}>
        <TouchableOpacity onPress={() => router.back()} style={TP.backBtn} activeOpacity={0.7}>
          <Ionicons name="chevron-back" size={22} color={colors.foreground} />
        </TouchableOpacity>
        <View style={TP.navCenter}>
          <Ionicons name="navigate" size={18} color={colors.primary} style={{ marginRight: 6 }} />
          <Text style={[TP.navTitle, { color: colors.foreground }]}>EV Trip Planner</Text>
        </View>
        <View style={{ width: 36 }} />
      </View>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 16, paddingBottom: insets.bottom + 32 }}
        keyboardShouldPersistTaps="handled"
      >
        {/* Route builder card */}
        <View style={[TP.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[TP.sectionTitle, { color: colors.foreground, marginBottom: 14 }]}>Route</Text>

          {/* Origin */}
          <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 0 }}>
            <View style={TP.routeLine}>
              <View style={[TP.routeDot, { backgroundColor: colors.primary }]} />
              <View style={[TP.routeConnector, { backgroundColor: colors.border }]} />
            </View>
            <View style={{ flex: 1, paddingBottom: 12 }}>
              <AddressField
                label="FROM"
                placeholder="Starting point…"
                value={origin?.display_name.split(",")[0] ?? ""}
                onSelect={r => { setOrigin(r); setUsingGpsOrigin(false); }}
                onClear={() => { setOrigin(null); setUsingGpsOrigin(false); }}
                onTextChange={() => setUsingGpsOrigin(false)}
                dotColor={colors.primary}
                gpsLoading={gpsLoading}
                gpsFilled={usingGpsOrigin}
                onGpsTap={Platform.OS !== "web" ? handleGpsTap : undefined}
              />
            </View>
          </View>

          {/* Intermediate waypoints */}
          {waypoints.map((wp, i) => (
            <View key={i} style={{ flexDirection: "row", alignItems: "flex-start" }}>
              <View style={TP.routeLine}>
                <View style={[TP.routeDot, { backgroundColor: DOT_COLORS[i % DOT_COLORS.length] }]} />
                <View style={[TP.routeConnector, { backgroundColor: colors.border }]} />
              </View>
              <View style={{ flex: 1, paddingBottom: 12 }}>
                <AddressField
                  label={`STOP ${i + 1}`}
                  placeholder="Add a stop…"
                  value={wp?.display_name.split(",")[0] ?? ""}
                  onSelect={r => updateWaypoint(i, r)}
                  onClear={() => clearWaypoint(i)}
                  dotColor={DOT_COLORS[i % DOT_COLORS.length]}
                />
              </View>
              <TouchableOpacity
                onPress={() => removeWaypoint(i)}
                style={[TP.removeBtn, { borderColor: colors.border }]}
                activeOpacity={0.7}
              >
                <Ionicons name="close" size={14} color={colors.mutedForeground} />
              </TouchableOpacity>
            </View>
          ))}

          {/* Destination */}
          <View style={{ flexDirection: "row", alignItems: "flex-start" }}>
            <View style={TP.routeLine}>
              <View style={[TP.routeDot, { backgroundColor: "#ef4444" }]} />
            </View>
            <View style={{ flex: 1 }}>
              <AddressField
                label="TO"
                placeholder="Destination…"
                value={dest?.display_name.split(",")[0] ?? ""}
                onSelect={setDest}
                onClear={() => setDest(null)}
                dotColor="#ef4444"
              />
            </View>
          </View>

          {/* Add stop button */}
          {waypoints.length < MAX_WAYPOINTS && (
            <TouchableOpacity
              style={[TP.addStopBtn, { borderColor: colors.primary + "40", backgroundColor: colors.primary + "08" }]}
              onPress={addWaypoint}
              activeOpacity={0.75}
            >
              <Ionicons name="add-circle-outline" size={16} color={colors.primary} />
              <Text style={[TP.addStopTxt, { color: colors.primary }]}>
                Add stop{waypoints.length > 0 ? ` (${waypoints.length}/${MAX_WAYPOINTS})` : ""}
              </Text>
            </TouchableOpacity>
          )}
        </View>

        {/* Vehicle card */}
        {renderVehicleCard()}

        {/* Saved trips button */}
        <TouchableOpacity
          style={[TP.savedBtn, { backgroundColor: colors.muted + "88", borderColor: colors.border }]}
          onPress={() => { Haptics.selectionAsync(); setShowSavedModal(true); }}
          activeOpacity={0.8}
        >
          <Ionicons name="bookmark-outline" size={16} color={colors.mutedForeground} />
          <Text style={[TP.savedBtnTxt, { color: colors.mutedForeground }]}>
            Saved Trips{savedTrips.length > 0 ? ` (${savedTrips.length})` : ""}
          </Text>
        </TouchableOpacity>

        {/* Plan button */}
        <TouchableOpacity
          style={[TP.planBtn, { backgroundColor: loading ? colors.muted : colors.primary, opacity: (!origin || !dest) ? 0.5 : 1 }]}
          onPress={planTrip}
          disabled={loading || !origin || !dest}
          activeOpacity={0.85}
        >
          {loading ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <>
              <Ionicons name="navigate" size={18} color="#fff" style={{ marginRight: 8 }} />
              <Text style={TP.planBtnTxt}>
                {filledWaypoints.length > 0 ? `Plan ${filledWaypoints.length + 2}-Stop Trip` : "Plan Trip"}
              </Text>
            </>
          )}
        </TouchableOpacity>

        {tripError && (
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: "#fef2f2", borderRadius: 10, borderWidth: 1, borderColor: "#fecaca", padding: 12, marginTop: 4 }}>
            <Ionicons name="alert-circle" size={16} color="#ef4444" />
            <Text style={{ flex: 1, fontSize: 13, color: "#ef4444" }}>{tripError}</Text>
          </View>
        )}

        {/* Results */}
        {plan && (
          <>
            {/* Save trip row */}
            <View style={[TP.saveTripRow, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <TextInput
                style={[TP.saveTripInput, { backgroundColor: colors.muted + "55", borderColor: colors.border, color: colors.foreground }]}
                value={tripName}
                onChangeText={setTripName}
                placeholder="Name this trip…"
                placeholderTextColor={colors.mutedForeground + "99"}
              />
              <TouchableOpacity
                style={[TP.saveTripBtn, { backgroundColor: saveDone ? "#22c55e" : colors.primary }]}
                onPress={saveCurrentTrip}
                disabled={saving}
                activeOpacity={0.8}
              >
                {saving ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Ionicons name={saveDone ? "checkmark" : "bookmark-outline"} size={16} color="#fff" />
                )}
              </TouchableOpacity>
            </View>

            {/* Summary strip */}
            <View style={[TP.summaryStrip, { backgroundColor: colors.primary + "12", borderColor: colors.primary + "33" }]}>
              <View style={TP.summaryItem}>
                <Text style={[TP.summaryVal, { color: colors.foreground }]}>{fmtDistKm(plan.route.distanceKm, usesMiles)}</Text>
                <Text style={[TP.summaryLbl, { color: colors.mutedForeground }]}>Distance</Text>
              </View>
              <View style={[TP.summaryDivider, { backgroundColor: colors.border }]} />
              <View style={TP.summaryItem}>
                <Text style={[TP.summaryVal, { color: colors.foreground }]}>{formatDuration(plan.route.durationSec)}</Text>
                <Text style={[TP.summaryLbl, { color: colors.mutedForeground }]}>Drive time</Text>
              </View>
              <View style={[TP.summaryDivider, { backgroundColor: colors.border }]} />
              <View style={TP.summaryItem}>
                <Text style={[TP.summaryVal, { color: colors.foreground }]}>{plan.stops.length}</Text>
                <Text style={[TP.summaryLbl, { color: colors.mutedForeground }]}>Charge stops</Text>
              </View>
            </View>

            {/* Export PDF button */}
            <TouchableOpacity
              style={[TP.exportBtn, { borderColor: colors.primary + "50", backgroundColor: colors.primary + "0C" }]}
              onPress={exportPdf}
              disabled={exportingPdf}
              activeOpacity={0.8}
            >
              {exportingPdf ? (
                <ActivityIndicator size="small" color={colors.primary} />
              ) : (
                <>
                  <Feather name="file-text" size={15} color={colors.primary} />
                  <Text style={[TP.exportBtnTxt, { color: colors.primary }]}>Export PDF with Directions</Text>
                </>
              )}
            </TouchableOpacity>

            {/* User waypoints summary */}
            {filledWaypoints.length > 0 && (
              <>
                <Text style={[TP.stopsHeader, { color: colors.foreground, marginBottom: 8 }]}>Your Stops</Text>
                {filledWaypoints.map((wp, i) => (
                  <View
                    key={i}
                    style={[TP.userStopCard, { backgroundColor: DOT_COLORS[i % DOT_COLORS.length] + "12", borderColor: DOT_COLORS[i % DOT_COLORS.length] + "40" }]}
                  >
                    <View style={[TP.stopBadge, { backgroundColor: DOT_COLORS[i % DOT_COLORS.length] }]}>
                      <Text style={TP.stopBadgeTxt}>{i + 1}</Text>
                    </View>
                    <Text style={[TP.stopName, { color: colors.foreground, flex: 1 }]} numberOfLines={1}>
                      {wp.display_name.split(",")[0]}
                    </Text>
                  </View>
                ))}
              </>
            )}

            {/* Charging stops */}
            <Text style={[TP.stopsHeader, { color: colors.foreground }]}>Charging Stops</Text>
            {plan.stops.length === 0 ? (
              <View style={[TP.noStops, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <Ionicons name="checkmark-circle" size={28} color="#22c55e" />
                <Text style={[TP.noStopsTxt, { color: colors.foreground }]}>No charging stops needed!</Text>
                <Text style={[TP.noStopsSub, { color: colors.mutedForeground }]}>All legs are within your range</Text>
              </View>
            ) : (
              plan.stops.map((stop, i) => (
                <View key={stop.id} style={[TP.stopCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                  <View style={[TP.stopBadge, { backgroundColor: "#f59e0b" }]}>
                    <Text style={TP.stopBadgeTxt}>{i + 1}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[TP.stopName, { color: colors.foreground }]} numberOfLines={1}>{stop.name}</Text>
                    <Text style={[TP.stopAddr, { color: colors.mutedForeground }]} numberOfLines={1}>{stop.address}</Text>
                    <View style={TP.stopTags}>
                      {stop.dcFastPorts > 0 && (
                        <View style={[TP.tag, { backgroundColor: colors.primary + "18" }]}>
                          <Text style={[TP.tagTxt, { color: colors.primary }]}>⚡ DC Fast ×{stop.dcFastPorts}</Text>
                        </View>
                      )}
                      {stop.level2Ports > 0 && (
                        <View style={[TP.tag, { backgroundColor: colors.muted + "88" }]}>
                          <Text style={[TP.tagTxt, { color: colors.mutedForeground }]}>L2 ×{stop.level2Ports}</Text>
                        </View>
                      )}
                      <View style={[TP.tag, { backgroundColor: colors.muted + "44" }]}>
                        <Text style={[TP.tagTxt, { color: colors.mutedForeground }]}>{fmtDistKm(stop.distanceFromOriginKm, usesMiles)} from start</Text>
                      </View>
                    </View>
                  </View>
                </View>
              ))
            )}
          </>
        )}
      </ScrollView>

      {/* Saved trips modal */}
      <Modal visible={showSavedModal} transparent animationType="slide" onRequestClose={() => setShowSavedModal(false)}>
        <TouchableOpacity style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.4)" }} activeOpacity={1} onPress={() => setShowSavedModal(false)} />
        <View style={[TP.savedModal, { backgroundColor: colors.card, borderColor: colors.border, paddingBottom: insets.bottom + 16 }]}>
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 18, paddingTop: 14, paddingBottom: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border }}>
            <Text style={{ fontSize: 16, fontWeight: "700", fontFamily: "Inter_700Bold", color: colors.foreground }}>Saved Trips</Text>
            <TouchableOpacity onPress={() => setShowSavedModal(false)}>
              <Ionicons name="close" size={22} color={colors.mutedForeground} />
            </TouchableOpacity>
          </View>
          {savedTrips.length === 0 ? (
            <View style={{ padding: 32, alignItems: "center", gap: 8 }}>
              <Ionicons name="bookmark-outline" size={32} color={colors.mutedForeground} />
              <Text style={{ color: colors.mutedForeground, fontSize: 14 }}>No saved trips yet</Text>
              <Text style={{ color: colors.mutedForeground, fontSize: 12, textAlign: "center" }}>Plan a trip and tap the bookmark icon to save it here.</Text>
            </View>
          ) : (
            <ScrollView style={{ maxHeight: 360 }} showsVerticalScrollIndicator={false}>
              {savedTrips.map(trip => (
                <View
                  key={trip.id}
                  style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: 18, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border }}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 14, fontWeight: "600", fontFamily: "Inter_600SemiBold", color: colors.foreground }}>{trip.name}</Text>
                    <Text style={{ fontSize: 12, color: colors.mutedForeground, marginTop: 2 }}>{fmtRange(trip.rangeKm, usesMiles)} range · {new Date(trip.createdAt).toLocaleDateString()}</Text>
                  </View>
                  <TouchableOpacity onPress={() => { Haptics.selectionAsync(); deleteSavedTrip(trip.id); }} style={{ padding: 6 }}>
                    <Ionicons name="trash-outline" size={16} color="#ef4444" />
                  </TouchableOpacity>
                </View>
              ))}
            </ScrollView>
          )}
        </View>
      </Modal>

      {/* Vehicle picker modal */}
      <VehiclePickerModal
        visible={vehiclePickerOpen}
        onClose={() => setVehiclePickerOpen(false)}
        onSelect={handlePickerSelect}
        initialCategory="electric"
      />
    </View>
  );
}

const TP = StyleSheet.create({
  root: { flex: 1 },
  navBar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 12, paddingBottom: 10, borderBottomWidth: StyleSheet.hairlineWidth },
  backBtn: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center" },
  navCenter: { flexDirection: "row", alignItems: "center" },
  navTitle: { fontSize: 17, fontWeight: "700", fontFamily: "Inter_700Bold" },
  card: { borderRadius: 14, borderWidth: 1, padding: 14 },
  routeLine: { width: 24, alignItems: "center", marginRight: 8, paddingTop: 18 },
  routeDot: { width: 12, height: 12, borderRadius: 6, borderWidth: 2, borderColor: "#fff" },
  routeConnector: { width: 2, flex: 1, minHeight: 20, marginTop: 4 },
  fieldLabel: { fontSize: 10, fontWeight: "700", letterSpacing: 0.8, textTransform: "uppercase" },
  inputRow: { flexDirection: "row", alignItems: "center", borderRadius: 10, borderWidth: 1, paddingLeft: 10 },
  dot: { width: 8, height: 8, borderRadius: 4, marginRight: 8 },
  input: { paddingVertical: 10, fontSize: 15, fontFamily: "Inter_400Regular" },
  dropdown: { position: "absolute", top: "100%", left: 0, right: 0, zIndex: 100, borderRadius: 10, borderWidth: 1, overflow: "hidden", marginTop: 2 },
  dropdownItem: { flexDirection: "row", alignItems: "flex-start", paddingHorizontal: 12, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth },
  dropdownTxt: { fontSize: 13, fontFamily: "Inter_400Regular", flex: 1 },
  removeBtn: { marginTop: 18, marginLeft: 6, width: 30, height: 30, borderRadius: 8, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  addStopBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, marginTop: 14, borderRadius: 10, borderWidth: 1, paddingVertical: 10 },
  addStopTxt: { fontSize: 14, fontWeight: "600", fontFamily: "Inter_600SemiBold" },
  sectionTitle: { fontSize: 15, fontWeight: "700", fontFamily: "Inter_700Bold" },
  rangeNote: { fontSize: 12, fontFamily: "Inter_400Regular" },
  savedBtn: { flexDirection: "row", alignItems: "center", gap: 8, borderRadius: 12, borderWidth: 1, paddingHorizontal: 14, paddingVertical: 10, marginTop: 12 },
  savedBtnTxt: { fontSize: 13, fontFamily: "Inter_500Medium" },
  planBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", borderRadius: 14, paddingVertical: 14, marginTop: 12, marginBottom: 20 },
  planBtnTxt: { color: "#fff", fontSize: 16, fontWeight: "700", fontFamily: "Inter_700Bold" },
  saveTripRow: { flexDirection: "row", gap: 8, borderRadius: 12, borderWidth: 1, padding: 10, marginBottom: 14 },
  saveTripInput: { flex: 1, borderRadius: 8, borderWidth: 1, paddingHorizontal: 10, paddingVertical: 8, fontSize: 13, fontFamily: "Inter_400Regular" },
  saveTripBtn: { width: 38, height: 38, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  summaryStrip: { flexDirection: "row", borderRadius: 14, borderWidth: 1, padding: 16, marginBottom: 16, justifyContent: "space-around" },
  summaryItem: { alignItems: "center" },
  summaryVal: { fontSize: 20, fontWeight: "700", fontFamily: "Inter_700Bold" },
  summaryLbl: { fontSize: 10, textTransform: "uppercase", letterSpacing: 0.6, marginTop: 2, fontFamily: "Inter_400Regular" },
  summaryDivider: { width: StyleSheet.hairlineWidth, alignSelf: "stretch" },
  stopsHeader: { fontSize: 16, fontWeight: "700", fontFamily: "Inter_700Bold", marginBottom: 10 },
  userStopCard: { flexDirection: "row", alignItems: "center", borderRadius: 10, borderWidth: 1, padding: 10, marginBottom: 6, gap: 10 },
  stopCard: { flexDirection: "row", alignItems: "flex-start", borderRadius: 12, borderWidth: 1, padding: 12, marginBottom: 8, gap: 10 },
  stopBadge: { width: 26, height: 26, borderRadius: 13, alignItems: "center", justifyContent: "center", flexShrink: 0 },
  stopBadgeTxt: { color: "#fff", fontSize: 12, fontWeight: "700" },
  stopName: { fontSize: 14, fontWeight: "600", fontFamily: "Inter_600SemiBold", marginBottom: 2 },
  stopAddr: { fontSize: 12, fontFamily: "Inter_400Regular", marginBottom: 6 },
  stopTags: { flexDirection: "row", flexWrap: "wrap", gap: 4 },
  tag: { borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
  tagTxt: { fontSize: 10, fontWeight: "600", fontFamily: "Inter_600SemiBold" },
  noStops: { borderRadius: 14, borderWidth: 1, padding: 24, alignItems: "center", gap: 6 },
  noStopsTxt: { fontSize: 16, fontWeight: "700", fontFamily: "Inter_700Bold" },
  noStopsSub: { fontSize: 13, fontFamily: "Inter_400Regular" },
  savedModal: { borderTopLeftRadius: 20, borderTopRightRadius: 20, borderTopWidth: 1, borderLeftWidth: 1, borderRightWidth: 1 },
  exportBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, borderRadius: 12, borderWidth: 1, paddingVertical: 11, marginBottom: 16 },
  exportBtnTxt: { fontSize: 14, fontWeight: "600", fontFamily: "Inter_600SemiBold" },
  // ── Vehicle card ──────────────────────────────────────────────────────────
  unitToggle: { flexDirection: "row", alignItems: "center", borderWidth: 1, borderRadius: 8, overflow: "hidden", paddingHorizontal: 2, paddingVertical: 2, gap: 2 },
  unitToggleTxt: { fontSize: 12, fontFamily: "Inter_600SemiBold", paddingHorizontal: 6 },
  unitToggleSep: { fontSize: 12 },
  vehTabs: { flexDirection: "row", borderRadius: 10, borderWidth: 1, padding: 3, gap: 3 },
  vehTab: { flex: 1, borderRadius: 8, paddingVertical: 7, alignItems: "center" },
  vehTabTxt: { fontSize: 12, fontWeight: "600", fontFamily: "Inter_600SemiBold" },
  garageCard: { flexDirection: "row", alignItems: "center", borderRadius: 10, borderWidth: 1, padding: 12, marginBottom: 8, gap: 10 },
  garageCardName: { fontSize: 14, fontWeight: "600", fontFamily: "Inter_600SemiBold" },
  garageCardStat: { fontSize: 12, fontFamily: "Inter_400Regular" },
  primaryBadge: { borderRadius: 4, paddingHorizontal: 5, paddingVertical: 2 },
  primaryBadgeTxt: { fontSize: 10, fontWeight: "700", fontFamily: "Inter_700Bold" },
  searchVehBtn: { flexDirection: "row", alignItems: "center", gap: 10, borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 13 },
  searchVehTxt: { fontSize: 15, fontWeight: "600", fontFamily: "Inter_600SemiBold", flex: 1 },
  manualLabel: { fontSize: 11, fontWeight: "700", fontFamily: "Inter_700Bold", textTransform: "uppercase", letterSpacing: 0.5 },
  manualInput: { borderRadius: 10, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, fontFamily: "Inter_400Regular" },
  suggestionRow: { flexDirection: "row", alignItems: "center", gap: 8, borderRadius: 10, borderWidth: 1, padding: 10 },
  connPill: { borderWidth: 1, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 6 },
  unitMiniToggle: { flexDirection: "row", borderWidth: 1, borderRadius: 8, overflow: "hidden" },
  unitMiniBtn: { paddingHorizontal: 10, paddingVertical: 9 },
  applyManualBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, borderRadius: 12, paddingVertical: 12 },
  applyManualTxt: { color: "#fff", fontSize: 15, fontWeight: "700", fontFamily: "Inter_700Bold" },
  selectedChip: { flexDirection: "row", alignItems: "center", borderWidth: 1, borderRadius: 10, padding: 10, marginTop: 12, gap: 8 },
  selectedChipName: { fontSize: 13, fontWeight: "600", fontFamily: "Inter_600SemiBold" },
  selectedChipStats: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 1 },
});
