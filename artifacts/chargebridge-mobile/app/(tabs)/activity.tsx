import React, { useState, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  RefreshControl,
  ActivityIndicator,
  Share,
  Modal,
  TextInput,
  Platform,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather, Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@clerk/expo";
import { useColors } from "@/hooks/useColors";
import { WallpaperLayer } from "@/components/WallpaperPicker";
import { useFocusEffect, useRouter } from "expo-router";
import * as Haptics from "expo-haptics";
import { track } from "@/lib/analytics";

const BASE = `https://${process.env.EXPO_PUBLIC_DOMAIN}`;
const DEFAULT_EFFICIENCY_MI_PER_KWH = 3.5;
const DEFAULT_MPG = 28;
const DEFAULT_GAS_PRICE = 3.5;

interface OwnershipReport {
  period: "monthly" | "annual";
  label: string;
  sessionCount: number;
  totalKwh: number;
  totalCostCents: number;
  avgCostPerKwh: number | null;
  totalMinutesCharging: number;
  topStations: Array<{ name: string; sessions: number; kwh: number; address: string | null }>;
  chargerTypeBreakdown: { dcfc: number; level2: number; level1: number; unknown: number };
  monthlyBreakdown: Array<{ month: string; kwh: number; costCents: number; sessions: number }>;
  vehicle: { efficiencyMiPerKwh: number | null; mpg: number | null; make: string | null; model: string | null } | null;
}

function fmtCurrency(cents: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);
}

function fmtDuration(minutes: number): string {
  if (minutes <= 0) return "—";
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

function prevMonth(year: number, month: number) {
  if (month === 1) return { year: year - 1, month: 12 };
  return { year, month: month - 1 };
}

function nextMonth(year: number, month: number) {
  if (month === 12) return { year: year + 1, month: 1 };
  return { year, month: month + 1 };
}

const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function StatCard({
  icon,
  label,
  value,
  sub,
  tint,
  colors,
}: {
  icon: string;
  label: string;
  value: string;
  sub?: string;
  tint: string;
  colors: ReturnType<typeof useColors>;
}) {
  return (
    <View style={[C.statCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <View style={[C.statIconWrap, { backgroundColor: tint + "18" }]}>
        <Feather name={icon as any} size={16} color={tint} />
      </View>
      <Text style={[C.statVal, { color: colors.foreground }]} numberOfLines={1} adjustsFontSizeToFit>
        {value}
      </Text>
      <Text style={[C.statLbl, { color: colors.mutedForeground }]}>{label}</Text>
      {!!sub && <Text style={[C.statSub, { color: colors.mutedForeground }]}>{sub}</Text>}
    </View>
  );
}

function SectionHeader({ title, colors }: { title: string; colors: ReturnType<typeof useColors> }) {
  return (
    <View style={C.sectionHeader}>
      <Text style={[C.sectionTitle, { color: colors.mutedForeground }]}>{title}</Text>
      <View style={[C.sectionLine, { backgroundColor: colors.border }]} />
    </View>
  );
}

function MonthBar({
  item,
  maxKwh,
  colors,
}: {
  item: { month: string; kwh: number; costCents: number; sessions: number };
  maxKwh: number;
  colors: ReturnType<typeof useColors>;
}) {
  const pct = maxKwh > 0 ? item.kwh / maxKwh : 0;
  return (
    <View style={C.barRow}>
      <Text style={[C.barMonth, { color: colors.mutedForeground }]}>{item.month}</Text>
      <View style={[C.barTrack, { backgroundColor: colors.muted }]}>
        <View
          style={[
            C.barFill,
            {
              width: `${Math.round(pct * 100)}%`,
              backgroundColor: item.sessions > 0 ? "#0D9E7E" : colors.muted,
            },
          ]}
        />
      </View>
      <Text style={[C.barVal, { color: item.sessions > 0 ? colors.foreground : colors.mutedForeground }]}>
        {item.kwh > 0 ? `${item.kwh.toFixed(1)}` : "—"}
      </Text>
    </View>
  );
}

export default function ActivityScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { getToken, isSignedIn } = useAuth();
  useFocusEffect(useCallback(() => { track("screen_viewed", { screen_name: "activity" }); }, []));

  const now = new Date();
  const [period, setPeriod] = useState<"monthly" | "annual">("monthly");
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);

  const [showSettings, setShowSettings] = useState(false);
  const [gasPriceInput, setGasPriceInput] = useState("3.50");
  const [mpgInput, setMpgInput] = useState("28");
  const [savedGasPrice, setSavedGasPrice] = useState(DEFAULT_GAS_PRICE);
  const [savedMpg, setSavedMpg] = useState(DEFAULT_MPG);

  const queryKey = period === "monthly"
    ? ["ownership-report", period, year, month]
    : ["ownership-report", period, year];

  const { data, isLoading, isError, refetch, isFetching } = useQuery<OwnershipReport>({
    queryKey,
    queryFn: async () => {
      const token = await getToken();
      if (!token) throw new Error("Session expired — please sign in again.");
      const params = period === "monthly"
        ? `period=monthly&year=${year}&month=${month}`
        : `period=annual&year=${year}`;
      const res = await fetch(`${BASE}/api/me/ownership-report?${params}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("Failed to fetch report");
      return res.json() as Promise<OwnershipReport>;
    },
    staleTime: 5 * 60 * 1000,
    enabled: isSignedIn === true,
  });

  const efficiencyMiPerKwh =
    data?.vehicle?.efficiencyMiPerKwh ?? DEFAULT_EFFICIENCY_MI_PER_KWH;
  const estimatedMiles = (data?.totalKwh ?? 0) * efficiencyMiPerKwh;
  const mpg = savedMpg;
  const gasGallons = estimatedMiles / mpg;
  const gasCostEquivalent = gasGallons * savedGasPrice;
  const savings = gasCostEquivalent - (data?.totalCostCents ?? 0) / 100;

  const handleNavBack = useCallback(() => {
    if (period === "monthly") {
      const prev = prevMonth(year, month);
      setYear(prev.year);
      setMonth(prev.month);
    } else {
      setYear((y) => y - 1);
    }
  }, [period, year, month]);

  const handleNavForward = useCallback(() => {
    const nowYear = now.getFullYear();
    const nowMonth = now.getMonth() + 1;
    if (period === "monthly") {
      if (year > nowYear || (year === nowYear && month >= nowMonth)) return;
      const next = nextMonth(year, month);
      setYear(next.year);
      setMonth(next.month);
    } else {
      if (year >= nowYear) return;
      setYear((y) => y + 1);
    }
  }, [period, year, month, now]);

  const isAtPresent =
    period === "monthly"
      ? year === now.getFullYear() && month === now.getMonth() + 1
      : year >= now.getFullYear();

  const handleShare = useCallback(async () => {
    if (!data) return;
    const label = data.label;
    const kWh = data.totalKwh.toFixed(1);
    const cost = fmtCurrency(data.totalCostCents);
    const miles = estimatedMiles.toFixed(0);
    const savingsStr = savings > 0 ? `$${savings.toFixed(2)}` : "$0.00";
    const avgStr = data.avgCostPerKwh !== null ? `$${data.avgCostPerKwh.toFixed(3)}/kWh` : "N/A";

    const msg =
      `⚡ My ChargeBridge EV Report — ${label}\n\n` +
      `🔋 ${kWh} kWh charged across ${data.sessionCount} session${data.sessionCount !== 1 ? "s" : ""}\n` +
      `💰 ${cost} total · ${avgStr} avg\n` +
      `🚗 ~${miles} miles estimated\n` +
      `💚 ~${savingsStr} saved vs. gasoline\n` +
      (data.totalMinutesCharging > 0 ? `⏱ ${fmtDuration(data.totalMinutesCharging)} charging time\n` : "") +
      `\nTracked with ChargeBridge.`;

    await Share.share({ message: msg, title: `EV Report — ${label}` });
  }, [data, estimatedMiles, savings]);

  const periodLabel = period === "monthly"
    ? `${MONTH_NAMES[month - 1]} ${year}`
    : String(year);

  const maxKwh = data
    ? Math.max(...data.monthlyBreakdown.map((m) => m.kwh), 0.1)
    : 1;

  const totalBreakdownSessions =
    (data?.chargerTypeBreakdown.dcfc ?? 0) +
    (data?.chargerTypeBreakdown.level2 ?? 0) +
    (data?.chargerTypeBreakdown.level1 ?? 0) +
    (data?.chargerTypeBreakdown.unknown ?? 0);

  const chargerTypes = [
    { label: "DC Fast", key: "dcfc" as const, color: "#0D9E7E", icon: "⚡" },
    { label: "Level 2", key: "level2" as const, color: "#3b82f6", icon: "🔌" },
    { label: "Level 1", key: "level1" as const, color: "#8b5cf6", icon: "🔋" },
    { label: "Other", key: "unknown" as const, color: "#6b7280", icon: "📍" },
  ].filter((t) => (data?.chargerTypeBreakdown[t.key] ?? 0) > 0);

  const router = useRouter();

  if (!isSignedIn) {
    return (
      <View style={[C.root, { backgroundColor: colors.background }]}>
        <WallpaperLayer tab="activity" />
        <LinearGradient
          colors={[colors.primary + "14", "transparent"]}
          style={[C.gradient, { height: insets.top + 160 }]}
          pointerEvents="none"
        />
        <View style={[C.header, { paddingTop: insets.top + 12 }]}>
          <View>
            <Text style={[C.headerTitle, { color: colors.foreground }]}>EV Report</Text>
            <Text style={[C.headerSub, { color: colors.mutedForeground }]}>Your charging story</Text>
          </View>
        </View>
        <View style={C.guestWrap}>
          <View style={[C.guestIcon, { backgroundColor: colors.primary + "18" }]}>
            <Ionicons name="flash" size={36} color={colors.primary} />
          </View>
          <Text style={[C.guestTitle, { color: colors.foreground }]}>
            Sign in to view your EV report
          </Text>
          <Text style={[C.guestBody, { color: colors.mutedForeground }]}>
            Track kWh charged, spending, and estimated savings vs. gasoline across all your sessions.
          </Text>
          <TouchableOpacity
            style={[C.guestBtn, { backgroundColor: colors.primary }]}
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
              router.push("/(auth)/sign-in");
            }}
            activeOpacity={0.85}
          >
            <Text style={C.guestBtnTxt}>Sign In</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <View style={[C.root, { backgroundColor: colors.background }]}>
      <WallpaperLayer tab="activity" />
      <LinearGradient
        colors={[colors.primary + "14", "transparent"]}
        style={[C.gradient, { height: insets.top + 160 }]}
        pointerEvents="none"
      />

      {/* Header */}
      <View style={[C.header, { paddingTop: insets.top + 12 }]}>
        <View>
          <Text style={[C.headerTitle, { color: colors.foreground }]}>EV Report</Text>
          <Text style={[C.headerSub, { color: colors.mutedForeground }]}>Your charging story</Text>
        </View>
        <View style={C.headerActions}>
          <TouchableOpacity
            style={[C.headerBtn, { backgroundColor: colors.card, borderColor: colors.border }]}
            onPress={handleShare}
            disabled={!data || data.sessionCount === 0}
            activeOpacity={0.7}
          >
            <Feather name="share-2" size={16} color={colors.foreground} />
          </TouchableOpacity>
          <TouchableOpacity
            style={[C.headerBtn, { backgroundColor: colors.card, borderColor: colors.border }]}
            onPress={() => {
              setGasPriceInput(savedGasPrice.toFixed(2));
              setMpgInput(String(savedMpg));
              setShowSettings(true);
            }}
            activeOpacity={0.7}
          >
            <Feather name="sliders" size={16} color={colors.foreground} />
          </TouchableOpacity>
        </View>
      </View>

      {/* Period selector */}
      <View style={[C.periodRow, { borderColor: colors.border }]}>
        <View style={[C.segmented, { backgroundColor: colors.muted, borderColor: colors.border }]}>
          {(["monthly", "annual"] as const).map((p) => (
            <TouchableOpacity
              key={p}
              style={[C.segment, period === p && { backgroundColor: colors.card, borderColor: colors.border }]}
              onPress={() => setPeriod(p)}
              activeOpacity={0.8}
            >
              <Text style={[C.segmentTxt, { color: period === p ? colors.foreground : colors.mutedForeground }]}>
                {p === "monthly" ? "Monthly" : "Annual"}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
        <View style={C.navRow}>
          <TouchableOpacity style={C.navBtn} onPress={handleNavBack} activeOpacity={0.7}>
            <Feather name="chevron-left" size={20} color={colors.mutedForeground} />
          </TouchableOpacity>
          <Text style={[C.navLabel, { color: colors.foreground }]}>{periodLabel}</Text>
          <TouchableOpacity
            style={[C.navBtn, isAtPresent && { opacity: 0.3 }]}
            onPress={handleNavForward}
            disabled={isAtPresent}
            activeOpacity={0.7}
          >
            <Feather name="chevron-right" size={20} color={colors.mutedForeground} />
          </TouchableOpacity>
        </View>
      </View>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={[C.scroll, { paddingBottom: insets.bottom + 100 }]}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={isFetching && !isLoading} onRefresh={refetch} tintColor={colors.primary} />
        }
      >
        {isLoading ? (
          <View style={C.loadingWrap}>
            <ActivityIndicator size="large" color={colors.primary} />
            <Text style={[C.loadingTxt, { color: colors.mutedForeground }]}>Loading report…</Text>
          </View>
        ) : isError ? (
          <View style={C.emptyWrap}>
            <Feather name="wifi-off" size={36} color={colors.mutedForeground} />
            <Text style={[C.emptyTxt, { color: colors.mutedForeground }]}>
              Couldn't load your report. Pull to retry.
            </Text>
          </View>
        ) : !data || data.sessionCount === 0 ? (
          <View style={C.emptyWrap}>
            <Feather name="battery" size={36} color={colors.mutedForeground} />
            <Text style={[C.emptyTxt, { color: colors.mutedForeground }]}>
              No charging sessions in {periodLabel}.
            </Text>
            <Text style={[C.emptySubTxt, { color: colors.mutedForeground }]}>
              Start a session via the Charge tab and it'll appear here.
            </Text>
          </View>
        ) : (
          <>
            {/* Key stats grid */}
            <View style={C.statsGrid}>
              <StatCard
                icon="zap"
                label="Sessions"
                value={String(data.sessionCount)}
                tint="#0D9E7E"
                colors={colors}
              />
              <StatCard
                icon="battery-charging"
                label="kWh Charged"
                value={`${data.totalKwh.toFixed(1)}`}
                sub="kilowatt-hours"
                tint="#3b82f6"
                colors={colors}
              />
              <StatCard
                icon="dollar-sign"
                label="Total Spent"
                value={fmtCurrency(data.totalCostCents)}
                tint="#f59e0b"
                colors={colors}
              />
              <StatCard
                icon="clock"
                label="Time Charging"
                value={data.totalMinutesCharging > 0 ? fmtDuration(data.totalMinutesCharging) : "—"}
                tint="#8b5cf6"
                colors={colors}
              />
            </View>

            {/* Avg cost per kWh — wide single card */}
            {data.avgCostPerKwh !== null && (
              <View style={[C.wideCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <View style={[C.wideIconWrap, { backgroundColor: "#f59e0b18" }]}>
                  <Feather name="trending-down" size={18} color="#f59e0b" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[C.wideLbl, { color: colors.mutedForeground }]}>Average cost per kWh</Text>
                  <Text style={[C.wideVal, { color: colors.foreground }]}>
                    ${data.avgCostPerKwh.toFixed(3)}
                    <Text style={[C.wideUnit, { color: colors.mutedForeground }]}> / kWh</Text>
                  </Text>
                </View>
              </View>
            )}

            {/* Estimated impact */}
            <SectionHeader title="ESTIMATED IMPACT" colors={colors} />
            <View style={C.impactRow}>
              <View style={[C.impactCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <Text style={C.impactEmoji}>🚗</Text>
                <Text style={[C.impactVal, { color: colors.foreground }]}>
                  {estimatedMiles.toFixed(0)}
                  <Text style={[C.impactUnit, { color: colors.mutedForeground }]}> mi</Text>
                </Text>
                <Text style={[C.impactLbl, { color: colors.mutedForeground }]}>Miles estimated</Text>
                <Text style={[C.impactNote, { color: colors.mutedForeground }]}>
                  {data.vehicle?.efficiencyMiPerKwh
                    ? `${data.vehicle.make ?? "Vehicle"} · ${efficiencyMiPerKwh} mi/kWh`
                    : `${efficiencyMiPerKwh} mi/kWh avg`}
                </Text>
              </View>
              <View style={[C.impactCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <Text style={C.impactEmoji}>{savings >= 0 ? "💚" : "💸"}</Text>
                <Text
                  style={[
                    C.impactVal,
                    { color: savings >= 0 ? "#22c55e" : "#ef4444" },
                  ]}
                >
                  {savings >= 0 ? "+" : "−"}${Math.abs(savings).toFixed(2)}
                </Text>
                <Text style={[C.impactLbl, { color: colors.mutedForeground }]}>
                  {savings >= 0 ? "Saved vs. gas" : "More than gas"}
                </Text>
                <Text style={[C.impactNote, { color: colors.mutedForeground }]}>
                  {savedMpg} MPG · ${savedGasPrice.toFixed(2)}/gal
                </Text>
              </View>
            </View>

            {/* Top locations */}
            {data.topStations.length > 0 && (
              <>
                <SectionHeader title="TOP LOCATIONS" colors={colors} />
                <View style={[C.listCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                  {data.topStations.map((station, idx) => (
                    <View
                      key={idx}
                      style={[
                        C.listRow,
                        idx < data.topStations.length - 1 && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
                      ]}
                    >
                      <View style={[C.listRank, { backgroundColor: colors.primary + "18" }]}>
                        <Text style={[C.listRankTxt, { color: colors.primary }]}>{idx + 1}</Text>
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={[C.listName, { color: colors.foreground }]} numberOfLines={1}>
                          {station.name}
                        </Text>
                        {!!station.address && (
                          <Text style={[C.listAddr, { color: colors.mutedForeground }]} numberOfLines={1}>
                            {station.address}
                          </Text>
                        )}
                      </View>
                      <View style={C.listMeta}>
                        <Text style={[C.listMetaTop, { color: colors.foreground }]}>
                          {station.sessions}×
                        </Text>
                        <Text style={[C.listMetaSub, { color: colors.mutedForeground }]}>
                          {station.kwh.toFixed(1)} kWh
                        </Text>
                      </View>
                    </View>
                  ))}
                </View>
              </>
            )}

            {/* Charger type breakdown */}
            {totalBreakdownSessions > 0 && chargerTypes.length > 0 && (
              <>
                <SectionHeader title="CHARGER TYPES" colors={colors} />
                <View style={[C.listCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                  {chargerTypes.map((t, idx) => {
                    const count = data.chargerTypeBreakdown[t.key];
                    const pct = totalBreakdownSessions > 0 ? count / totalBreakdownSessions : 0;
                    return (
                      <View
                        key={t.key}
                        style={[
                          C.typeRow,
                          idx < chargerTypes.length - 1 && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
                        ]}
                      >
                        <Text style={C.typeEmoji}>{t.icon}</Text>
                        <View style={{ flex: 1, gap: 4 }}>
                          <View style={C.typeTopRow}>
                            <Text style={[C.typeName, { color: colors.foreground }]}>{t.label}</Text>
                            <Text style={[C.typeCount, { color: colors.mutedForeground }]}>
                              {count} session{count !== 1 ? "s" : ""}
                            </Text>
                          </View>
                          <View style={[C.typeTrack, { backgroundColor: colors.muted }]}>
                            <View
                              style={[C.typeFill, { width: `${Math.round(pct * 100)}%`, backgroundColor: t.color }]}
                            />
                          </View>
                        </View>
                        <Text style={[C.typePct, { color: colors.mutedForeground }]}>
                          {Math.round(pct * 100)}%
                        </Text>
                      </View>
                    );
                  })}
                </View>
              </>
            )}

            {/* Monthly breakdown (annual only) */}
            {period === "annual" && (
              <>
                <SectionHeader title="MONTHLY kWh" colors={colors} />
                <View style={[C.listCard, { backgroundColor: colors.card, borderColor: colors.border, padding: 16, gap: 10 }]}>
                  {data.monthlyBreakdown.map((item, idx) => (
                    <MonthBar key={idx} item={item} maxKwh={maxKwh} colors={colors} />
                  ))}
                  <Text style={[C.barLegend, { color: colors.mutedForeground }]}>kWh per month</Text>
                </View>
              </>
            )}
          </>
        )}
      </ScrollView>

      {/* Gas comparison settings modal */}
      <Modal
        visible={showSettings}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setShowSettings(false)}
      >
        <View style={[C.modalRoot, { backgroundColor: colors.background }]}>
          <View style={[C.modalHeader, { borderBottomColor: colors.border }]}>
            <Text style={[C.modalTitle, { color: colors.foreground }]}>Gas Comparison</Text>
            <TouchableOpacity onPress={() => setShowSettings(false)} style={C.modalClose}>
              <Feather name="x" size={20} color={colors.foreground} />
            </TouchableOpacity>
          </View>
          <ScrollView contentContainerStyle={C.modalScroll}>
            <Text style={[C.modalBody, { color: colors.mutedForeground }]}>
              Customize how ChargeBridge estimates your gasoline savings.
            </Text>

            <View style={C.fieldGroup}>
              <Text style={[C.fieldLabel, { color: colors.foreground }]}>Local gas price ($/gallon)</Text>
              <View style={[C.fieldInput, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <Text style={[C.fieldPrefix, { color: colors.mutedForeground }]}>$</Text>
                <TextInput
                  value={gasPriceInput}
                  onChangeText={setGasPriceInput}
                  keyboardType="decimal-pad"
                  style={[C.fieldText, { color: colors.foreground }]}
                  placeholderTextColor={colors.mutedForeground}
                  placeholder="3.50"
                />
                <Text style={[C.fieldSuffix, { color: colors.mutedForeground }]}>/gal</Text>
              </View>
              <Text style={[C.fieldHint, { color: colors.mutedForeground }]}>
                US average is ~$3.50. Check GasBuddy for local prices.
              </Text>
            </View>

            <View style={C.fieldGroup}>
              <Text style={[C.fieldLabel, { color: colors.foreground }]}>Your gas car's MPG</Text>
              <View style={[C.fieldInput, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <TextInput
                  value={mpgInput}
                  onChangeText={setMpgInput}
                  keyboardType="decimal-pad"
                  style={[C.fieldText, { color: colors.foreground }]}
                  placeholderTextColor={colors.mutedForeground}
                  placeholder="28"
                />
                <Text style={[C.fieldSuffix, { color: colors.mutedForeground }]}>MPG</Text>
              </View>
              <Text style={[C.fieldHint, { color: colors.mutedForeground }]}>
                US average is 28 MPG. Use your previous gas car or comparable model.
              </Text>
            </View>

            {data?.vehicle?.make && (
              <View style={[C.vehicleNote, { backgroundColor: colors.primary + "12", borderColor: colors.primary + "30" }]}>
                <Ionicons name="car-sport-outline" size={16} color={colors.primary} />
                <Text style={[C.vehicleNoteTxt, { color: colors.mutedForeground }]}>
                  Your {data.vehicle.make} {data.vehicle.model ?? ""} gets{" "}
                  {efficiencyMiPerKwh} mi/kWh — used for the miles estimate above.
                </Text>
              </View>
            )}

            <TouchableOpacity
              style={[C.saveBtn, { backgroundColor: colors.primary }]}
              onPress={() => {
                const price = parseFloat(gasPriceInput);
                const mpg = parseFloat(mpgInput);
                if (!isNaN(price) && price > 0) setSavedGasPrice(price);
                if (!isNaN(mpg) && mpg > 0) setSavedMpg(mpg);
                setShowSettings(false);
              }}
              activeOpacity={0.8}
            >
              <Text style={C.saveBtnTxt}>Save Comparison</Text>
            </TouchableOpacity>
          </ScrollView>
        </View>
      </Modal>
    </View>
  );
}

const C = StyleSheet.create({
  root: { flex: 1 },
  gradient: { position: "absolute", top: 0, left: 0, right: 0 },

  header: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingBottom: 16,
  },
  headerTitle: {
    fontSize: 28,
    fontWeight: "800",
    fontFamily: "Inter_700Bold",
    letterSpacing: -0.5,
  },
  headerSub: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    marginTop: 2,
  },
  headerActions: { flexDirection: "row", gap: 8, marginTop: 4 },
  headerBtn: {
    width: 38,
    height: 38,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },

  periodRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingBottom: 12,
    gap: 12,
  },
  segmented: {
    flexDirection: "row",
    borderRadius: 10,
    borderWidth: 1,
    padding: 2,
    gap: 2,
  },
  segment: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "transparent",
  },
  segmentTxt: {
    fontSize: 13,
    fontWeight: "600",
    fontFamily: "Inter_600SemiBold",
  },
  navRow: { flexDirection: "row", alignItems: "center", gap: 4 },
  navBtn: { padding: 4 },
  navLabel: {
    fontSize: 14,
    fontWeight: "600",
    fontFamily: "Inter_600SemiBold",
    minWidth: 90,
    textAlign: "center",
  },

  scroll: { paddingHorizontal: 16, paddingTop: 4, gap: 12 },

  loadingWrap: { paddingTop: 80, alignItems: "center", gap: 16 },
  loadingTxt: { fontSize: 14, fontFamily: "Inter_400Regular" },
  emptyWrap: { paddingTop: 60, alignItems: "center", gap: 12, paddingHorizontal: 24 },
  emptyTxt: { fontSize: 15, fontFamily: "Inter_500Medium", textAlign: "center", lineHeight: 22 },
  emptySubTxt: { fontSize: 13, fontFamily: "Inter_400Regular", textAlign: "center", lineHeight: 19 },

  guestWrap: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 32, gap: 12 },
  guestIcon: { width: 72, height: 72, borderRadius: 36, alignItems: "center", justifyContent: "center", marginBottom: 4 },
  guestTitle: { fontSize: 20, fontWeight: "700", fontFamily: "Inter_700Bold", textAlign: "center" },
  guestBody: { fontSize: 14, fontFamily: "Inter_400Regular", textAlign: "center", lineHeight: 21 },
  guestBtn: {
    marginTop: 8,
    paddingHorizontal: 32,
    paddingVertical: 14,
    borderRadius: 14,
    alignItems: "center",
    minWidth: 160,
  },
  guestBtnTxt: { color: "#fff", fontSize: 15, fontWeight: "700", fontFamily: "Inter_700Bold" },

  statsGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  statCard: {
    width: "47.5%",
    borderRadius: 14,
    borderWidth: 1,
    padding: 14,
    gap: 6,
  },
  statIconWrap: {
    width: 32,
    height: 32,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 2,
  },
  statVal: {
    fontSize: 22,
    fontWeight: "800",
    fontFamily: "Inter_700Bold",
    letterSpacing: -0.5,
  },
  statLbl: {
    fontSize: 12,
    fontWeight: "600",
    fontFamily: "Inter_600SemiBold",
  },
  statSub: {
    fontSize: 10,
    fontFamily: "Inter_400Regular",
    marginTop: -2,
  },

  wideCard: {
    borderRadius: 14,
    borderWidth: 1,
    padding: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  wideIconWrap: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  wideLbl: { fontSize: 12, fontWeight: "500", fontFamily: "Inter_500Medium" },
  wideVal: { fontSize: 20, fontWeight: "700", fontFamily: "Inter_700Bold", letterSpacing: -0.3 },
  wideUnit: { fontSize: 14, fontWeight: "400", fontFamily: "Inter_400Regular" },

  sectionHeader: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 4 },
  sectionTitle: {
    fontSize: 11,
    fontWeight: "600",
    fontFamily: "Inter_600SemiBold",
    letterSpacing: 0.8,
    flexShrink: 0,
  },
  sectionLine: { flex: 1, height: StyleSheet.hairlineWidth },

  impactRow: { flexDirection: "row", gap: 10 },
  impactCard: {
    flex: 1,
    borderRadius: 14,
    borderWidth: 1,
    padding: 14,
    gap: 4,
    alignItems: "flex-start",
  },
  impactEmoji: { fontSize: 22, marginBottom: 4 },
  impactVal: { fontSize: 22, fontWeight: "800", fontFamily: "Inter_700Bold", letterSpacing: -0.5 },
  impactUnit: { fontSize: 15, fontWeight: "400", fontFamily: "Inter_400Regular" },
  impactLbl: { fontSize: 12, fontWeight: "600", fontFamily: "Inter_600SemiBold" },
  impactNote: { fontSize: 10, fontFamily: "Inter_400Regular", marginTop: 2 },

  listCard: { borderRadius: 14, borderWidth: 1, overflow: "hidden" },
  listRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 10,
  },
  listRank: {
    width: 26,
    height: 26,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  listRankTxt: { fontSize: 12, fontWeight: "700", fontFamily: "Inter_700Bold" },
  listName: { fontSize: 14, fontWeight: "600", fontFamily: "Inter_600SemiBold" },
  listAddr: { fontSize: 11, fontFamily: "Inter_400Regular", marginTop: 1 },
  listMeta: { alignItems: "flex-end" },
  listMetaTop: { fontSize: 14, fontWeight: "700", fontFamily: "Inter_700Bold" },
  listMetaSub: { fontSize: 11, fontFamily: "Inter_400Regular" },

  typeRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 10,
  },
  typeEmoji: { fontSize: 18, width: 26, textAlign: "center" },
  typeTopRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  typeName: { fontSize: 13, fontWeight: "600", fontFamily: "Inter_600SemiBold" },
  typeCount: { fontSize: 12, fontFamily: "Inter_400Regular" },
  typeTrack: { height: 6, borderRadius: 3, overflow: "hidden" },
  typeFill: { height: 6, borderRadius: 3 },
  typePct: { fontSize: 12, fontWeight: "600", fontFamily: "Inter_600SemiBold", width: 36, textAlign: "right" },

  barRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  barMonth: { width: 28, fontSize: 11, fontFamily: "Inter_500Medium", fontWeight: "500" },
  barTrack: { flex: 1, height: 10, borderRadius: 5, overflow: "hidden" },
  barFill: { height: 10, borderRadius: 5 },
  barVal: { width: 40, fontSize: 11, fontFamily: "Inter_500Medium", textAlign: "right" },
  barLegend: { fontSize: 10, fontFamily: "Inter_400Regular", textAlign: "right", marginTop: 4 },

  modalRoot: { flex: 1 },
  modalHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingTop: Platform.OS === "ios" ? 20 : 16,
    paddingBottom: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  modalTitle: { fontSize: 18, fontWeight: "700", fontFamily: "Inter_700Bold" },
  modalClose: { padding: 4 },
  modalScroll: { padding: 20, gap: 20 },
  modalBody: { fontSize: 14, fontFamily: "Inter_400Regular", lineHeight: 20 },

  fieldGroup: { gap: 8 },
  fieldLabel: { fontSize: 14, fontWeight: "600", fontFamily: "Inter_600SemiBold" },
  fieldInput: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 4,
  },
  fieldPrefix: { fontSize: 15, fontFamily: "Inter_400Regular" },
  fieldText: { flex: 1, fontSize: 15, fontFamily: "Inter_400Regular" },
  fieldSuffix: { fontSize: 13, fontFamily: "Inter_400Regular" },
  fieldHint: { fontSize: 12, fontFamily: "Inter_400Regular", lineHeight: 17 },

  vehicleNote: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    borderRadius: 12,
    borderWidth: 1,
    padding: 12,
  },
  vehicleNoteTxt: { flex: 1, fontSize: 13, fontFamily: "Inter_400Regular", lineHeight: 18 },

  saveBtn: {
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: "center",
    marginTop: 8,
  },
  saveBtnTxt: {
    fontSize: 15,
    fontWeight: "700",
    fontFamily: "Inter_700Bold",
    color: "#fff",
  },
});
