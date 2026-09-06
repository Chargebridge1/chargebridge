import React, { useCallback, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { TouchableOpacity } from "react-native-gesture-handler";
import { useRouter, usePathname } from "expo-router";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";

import { TabBar as TabBarTokens, NavPillEdit } from "@/constants/motion";
import { tokens } from "@workspace/design-tokens";
import { NAV_PILLS, PillId } from "@/constants/navPills";
import { useNavPills } from "@/contexts/NavPillContext";
import { EditableTabBar } from "./EditableTabBar";
import { NavPillCoachMark } from "./NavPillCoachMark";
import { TabBarShell } from "./TabBarShell";
import { NavPillIcon } from "./NavPillIcon";
import { track } from "@/lib/analytics";
import { makeResetHandler } from "@/utils/makeResetHandler";
import { makeDoneHandler } from "@/utils/makeDoneHandler";

// ─────────────────────────────────────────────────────────────────────────────
// CustomTabBar — absolutely-positioned dark glass tab bar.
//
// Rendered from AppShell (NOT via expo-router's tabBar prop) so it lives
// outside the tab navigator and has full access to NavPillContext.
// Navigation is driven by useRouter() + usePathname() from expo-router.
// Glass chrome is owned by TabBarShell; platform icons by NavPillIcon.
// ─────────────────────────────────────────────────────────────────────────────

const T            = tokens.colors.dark.tabBar;
const ACTIVE_TINT  = T.activeTint;
const INACTIVE_TINT = `rgba(255,255,255,${TabBarTokens.inactiveOpacity})`;

// Written the first time the user opens Edit Mode. When present the "Customize"
// text label collapses to the icon alone on subsequent launches.
const CUSTOMIZE_SEEN_KEY = "CB_CUSTOMIZE_BTN_SEEN_V1";

// Segments of the path that identify each tab.
const ACTIVE_SEGMENTS: Record<PillId, string> = {
  home:     "/home",
  map:      "/map",
  charge:   "/charge",
  activity: "/activity",
  account:  "/account",
};

function pillIsActive(id: PillId, pathname: string): boolean {
  return pathname.includes(ACTIVE_SEGMENTS[id]);
}

// ── Per-pill icon ─────────────────────────────────────────────────────────────
// Wraps NavPillIcon with the special containers the map and charge tabs need.

interface TabPillIconProps {
  id:       PillId;
  isActive: boolean;
}

function TabPillIcon({ id, isActive }: TabPillIconProps) {
  const color = isActive ? ACTIVE_TINT : INACTIVE_TINT;

  if (id === "map") {
    return (
      <View style={[LS.navPillWrap, isActive && LS.navPillWrapActive]}>
        <NavPillIcon
          id={id}
          tintColor={isActive ? T.navPillIcon : (color as string)}
          size={20}
        />
      </View>
    );
  }

  if (id === "charge") {
    return (
      <View style={[LS.ctaWrap, isActive && LS.ctaWrapActive]}>
        <NavPillIcon id={id} tintColor={T.ctaIcon} size={22} />
      </View>
    );
  }

  return <NavPillIcon id={id} tintColor={color as string} size={22} />;
}

// ── Single tab button ─────────────────────────────────────────────────────────

interface TabButtonProps {
  id:          PillId;
  isActive:    boolean;
  onPress:     () => void;
  onLongPress: () => void;
}

function TabButton({ id, isActive, onPress, onLongPress }: TabButtonProps) {
  const pill = NAV_PILLS[id];
  return (
    <TouchableOpacity
      style={[LS.tabBtn, id === "charge" && LS.tabBtnCharge]}
      onPress={onPress}
      onLongPress={onLongPress}
      delayLongPress={NavPillEdit.longPressDelayMs}
      accessibilityRole="tab"
      accessibilityLabel={`${pill.label} tab`}
      accessibilityState={{ selected: isActive }}
      accessibilityHint="Long press to customise navigation"
    >
      <TabPillIcon id={id} isActive={isActive} />
    </TouchableOpacity>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function CustomTabBar() {
  const router   = useRouter();
  const pathname = usePathname();
  const {
    visiblePills,
    layout,
    isEditMode,
    enterEditMode,
    exitEditMode,
    savePillLayout,
    resetToDefault,
  } = useNavPills();

  // ── DIAGNOSTIC: log every render so TestFlight logs show whether the
  //   state update from setIsEditMode(true) is propagating to this component.
  console.log("[NavPill][DIAG] CustomTabBar render — isEditMode:", isEditMode);

  // ── Customize button discoverability ──────────────────────────────────────
  // The label is always shown on every fresh launch so the entry point is
  // never invisible to new users. It collapses within the current session
  // after the user first enters Edit Mode (fine — they already know about it).
  // Previously the label was permanently hidden after first use (stored in
  // AsyncStorage), which caused TestFlight testers to never find the feature.
  const [showCustomizeLabel, setShowCustomizeLabel] = useState(true);

  // ── Handlers ─────────────────────────────────────────────────────────────

  const handlePress = useCallback(
    (id: PillId) => { router.navigate(NAV_PILLS[id].route as never); },
    [router],
  );

  const handleLongPress = useCallback(() => {
    console.log("[NavPill][DIAG] handleLongPress fired — isEditMode before:", isEditMode);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    track("navigation_edit_started", { entry_point: "long_press" });
    void AsyncStorage.setItem(CUSTOMIZE_SEEN_KEY, "1");
    setShowCustomizeLabel(false);
    console.log("[NavPill][DIAG] calling enterEditMode() from long_press");
    enterEditMode();
    console.log("[NavPill][DIAG] enterEditMode() returned (long_press)");
  }, [enterEditMode, isEditMode]);

  const handleCoachMarkPress = useCallback(() => {
    console.log("[NavPill][DIAG] handleCoachMarkPress fired — isEditMode before:", isEditMode);
    track("navigation_edit_started", { entry_point: "coachmark" });
    void AsyncStorage.setItem(CUSTOMIZE_SEEN_KEY, "1");
    setShowCustomizeLabel(false);
    console.log("[NavPill][DIAG] calling enterEditMode() from coachmark");
    enterEditMode();
    console.log("[NavPill][DIAG] enterEditMode() returned (coachmark)");
  }, [enterEditMode, isEditMode]);

  const handleCustomizePress = useCallback(() => {
    console.log("[NavPill][DIAG] handleCustomizePress fired — isEditMode before:", isEditMode);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    track("navigation_edit_started", { entry_point: "customize_button" });
    void AsyncStorage.setItem(CUSTOMIZE_SEEN_KEY, "1");
    setShowCustomizeLabel(false);
    console.log("[NavPill][DIAG] calling enterEditMode() from customize_button");
    enterEditMode();
    console.log("[NavPill][DIAG] enterEditMode() returned (customize_button)");
  }, [enterEditMode, isEditMode]);

  // ── Edit mode ─────────────────────────────────────────────────────────────
  if (isEditMode) {
    return (
      <EditableTabBar
        initialOrder={layout.order}
        initialHidden={layout.hidden}
        onDone={makeDoneHandler(exitEditMode, savePillLayout)}
        onReset={makeResetHandler(exitEditMode, resetToDefault)}
      />
    );
  }

  return (
    <>
      <TabBarShell accessibilityRole="tablist" pointerEvents="box-none">
        {/* Pill row */}
        <View style={LS.row} pointerEvents="box-none">
          {visiblePills.map((id) => (
            <TabButton
              key={id}
              id={id}
              isActive={pillIsActive(id, pathname)}
              onPress={() => handlePress(id)}
              onLongPress={handleLongPress}
            />
          ))}
        </View>

        {/* Customize entry point.
            First launch: icon + "Customize" label with a subtle pill background.
            After first use: icon only (16 px, 60% opacity). */}
        <TouchableOpacity
          style={[LS.customizeBtn, showCustomizeLabel && LS.customizeBtnExpanded]}
          onPress={handleCustomizePress}
          accessibilityRole="button"
          accessibilityLabel="Customise navigation"
          accessibilityHint="Opens the navigation layout editor"
          onLayout={(e) => {
            const { x, y, width, height } = e.nativeEvent.layout;
            console.log(
              "[NavPill][DIAG] Customize button layout — x:", Math.round(x),
              "y:", Math.round(y),
              "w:", Math.round(width),
              "h:", Math.round(height),
              "| hit area covers y:", Math.round(y), "→", Math.round(y + height),
            );
          }}
        >
          <Feather
            name="sliders"
            size={16}
            color={showCustomizeLabel ? "rgba(255,255,255,0.65)" : "rgba(255,255,255,0.60)"}
          />
          {showCustomizeLabel && (
            <Text style={LS.customizeLbl}>Customize</Text>
          )}
        </TouchableOpacity>
      </TabBarShell>

      {/* Coach mark — shown once on first dashboard visit */}
      <NavPillCoachMark onPress={handleCoachMarkPress} />
    </>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const LS = StyleSheet.create({
  row: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-around",
    paddingTop: 8,
  },
  tabBtn: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 4,
    minHeight: 44,
  },
  tabBtnCharge: {
    marginTop: -16,
  },
  // Map tab — pill-shaped highlight when active
  navPillWrap: {
    width: 44,
    height: 28,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "transparent",
  },
  navPillWrapActive: {
    backgroundColor: T.navPillSurface,
  },
  // Charge tab — floating CTA circle
  ctaWrap: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: T.ctaSurface,
    shadowColor: T.shadowColor,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.22,
    shadowRadius: TabBarTokens.ctaShadowRadius,
    elevation: 8,
  },
  ctaWrapActive: {
    backgroundColor: T.ctaSurfacePress,
  },
  // Customize button — sits top-right of the bar
  customizeBtn: {
    position: "absolute",
    top: 6,
    right: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 10,
  },
  customizeBtnExpanded: {
    backgroundColor: "rgba(255,255,255,0.08)",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(255,255,255,0.14)",
  },
  customizeLbl: {
    color: "rgba(255,255,255,0.65)",
    fontSize: 12,
    fontFamily: "Inter_500Medium",
  },
});
