import React, { useState, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  RefreshControl,
  TextInput,
  ActivityIndicator,
  Platform,
  Modal,
  ScrollView,
} from "react-native";
import { Feather, Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@clerk/expo";
import { useRouter } from "expo-router";
import * as Haptics from "expo-haptics";
import * as Print from "expo-print";
import * as Sharing from "expo-sharing";
import { useColors } from "@/hooks/useColors";
import { track } from "@/lib/analytics";

const BASE = `https://${process.env.EXPO_PUBLIC_DOMAIN}`;

interface HistoryEntry {
  id: number;
  stationId: number | null;
  stationName: string;
  stationAddress: string | null;
  chargerType: string | null;
  kwh: number | null;
  amountCents: number | null;
  currency: string;
  chargedAt: string;
  source?: "legacy" | "session";
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function fmtDateShort(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    year: "numeric",
  });
}

function fmtCurrency(cents: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(
    cents / 100
  );
}

function SummaryBar({
  entries,
  colors,
}: {
  entries: HistoryEntry[];
  colors: ReturnType<typeof useColors>;
}) {
  const totalKwh = entries.reduce((s, e) => s + (e.kwh ?? 0), 0);
  const totalSpent = entries.reduce((s, e) => s + (e.amountCents ?? 0), 0) / 100;

  return (
    <View style={[SB.wrap, { backgroundColor: colors.card, borderColor: colors.border }]}>
      {[
        { value: String(entries.length), label: "Sessions", tint: "#0D9E7E" },
        {
          value: totalKwh > 0 ? `${totalKwh.toFixed(1)}` : "—",
          label: "kWh Charged",
          tint: "#3b82f6",
        },
        {
          value: totalSpent > 0 ? `$${totalSpent.toFixed(0)}` : "—",
          label: "Total Spent",
          tint: "#f59e0b",
        },
      ].map(({ value, label, tint }) => (
        <View key={label} style={SB.pill}>
          <Text style={[SB.val, { color: tint }]}>{value}</Text>
          <Text style={[SB.lbl, { color: colors.mutedForeground }]}>{label}</Text>
        </View>
      ))}
    </View>
  );
}

const SB = StyleSheet.create({
  wrap: {
    flexDirection: "row",
    borderRadius: 14,
    borderWidth: 1,
    marginHorizontal: 16,
    marginBottom: 12,
    overflow: "hidden",
  },
  pill: { flex: 1, alignItems: "center", paddingVertical: 12 },
  val: { fontSize: 19, fontWeight: "800", fontFamily: "Inter_700Bold" },
  lbl: { fontSize: 10, fontFamily: "Inter_400Regular", marginTop: 2 },
});

function SessionCard({
  entry,
  onPress,
  colors,
}: {
  entry: HistoryEntry;
  onPress: () => void;
  colors: ReturnType<typeof useColors>;
}) {
  const stationDeleted = entry.stationId == null;
  return (
    <TouchableOpacity
      style={[SC.card, { backgroundColor: colors.card, borderColor: colors.border }]}
      onPress={onPress}
      activeOpacity={0.78}
    >
      <View style={[SC.iconWrap, { backgroundColor: colors.primary + "18" }]}>
        <Ionicons name="flash" size={18} color={colors.primary} />
      </View>

      <View style={{ flex: 1, minWidth: 0, gap: 1 }}>
        <Text style={[SC.name, { color: colors.foreground }]} numberOfLines={1}>
          {entry.stationName}
        </Text>
        {stationDeleted ? (
          <View style={[SC.deletedBadge, { backgroundColor: colors.mutedForeground + "18" }]}>
            <Text style={[SC.deletedText, { color: colors.mutedForeground }]}>
              Station no longer available
            </Text>
          </View>
        ) : entry.stationAddress ? (
          <Text style={[SC.addr, { color: colors.mutedForeground }]} numberOfLines={1}>
            {entry.stationAddress}
          </Text>
        ) : null}
        <Text style={[SC.date, { color: colors.mutedForeground }]}>
          {fmtDate(entry.chargedAt)}
          {entry.chargerType ? ` · ${entry.chargerType}` : ""}
        </Text>
      </View>

      <View style={{ alignItems: "flex-end", flexShrink: 0, gap: 2 }}>
        {entry.kwh != null ? (
          <Text style={[SC.kwh, { color: colors.primary }]}>
            {entry.kwh.toFixed(1)} kWh
          </Text>
        ) : null}
        {entry.amountCents != null ? (
          <Text style={[SC.amt, { color: colors.foreground }]}>
            {fmtCurrency(entry.amountCents)}
          </Text>
        ) : null}
        {!stationDeleted && (
          <Feather name="chevron-right" size={13} color={colors.mutedForeground + "88"} />
        )}
      </View>
    </TouchableOpacity>
  );
}

const SC = StyleSheet.create({
  card: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderRadius: 14,
    borderWidth: 1,
    padding: 14,
    marginBottom: 8,
  },
  iconWrap: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  name: { fontSize: 14, fontWeight: "700", fontFamily: "Inter_700Bold" },
  addr: { fontSize: 11, fontFamily: "Inter_400Regular" },
  date: { fontSize: 11, fontFamily: "Inter_400Regular", marginTop: 1 },
  kwh: { fontSize: 14, fontWeight: "700", fontFamily: "Inter_700Bold" },
  amt: { fontSize: 12, fontFamily: "Inter_400Regular" },
  deletedBadge: {
    alignSelf: "flex-start",
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
    marginTop: 2,
  },
  deletedText: { fontSize: 10, fontFamily: "Inter_400Regular" },
});

function MonthPickerModal({
  visible,
  title,
  selected,
  onSelect,
  onClose,
  colors,
}: {
  visible: boolean;
  title: string;
  selected: Date | null;
  onSelect: (d: Date) => void;
  onClose: () => void;
  colors: ReturnType<typeof useColors>;
}) {
  const now = new Date();
  const months: Date[] = [];
  for (let i = 0; i < 24; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push(d);
  }
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <TouchableOpacity
        style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.4)" }}
        activeOpacity={1}
        onPress={onClose}
      />
      <View
        style={[
          MP.sheet,
          { backgroundColor: colors.background, borderTopColor: colors.border },
        ]}
      >
        <View style={[MP.handle, { backgroundColor: colors.border }]} />
        <Text style={[MP.title, { color: colors.foreground }]}>{title}</Text>
        <ScrollView showsVerticalScrollIndicator={false} style={{ maxHeight: 280 }}>
          {months.map((d) => {
            const key = d.toISOString();
            const isSel =
              selected &&
              selected.getFullYear() === d.getFullYear() &&
              selected.getMonth() === d.getMonth();
            return (
              <TouchableOpacity
                key={key}
                style={[
                  MP.option,
                  { borderBottomColor: colors.border },
                  isSel && { backgroundColor: colors.primary + "14" },
                ]}
                onPress={() => {
                  onSelect(d);
                  onClose();
                }}
              >
                <Text
                  style={[
                    MP.optionTxt,
                    { color: isSel ? colors.primary : colors.foreground },
                  ]}
                >
                  {d.toLocaleDateString(undefined, {
                    month: "long",
                    year: "numeric",
                  })}
                </Text>
                {isSel && (
                  <Feather name="check" size={15} color={colors.primary} />
                )}
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      </View>
    </Modal>
  );
}

const MP = StyleSheet.create({
  sheet: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderTopWidth: 1,
    paddingBottom: 32,
  },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    alignSelf: "center",
    marginTop: 10,
    marginBottom: 6,
  },
  title: {
    fontSize: 15,
    fontWeight: "700",
    fontFamily: "Inter_700Bold",
    textAlign: "center",
    paddingVertical: 10,
  },
  option: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  optionTxt: { fontSize: 15, fontFamily: "Inter_400Regular" },
});

export default function HistoryTab() {
  const { isSignedIn, getToken } = useAuth();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const colors = useColors();
  const isWeb = Platform.OS === "web";
  const topPad = isWeb ? 67 : insets.top;

  const [search, setSearch] = useState("");
  const [fromDate, setFromDate] = useState<Date | null>(null);
  const [toDate, setToDate] = useState<Date | null>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [monthMode, setMonthMode] = useState<"from" | "to" | null>(null);
  const [pdfBusy, setPdfBusy] = useState(false);

  const params = new URLSearchParams();
  if (fromDate) params.set("from", fromDate.toISOString());
  if (toDate) {
    const end = new Date(toDate);
    end.setMonth(end.getMonth() + 1);
    params.set("to", end.toISOString());
  }
  const paramStr = params.toString();

  const {
    data: history = [],
    isLoading,
    isFetching,
    refetch,
  } = useQuery<HistoryEntry[]>({
    queryKey: ["charging-history", paramStr],
    queryFn: async () => {
      const token = await getToken();
      if (!token) {
        track("charging_history_tab_no_token", {});
        throw new Error("Session expired — please sign in again.");
      }
      const url = `${BASE}/api/charging-history${paramStr ? `?${paramStr}` : ""}`;
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("Failed to load history");
      return res.json();
    },
    enabled: isSignedIn === true,
  });

  const searchTrimmed = search.trim().toLowerCase();
  const filtered = searchTrimmed
    ? history.filter((e) => e.stationName.toLowerCase().includes(searchTrimmed))
    : history;

  const hasFilters = !!(fromDate || toDate || searchTrimmed);
  const activeFilterCount = [fromDate, toDate, searchTrimmed].filter(Boolean).length;

  const clearFilters = useCallback(() => {
    setFromDate(null);
    setToDate(null);
    setSearch("");
  }, []);

  function openSession(entry: HistoryEntry) {
    Haptics.selectionAsync();
    router.push({
      pathname: "/session-summary" as any,
      params: {
        sessionId: String(entry.id),
        ...(entry.stationId ? { stationId: String(entry.stationId) } : {}),
        stationName: entry.stationName,
        ...(entry.kwh != null ? { kwh: String(entry.kwh) } : {}),
        ...(entry.amountCents != null
          ? { totalCost: String((entry.amountCents / 100).toFixed(2)) }
          : {}),
        date: new Date(entry.chargedAt).toLocaleString([], {
          dateStyle: "medium",
          timeStyle: "short",
        }),
        ...(entry.chargerType ? { chargerType: entry.chargerType } : {}),
      },
    });
  }

  async function handleExportPDF() {
    if (history.length === 0) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setPdfBusy(true);
    try {
      const generatedDate = new Date().toLocaleDateString(undefined, {
        month: "long",
        day: "numeric",
        year: "numeric",
      });
      const totalKwh = history.reduce((s, h) => s + (h.kwh ?? 0), 0);
      const totalSpent = history.reduce((s, h) => s + (h.amountCents ?? 0), 0) / 100;

      const rows = history
        .map((e) => {
          const date = fmtDate(e.chargedAt);
          const kwh = e.kwh != null ? `${e.kwh.toFixed(2)} kWh` : "—";
          const amt = e.amountCents != null ? fmtCurrency(e.amountCents) : "—";
          const type = e.chargerType ?? "—";
          return `<tr>
            <td>${e.stationName}</td>
            <td style="color:#666">${e.stationAddress ?? "—"}</td>
            <td>${date}</td>
            <td>${type}</td>
            <td style="text-align:center">${kwh}</td>
            <td style="text-align:center;font-weight:600">${amt}</td>
          </tr>`;
        })
        .join("");

      const html = `<!DOCTYPE html><html><head><meta charset="utf-8"/>
<style>
* { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: -apple-system, Helvetica, Arial, sans-serif; color: #1a2530; padding: 40px; }
.header { display: flex; align-items: center; justify-content: space-between; padding-bottom: 24px; border-bottom: 2px solid #0D9E7E; margin-bottom: 28px; }
.brand-name { font-size: 22px; font-weight: 800; color: #0D9E7E; }
.brand-sub { font-size: 12px; color: #888; margin-top: 2px; }
.meta { text-align: right; font-size: 12px; color: #888; }
.summary { display: flex; gap: 16px; margin-bottom: 28px; }
.stat { flex: 1; background: #f7faf9; border-radius: 12px; padding: 16px; text-align: center; border: 1px solid #e2f0ec; }
.stat-val { font-size: 26px; font-weight: 800; color: #0D9E7E; }
.stat-lbl { font-size: 11px; color: #888; margin-top: 4px; text-transform: uppercase; }
h2 { font-size: 15px; font-weight: 700; margin-bottom: 12px; }
table { width: 100%; border-collapse: collapse; font-size: 12px; }
th { background: #0D9E7E; color: #fff; padding: 10px 12px; text-align: left; font-size: 11px; text-transform: uppercase; }
th:last-child, th:nth-last-child(2) { text-align: center; }
td { padding: 10px 12px; border-bottom: 1px solid #f0f0f0; }
tr:nth-child(even) td { background: #fafcfb; }
.footer { margin-top: 32px; text-align: center; font-size: 11px; color: #aaa; border-top: 1px solid #f0f0f0; padding-top: 16px; }
</style></head><body>
<div class="header">
  <div><div class="brand-name">ChargeBridge</div><div class="brand-sub">EV Charging History Report</div></div>
  <div class="meta">Generated ${generatedDate}</div>
</div>
<div class="summary">
  <div class="stat"><div class="stat-val">${history.length}</div><div class="stat-lbl">Sessions</div></div>
  <div class="stat"><div class="stat-val">${totalKwh > 0 ? totalKwh.toFixed(1) : "—"}</div><div class="stat-lbl">kWh Charged</div></div>
  <div class="stat"><div class="stat-val">${totalSpent > 0 ? "$" + totalSpent.toFixed(2) : "—"}</div><div class="stat-lbl">Total Spent</div></div>
</div>
<h2>Session Details</h2>
<table>
  <thead><tr><th>Station</th><th>Address</th><th>Date</th><th>Charger</th><th>kWh</th><th>Amount</th></tr></thead>
  <tbody>${rows}</tbody>
</table>
<div class="footer">ChargeBridge — Community EV Charging Network · chargebridge.app</div>
</body></html>`;

      const { uri } = await Print.printToFileAsync({ html, base64: false });
      const canShare = await Sharing.isAvailableAsync();
      if (canShare) {
        await Sharing.shareAsync(uri, {
          mimeType: "application/pdf",
          dialogTitle: "Share Charging History PDF",
          UTI: "com.adobe.pdf",
        });
      }
    } finally {
      setPdfBusy(false);
    }
  }

  if (!isSignedIn) {
    return (
      <View style={[S.root, { backgroundColor: colors.background }]}>
        <View style={[S.header, { paddingTop: topPad + 12, borderBottomColor: colors.border }]}>
          <Text style={[S.headerTitle, { color: colors.foreground }]}>Charging History</Text>
        </View>
        <View style={S.guestWrap}>
          <View style={[S.guestIcon, { backgroundColor: colors.primary + "18" }]}>
            <Ionicons name="flash" size={36} color={colors.primary} />
          </View>
          <Text style={[S.guestTitle, { color: colors.foreground }]}>
            Sign in to see your history
          </Text>
          <Text style={[S.guestBody, { color: colors.mutedForeground }]}>
            Your past charging sessions will appear here once you're signed in.
          </Text>
          <TouchableOpacity
            style={[S.signInBtn, { backgroundColor: colors.primary }]}
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
              router.push("/(auth)/sign-in");
            }}
            activeOpacity={0.85}
          >
            <Text style={S.signInBtnTxt}>Sign In</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <View style={[S.root, { backgroundColor: colors.background }]}>
      <MonthPickerModal
        visible={monthMode === "from"}
        title="From month"
        selected={fromDate}
        onSelect={setFromDate}
        onClose={() => setMonthMode(null)}
        colors={colors}
      />
      <MonthPickerModal
        visible={monthMode === "to"}
        title="To month"
        selected={toDate}
        onSelect={setToDate}
        onClose={() => setMonthMode(null)}
        colors={colors}
      />

      <View
        style={[S.header, { paddingTop: topPad + 12, borderBottomColor: colors.border }]}
      >
        <Text style={[S.headerTitle, { color: colors.foreground }]}>Charging History</Text>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          {history.length > 0 && (
            <TouchableOpacity
              style={[S.headerBtn, { backgroundColor: colors.primary + "14", borderColor: colors.primary + "40" }]}
              onPress={handleExportPDF}
              disabled={pdfBusy}
              activeOpacity={0.75}
            >
              {pdfBusy ? (
                <ActivityIndicator size="small" color={colors.primary} />
              ) : (
                <>
                  <Feather name="share" size={13} color={colors.primary} />
                  <Text style={[S.headerBtnTxt, { color: colors.primary }]}>PDF</Text>
                </>
              )}
            </TouchableOpacity>
          )}
          <TouchableOpacity
            style={[
              S.headerBtn,
              {
                borderColor: hasFilters ? colors.primary + "88" : colors.border,
                backgroundColor: hasFilters ? colors.primary + "12" : "transparent",
              },
            ]}
            onPress={() => {
              Haptics.selectionAsync();
              setFiltersOpen((v) => !v);
            }}
            activeOpacity={0.75}
          >
            <Feather
              name="sliders"
              size={14}
              color={hasFilters ? colors.primary : colors.mutedForeground}
            />
            {activeFilterCount > 0 && (
              <View style={[S.filterBadge, { backgroundColor: colors.primary }]}>
                <Text style={S.filterBadgeTxt}>{activeFilterCount}</Text>
              </View>
            )}
          </TouchableOpacity>
        </View>
      </View>

      {filtersOpen && (
        <View style={[S.filterBar, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View
            style={[
              S.searchRow,
              { backgroundColor: colors.muted + "55", borderColor: colors.border },
            ]}
          >
            <Feather name="search" size={14} color={colors.mutedForeground} />
            <TextInput
              style={[S.searchInput, { color: colors.foreground }]}
              value={search}
              onChangeText={setSearch}
              placeholder="Search by station name…"
              placeholderTextColor={colors.mutedForeground + "99"}
              returnKeyType="search"
              clearButtonMode="while-editing"
              autoCapitalize="none"
              autoCorrect={false}
            />
            {search.length > 0 && (
              <TouchableOpacity
                onPress={() => setSearch("")}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <Feather name="x" size={13} color={colors.mutedForeground} />
              </TouchableOpacity>
            )}
          </View>

          <View style={S.dateRow}>
            <TouchableOpacity
              style={[
                S.dateChip,
                {
                  borderColor: fromDate ? colors.primary + "88" : colors.border,
                  backgroundColor: fromDate ? colors.primary + "10" : colors.muted + "44",
                },
              ]}
              onPress={() => {
                Haptics.selectionAsync();
                setMonthMode("from");
              }}
              activeOpacity={0.8}
            >
              <Feather
                name="calendar"
                size={12}
                color={fromDate ? colors.primary : colors.mutedForeground}
              />
              <Text
                style={[S.dateChipTxt, { color: fromDate ? colors.primary : colors.mutedForeground }]}
              >
                {fromDate ? fmtDateShort(fromDate.toISOString()) : "From"}
              </Text>
              {fromDate && (
                <TouchableOpacity
                  onPress={() => setFromDate(null)}
                  hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                >
                  <Feather name="x" size={11} color={colors.primary} />
                </TouchableOpacity>
              )}
            </TouchableOpacity>

            <Feather name="arrow-right" size={13} color={colors.mutedForeground} />

            <TouchableOpacity
              style={[
                S.dateChip,
                {
                  borderColor: toDate ? colors.primary + "88" : colors.border,
                  backgroundColor: toDate ? colors.primary + "10" : colors.muted + "44",
                },
              ]}
              onPress={() => {
                Haptics.selectionAsync();
                setMonthMode("to");
              }}
              activeOpacity={0.8}
            >
              <Feather
                name="calendar"
                size={12}
                color={toDate ? colors.primary : colors.mutedForeground}
              />
              <Text
                style={[S.dateChipTxt, { color: toDate ? colors.primary : colors.mutedForeground }]}
              >
                {toDate ? fmtDateShort(toDate.toISOString()) : "To"}
              </Text>
              {toDate && (
                <TouchableOpacity
                  onPress={() => setToDate(null)}
                  hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                >
                  <Feather name="x" size={11} color={colors.primary} />
                </TouchableOpacity>
              )}
            </TouchableOpacity>

            {hasFilters && (
              <TouchableOpacity
                style={[S.clearBtn, { borderColor: colors.border }]}
                onPress={clearFilters}
                activeOpacity={0.75}
              >
                <Text style={[S.clearBtnTxt, { color: colors.mutedForeground }]}>Clear</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
      )}

      <FlatList
        data={filtered}
        keyExtractor={(item) => `${item.source ?? "e"}-${item.id}`}
        contentContainerStyle={[
          S.listContent,
          { paddingBottom: insets.bottom + 100 },
        ]}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={isFetching && !isLoading}
            onRefresh={refetch}
            tintColor={colors.primary}
          />
        }
        ListHeaderComponent={
          !isLoading && filtered.length > 0 ? (
            <SummaryBar entries={history} colors={colors} />
          ) : null
        }
        ListEmptyComponent={
          isLoading ? (
            <View style={S.centerBox}>
              <ActivityIndicator color={colors.primary} size="large" />
            </View>
          ) : (
            <View
              style={[S.emptyBox, { backgroundColor: colors.card, borderColor: colors.border }]}
            >
              <Ionicons
                name="flash-outline"
                size={36}
                color={colors.mutedForeground + "66"}
              />
              <Text style={[S.emptyTitle, { color: colors.foreground }]}>
                {hasFilters ? "No matching sessions" : "No sessions yet"}
              </Text>
              <Text style={[S.emptyBody, { color: colors.mutedForeground }]}>
                {hasFilters
                  ? "Try adjusting your filters."
                  : "Your charging sessions will appear here after your first charge."}
              </Text>
              {hasFilters && (
                <TouchableOpacity
                  style={[S.clearFiltersBtn, { borderColor: colors.border }]}
                  onPress={clearFilters}
                  activeOpacity={0.75}
                >
                  <Text style={[S.clearFiltersBtnTxt, { color: colors.primary }]}>
                    Clear filters
                  </Text>
                </TouchableOpacity>
              )}
            </View>
          )
        }
        renderItem={({ item }) => (
          <SessionCard entry={item} onPress={() => openSession(item)} colors={colors} />
        )}
      />
    </View>
  );
}

const S = StyleSheet.create({
  root: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerTitle: { fontSize: 22, fontWeight: "800", fontFamily: "Inter_700Bold" },
  headerBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 10,
    borderWidth: 1,
  },
  headerBtnTxt: { fontSize: 12, fontWeight: "700", fontFamily: "Inter_700Bold" },
  filterBadge: {
    width: 16,
    height: 16,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    marginLeft: 1,
  },
  filterBadgeTxt: { color: "#fff", fontSize: 9, fontWeight: "700" },

  filterBar: {
    marginHorizontal: 16,
    marginTop: 10,
    borderRadius: 14,
    borderWidth: 1,
    padding: 12,
    gap: 10,
    marginBottom: 4,
  },
  searchRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  searchInput: { flex: 1, fontSize: 14, fontFamily: "Inter_400Regular" },
  dateRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    flexWrap: "wrap",
  },
  dateChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 10,
    borderWidth: 1,
  },
  dateChipTxt: { fontSize: 12, fontFamily: "Inter_400Regular" },
  clearBtn: {
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 10,
    borderWidth: 1,
  },
  clearBtnTxt: { fontSize: 12, fontFamily: "Inter_400Regular" },

  listContent: { paddingTop: 14, paddingHorizontal: 16 },
  centerBox: { paddingTop: 60, alignItems: "center" },
  emptyBox: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 28,
    alignItems: "center",
    gap: 8,
    marginTop: 8,
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: "700",
    fontFamily: "Inter_700Bold",
    marginTop: 8,
  },
  emptyBody: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    textAlign: "center",
    lineHeight: 19,
  },
  clearFiltersBtn: {
    marginTop: 10,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1,
  },
  clearFiltersBtnTxt: { fontSize: 13, fontWeight: "600", fontFamily: "Inter_600SemiBold" },

  guestWrap: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 32,
    gap: 12,
  },
  guestIcon: {
    width: 72,
    height: 72,
    borderRadius: 36,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 4,
  },
  guestTitle: { fontSize: 20, fontWeight: "800", fontFamily: "Inter_700Bold", textAlign: "center" },
  guestBody: {
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    textAlign: "center",
    lineHeight: 20,
  },
  signInBtn: {
    marginTop: 12,
    paddingHorizontal: 32,
    paddingVertical: 14,
    borderRadius: 14,
  },
  signInBtnTxt: {
    color: "#fff",
    fontSize: 15,
    fontWeight: "700",
    fontFamily: "Inter_700Bold",
  },
});
