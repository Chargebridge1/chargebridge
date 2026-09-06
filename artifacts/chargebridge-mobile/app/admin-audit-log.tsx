import { useAuth } from "@clerk/expo";
import { useRouter } from "expo-router";
import React, { useEffect, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  Pressable,
  ActivityIndicator,
  RefreshControl,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQuery } from "@tanstack/react-query";

const BASE = `https://${process.env.EXPO_PUBLIC_DOMAIN}`;

type UserRole = "admin" | "client";

function useRole() {
  const { sessionClaims } = useAuth();
  const role = (sessionClaims?.publicMetadata as { role?: UserRole } | undefined)?.role ?? "client";
  return { isAdmin: role === "admin" };
}

type AuditEvent = {
  id: number;
  adminClerkId: string;
  adminName: string | null;
  adminEmail: string | null;
  action: string;
  targetType: string | null;
  targetId: number | null;
  targetName: string | null;
  details: string | null;
  createdAt: string;
};

function useAuditEvents() {
  const { getToken } = useAuth();
  return useQuery<{ events: AuditEvent[]; total: number }>({
    queryKey: ["admin-audit-events"],
    queryFn: async () => {
      const token = await getToken();
      const res = await fetch(`${BASE}/api/admin/events?limit=100`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("Failed to fetch audit log");
      return res.json();
    },
    staleTime: 60_000,
    gcTime: 300_000,
  });
}

const ACTION_META: Record<string, { label: string; color: string; bg: string }> = {
  hard_delete_station: { label: "Hard Deleted",     color: "#B91C1C", bg: "#FEE2E2" },
  promote_admin:       { label: "Promoted Admin",   color: "#6D28D9", bg: "#EDE9FE" },
  revoke_admin:        { label: "Admin Revoked",    color: "#B45309", bg: "#FEF3C7" },
  grant_reviewer:      { label: "Reviewer Granted", color: "#0D766B", bg: "#CCFBF1" },
  revoke_reviewer:     { label: "Reviewer Revoked", color: "#9D3414", bg: "#FFEDD5" },
};

function fmtDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) +
    " · " + d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

type ParsedDetails = Record<string, unknown> | null;

function parseDetails(raw: string | null): ParsedDetails {
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

function DetailRow({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <View style={styles.detailRow}>
      <Text style={styles.detailLabel}>{label}</Text>
      <Text style={[styles.detailValue, mono && styles.detailMono]}>{value}</Text>
    </View>
  );
}

function EventCard({ event }: { event: AuditEvent }) {
  const [expanded, setExpanded] = useState(false);
  const meta = ACTION_META[event.action] ?? { label: event.action, color: "#6B6B6B", bg: "#F3F4F6" };
  const details = parseDetails(event.details);
  const isStation = event.targetType === "station";
  const adminLabel = event.adminName ?? event.adminEmail ?? (event.adminClerkId.slice(0, 12) + "…");

  const fullAddress = isStation && details
    ? [details.address, details.city, details.state].filter(Boolean).join(", ")
    : null;

  const hasDetails = !!(
    fullAddress ||
    (isStation && details && typeof details.status === "string") ||
    (isStation && details && (typeof details.ownerClerkUserId === "string" || typeof details.ownerClerkId === "string")) ||
    (isStation && details && typeof details.createdAt === "string") ||
    (!isStation && details && typeof details.email === "string") ||
    (!isStation && details && typeof details.role === "string") ||
    (!isStation && details && typeof details.targetClerkId === "string")
  );

  return (
    <Pressable
      style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
      onPress={() => hasDetails && setExpanded((e) => !e)}
      accessibilityRole="button"
      accessibilityLabel={`${meta.label} event for ${event.targetName ?? "unknown"}`}
    >
      {/* ── Row header ── */}
      <View style={styles.cardHeader}>
        <View style={{ flex: 1, gap: 3 }}>
          <Text style={styles.targetName} numberOfLines={1}>
            {event.targetName ?? (event.targetId != null ? `#${event.targetId}` : "—")}
          </Text>
          {fullAddress ? (
            <Text style={styles.addressText} numberOfLines={1}>{fullAddress}</Text>
          ) : !isStation && details && typeof details.email === "string" ? (
            <Text style={styles.addressText} numberOfLines={1}>{String(details.email)}</Text>
          ) : null}
          <Text style={styles.dateText}>{fmtDate(event.createdAt)}</Text>
        </View>
        <View style={{ alignItems: "flex-end", gap: 6 }}>
          <View style={[styles.actionBadge, { backgroundColor: meta.bg }]}>
            <Text style={[styles.actionBadgeText, { color: meta.color }]}>{meta.label}</Text>
          </View>
          {hasDetails && (
            <Feather
              name={expanded ? "chevron-up" : "chevron-down"}
              size={14}
              color="#9AAFAF"
            />
          )}
        </View>
      </View>

      {/* ── Expanded details ── */}
      {expanded && (
        <View style={styles.detailsBox}>
          <View style={styles.detailsDivider} />
          <Text style={styles.detailsBy}>By {adminLabel}</Text>

          {/* Station event details */}
          {fullAddress && <DetailRow label="Address" value={fullAddress} />}
          {isStation && details && typeof details.status === "string" && (
            <DetailRow label="Prior status" value={String(details.status)} />
          )}
          {isStation && details && (typeof details.ownerClerkUserId === "string" || typeof details.ownerClerkId === "string") && (
            <DetailRow
              label="Owner Clerk ID"
              value={String(details.ownerClerkUserId ?? details.ownerClerkId)}
              mono
            />
          )}
          {isStation && details && typeof details.createdAt === "string" && (
            <DetailRow label="Station created" value={fmtDate(String(details.createdAt))} />
          )}

          {/* User/role-change details */}
          {!isStation && details && typeof details.email === "string" && (
            <DetailRow label="Email" value={String(details.email)} />
          )}
          {!isStation && details && typeof details.role === "string" && (
            <DetailRow label="Role" value={String(details.role)} />
          )}
          {!isStation && details && typeof details.targetClerkId === "string" && (
            <DetailRow label="Clerk ID" value={String(details.targetClerkId)} mono />
          )}

          {!details && (
            <Text style={styles.noDetails}>No additional details recorded.</Text>
          )}
        </View>
      )}
    </Pressable>
  );
}

export default function AdminAuditLogScreen() {
  const { isAdmin } = useRole();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { data, isLoading, isError, refetch, isRefetching } = useAuditEvents();

  useEffect(() => {
    if (!isAdmin) router.replace("/(tabs)/home" as any);
  }, [isAdmin]);

  if (!isAdmin) return null;

  const events = data?.events ?? [];

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {/* ── Header ── */}
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.backBtn} hitSlop={12}>
          <Feather name="arrow-left" size={20} color="#1A2530" />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={styles.heading}>Audit Log</Text>
          <Text style={styles.subheading}>
            {isLoading ? "Loading…" : `${data?.total ?? 0} events total`}
          </Text>
        </View>
        <View style={styles.iconWrap}>
          <Feather name="file-text" size={18} color="#0D9E7E" />
        </View>
      </View>

      {/* ── Content ── */}
      {isLoading ? (
        <View style={styles.center}>
          <ActivityIndicator color="#0D9E7E" size="large" />
          <Text style={styles.loadingText}>Loading audit log…</Text>
        </View>
      ) : isError ? (
        <View style={styles.center}>
          <Feather name="alert-circle" size={36} color="#B91C1C" />
          <Text style={styles.errorText}>Failed to load audit log</Text>
          <Pressable style={styles.retryBtn} onPress={() => refetch()}>
            <Text style={styles.retryBtnText}>Retry</Text>
          </Pressable>
        </View>
      ) : events.length === 0 ? (
        <View style={styles.center}>
          <Feather name="file-text" size={36} color="#C4C4C4" />
          <Text style={styles.emptyText}>No audit events yet</Text>
        </View>
      ) : (
        <FlatList
          data={events}
          keyExtractor={(item) => String(item.id)}
          contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 32 }}
          ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
          renderItem={({ item }) => <EventCard event={item} />}
          refreshControl={
            <RefreshControl
              refreshing={isRefetching}
              onRefresh={refetch}
              tintColor="#0D9E7E"
            />
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#F8F7F4" },

  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: "#fff",
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: "#E8E4DC",
  },
  backBtn: { padding: 4 },
  heading: { fontSize: 18, fontWeight: "800", color: "#1A2530" },
  subheading: { fontSize: 12, color: "#6B6B6B", marginTop: 1 },
  iconWrap: {
    width: 36, height: 36, borderRadius: 10,
    backgroundColor: "#0D9E7E18",
    alignItems: "center", justifyContent: "center",
  },

  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 10 },
  loadingText: { fontSize: 14, color: "#6B6B6B" },
  errorText: { fontSize: 14, color: "#B91C1C", fontWeight: "600" },
  emptyText: { fontSize: 14, color: "#9AAFAF" },
  retryBtn: {
    marginTop: 4, paddingHorizontal: 20, paddingVertical: 8,
    backgroundColor: "#0D9E7E", borderRadius: 8,
  },
  retryBtnText: { fontSize: 14, color: "#fff", fontWeight: "600" },

  card: {
    backgroundColor: "#fff",
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#E8E4DC",
    padding: 14,
  },
  cardPressed: { opacity: 0.85 },
  cardHeader: { flexDirection: "row", alignItems: "flex-start", gap: 10 },

  targetName: { fontSize: 15, fontWeight: "700", color: "#1A2530" },
  addressText: { fontSize: 12, color: "#6B6B6B" },
  dateText: { fontSize: 11, color: "#9AAFAF", marginTop: 2 },

  actionBadge: {
    paddingHorizontal: 9, paddingVertical: 3,
    borderRadius: 20,
  },
  actionBadgeText: { fontSize: 11, fontWeight: "700" },

  detailsBox: { marginTop: 10 },
  detailsDivider: { height: 1, backgroundColor: "#E8E4DC", marginBottom: 10 },
  detailsBy: { fontSize: 11, color: "#9AAFAF", marginBottom: 8 },

  detailRow: { marginBottom: 8 },
  detailLabel: { fontSize: 11, fontWeight: "600", color: "#9AAFAF", textTransform: "uppercase", letterSpacing: 0.4 },
  detailValue: { fontSize: 13, color: "#1A2530", marginTop: 2 },
  detailMono: { fontFamily: "monospace", fontSize: 11 },

  noDetails: { fontSize: 12, color: "#9AAFAF", fontStyle: "italic" },
});
