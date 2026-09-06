import React, { useState, useMemo } from "react";
import {
  Modal, View, Text, TextInput, FlatList,
  TouchableOpacity, StyleSheet, ActivityIndicator,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";
import { useVehicleCatalog, type CatalogEntry } from "@/hooks/useVehicleCatalog";

// ── Types (exported for backward compat) ──────────────────────────────────────
export type FuelCategory = "electric" | "phev_hybrid" | "gas_diesel";

export interface Vehicle {
  id: string;
  name: string;
  make: string;
  model: string;
  yearRange: string;
  fuelCategory: FuelCategory;
  dcConnector?: "CCS" | "NACS" | "CHAdeMO" | null;
  acConnector?: "J1772" | "NACS";
  fuelType?: "regular" | "premium" | "diesel" | "e85" | "hybrid";
  typicalMpg?: number;
  batteryKwh?: number;
  rangeMiles?: number;
  acMaxKw?: number;
  dcMaxKw?: number;
}

// ── Catalog → Vehicle mapper ──────────────────────────────────────────────────
function catalogFuelCategory(fc: string): FuelCategory {
  if (fc === "BEV") return "electric";
  if (fc === "PHEV" || fc === "HEV") return "phev_hybrid";
  return "gas_diesel";
}

function catalogFuelType(fc: string): Vehicle["fuelType"] | undefined {
  if (fc === "DIESEL") return "diesel";
  if (fc === "E85") return "e85";
  if (fc === "HEV" || fc === "PHEV") return "hybrid";
  return undefined;
}

function catalogToVehicle(e: CatalogEntry): Vehicle {
  const fc = catalogFuelCategory(e.fuelCategory);
  return {
    id: `cat-${e.id}`,
    name: e.trim ? `${e.make} ${e.model} ${e.trim}` : `${e.make} ${e.model}`,
    make: e.make,
    model: e.model,
    yearRange: e.yearDisplay,
    fuelCategory: fc,
    dcConnector: (e.dcConnector as Vehicle["dcConnector"]) ?? null,
    acConnector: e.acConnector as Vehicle["acConnector"],
    fuelType: catalogFuelType(e.fuelCategory),
    typicalMpg: e.typicalMpg ?? undefined,
    batteryKwh: e.batteryKwh ?? undefined,
    rangeMiles: e.rangeMiles ?? undefined,
    acMaxKw: e.acMaxKw ?? undefined,
    dcMaxKw: e.dcMaxKw ?? undefined,
  };
}

// ── Catalog fuel filter sets per tab ──────────────────────────────────────────
const TAB_FUEL_CATEGORIES: Record<FuelCategory, Set<string>> = {
  electric: new Set(["BEV"]),
  phev_hybrid: new Set(["PHEV", "HEV"]),
  gas_diesel: new Set(["GAS", "DIESEL", "E85"]),
};

// ── Badge colors ──────────────────────────────────────────────────────────────
const CONNECTOR_COLOR: Record<string, string> = {
  NACS: "#16a34a",
  CCS: "#2563eb",
  CHAdeMO: "#d97706",
};

const FUEL_COLOR: Record<string, string> = {
  regular: "#f59e0b",
  premium: "#8b5cf6",
  diesel: "#0891b2",
  e85: "#22c55e",
  hybrid: "#0D9E7E",
};

const FUEL_LABEL: Record<string, string> = {
  regular: "Regular",
  premium: "Premium",
  diesel: "Diesel",
  e85: "E85 Flex",
  hybrid: "Hybrid",
};

// ── Categories ────────────────────────────────────────────────────────────────
const CATEGORIES: { id: FuelCategory; label: string; emoji: string; desc: string }[] = [
  { id: "electric", label: "Electric", emoji: "⚡", desc: "Connector type auto-filled" },
  { id: "phev_hybrid", label: "Hybrid / PHEV", emoji: "🔋", desc: "Plug-in hybrid & standard hybrid" },
  { id: "gas_diesel", label: "Gas & Diesel", emoji: "⛽", desc: "Gasoline, diesel, premium & E85" },
];

// ── Props ─────────────────────────────────────────────────────────────────────
interface Props {
  visible: boolean;
  onClose: () => void;
  onSelect: (v: Vehicle) => void;
  initialCategory?: FuelCategory;
}

export function VehiclePickerModal({ visible, onClose, onSelect, initialCategory }: Props) {
  const colors = useColors();
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<FuelCategory>(initialCategory ?? "electric");

  const { entries, isLoading, isUnavailable, isServerEmpty, fromCache, refetch } = useVehicleCatalog();

  const results = useMemo<Vehicle[]>(() => {
    const fuelSet = TAB_FUEL_CATEGORIES[category];
    const pool = entries.filter((e) => e.isActive && fuelSet.has(e.fuelCategory));
    const q = query.toLowerCase().trim();

    const filtered = q
      ? pool.filter(
          (e) =>
            e.make.toLowerCase().includes(q) ||
            e.model.toLowerCase().includes(q) ||
            (e.trim ?? "").toLowerCase().includes(q)
        )
      : pool;

    return filtered.slice(0, 60).map(catalogToVehicle);
  }, [entries, query, category]);

  function handleSelect(v: Vehicle) {
    onSelect(v);
    setQuery("");
    onClose();
  }

  const catDesc = CATEGORIES.find((c) => c.id === category)?.desc ?? "";

  // ── Render helpers for the four distinct states ───────────────────────────

  function renderLoading() {
    return (
      <View style={S.centeredState}>
        <ActivityIndicator size="large" color={colors.primary} />
        <Text style={[S.stateTitle, { color: colors.mutedForeground, marginTop: 14 }]}>
          Downloading vehicle catalog…
        </Text>
        <Text style={[S.stateHint, { color: colors.mutedForeground + "88" }]}>
          This only happens once — results are cached locally.
        </Text>
      </View>
    );
  }

  function renderUnavailable() {
    return (
      <View style={S.centeredState}>
        <Ionicons name="cloud-offline-outline" size={44} color={colors.mutedForeground + "40"} />
        <Text style={[S.stateTitle, { color: colors.foreground, marginTop: 14 }]}>
          Vehicle catalog unavailable
        </Text>
        <Text style={[S.stateHint, { color: colors.mutedForeground, textAlign: "center" }]}>
          Could not reach the server. Check your connection and try again.
        </Text>
        <TouchableOpacity
          onPress={() => refetch()}
          style={[S.retryBtn, { backgroundColor: colors.primary }]}
          activeOpacity={0.8}
        >
          <Text style={S.retryTxt}>Try Again</Text>
        </TouchableOpacity>
      </View>
    );
  }

  function renderServerEmpty() {
    return (
      <View style={S.centeredState}>
        <Ionicons name="time-outline" size={44} color={colors.mutedForeground + "40"} />
        <Text style={[S.stateTitle, { color: colors.foreground, marginTop: 14 }]}>
          Vehicle catalog is currently unavailable
        </Text>
        <Text style={[S.stateHint, { color: colors.mutedForeground, textAlign: "center" }]}>
          Pull to refresh or try again in a few minutes.
        </Text>
        <TouchableOpacity
          onPress={() => refetch()}
          style={[S.retryBtn, { backgroundColor: colors.primary }]}
          activeOpacity={0.8}
        >
          <Text style={S.retryTxt}>Refresh</Text>
        </TouchableOpacity>
      </View>
    );
  }

  function renderList() {
    return (
      <FlatList
        data={results}
        keyExtractor={(v) => v.id}
        keyboardShouldPersistTaps="handled"
        renderItem={({ item: v }) => {
          const isEV = v.fuelCategory === "electric";
          const badgeLabel = isEV
            ? (v.dcConnector ?? "L2 only")
            : v.fuelType
            ? FUEL_LABEL[v.fuelType] ?? "Gas"
            : "Gas";
          const badgeColor = isEV
            ? v.dcConnector
              ? (CONNECTOR_COLOR[v.dcConnector] ?? "#64748b")
              : "#64748b"
            : v.fuelType
            ? (FUEL_COLOR[v.fuelType] ?? "#f59e0b")
            : "#f59e0b";

          return (
            <TouchableOpacity
              onPress={() => handleSelect(v)}
              style={[S.row, { borderBottomColor: colors.border + "40" }]}
              activeOpacity={0.7}
            >
              <View style={{ flex: 1 }}>
                <Text style={[S.rowName, { color: colors.foreground }]}>{v.name}</Text>
                <Text style={[S.rowSub, { color: colors.mutedForeground }]}>
                  {v.yearRange}
                  {v.typicalMpg ? `  ·  ~${v.typicalMpg} MPG` : ""}
                  {v.rangeMiles ? `  ·  ${v.rangeMiles} mi` : ""}
                </Text>
              </View>
              <View
                style={[
                  S.badge,
                  {
                    backgroundColor: badgeColor + "18",
                    borderColor: badgeColor + "40",
                  },
                ]}
              >
                <Text style={[S.badgeTxt, { color: badgeColor }]}>{badgeLabel}</Text>
              </View>
            </TouchableOpacity>
          );
        }}
        ListEmptyComponent={
          <View style={S.centeredState}>
            <Ionicons name="search-outline" size={40} color={colors.mutedForeground + "40"} />
            <Text style={[S.stateTitle, { color: colors.mutedForeground }]}>
              No vehicles found
            </Text>
            <Text style={[S.stateHint, { color: colors.mutedForeground + "88" }]}>
              Try a different search term or switch tabs.
            </Text>
          </View>
        }
      />
    );
  }

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: colors.background }}>

        {/* Header */}
        <View style={[S.header, { borderBottomColor: colors.border }]}>
          <View style={{ flex: 1 }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <Text style={[S.headerTitle, { color: colors.foreground }]}>Select Your Vehicle</Text>
              {fromCache && (
                <View style={[S.offlineBadge, { backgroundColor: colors.muted + "44" }]}>
                  <Text style={[S.offlineTxt, { color: colors.mutedForeground }]}>Cached</Text>
                </View>
              )}
            </View>
            <Text style={[S.headerSub, { color: colors.mutedForeground }]}>{catDesc}</Text>
          </View>
          <TouchableOpacity onPress={onClose} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <Ionicons name="close" size={24} color={colors.mutedForeground} />
          </TouchableOpacity>
        </View>

        {/* Category tabs — hidden while loading or catalog unavailable */}
        {!isLoading && !isUnavailable && !isServerEmpty && (
          <View style={[S.tabRow, { borderBottomColor: colors.border }]}>
            {CATEGORIES.map((cat) => (
              <TouchableOpacity
                key={cat.id}
                style={[
                  S.tab,
                  category === cat.id && {
                    borderBottomColor: colors.primary,
                    borderBottomWidth: 2,
                  },
                ]}
                onPress={() => {
                  setCategory(cat.id);
                  setQuery("");
                }}
                activeOpacity={0.7}
              >
                <Text style={S.tabEmoji}>{cat.emoji}</Text>
                <Text
                  style={[
                    S.tabLabel,
                    { color: category === cat.id ? colors.primary : colors.mutedForeground },
                  ]}
                >
                  {cat.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        )}

        {/* Search — hidden while loading or catalog unavailable */}
        {!isLoading && !isUnavailable && !isServerEmpty && (
          <View
            style={[
              S.searchBox,
              { backgroundColor: colors.muted + "44", borderColor: colors.border },
            ]}
          >
            <Ionicons
              name="search-outline"
              size={16}
              color={colors.mutedForeground}
              style={{ marginRight: 8 }}
            />
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder="Search make or model…"
              placeholderTextColor={colors.mutedForeground + "88"}
              style={{ flex: 1, paddingVertical: 10, fontSize: 15, color: colors.foreground }}
              returnKeyType="search"
            />
            {query.length > 0 && (
              <TouchableOpacity onPress={() => setQuery("")}>
                <Ionicons name="close-circle" size={16} color={colors.mutedForeground} />
              </TouchableOpacity>
            )}
          </View>
        )}

        {/* State machine: exactly one of these renders */}
        {isLoading && renderLoading()}
        {!isLoading && isUnavailable && renderUnavailable()}
        {!isLoading && !isUnavailable && isServerEmpty && renderServerEmpty()}
        {!isLoading && !isUnavailable && !isServerEmpty && renderList()}

      </View>
    </Modal>
  );
}

const S = StyleSheet.create({
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
  },
  headerTitle: { fontWeight: "700", fontSize: 18 },
  headerSub: { fontSize: 12, marginTop: 2 },
  offlineBadge: {
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  offlineTxt: { fontSize: 10, fontWeight: "600" },
  tabRow: { flexDirection: "row", borderBottomWidth: 1 },
  tab: {
    flex: 1,
    alignItems: "center",
    paddingVertical: 10,
    gap: 2,
    borderBottomWidth: 2,
    borderBottomColor: "transparent",
  },
  tabEmoji: { fontSize: 16 },
  tabLabel: { fontSize: 11, fontWeight: "600" },
  searchBox: {
    flexDirection: "row",
    alignItems: "center",
    margin: 12,
    borderRadius: 10,
    paddingHorizontal: 12,
    borderWidth: 1,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 13,
    borderBottomWidth: 1,
  },
  rowName: { fontSize: 15, fontWeight: "600" },
  rowSub: { fontSize: 11, marginTop: 1 },
  badge: {
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderWidth: 1,
  },
  badgeTxt: { fontSize: 11, fontWeight: "700" },
  centeredState: {
    alignItems: "center",
    paddingTop: 56,
    paddingHorizontal: 36,
  },
  stateTitle: { fontSize: 15, fontWeight: "600", textAlign: "center" },
  stateHint: { fontSize: 13, marginTop: 6, lineHeight: 18 },
  retryBtn: {
    marginTop: 20,
    paddingHorizontal: 28,
    paddingVertical: 11,
    borderRadius: 10,
  },
  retryTxt: { color: "#fff", fontWeight: "700", fontSize: 14 },
  emptyTxt: { marginTop: 12, fontSize: 14 },
  emptyHint: { fontSize: 12, marginTop: 4 },
});
