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
  Alert,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import * as Haptics from "expo-haptics";

const BASE = `https://${process.env.EXPO_PUBLIC_DOMAIN}`;

type UserRole = "admin" | "client";

function useRole() {
  const { sessionClaims } = useAuth();
  const role = (sessionClaims?.publicMetadata as { role?: UserRole } | undefined)?.role ?? "client";
  return { isAdmin: role === "admin" };
}

type RemovedStation = {
  id: number;
  name: string;
  address: string;
  chargerType: string;
  status: string;
  updatedAt?: string;
};

function useRemovedStations() {
  const { getToken } = useAuth();
  return useQuery<RemovedStation[]>({
    queryKey: ["admin-removed-stations"],
    queryFn: async () => {
      const token = await getToken();
      const res = await fetch(`${BASE}/api/admin/all-stations?status=removed`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("Failed to fetch removed stations");
      return res.json();
    },
    staleTime: 30_000,
  });
}

function StationRow({
  station,
  onRestored,
  onDeleted,
}: {
  station: RemovedStation;
  onRestored: (id: number) => void;
  onDeleted: (id: number) => void;
}) {
  const { getToken } = useAuth();
  const [restoring, setRestoring] = useState(false);
  const [deleting, setDeleting] = useState(false);

  async function handleRestore() {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setRestoring(true);
    try {
      const token = await getToken();
      const res = await fetch(`${BASE}/api/admin/stations/${station.id}/restore`, {
        method: "PATCH",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error((body as { error?: string }).error ?? "Restore failed");
      }
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      onRestored(station.id);
    } catch (err: unknown) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      const message = err instanceof Error ? err.message : "Could not restore station.";
      Alert.alert("Restore failed", message);
    } finally {
      setRestoring(false);
    }
  }

  function confirmHardDelete() {
    Alert.alert(
      "Permanently delete?",
      `This will permanently remove "${station.name}" and cannot be undone.`,
      [
        { text: "Cancel", style: "cancel" },
        { text: "Delete permanently", style: "destructive", onPress: executeHardDelete },
      ]
    );
  }

  async function executeHardDelete() {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    setDeleting(true);
    try {
      const token = await getToken();
      const tokenRes = await fetch(`${BASE}/api/admin/stations/${station.id}/delete-token`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      const tokenData = await tokenRes.json().catch(() => ({}));
      if (!tokenRes.ok) {
        throw new Error((tokenData as { error?: string }).error ?? "Failed to get delete token");
      }
      const { token: confirmToken } = tokenData as { token: string };

      const delRes = await fetch(
        `${BASE}/api/admin/stations/${station.id}?confirmToken=${confirmToken}`,
        { method: "DELETE", headers: { Authorization: `Bearer ${token}` } }
      );
      if (!delRes.ok) {
        const delData = await delRes.json().catch(() => ({}));
        throw new Error((delData as { error?: string }).error ?? "Delete failed");
      }
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      onDeleted(station.id);
    } catch (err: unknown) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      const message = err instanceof Error ? err.message : "Could not delete station.";
      Alert.alert("Delete failed", message);
    } finally {
      setDeleting(false);
    }
  }

  const busy = restoring || deleting;

  return (
    <View style={styles.row}>
      <View style={styles.rowIcon}>
        <Feather name="trash-2" size={16} color="#B91C1C" />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.rowName} numberOfLines={1}>{station.name}</Text>
        <Text style={styles.rowAddress} numberOfLines={1}>{station.address}</Text>
        <View style={styles.rowMeta}>
          <Text style={styles.rowType}>{station.chargerType}</Text>
          {station.updatedAt && (
            <Text style={styles.rowDate}>
              {new Date(station.updatedAt).toLocaleDateString()}
            </Text>
          )}
        </View>
      </View>
      <View style={styles.rowActions}>
        <Pressable
          style={({ pressed }) => [styles.restoreBtn, pressed && styles.restoreBtnPressed, busy && styles.btnDisabled]}
          onPress={handleRestore}
          disabled={busy}
          accessibilityLabel={`Restore ${station.name}`}
        >
          {restoring ? (
            <ActivityIndicator size="small" color="#0D9E7E" />
          ) : (
            <>
              <Feather name="rotate-ccw" size={13} color="#0D9E7E" />
              <Text style={styles.restoreBtnText}>Restore</Text>
            </>
          )}
        </Pressable>
        <Pressable
          style={({ pressed }) => [styles.deleteBtn, pressed && styles.deleteBtnPressed, busy && styles.btnDisabled]}
          onPress={confirmHardDelete}
          disabled={busy}
          accessibilityLabel={`Permanently delete ${station.name}`}
        >
          {deleting ? (
            <ActivityIndicator size="small" color="#B91C1C" />
          ) : (
            <Feather name="x" size={14} color="#B91C1C" />
          )}
        </Pressable>
      </View>
    </View>
  );
}

export default function AdminRemovedScreen() {
  const { isAdmin } = useRole();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const { data: stations, isLoading, isError, refetch } = useRemovedStations();

  useEffect(() => {
    if (!isAdmin) {
      router.replace("/(tabs)/home");
    }
  }, [isAdmin]);

  if (!isAdmin) return null;

  function handleRestored(id: number) {
    queryClient.setQueryData<RemovedStation[]>(["admin-removed-stations"], (prev) =>
      (prev ?? []).filter((s) => s.id !== id)
    );
    queryClient.invalidateQueries({ queryKey: ["admin-review-stats"] });
  }

  function handleDeleted(id: number) {
    queryClient.setQueryData<RemovedStation[]>(["admin-removed-stations"], (prev) =>
      (prev ?? []).filter((s) => s.id !== id)
    );
    queryClient.invalidateQueries({ queryKey: ["admin-review-stats"] });
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Pressable style={styles.backBtn} onPress={() => router.back()}>
          <Feather name="arrow-left" size={20} color="#1A2530" />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={styles.heading}>Removed Stations</Text>
          <Text style={styles.subheading}>
            {isLoading ? "Loading…" : `${stations?.length ?? 0} station${(stations?.length ?? 0) !== 1 ? "s" : ""} removed`}
          </Text>
        </View>
        <Pressable style={styles.refreshBtn} onPress={() => refetch()}>
          <Feather name="refresh-cw" size={16} color="#6B6B6B" />
        </Pressable>
      </View>

      {isLoading ? (
        <ActivityIndicator color="#0D9E7E" style={{ marginTop: 40 }} />
      ) : isError ? (
        <View style={styles.emptyState}>
          <Feather name="alert-circle" size={32} color="#B91C1C" />
          <Text style={styles.emptyTitle}>Failed to load</Text>
          <Text style={styles.emptyText}>Could not fetch removed stations. Check your connection and try again.</Text>
          <Pressable style={styles.retryBtn} onPress={() => refetch()}>
            <Text style={styles.retryBtnText}>Retry</Text>
          </Pressable>
        </View>
      ) : (stations?.length ?? 0) === 0 ? (
        <View style={styles.emptyState}>
          <Feather name="check-circle" size={32} color="#0D9E7E" />
          <Text style={styles.emptyTitle}>No removed stations</Text>
          <Text style={styles.emptyText}>All stations are active or pending review.</Text>
        </View>
      ) : (
        <FlatList
          data={stations}
          keyExtractor={(item) => String(item.id)}
          renderItem={({ item }) => (
            <StationRow station={item} onRestored={handleRestored} onDeleted={handleDeleted} />
          )}
          contentContainerStyle={{ paddingBottom: insets.bottom + 24, paddingTop: 8 }}
          ItemSeparatorComponent={() => <View style={styles.separator} />}
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
  backBtn: {
    width: 36, height: 36, borderRadius: 10,
    alignItems: "center", justifyContent: "center",
    backgroundColor: "#F8F7F4",
  },
  refreshBtn: {
    width: 36, height: 36, borderRadius: 10,
    alignItems: "center", justifyContent: "center",
    backgroundColor: "#F8F7F4",
  },
  heading: { fontSize: 17, fontWeight: "700", color: "#1A2530" },
  subheading: { fontSize: 12, color: "#6B6B6B", marginTop: 1 },

  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    paddingHorizontal: 16,
    paddingVertical: 14,
    backgroundColor: "#fff",
  },
  rowIcon: {
    width: 38, height: 38, borderRadius: 10,
    backgroundColor: "#FEE2E2",
    alignItems: "center", justifyContent: "center",
  },
  rowName: { fontSize: 14, fontWeight: "600", color: "#1A2530" },
  rowAddress: { fontSize: 12, color: "#6B6B6B", marginTop: 2 },
  rowMeta: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 4 },
  rowType: {
    fontSize: 11, fontWeight: "600", color: "#B91C1C",
    backgroundColor: "#FEE2E2", paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4,
  },
  rowDate: { fontSize: 11, color: "#9AAFAF" },

  rowActions: { flexDirection: "row", alignItems: "center", gap: 8 },

  restoreBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#0D9E7E",
    backgroundColor: "#F0FBF8",
    minWidth: 82,
    justifyContent: "center",
  },
  restoreBtnPressed: { opacity: 0.75 },
  restoreBtnText: { fontSize: 12, fontWeight: "700", color: "#0D9E7E" },

  deleteBtn: {
    width: 34, height: 34, borderRadius: 10,
    alignItems: "center", justifyContent: "center",
    borderWidth: 1,
    borderColor: "#FCA5A5",
    backgroundColor: "#FEF2F2",
  },
  deleteBtnPressed: { opacity: 0.75 },
  btnDisabled: { opacity: 0.5 },

  separator: { height: StyleSheet.hairlineWidth, backgroundColor: "#E8E4DC" },

  emptyState: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 32, gap: 12 },
  emptyTitle: { fontSize: 17, fontWeight: "700", color: "#1A2530" },
  emptyText: { fontSize: 13, color: "#6B6B6B", textAlign: "center", lineHeight: 20 },
  retryBtn: {
    marginTop: 4, paddingHorizontal: 20, paddingVertical: 10,
    backgroundColor: "#0D9E7E", borderRadius: 10,
  },
  retryBtnText: { color: "#fff", fontWeight: "700", fontSize: 14 },
});
