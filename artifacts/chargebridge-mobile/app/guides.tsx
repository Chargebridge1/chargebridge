import React, { useState } from "react";
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, Linking,
} from "react-native";
import { Feather, Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import * as Haptics from "expo-haptics";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/useColors";

type GuideId = "levels" | "connectors" | "etiquette" | "range" | "costs" | "ocpp";

interface Guide {
  id: GuideId;
  icon: string;
  iconLib: "ion" | "feather";
  title: string;
  summary: string;
  content: React.ReactNode;
}

function LevelChip({ name, power, speed, outlet, best, color, textColor }: {
  name: string; power: string; speed: string; outlet: string; best: string;
  color: string; textColor: string;
}) {
  return (
    <View style={[GL.tierCard, { backgroundColor: color + "22", borderColor: color + "55" }]}>
      <Text style={[GL.tierName, { color: textColor }]}>{name}</Text>
      <View style={GL.tierRow}><Text style={[GL.tierKey, { color: textColor }]}>Power: </Text><Text style={[GL.tierVal, { color: textColor + "cc" }]}>{power}</Text></View>
      <View style={GL.tierRow}><Text style={[GL.tierKey, { color: textColor }]}>Speed: </Text><Text style={[GL.tierVal, { color: textColor + "cc" }]}>{speed}</Text></View>
      <View style={GL.tierRow}><Text style={[GL.tierKey, { color: textColor }]}>Outlet: </Text><Text style={[GL.tierVal, { color: textColor + "cc" }]}>{outlet}</Text></View>
      <View style={[GL.tierBestRow, { borderTopColor: textColor + "30" }]}>
        <Text style={[GL.tierKey, { color: textColor }]}>Best for: </Text>
        <Text style={[GL.tierVal, { color: textColor + "cc" }]}>{best}</Text>
      </View>
    </View>
  );
}

function InfoRow({ emoji, title, detail }: { emoji: string; title: string; detail: string }) {
  const colors = useColors();
  return (
    <View style={[GL.infoRow, { backgroundColor: colors.muted + "66", borderColor: colors.border }]}>
      <Text style={GL.infoEmoji}>{emoji}</Text>
      <View style={{ flex: 1 }}>
        <Text style={[GL.infoTitle, { color: colors.foreground }]}>{title}</Text>
        <Text style={[GL.infoDetail, { color: colors.mutedForeground }]}>{detail}</Text>
      </View>
    </View>
  );
}

function FactorCard({ factor, impact, detail, colors }: { factor: string; impact: string; detail: string; colors: ReturnType<typeof useColors> }) {
  return (
    <View style={[GL.factorCard, { backgroundColor: colors.muted + "55", borderColor: colors.border }]}>
      <View style={GL.factorHeader}>
        <Text style={[GL.factorName, { color: colors.foreground }]}>{factor}</Text>
        <View style={GL.impactBadge}>
          <Text style={GL.impactTxt}>{impact}</Text>
        </View>
      </View>
      <Text style={[GL.factorDetail, { color: colors.mutedForeground }]}>{detail}</Text>
    </View>
  );
}

function CostCard({ model, example, pros, cons, colors }: { model: string; example: string; pros: string; cons: string; colors: ReturnType<typeof useColors> }) {
  return (
    <View style={[GL.costCard, { backgroundColor: colors.muted + "55", borderColor: colors.border }]}>
      <View style={GL.costHeader}>
        <Text style={[GL.costModel, { color: colors.foreground }]}>{model}</Text>
        <View style={[GL.costBadge, { backgroundColor: colors.primary + "18" }]}>
          <Text style={[GL.costBadgeTxt, { color: colors.primary }]}>{example}</Text>
        </View>
      </View>
      <View style={GL.costRow}>
        <Text style={GL.proIcon}>✓ </Text>
        <Text style={[GL.costTxt, { color: colors.mutedForeground }]}>{pros}</Text>
      </View>
      <View style={GL.costRow}>
        <Text style={GL.conIcon}>✗ </Text>
        <Text style={[GL.costTxt, { color: colors.mutedForeground }]}>{cons}</Text>
      </View>
    </View>
  );
}

function ConnectorCard({ name, icon, cars, levels, note, colors }: { name: string; icon: string; cars: string; levels: string; note: string; colors: ReturnType<typeof useColors> }) {
  return (
    <View style={[GL.connCard, { backgroundColor: colors.muted + "55", borderColor: colors.border }]}>
      <View style={GL.connHeader}>
        <Text style={GL.connIcon}>{icon}</Text>
        <View style={{ flex: 1 }}>
          <Text style={[GL.connName, { color: colors.foreground }]}>{name}</Text>
          <Text style={[GL.connLevels, { color: colors.primary }]}>{levels}</Text>
        </View>
      </View>
      <Text style={[GL.connCars, { color: colors.mutedForeground }]}>Cars: {cars}</Text>
      <Text style={[GL.connNote, { color: colors.mutedForeground }]}>{note}</Text>
    </View>
  );
}

function GuideCard({ guide }: { guide: Guide }) {
  const colors = useColors();
  const [open, setOpen] = useState(false);
  return (
    <View style={[GL.card, { backgroundColor: colors.card, borderColor: open ? colors.primary + "55" : colors.border }]}>
      <TouchableOpacity
        style={GL.cardHeader}
        onPress={() => { Haptics.selectionAsync(); setOpen(v => !v); }}
        activeOpacity={0.8}
      >
        <View style={[GL.iconBox, { backgroundColor: colors.primary + "18" }]}>
          {guide.iconLib === "ion"
            ? <Ionicons name={guide.icon as any} size={20} color={colors.primary} />
            : <Feather name={guide.icon as any} size={20} color={colors.primary} />}
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[GL.cardTitle, { color: colors.foreground }]}>{guide.title}</Text>
          <Text style={[GL.cardSummary, { color: colors.mutedForeground }]}>{guide.summary}</Text>
        </View>
        <Feather name={open ? "chevron-up" : "chevron-down"} size={18} color={colors.mutedForeground} />
      </TouchableOpacity>
      {open && (
        <View style={[GL.body, { borderTopColor: colors.border }]}>
          {guide.content}
        </View>
      )}
    </View>
  );
}

export default function GuidesScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();

  const guides: Guide[] = [
    {
      id: "levels",
      icon: "flash-outline",
      iconLib: "ion",
      title: "Level 1 vs Level 2 vs DC Fast Charging",
      summary: "Understand the three tiers of EV charging and when to use each.",
      content: (
        <View style={{ gap: 10 }}>
          <LevelChip name="Level 1" power="1.4–1.9 kW" speed="~5 miles/hr" outlet="Standard 120V household outlet" best="Overnight at home for short daily commutes" color="#3b82f6" textColor="#1e40af" />
          <LevelChip name="Level 2" power="7–22 kW" speed="~25 miles/hr" outlet="240V outlet or hardwired EVSE" best="Home garage, workplace, hotels, malls" color="#10b981" textColor="#065f46" />
          <LevelChip name="DC Fast" power="50–350 kW" speed="~200+ miles/hr" outlet="Dedicated commercial unit (CCS, CHAdeMO, NACS)" best="Long road trips — 80% in 20–40 minutes" color="#f59e0b" textColor="#92400e" />
          <Text style={[GL.tipBox, { backgroundColor: colors.primary + "12", color: colors.primary, borderColor: colors.primary + "33" }]}>
            💡 Use Level 1 or 2 for overnight charging; DC Fast only for quick top-ups on road trips. Frequent DCFC can slightly increase battery degradation.
          </Text>
        </View>
      ),
    },
    {
      id: "connectors",
      icon: "battery-charging-outline",
      iconLib: "ion",
      title: "Connector Types: J1772, CCS, CHAdeMO, NACS",
      summary: "The plug on your car determines which stations you can use.",
      content: (
        <View style={{ gap: 10 }}>
          <ConnectorCard name="J1772 (Type 1)" icon="🔌" cars="All North American EVs" levels="Level 1 & Level 2" note="Universal AC plug. Every EV sold in North America has one — or an adapter." colors={colors} />
          <ConnectorCard name="CCS (Combo)" icon="⚡" cars="Most non-Tesla EVs (Ford, GM, VW, Hyundai, BMW…)" levels="DC Fast Charging" note="Extends J1772 with two extra DC pins. Becoming the dominant North American DC standard." colors={colors} />
          <ConnectorCard name="CHAdeMO" icon="🔋" cars="Nissan Leaf (older), Mitsubishi Outlander PHEV" levels="DC Fast Charging" note="Japanese standard, now declining. Fewer CHAdeMO stalls being built." colors={colors} />
          <ConnectorCard name="NACS (Tesla / J3400)" icon="🟠" cars="All Tesla; Ford, GM, Rivian, Honda from 2025+" levels="Level 2 & DC Fast" note="Originally Tesla-only. Adopted by SAE as J3400. Rapidly becoming a dominant standard." colors={colors} />
          <Text style={[GL.tipBox, { backgroundColor: colors.primary + "12", color: colors.primary, borderColor: colors.primary + "33" }]}>
            💡 Use ChargeBridge's connector filter to see only stations compatible with your car.
          </Text>
        </View>
      ),
    },
    {
      id: "etiquette",
      icon: "star-outline",
      iconLib: "ion",
      title: "Charging Etiquette: The Unwritten Rules",
      summary: "Keep the charging community happy with these simple courtesies.",
      content: (
        <View style={{ gap: 8 }}>
          <InfoRow emoji="⏱️" title="Move when charging is complete" detail="Staying plugged in after a full charge — 'ICE'ing the spot — is considered rude." />
          <InfoRow emoji="📱" title="Enable charge-complete notifications" detail="Most apps notify you when full. Enable them so you can promptly move on." />
          <InfoRow emoji="🔌" title="Return the cable neatly" detail="Hang it back on the holster or lay flat. Don't leave it on the ground." />
          <InfoRow emoji="⚡" title="Don't unplug another car" detail="Unless it's clearly done and there are no other options, never unplug someone else's vehicle." />
          <InfoRow emoji="🛣️" title="Use DCFC strategically" detail="On road trips, charge to 80% and leave — the last 20% is slow and ties up the charger." />
          <InfoRow emoji="📝" title="Leave a review" detail="Community stations thrive on fresh, accurate reviews. A quick rating helps the next driver." />
        </View>
      ),
    },
    {
      id: "range",
      icon: "map-outline",
      iconLib: "ion",
      title: "Understanding EV Range in the Real World",
      summary: "Your car's EPA range is a starting point, not a guarantee.",
      content: (
        <View style={{ gap: 8 }}>
          <Text style={[GL.bodyText, { color: colors.mutedForeground }]}>
            EV range varies significantly with real-world conditions. Here's what affects how far you'll actually go:
          </Text>
          <FactorCard factor="Temperature" impact="−20–40%" detail="Battery chemistry slows below 40°F. Pre-conditioning (warming on charger power) helps." colors={colors} />
          <FactorCard factor="Highway speed" impact="−20–30%" detail="Aerodynamic drag grows with speed. 75 mph uses much more energy than 55 mph." colors={colors} />
          <FactorCard factor="Climate control" impact="−5–15%" detail="HVAC is a major energy draw. Heated seats use less power than heating the whole cabin." colors={colors} />
          <FactorCard factor="Cargo & passengers" impact="−3–8%" detail="Every 100 lbs reduces range by roughly 1–2%." colors={colors} />
          <FactorCard factor="Tire pressure" impact="±3–5%" detail="Under-inflated tires increase rolling resistance. Check monthly." colors={colors} />
          <FactorCard factor="Elevation" impact="Varies" detail="Hills use more energy going up, but regenerative braking recovers much of it descending." colors={colors} />
          <Text style={[GL.tipBox, { backgroundColor: colors.primary + "12", color: colors.primary, borderColor: colors.primary + "33" }]}>
            💡 Plan charging stops at 80% of EPA range intervals in summer, 60% in winter.
          </Text>
        </View>
      ),
    },
    {
      id: "costs",
      icon: "card-outline",
      iconLib: "ion",
      title: "How EV Charging Costs Work",
      summary: "Per-kWh, per-minute, session fees — here's how to compare them.",
      content: (
        <View style={{ gap: 8 }}>
          <Text style={[GL.bodyText, { color: colors.mutedForeground }]}>
            Public networks use different billing models that make price comparisons tricky.
          </Text>
          <CostCard model="Per kWh" example="$0.39/kWh" pros="Most fair — you pay for what you use" cons="Not allowed in all US states" colors={colors} />
          <CostCard model="Per minute" example="$0.14/min" pros="Simple, predictable" cons="Penalizes slower-charging cars" colors={colors} />
          <CostCard model="Per session" example="$1–3 flat fee" pros="Predictable for short stops" cons="Bad value for long sessions" colors={colors} />
          <CostCard model="Membership" example="$7–40/month" pros="Big savings for frequent users" cons="Only worthwhile at that specific network" colors={colors} />
          <Text style={[GL.bodyText, { color: colors.mutedForeground }]}>
            ChargeBridge shows community-reported $/kWh where available.
          </Text>
        </View>
      ),
    },
    {
      id: "ocpp",
      icon: "book-outline",
      iconLib: "ion",
      title: "What is OCPP and Why Does It Matter?",
      summary: "The open protocol that lets ChargeBridge pay directly at independent stations.",
      content: (
        <View style={{ gap: 10 }}>
          <Text style={[GL.bodyText, { color: colors.mutedForeground }]}>
            <Text style={{ color: colors.foreground, fontWeight: "700" }}>OCPP</Text> (Open Charge Point Protocol) is an open communication standard between EV charger hardware and a back-end network — the "HTTP for charging stations."
          </Text>
          <View style={[GL.ocppBox, { backgroundColor: colors.primary + "10", borderColor: colors.primary + "30" }]}>
            <View style={GL.ocppHeader}>
              <Ionicons name="flash" size={16} color={colors.primary} />
              <Text style={[GL.ocppTitle, { color: colors.foreground }]}>How Direct Pay works</Text>
            </View>
            {[
              "Station owner installs an OCPP-compatible charger and connects it to ChargeBridge",
              'Charger appears in the directory with a "Direct Pay" badge',
              'Driver finds the station, taps "Charge Now", and pays via the app',
              "ChargeBridge sends a remote start command via OCPP — the charger unlocks",
              "Session stops when the driver ends it or the car is full; receipt is emailed",
            ].map((step, i) => (
              <View key={i} style={GL.stepRow}>
                <View style={[GL.stepNum, { backgroundColor: colors.primary }]}>
                  <Text style={GL.stepNumTxt}>{i + 1}</Text>
                </View>
                <Text style={[GL.stepTxt, { color: colors.mutedForeground }]}>{step}</Text>
              </View>
            ))}
          </View>
          <TouchableOpacity
            style={[GL.connectBtn, { borderColor: colors.primary + "44", backgroundColor: colors.primary + "0e" }]}
            onPress={() => {
              Haptics.selectionAsync();
              Linking.openURL(`https://${process.env.EXPO_PUBLIC_DOMAIN}/operators`);
            }}
            activeOpacity={0.8}
          >
            <Text style={[GL.connectBtnTxt, { color: colors.primary }]}>Connect your own charger →</Text>
            <Feather name="external-link" size={13} color={colors.primary} />
          </TouchableOpacity>
        </View>
      ),
    },
  ];

  return (
    <View style={[GL.root, { backgroundColor: colors.background }]}>
      {/* Header */}
      <View style={[GL.header, { paddingTop: insets.top + 14, borderBottomColor: colors.border, backgroundColor: colors.background }]}>
        <TouchableOpacity onPress={() => { Haptics.selectionAsync(); router.back(); }} style={GL.backBtn} activeOpacity={0.7}>
          <Feather name="arrow-left" size={22} color={colors.foreground} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={[GL.title, { color: colors.foreground }]}>EV Driver Guides</Text>
          <Text style={[GL.subtitle, { color: colors.mutedForeground }]}>Everything about EV charging</Text>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 40, gap: 12 }}
        showsVerticalScrollIndicator={false}
      >
        {guides.map(guide => <GuideCard key={guide.id} guide={guide} />)}
      </ScrollView>
    </View>
  );
}

const GL = StyleSheet.create({
  root: { flex: 1 },
  header: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 16, paddingBottom: 14, borderBottomWidth: StyleSheet.hairlineWidth },
  backBtn: { padding: 4 },
  title: { fontSize: 20, fontWeight: "800", fontFamily: "Inter_700Bold" },
  subtitle: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 1 },

  card: { borderRadius: 16, borderWidth: 1, overflow: "hidden" },
  cardHeader: { flexDirection: "row", alignItems: "flex-start", gap: 12, padding: 16 },
  iconBox: { width: 40, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center", flexShrink: 0 },
  cardTitle: { fontSize: 14, fontWeight: "700", fontFamily: "Inter_700Bold", lineHeight: 19 },
  cardSummary: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2, lineHeight: 16 },
  body: { padding: 16, borderTopWidth: StyleSheet.hairlineWidth },

  tierCard: { borderRadius: 12, borderWidth: 1, padding: 12 },
  tierName: { fontSize: 14, fontWeight: "800", fontFamily: "Inter_700Bold", marginBottom: 8 },
  tierRow: { flexDirection: "row", marginBottom: 3 },
  tierKey: { fontSize: 12, fontWeight: "600", fontFamily: "Inter_600SemiBold" },
  tierVal: { fontSize: 12, fontFamily: "Inter_400Regular", flex: 1 },
  tierBestRow: { flexDirection: "row", flexWrap: "wrap", marginTop: 8, paddingTop: 8, borderTopWidth: StyleSheet.hairlineWidth },

  infoRow: { flexDirection: "row", alignItems: "flex-start", gap: 12, padding: 12, borderRadius: 12, borderWidth: 1 },
  infoEmoji: { fontSize: 20, lineHeight: 24 },
  infoTitle: { fontSize: 12, fontWeight: "700", fontFamily: "Inter_700Bold" },
  infoDetail: { fontSize: 11, fontFamily: "Inter_400Regular", marginTop: 2, lineHeight: 15 },

  factorCard: { borderRadius: 12, borderWidth: 1, padding: 12 },
  factorHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 4 },
  factorName: { fontSize: 13, fontWeight: "700", fontFamily: "Inter_700Bold" },
  impactBadge: { backgroundColor: "#fef3c720", borderRadius: 10, paddingHorizontal: 8, paddingVertical: 2 },
  impactTxt: { fontSize: 10, fontWeight: "700", color: "#b45309", fontFamily: "Inter_700Bold" },
  factorDetail: { fontSize: 11, fontFamily: "Inter_400Regular", lineHeight: 15 },

  costCard: { borderRadius: 12, borderWidth: 1, padding: 12 },
  costHeader: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 8 },
  costModel: { fontSize: 13, fontWeight: "700", fontFamily: "Inter_700Bold" },
  costBadge: { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 2 },
  costBadgeTxt: { fontSize: 11, fontWeight: "700", fontFamily: "Inter_700Bold" },
  costRow: { flexDirection: "row", marginBottom: 2 },
  proIcon: { fontSize: 12, color: "#10b981", fontWeight: "700" },
  conIcon: { fontSize: 12, color: "#ef4444", fontWeight: "700" },
  costTxt: { fontSize: 11, fontFamily: "Inter_400Regular", flex: 1, lineHeight: 15 },

  connCard: { borderRadius: 12, borderWidth: 1, padding: 12 },
  connHeader: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 6 },
  connIcon: { fontSize: 22 },
  connName: { fontSize: 13, fontWeight: "700", fontFamily: "Inter_700Bold" },
  connLevels: { fontSize: 11, fontFamily: "Inter_400Regular", marginTop: 1 },
  connCars: { fontSize: 11, fontFamily: "Inter_400Regular", marginBottom: 4 },
  connNote: { fontSize: 11, fontFamily: "Inter_400Regular", lineHeight: 15 },

  ocppBox: { borderRadius: 12, borderWidth: 1, padding: 14, gap: 10 },
  ocppHeader: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 4 },
  ocppTitle: { fontSize: 13, fontWeight: "700", fontFamily: "Inter_700Bold" },
  stepRow: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  stepNum: { width: 20, height: 20, borderRadius: 10, alignItems: "center", justifyContent: "center", flexShrink: 0 },
  stepNumTxt: { fontSize: 10, fontWeight: "800", color: "#fff", fontFamily: "Inter_700Bold" },
  stepTxt: { fontSize: 12, fontFamily: "Inter_400Regular", flex: 1, lineHeight: 16 },

  connectBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, borderRadius: 10, borderWidth: 1, paddingVertical: 10, paddingHorizontal: 14 },
  connectBtnTxt: { fontSize: 13, fontWeight: "600", fontFamily: "Inter_600SemiBold" },

  bodyText: { fontSize: 13, fontFamily: "Inter_400Regular", lineHeight: 18 },
  tipBox: { fontSize: 12, fontFamily: "Inter_600SemiBold", borderRadius: 10, borderWidth: 1, padding: 12, lineHeight: 17 },
});
