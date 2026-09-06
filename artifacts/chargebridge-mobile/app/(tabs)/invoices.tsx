import React, { useState, useCallback } from "react";
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  RefreshControl, Modal, TextInput, ScrollView, ActivityIndicator,
  Alert, KeyboardAvoidingView, Platform,
} from "react-native";
import { Feather, Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@clerk/expo";
import * as Haptics from "expo-haptics";
import { LinearGradient } from "expo-linear-gradient";
import { usePlan } from "@/hooks/usePlan";
import { useColors } from "@/hooks/useColors";
import { MembershipModal } from "@/components/MembershipModal";

const BASE = `https://${process.env.EXPO_PUBLIC_DOMAIN}`;

// ── Types ─────────────────────────────────────────────────────────────────────
type InvoiceStatus = "draft" | "sent" | "paid" | "overdue";

type InvoiceItem = {
  id: number;
  description: string;
  quantity: number;
  unitPrice: number;
  amount: number;
};

type Invoice = {
  id: number;
  invoiceNumber: string;
  businessName: string;
  businessEmail: string;
  status: InvoiceStatus;
  dueDate: string;
  createdAt: string;
  notes: string | null;
  totalAmount: number;
  items: InvoiceItem[];
};

type MonthlyCount = { used: number; limit: number | null; plan: string };

// ── Status helpers ────────────────────────────────────────────────────────────
const STATUS_META: Record<InvoiceStatus, { label: string; color: string; bg: string; icon: keyof typeof Feather.glyphMap }> = {
  draft:   { label: "Draft",   color: "#64748b", bg: "#f1f5f9", icon: "edit-2" },
  sent:    { label: "Sent",    color: "#3b82f6", bg: "#eff6ff", icon: "send" },
  paid:    { label: "Paid",    color: "#22c55e", bg: "#f0fdf4", icon: "check-circle" },
  overdue: { label: "Overdue", color: "#ef4444", bg: "#fef2f2", icon: "alert-circle" },
};

const STATUS_TABS: (InvoiceStatus | "all")[] = ["all", "draft", "sent", "paid", "overdue"];

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function formatCurrency(n: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);
}

// ── Usage bar ────────────────────────────────────────────────────────────────
function UsageBar({ used, limit, planName, colors }: {
  used: number; limit: number | null; planName: string;
  colors: ReturnType<typeof useColors>;
}) {
  const isUnlimited = limit === null;
  const pct = isUnlimited ? 1 : Math.min(used / (limit ?? 1), 1);
  const warn = !isUnlimited && pct >= 0.8;
  const barColor = pct >= 1 ? "#ef4444" : warn ? "#f59e0b" : "#22c55e";

  return (
    <View style={[UB.wrap, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <View style={UB.row}>
        <View style={[UB.planPill, { backgroundColor: colors.primary + "15" }]}>
          <Ionicons name="shield-checkmark-outline" size={12} color={colors.primary} />
          <Text style={[UB.planTxt, { color: colors.primary }]}>{planName}</Text>
        </View>
        <Text style={[UB.countTxt, { color: colors.mutedForeground }]}>
          {isUnlimited
            ? `${used} invoice${used !== 1 ? "s" : ""} this month`
            : `${used} / ${limit} this month`}
        </Text>
      </View>
      {!isUnlimited && (
        <View style={[UB.track, { backgroundColor: colors.muted }]}>
          <View style={[UB.fill, { width: `${pct * 100}%` as any, backgroundColor: barColor }]} />
        </View>
      )}
      {!isUnlimited && pct >= 1 && (
        <Text style={UB.limitTxt}>Monthly limit reached — upgrade for more</Text>
      )}
    </View>
  );
}

const UB = StyleSheet.create({
  wrap: { borderRadius: 14, borderWidth: 1, padding: 14, marginBottom: 12 },
  row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 8 },
  planPill: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
  planTxt: { fontSize: 11, fontWeight: "700", fontFamily: "Inter_700Bold" },
  countTxt: { fontSize: 12, fontFamily: "Inter_400Regular" },
  track: { height: 6, borderRadius: 3, overflow: "hidden" },
  fill: { height: "100%", borderRadius: 3 },
  limitTxt: { fontSize: 11, color: "#ef4444", fontFamily: "Inter_400Regular", marginTop: 6 },
});

// ── Invoice card ──────────────────────────────────────────────────────────────
function InvoiceCard({ invoice, onPress, colors }: {
  invoice: Invoice;
  onPress: () => void;
  colors: ReturnType<typeof useColors>;
}) {
  const meta = STATUS_META[invoice.status];
  return (
    <TouchableOpacity
      style={[IC.card, { backgroundColor: colors.card, borderColor: colors.border }]}
      onPress={onPress}
      activeOpacity={0.78}
    >
      <View style={IC.top}>
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={[IC.num, { color: colors.mutedForeground }]}>{invoice.invoiceNumber}</Text>
          <Text style={[IC.biz, { color: colors.foreground }]} numberOfLines={1}>{invoice.businessName}</Text>
          <Text style={[IC.date, { color: colors.mutedForeground }]}>Due {formatDate(invoice.dueDate)}</Text>
        </View>
        <View style={{ alignItems: "flex-end", gap: 6 }}>
          <Text style={[IC.amount, { color: colors.foreground }]}>{formatCurrency(invoice.totalAmount)}</Text>
          <View style={[IC.badge, { backgroundColor: meta.bg }]}>
            <Feather name={meta.icon} size={10} color={meta.color} />
            <Text style={[IC.badgeTxt, { color: meta.color }]}>{meta.label}</Text>
          </View>
        </View>
      </View>
    </TouchableOpacity>
  );
}

const IC = StyleSheet.create({
  card: { borderRadius: 14, borderWidth: 1, padding: 14, marginBottom: 10 },
  top: { flexDirection: "row", alignItems: "flex-start", gap: 12 },
  num: { fontSize: 10, fontFamily: "Inter_400Regular", textTransform: "uppercase", letterSpacing: 0.5 },
  biz: { fontSize: 15, fontWeight: "700", fontFamily: "Inter_700Bold" },
  date: { fontSize: 11, fontFamily: "Inter_400Regular" },
  amount: { fontSize: 17, fontWeight: "800", fontFamily: "Inter_700Bold" },
  badge: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 7, paddingVertical: 3, borderRadius: 7 },
  badgeTxt: { fontSize: 10, fontWeight: "700", fontFamily: "Inter_700Bold" },
});

// ── Invoice detail modal ──────────────────────────────────────────────────────
function InvoiceDetailModal({ invoice, onClose, onStatusChange, colors, getToken }: {
  invoice: Invoice;
  onClose: () => void;
  onStatusChange: (id: number, status: InvoiceStatus) => void;
  colors: ReturnType<typeof useColors>;
  getToken: () => Promise<string | null>;
}) {
  const meta = STATUS_META[invoice.status];
  const [sendEmail, setSendEmail] = useState("");
  const [sending, setSending] = useState(false);
  const [sendResult, setSendResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [statusChanging, setStatusChanging] = useState(false);
  const insets = useSafeAreaInsets();

  const NEXT_STATUSES: Partial<Record<InvoiceStatus, InvoiceStatus[]>> = {
    draft:   ["sent", "overdue"],
    sent:    ["paid", "overdue"],
    overdue: ["paid"],
  };
  const nextStatuses = NEXT_STATUSES[invoice.status] ?? [];

  async function handleSendEmail() {
    if (!sendEmail.trim() || !sendEmail.includes("@")) {
      setSendResult({ ok: false, message: "Please enter a valid email address." });
      return;
    }
    setSending(true);
    setSendResult(null);
    try {
      const token = await getToken();
      const r = await fetch(`${BASE}/api/invoices/${invoice.id}/send-email`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token ?? ""}` },
        body: JSON.stringify({ toEmail: sendEmail.trim() }),
      });
      const d = await r.json();
      setSendResult(d);
      if (d.ok) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        onStatusChange(invoice.id, "sent");
      }
    } catch {
      setSendResult({ ok: false, message: "Network error. Please try again." });
    } finally {
      setSending(false);
    }
  }

  async function handleStatusChange(newStatus: InvoiceStatus) {
    setStatusChanging(true);
    try {
      const token = await getToken();
      await fetch(`${BASE}/api/invoices/${invoice.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token ?? ""}` },
        body: JSON.stringify({ status: newStatus }),
      });
      Haptics.selectionAsync();
      onStatusChange(invoice.id, newStatus);
    } finally {
      setStatusChanging(false);
    }
  }

  return (
    <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={[DM.sheet, { backgroundColor: colors.background }]}>
        <View style={[DM.header, { borderBottomColor: colors.border, paddingTop: Platform.OS === "ios" ? 16 : insets.top + 12 }]}>
          <View style={{ width: 34 }} />
          <Text style={[DM.headerTitle, { color: colors.foreground }]}>Invoice</Text>
          <TouchableOpacity style={[DM.closeBtn, { backgroundColor: colors.muted }]} onPress={onClose}>
            <Feather name="x" size={17} color={colors.foreground} />
          </TouchableOpacity>
        </View>

        <ScrollView
          contentContainerStyle={[DM.scroll, { paddingBottom: insets.bottom + 40 }]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* Hero */}
          <View style={[DM.hero, { backgroundColor: meta.bg, borderColor: meta.color + "30" }]}>
            <Text style={[DM.invoiceNum, { color: meta.color }]}>{invoice.invoiceNumber}</Text>
            <Text style={[DM.amount, { color: colors.foreground }]}>{formatCurrency(invoice.totalAmount)}</Text>
            <View style={[DM.statusBadge, { backgroundColor: meta.color + "20" }]}>
              <Feather name={meta.icon} size={13} color={meta.color} />
              <Text style={[DM.statusTxt, { color: meta.color }]}>{meta.label}</Text>
            </View>
          </View>

          {/* Meta */}
          <View style={[DM.section, { backgroundColor: colors.card, borderColor: colors.border }]}>
            {[
              { label: "To", value: invoice.businessName },
              { label: "Email", value: invoice.businessEmail },
              { label: "Due date", value: formatDate(invoice.dueDate) },
              { label: "Created", value: formatDate(invoice.createdAt) },
            ].map(({ label, value }) => (
              <View key={label} style={[DM.metaRow, { borderBottomColor: colors.border }]}>
                <Text style={[DM.metaLabel, { color: colors.mutedForeground }]}>{label}</Text>
                <Text style={[DM.metaValue, { color: colors.foreground }]}>{value}</Text>
              </View>
            ))}
          </View>

          {/* Line items */}
          <Text style={[DM.sectionHead, { color: colors.mutedForeground }]}>LINE ITEMS</Text>
          <View style={[DM.section, { backgroundColor: colors.card, borderColor: colors.border }]}>
            {invoice.items.map((item, i) => (
              <View key={item.id} style={[DM.lineItem, { borderBottomColor: colors.border }]}>
                <View style={{ flex: 1 }}>
                  <Text style={[DM.liDesc, { color: colors.foreground }]}>{item.description}</Text>
                  <Text style={[DM.liSub, { color: colors.mutedForeground }]}>
                    {item.quantity} × {formatCurrency(item.unitPrice)}
                  </Text>
                </View>
                <Text style={[DM.liAmount, { color: colors.foreground }]}>{formatCurrency(item.amount)}</Text>
              </View>
            ))}
            <View style={DM.totalRow}>
              <Text style={[DM.totalLabel, { color: colors.mutedForeground }]}>Total</Text>
              <Text style={[DM.totalVal, { color: colors.foreground }]}>{formatCurrency(invoice.totalAmount)}</Text>
            </View>
          </View>

          {/* Status actions */}
          {nextStatuses.length > 0 && (
            <>
              <Text style={[DM.sectionHead, { color: colors.mutedForeground }]}>MARK AS</Text>
              <View style={DM.statusBtns}>
                {nextStatuses.map(s => {
                  const m = STATUS_META[s];
                  return (
                    <TouchableOpacity
                      key={s}
                      style={[DM.statusBtn, { backgroundColor: m.bg, borderColor: m.color + "40" }]}
                      onPress={() => handleStatusChange(s)}
                      disabled={statusChanging}
                    >
                      <Feather name={m.icon} size={14} color={m.color} />
                      <Text style={[DM.statusBtnTxt, { color: m.color }]}>{m.label}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </>
          )}

          {/* Send email */}
          <Text style={[DM.sectionHead, { color: colors.mutedForeground }]}>SEND TO EMAIL</Text>
          <View style={[DM.emailSection, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={[DM.emailRow, { borderColor: colors.border }]}>
              <Feather name="mail" size={15} color={colors.mutedForeground} />
              <TextInput
                style={[DM.emailInput, { color: colors.foreground }]}
                placeholder={invoice.businessEmail}
                placeholderTextColor={colors.mutedForeground}
                value={sendEmail}
                onChangeText={t => { setSendEmail(t); setSendResult(null); }}
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
              />
            </View>
            {sendResult && (
              <View style={[DM.sendResult, { backgroundColor: sendResult.ok ? "#f0fdf4" : "#fef2f2" }]}>
                <Feather
                  name={sendResult.ok ? "check-circle" : "alert-circle"}
                  size={13}
                  color={sendResult.ok ? "#22c55e" : "#ef4444"}
                />
                <Text style={[DM.sendResultTxt, { color: sendResult.ok ? "#22c55e" : "#ef4444" }]}>
                  {sendResult.ok ? "Invoice sent!" : sendResult.message}
                </Text>
              </View>
            )}
            <TouchableOpacity
              style={[DM.sendBtn, { backgroundColor: colors.primary }]}
              onPress={handleSendEmail}
              disabled={sending}
              activeOpacity={0.82}
            >
              {sending
                ? <ActivityIndicator color="#fff" size="small" />
                : <><Feather name="send" size={15} color="#fff" /><Text style={DM.sendBtnTxt}>Send Invoice</Text></>}
            </TouchableOpacity>
          </View>

          {invoice.notes && (
            <>
              <Text style={[DM.sectionHead, { color: colors.mutedForeground }]}>NOTES</Text>
              <View style={[DM.section, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <Text style={[DM.notesTxt, { color: colors.foreground }]}>{invoice.notes}</Text>
              </View>
            </>
          )}
        </ScrollView>
      </View>
    </Modal>
  );
}

const DM = StyleSheet.create({
  sheet: { flex: 1 },
  header: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: 16, paddingBottom: 14, borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerTitle: { fontSize: 17, fontWeight: "700", fontFamily: "Inter_700Bold", flex: 1, textAlign: "center" },
  closeBtn: { width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center" },
  scroll: { padding: 16, gap: 4 },

  hero: { borderRadius: 18, borderWidth: 1, padding: 20, alignItems: "center", gap: 8, marginBottom: 12 },
  invoiceNum: { fontSize: 11, fontFamily: "Inter_400Regular", textTransform: "uppercase", letterSpacing: 1 },
  amount: { fontSize: 32, fontWeight: "800", fontFamily: "Inter_700Bold" },
  statusBadge: { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 10 },
  statusTxt: { fontSize: 12, fontWeight: "700", fontFamily: "Inter_700Bold" },

  section: { borderRadius: 14, borderWidth: 1, overflow: "hidden", marginBottom: 12 },
  sectionHead: { fontSize: 10, fontFamily: "Inter_400Regular", textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 6, paddingHorizontal: 2 },

  metaRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", padding: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  metaLabel: { fontSize: 12, fontFamily: "Inter_400Regular" },
  metaValue: { fontSize: 13, fontWeight: "600", fontFamily: "Inter_600SemiBold", flex: 1, textAlign: "right" },

  lineItem: { flexDirection: "row", alignItems: "flex-start", gap: 12, padding: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  liDesc: { fontSize: 13, fontWeight: "600", fontFamily: "Inter_600SemiBold" },
  liSub: { fontSize: 11, fontFamily: "Inter_400Regular", marginTop: 2 },
  liAmount: { fontSize: 14, fontWeight: "700", fontFamily: "Inter_700Bold" },
  totalRow: { flexDirection: "row", justifyContent: "space-between", padding: 12 },
  totalLabel: { fontSize: 12, fontFamily: "Inter_400Regular", fontWeight: "600" },
  totalVal: { fontSize: 15, fontWeight: "800", fontFamily: "Inter_700Bold" },

  statusBtns: { flexDirection: "row", gap: 10, marginBottom: 12 },
  statusBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, padding: 12, borderRadius: 12, borderWidth: 1 },
  statusBtnTxt: { fontSize: 13, fontWeight: "700", fontFamily: "Inter_700Bold" },

  emailSection: { borderRadius: 14, borderWidth: 1, padding: 14, gap: 10, marginBottom: 12 },
  emailRow: { flexDirection: "row", alignItems: "center", gap: 10, borderBottomWidth: StyleSheet.hairlineWidth, paddingBottom: 10 },
  emailInput: { flex: 1, fontSize: 14, fontFamily: "Inter_400Regular" },
  sendResult: { flexDirection: "row", alignItems: "center", gap: 6, padding: 10, borderRadius: 10 },
  sendResultTxt: { fontSize: 12, fontFamily: "Inter_400Regular", flex: 1 },
  sendBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, borderRadius: 12, paddingVertical: 13 },
  sendBtnTxt: { color: "#fff", fontSize: 14, fontWeight: "700", fontFamily: "Inter_700Bold" },

  notesTxt: { padding: 12, fontSize: 13, fontFamily: "Inter_400Regular", lineHeight: 20 },
});

// ── Create invoice modal ──────────────────────────────────────────────────────
type LineItem = { description: string; qty: string; price: string };

function CreateInvoiceModal({ onClose, onCreated, getToken, colors }: {
  onClose: () => void;
  onCreated: () => void;
  getToken: () => Promise<string | null>;
  colors: ReturnType<typeof useColors>;
}) {
  const insets = useSafeAreaInsets();
  const [businessName, setBusinessName] = useState("");
  const [businessEmail, setBusinessEmail] = useState("");
  const [dueDate, setDueDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() + 30);
    return d.toISOString().slice(0, 10);
  });
  const [items, setItems] = useState<LineItem[]>([{ description: "", qty: "1", price: "" }]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const addItem = () => setItems(prev => [...prev, { description: "", qty: "1", price: "" }]);
  const removeItem = (i: number) => setItems(prev => prev.filter((_, idx) => idx !== i));
  const setItem = (i: number, k: keyof LineItem, v: string) =>
    setItems(prev => prev.map((item, idx) => idx === i ? { ...item, [k]: v } : item));

  const total = items.reduce((sum, item) => {
    const qty = parseFloat(item.qty) || 0;
    const price = parseFloat(item.price) || 0;
    return sum + qty * price;
  }, 0);

  async function handleSave() {
    if (!businessName.trim()) { setError("Business name is required."); return; }
    if (!businessEmail.trim() || !businessEmail.includes("@")) { setError("Valid email is required."); return; }
    const validItems = items.filter(i => i.description.trim() && parseFloat(i.price) > 0);
    if (validItems.length === 0) { setError("At least one line item with description and price is required."); return; }

    setSaving(true);
    setError(null);
    try {
      const token = await getToken();
      const r = await fetch(`${BASE}/api/invoices`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token ?? ""}` },
        body: JSON.stringify({
          businessName: businessName.trim(),
          businessEmail: businessEmail.trim(),
          dueDate,
          items: validItems.map(i => ({
            description: i.description.trim(),
            quantity: parseFloat(i.qty) || 1,
            unitPrice: parseFloat(i.price) || 0,
          })),
        }),
      });
      const d = await r.json();
      if (!r.ok) {
        setError(d.error ?? "Failed to create invoice.");
        return;
      }
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      onCreated();
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={[CM.sheet, { backgroundColor: colors.background }]}>
        <View style={[CM.header, { borderBottomColor: colors.border, paddingTop: Platform.OS === "ios" ? 16 : insets.top + 12 }]}>
          <TouchableOpacity style={[CM.btn, { backgroundColor: colors.muted }]} onPress={onClose}>
            <Text style={[CM.btnTxt, { color: colors.mutedForeground }]}>Cancel</Text>
          </TouchableOpacity>
          <Text style={[CM.title, { color: colors.foreground }]}>New Invoice</Text>
          <TouchableOpacity style={[CM.btn, { backgroundColor: colors.primary }]} onPress={handleSave} disabled={saving}>
            {saving ? <ActivityIndicator color="#fff" size="small" /> : <Text style={[CM.btnTxt, { color: "#fff" }]}>Create</Text>}
          </TouchableOpacity>
        </View>

        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
          <ScrollView contentContainerStyle={[CM.scroll, { paddingBottom: insets.bottom + 32 }]} keyboardShouldPersistTaps="handled">
            {/* Client info */}
            <Text style={[CM.sectionHead, { color: colors.mutedForeground }]}>CLIENT</Text>
            <View style={[CM.section, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <View style={[CM.field, { borderBottomColor: colors.border }]}>
                <Text style={[CM.fieldLabel, { color: colors.mutedForeground }]}>Business Name *</Text>
                <TextInput
                  style={[CM.fieldInput, { color: colors.foreground }]}
                  placeholder="Client or business name"
                  placeholderTextColor={colors.mutedForeground}
                  value={businessName}
                  onChangeText={setBusinessName}
                  autoCapitalize="words"
                />
              </View>
              <View style={[CM.field, { borderBottomColor: colors.border }]}>
                <Text style={[CM.fieldLabel, { color: colors.mutedForeground }]}>Email *</Text>
                <TextInput
                  style={[CM.fieldInput, { color: colors.foreground }]}
                  placeholder="client@example.com"
                  placeholderTextColor={colors.mutedForeground}
                  value={businessEmail}
                  onChangeText={setBusinessEmail}
                  keyboardType="email-address"
                  autoCapitalize="none"
                />
              </View>
              <View style={CM.field}>
                <Text style={[CM.fieldLabel, { color: colors.mutedForeground }]}>Due Date</Text>
                <TextInput
                  style={[CM.fieldInput, { color: colors.foreground }]}
                  placeholder="YYYY-MM-DD"
                  placeholderTextColor={colors.mutedForeground}
                  value={dueDate}
                  onChangeText={setDueDate}
                />
              </View>
            </View>

            {/* Line items */}
            <Text style={[CM.sectionHead, { color: colors.mutedForeground }]}>LINE ITEMS</Text>
            {items.map((item, i) => (
              <View key={i} style={[CM.itemCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <View style={[CM.field, { borderBottomColor: colors.border }]}>
                  <Text style={[CM.fieldLabel, { color: colors.mutedForeground }]}>Description *</Text>
                  <TextInput
                    style={[CM.fieldInput, { color: colors.foreground }]}
                    placeholder="Service or product description"
                    placeholderTextColor={colors.mutedForeground}
                    value={item.description}
                    onChangeText={v => setItem(i, "description", v)}
                  />
                </View>
                <View style={CM.itemRow}>
                  <View style={[CM.halfField, { borderRightColor: colors.border }]}>
                    <Text style={[CM.fieldLabel, { color: colors.mutedForeground }]}>Qty</Text>
                    <TextInput
                      style={[CM.fieldInput, { color: colors.foreground }]}
                      placeholder="1"
                      placeholderTextColor={colors.mutedForeground}
                      value={item.qty}
                      onChangeText={v => setItem(i, "qty", v)}
                      keyboardType="decimal-pad"
                    />
                  </View>
                  <View style={CM.halfField}>
                    <Text style={[CM.fieldLabel, { color: colors.mutedForeground }]}>Unit Price ($)</Text>
                    <TextInput
                      style={[CM.fieldInput, { color: colors.foreground }]}
                      placeholder="0.00"
                      placeholderTextColor={colors.mutedForeground}
                      value={item.price}
                      onChangeText={v => setItem(i, "price", v)}
                      keyboardType="decimal-pad"
                    />
                  </View>
                </View>
                {items.length > 1 && (
                  <TouchableOpacity style={CM.removeBtn} onPress={() => removeItem(i)}>
                    <Feather name="trash-2" size={13} color="#ef4444" />
                    <Text style={CM.removeBtnTxt}>Remove</Text>
                  </TouchableOpacity>
                )}
              </View>
            ))}

            <TouchableOpacity style={[CM.addItemBtn, { borderColor: colors.primary }]} onPress={addItem}>
              <Feather name="plus" size={14} color={colors.primary} />
              <Text style={[CM.addItemTxt, { color: colors.primary }]}>Add Line Item</Text>
            </TouchableOpacity>

            {/* Total */}
            <View style={[CM.totalRow, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Text style={[CM.totalLabel, { color: colors.mutedForeground }]}>Total</Text>
              <Text style={[CM.totalVal, { color: colors.foreground }]}>{formatCurrency(total)}</Text>
            </View>

            {error && (
              <View style={CM.errorRow}>
                <Feather name="alert-circle" size={14} color="#ef4444" />
                <Text style={CM.errorTxt}>{error}</Text>
              </View>
            )}
          </ScrollView>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

const CM = StyleSheet.create({
  sheet: { flex: 1 },
  header: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: 16, paddingBottom: 14, borderBottomWidth: StyleSheet.hairlineWidth,
  },
  title: { fontSize: 17, fontWeight: "700", fontFamily: "Inter_700Bold" },
  btn: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 10 },
  btnTxt: { fontSize: 14, fontWeight: "600", fontFamily: "Inter_600SemiBold" },
  scroll: { padding: 16, gap: 6 },
  sectionHead: { fontSize: 10, fontFamily: "Inter_400Regular", textTransform: "uppercase", letterSpacing: 0.8, marginTop: 6, paddingHorizontal: 2 },
  section: { borderRadius: 14, borderWidth: 1, overflow: "hidden", marginBottom: 8 },
  field: { paddingHorizontal: 14, paddingTop: 10, paddingBottom: 10, borderBottomWidth: StyleSheet.hairlineWidth },
  fieldLabel: { fontSize: 10, fontFamily: "Inter_400Regular", textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 4 },
  fieldInput: { fontSize: 15, fontFamily: "Inter_400Regular" },
  itemCard: { borderRadius: 14, borderWidth: 1, overflow: "hidden", marginBottom: 8 },
  itemRow: { flexDirection: "row" },
  halfField: { flex: 1, paddingHorizontal: 14, paddingTop: 10, paddingBottom: 10, borderRightWidth: StyleSheet.hairlineWidth },
  removeBtn: { flexDirection: "row", alignItems: "center", gap: 5, padding: 10, paddingHorizontal: 14 },
  removeBtnTxt: { fontSize: 12, color: "#ef4444", fontFamily: "Inter_400Regular" },
  addItemBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, borderWidth: 1, borderStyle: "dashed", borderRadius: 12, paddingVertical: 12, marginBottom: 8 },
  addItemTxt: { fontSize: 13, fontWeight: "600", fontFamily: "Inter_600SemiBold" },
  totalRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", borderRadius: 14, borderWidth: 1, padding: 14, marginTop: 4 },
  totalLabel: { fontSize: 13, fontFamily: "Inter_400Regular" },
  totalVal: { fontSize: 18, fontWeight: "800", fontFamily: "Inter_700Bold" },
  errorRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  errorTxt: { fontSize: 13, color: "#ef4444", fontFamily: "Inter_400Regular", flex: 1 },
});

// ── Plan gate ─────────────────────────────────────────────────────────────────
function PlanGate({ onUpgrade, colors, insets }: {
  onUpgrade: () => void;
  colors: ReturnType<typeof useColors>;
  insets: ReturnType<typeof useSafeAreaInsets>;
}) {
  const plans = [
    { name: "Explorer", price: "$4.99/mo", limit: "5 invoices/month", color: "#3b82f6", icon: "compass" as const },
    { name: "Driver Pro", price: "$9.99/mo", limit: "10 invoices/month", color: "#13AE8F", icon: "navigation" as const, highlight: true },
    { name: "Fleet Pro", price: "$19.99/mo", limit: "Unlimited invoices", color: "#8b5cf6", icon: "briefcase" as const },
  ];

  return (
    <ScrollView
      contentContainerStyle={[PG.scroll, { paddingBottom: insets.bottom + 100 }]}
      showsVerticalScrollIndicator={false}
    >
      <LinearGradient
        colors={["#f0fdf4", "#eff6ff"]}
        style={PG.hero}
      >
        <View style={[PG.heroIcon, { backgroundColor: "#fff" }]}>
          <Feather name="file-text" size={36} color="#3b82f6" />
        </View>
        <Text style={PG.heroTitle}>Invoices & Billing</Text>
        <Text style={PG.heroSub}>
          Create, track, and send professional invoices — included with all paid plans
        </Text>
      </LinearGradient>

      {plans.map((plan) => (
        <View
          key={plan.name}
          style={[
            PG.planCard,
            { backgroundColor: colors.card, borderColor: plan.highlight ? plan.color : colors.border },
            plan.highlight && PG.planCardHighlight,
          ]}
        >
          {plan.highlight && (
            <View style={[PG.bestBadge, { backgroundColor: plan.color }]}>
              <Text style={PG.bestBadgeTxt}>Best Value</Text>
            </View>
          )}
          <View style={[PG.planIcon, { backgroundColor: plan.color + "15" }]}>
            <Feather name={plan.icon} size={20} color={plan.color} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[PG.planName, { color: colors.foreground }]}>{plan.name}</Text>
            <Text style={[PG.planPrice, { color: colors.mutedForeground }]}>{plan.price}</Text>
          </View>
          <View style={[PG.limitPill, { backgroundColor: plan.color + "15" }]}>
            <Feather name="file-text" size={11} color={plan.color} />
            <Text style={[PG.limitTxt, { color: plan.color }]}>{plan.limit}</Text>
          </View>
        </View>
      ))}

      <TouchableOpacity
        style={[PG.upgradeBtn, { backgroundColor: "#3b82f6" }]}
        onPress={onUpgrade}
        activeOpacity={0.85}
      >
        <Ionicons name="diamond-outline" size={18} color="#fff" />
        <Text style={PG.upgradeBtnTxt}>View Plans & Upgrade</Text>
      </TouchableOpacity>

      <Text style={[PG.footer, { color: colors.mutedForeground }]}>
        Plans include invoice creation, email delivery, and status tracking
      </Text>
    </ScrollView>
  );
}

const PG = StyleSheet.create({
  scroll: { padding: 16, gap: 10 },
  hero: { borderRadius: 20, padding: 28, alignItems: "center", gap: 12, marginBottom: 6 },
  heroIcon: { width: 72, height: 72, borderRadius: 36, alignItems: "center", justifyContent: "center", shadowColor: "#000", shadowOpacity: 0.08, shadowRadius: 8, shadowOffset: { width: 0, height: 2 } },
  heroTitle: { fontSize: 22, fontWeight: "800", fontFamily: "Inter_700Bold", color: "#1e293b", textAlign: "center" },
  heroSub: { fontSize: 14, color: "#64748b", fontFamily: "Inter_400Regular", textAlign: "center", lineHeight: 20 },
  planCard: { flexDirection: "row", alignItems: "center", gap: 12, borderRadius: 16, borderWidth: 1, padding: 16, position: "relative" },
  planCardHighlight: { borderWidth: 2 },
  bestBadge: { position: "absolute", top: -10, right: 12, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
  bestBadgeTxt: { color: "#fff", fontSize: 9, fontWeight: "700", fontFamily: "Inter_700Bold", textTransform: "uppercase" },
  planIcon: { width: 44, height: 44, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  planName: { fontSize: 15, fontWeight: "700", fontFamily: "Inter_700Bold" },
  planPrice: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2 },
  limitPill: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8 },
  limitTxt: { fontSize: 11, fontWeight: "600", fontFamily: "Inter_600SemiBold" },
  upgradeBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, borderRadius: 16, paddingVertical: 15, marginTop: 6 },
  upgradeBtnTxt: { color: "#fff", fontSize: 15, fontWeight: "700", fontFamily: "Inter_700Bold" },
  footer: { fontSize: 12, fontFamily: "Inter_400Regular", textAlign: "center", marginTop: 4 },
});

// ── Main screen ───────────────────────────────────────────────────────────────
export default function InvoicesScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { getToken } = useAuth();
  const { hasInvoiceAccess, invoiceLimit, planName, isLoaded } = usePlan();
  const qc = useQueryClient();

  const [statusFilter, setStatusFilter] = useState<InvoiceStatus | "all">("all");
  const [selectedInvoice, setSelectedInvoice] = useState<Invoice | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [showMembership, setShowMembership] = useState(false);

  const authFetch = useCallback(async (url: string, opts?: RequestInit) => {
    const token = await getToken();
    return fetch(`${BASE}${url}`, {
      ...opts,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token ?? ""}`, ...(opts?.headers ?? {}) },
    });
  }, [getToken]);

  const { data: countData } = useQuery<MonthlyCount>({
    queryKey: ["invoice-count"],
    queryFn: async () => {
      const r = await authFetch("/api/invoices/my/count");
      if (!r.ok) return { used: 0, limit: invoiceLimit, plan: "free" };
      return r.json();
    },
    enabled: hasInvoiceAccess,
    staleTime: 30_000,
  });

  const { data: invoiceData, isLoading, refetch, isRefetching } = useQuery<{ invoices: Invoice[]; plan: string; limit: number | null }>({
    queryKey: ["my-invoices", statusFilter],
    queryFn: async () => {
      const qs = statusFilter !== "all" ? `?status=${statusFilter}` : "";
      const r = await authFetch(`/api/invoices/my${qs}`);
      if (!r.ok) throw new Error("Failed to load invoices");
      return r.json();
    },
    enabled: hasInvoiceAccess,
    staleTime: 30_000,
  });

  const updateStatus = useCallback((id: number, status: InvoiceStatus) => {
    qc.setQueryData<{ invoices: Invoice[]; plan: string; limit: number | null }>(
      ["my-invoices", statusFilter],
      (old) => {
        if (!old) return old;
        return {
          ...old,
          invoices: old.invoices.map(inv => inv.id === id ? { ...inv, status } : inv),
        };
      }
    );
    if (selectedInvoice?.id === id) {
      setSelectedInvoice(prev => prev ? { ...prev, status } : prev);
    }
  }, [statusFilter, selectedInvoice, qc]);

  const atLimit = invoiceLimit !== null && (countData?.used ?? 0) >= invoiceLimit;

  if (!isLoaded) {
    return <View style={[S.root, { backgroundColor: colors.background }]}><ActivityIndicator color={colors.primary} style={{ marginTop: 80 }} /></View>;
  }

  // ── Free / unauthenticated gate ───────────────────────────────────────────
  if (!hasInvoiceAccess) {
    return (
      <View style={[S.root, { backgroundColor: colors.background }]}>
        <View style={[S.screenHeader, { paddingTop: insets.top + 16, borderBottomColor: colors.border }]}>
          <Text style={[S.screenTitle, { color: colors.foreground }]}>Invoices</Text>
        </View>
        <PlanGate onUpgrade={() => setShowMembership(true)} colors={colors} insets={insets} />
        <MembershipModal visible={showMembership} onClose={() => setShowMembership(false)} />
      </View>
    );
  }

  const invoices = invoiceData?.invoices ?? [];

  return (
    <View style={[S.root, { backgroundColor: colors.background }]}>
      {/* Header */}
      <LinearGradient
        colors={[colors.primary, colors.primary + "cc"]}
        start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
        style={[S.heroHeader, { paddingTop: insets.top + 16 }]}
      >
        <View style={S.heroRow}>
          <View>
            <Text style={S.heroTitle}>Invoices</Text>
            <Text style={S.heroSub}>Manage and send invoices</Text>
          </View>
          <TouchableOpacity
            style={[S.createBtn, atLimit && S.createBtnDisabled]}
            onPress={() => {
              if (atLimit) {
                Alert.alert(
                  "Monthly limit reached",
                  `You've used all ${invoiceLimit} invoices this month. Upgrade your plan for more.`,
                  [
                    { text: "Cancel", style: "cancel" },
                    { text: "View Plans", onPress: () => setShowMembership(true) },
                  ]
                );
                return;
              }
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              setShowCreate(true);
            }}
          >
            <Feather name="plus" size={20} color="#fff" />
          </TouchableOpacity>
        </View>
      </LinearGradient>

      <FlatList
        data={invoices}
        keyExtractor={item => String(item.id)}
        contentContainerStyle={[S.list, { paddingBottom: insets.bottom + 100 }]}
        refreshControl={
          <RefreshControl refreshing={isRefetching} onRefresh={() => { refetch(); qc.invalidateQueries({ queryKey: ["invoice-count"] }); }} tintColor={colors.primary} />
        }
        showsVerticalScrollIndicator={false}
        ListHeaderComponent={
          <View>
            {/* Usage bar */}
            {countData && (
              <UsageBar
                used={countData.used}
                limit={invoiceLimit}
                planName={planName}
                colors={colors}
              />
            )}

            {/* Status filter tabs */}
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={S.tabsScroll} contentContainerStyle={S.tabsContent}>
              {STATUS_TABS.map(tab => {
                const active = statusFilter === tab;
                const meta = tab !== "all" ? STATUS_META[tab] : null;
                return (
                  <TouchableOpacity
                    key={tab}
                    style={[
                      S.tab,
                      active
                        ? { backgroundColor: meta ? meta.color : colors.primary }
                        : { backgroundColor: colors.card, borderColor: colors.border },
                    ]}
                    onPress={() => { Haptics.selectionAsync(); setStatusFilter(tab); }}
                  >
                    <Text style={[S.tabTxt, { color: active ? "#fff" : colors.mutedForeground }]}>
                      {tab === "all" ? "All" : STATUS_META[tab].label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </View>
        }
        ListEmptyComponent={
          isLoading ? (
            <ActivityIndicator color={colors.primary} style={{ marginTop: 60 }} />
          ) : (
            <View style={S.empty}>
              <View style={[S.emptyIcon, { backgroundColor: colors.primary + "15" }]}>
                <Feather name="file-text" size={36} color={colors.primary} />
              </View>
              <Text style={[S.emptyTitle, { color: colors.foreground }]}>
                {statusFilter === "all" ? "No invoices yet" : `No ${statusFilter} invoices`}
              </Text>
              <Text style={[S.emptySub, { color: colors.mutedForeground }]}>
                {statusFilter === "all" ? "Tap + to create your first invoice" : "Try a different filter"}
              </Text>
            </View>
          )
        }
        renderItem={({ item }) => (
          <InvoiceCard
            invoice={item}
            colors={colors}
            onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setSelectedInvoice(item); }}
          />
        )}
      />

      {/* Detail modal */}
      {selectedInvoice && (
        <InvoiceDetailModal
          invoice={selectedInvoice}
          onClose={() => setSelectedInvoice(null)}
          onStatusChange={updateStatus}
          colors={colors}
          getToken={getToken}
        />
      )}

      {/* Create modal */}
      {showCreate && (
        <CreateInvoiceModal
          onClose={() => setShowCreate(false)}
          onCreated={() => {
            setShowCreate(false);
            refetch();
            qc.invalidateQueries({ queryKey: ["invoice-count"] });
          }}
          getToken={getToken}
          colors={colors}
        />
      )}

      <MembershipModal visible={showMembership} onClose={() => setShowMembership(false)} />
    </View>
  );
}

const S = StyleSheet.create({
  root: { flex: 1 },
  heroHeader: { paddingHorizontal: 20, paddingBottom: 18 },
  heroRow: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between" },
  heroTitle: { fontSize: 22, fontWeight: "800", color: "#fff", fontFamily: "Inter_700Bold" },
  heroSub: { fontSize: 12, color: "rgba(255,255,255,0.75)", fontFamily: "Inter_400Regular", marginTop: 2 },
  createBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: "rgba(255,255,255,0.22)", alignItems: "center", justifyContent: "center" },
  createBtnDisabled: { opacity: 0.5 },

  screenHeader: { paddingHorizontal: 20, paddingBottom: 14, borderBottomWidth: StyleSheet.hairlineWidth },
  screenTitle: { fontSize: 22, fontWeight: "800", fontFamily: "Inter_700Bold" },

  list: { paddingHorizontal: 16, paddingTop: 14 },

  tabsScroll: { marginBottom: 12 },
  tabsContent: { gap: 8, paddingBottom: 2 },
  tab: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20, borderWidth: 1 },
  tabTxt: { fontSize: 12, fontWeight: "600", fontFamily: "Inter_600SemiBold" },

  empty: { alignItems: "center", marginTop: 60, gap: 12, paddingHorizontal: 24 },
  emptyIcon: { width: 72, height: 72, borderRadius: 36, alignItems: "center", justifyContent: "center" },
  emptyTitle: { fontSize: 17, fontWeight: "700", fontFamily: "Inter_700Bold", textAlign: "center" },
  emptySub: { fontSize: 13, fontFamily: "Inter_400Regular", textAlign: "center" },
});
