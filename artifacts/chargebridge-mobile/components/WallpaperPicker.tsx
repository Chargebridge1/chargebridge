import React from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Modal,
  FlatList,
  Image,
  Alert,
  Platform,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { Feather, Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Haptics from "expo-haptics";
import * as ImagePicker from "expo-image-picker";
import {
  PRESETS,
  MAX_SAVED_PHOTOS,
  useWallpaper,
  useWallpaperRaw,
  TabKey,
} from "@/contexts/WallpaperContext";
import { useColors } from "@/hooks/useColors";

// ── Gradient / photo layer rendered absolutely behind tab content ──────────────
export function WallpaperLayer({ tab }: { tab: TabKey }) {
  const { preset, isDefault, isPhoto, photoUri } = useWallpaper(tab);

  if (isPhoto && photoUri) {
    return (
      <Image
        source={{ uri: photoUri }}
        style={StyleSheet.absoluteFill}
        resizeMode="cover"
      />
    );
  }
  if (isDefault) return null;
  return (
    <LinearGradient
      colors={[...preset.colors] as [string, string, ...string[]]}
      start={preset.start ?? { x: 0, y: 0 }}
      end={preset.end ?? { x: 1, y: 1 }}
      style={StyleSheet.absoluteFill}
    />
  );
}

// ── Shared helper: open image picker and return URI ───────────────────────────
async function pickImage(): Promise<string | null> {
  if (Platform.OS !== "web") {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== "granted") {
      Alert.alert(
        "Permission needed",
        "Allow access to your photo library so you can set a custom wallpaper.",
      );
      return null;
    }
  }
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ImagePicker.MediaTypeOptions.Images,
    allowsEditing: true,
    aspect: [9, 19],
    quality: 0.85,
  });
  return result.canceled ? null : (result.assets[0]?.uri ?? null);
}

// ── Saved-photo grid (up to MAX_SAVED_PHOTOS slots) ──────────────────────────
function SavedPhotosGrid({
  savedPhotos,
  activeUri,
  onSelect,
  onRemove,
  onAdd,
}: {
  savedPhotos: string[];
  activeUri: string | null;
  onSelect: (uri: string) => void;
  onRemove: (uri: string) => void;
  onAdd: () => void;
}) {
  const colors = useColors();

  // Build a fixed array of MAX_SAVED_PHOTOS slots; remaining slots show "+"
  const slots: Array<string | "add" | "empty"> = [
    ...savedPhotos,
    ...(savedPhotos.length < MAX_SAVED_PHOTOS ? (["add"] as const) : []),
    ...Array(Math.max(0, MAX_SAVED_PHOTOS - savedPhotos.length - 1)).fill("empty"),
  ];

  return (
    <View style={PK.photoGrid}>
      {slots.map((slot, i) => {
        if (slot === "add") {
          return (
            <TouchableOpacity
              key="add"
              style={[PK.photoSlot, { borderColor: colors.primary + "60", borderStyle: "dashed", backgroundColor: colors.primary + "08" }]}
              onPress={onAdd}
              activeOpacity={0.75}
            >
              <Ionicons name="add" size={26} color={colors.primary} />
              <Text style={[PK.photoSlotAddTxt, { color: colors.primary }]}>
                Add{savedPhotos.length > 0 ? `\n${savedPhotos.length}/${MAX_SAVED_PHOTOS}` : " photo"}
              </Text>
            </TouchableOpacity>
          );
        }

        if (slot === "empty") {
          return (
            <View
              key={`empty-${i}`}
              style={[PK.photoSlot, { borderColor: colors.border, backgroundColor: colors.muted + "33" }]}
            >
              <Feather name="image" size={20} color={colors.border} />
            </View>
          );
        }

        // Filled photo slot
        const uri = slot as string;
        const isActive = uri === activeUri;
        return (
          <View key={uri} style={PK.photoSlotWrap}>
            <TouchableOpacity
              style={[
                PK.photoSlot,
                {
                  borderColor: isActive ? "#0D9E7E" : colors.border,
                  borderWidth: isActive ? 3 : 1.5,
                  overflow: "hidden",
                },
              ]}
              onPress={() => { Haptics.selectionAsync(); onSelect(uri); }}
              activeOpacity={0.82}
            >
              <Image source={{ uri }} style={StyleSheet.absoluteFill} resizeMode="cover" />
              {isActive && (
                <View style={PK.activeOverlay}>
                  <View style={PK.activeCheck}>
                    <Ionicons name="checkmark" size={14} color="#fff" />
                  </View>
                </View>
              )}
            </TouchableOpacity>
            {/* Remove button */}
            <TouchableOpacity
              style={[PK.removeSlotBtn, { backgroundColor: colors.background }]}
              onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); onRemove(uri); }}
              hitSlop={{ top: 6, right: 6, bottom: 6, left: 6 }}
            >
              <Ionicons name="close-circle" size={20} color="#ef4444" />
            </TouchableOpacity>
          </View>
        );
      })}
    </View>
  );
}

// ── Bottom-sheet picker (single tab) ─────────────────────────────────────────
const TAB_LABELS: Record<TabKey, string> = {
  home: "Home",
  nearby: "Nearby",
  gas: "Gas",
  explore: "Explore",
  profile: "Profile",
  map: "Map",
  charge: "Charge",
  activity: "Activity",
};

export function WallpaperPicker({
  tab,
  visible,
  onClose,
}: {
  tab: TabKey;
  visible: boolean;
  onClose: () => void;
}) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { presetId, photoUri, isPhoto, setWallpaper, setPhotoWallpaper } = useWallpaper(tab);
  const { savedPhotos, addSavedPhoto, removeSavedPhoto } = useWallpaperRaw();

  async function handleAddPhoto() {
    const uri = await pickImage();
    if (!uri) return;
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    addSavedPhoto(uri);
    setPhotoWallpaper(uri);
    onClose();
  }

  function handleSelectPhoto(uri: string) {
    setPhotoWallpaper(uri);
    onClose();
  }

  function handleRemovePhoto(uri: string) {
    removeSavedPhoto(uri);
    // If it was the active wallpaper, clear it
    if (photoUri === uri) setPhotoWallpaper(null);
  }

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <View style={[PK.root, { backgroundColor: colors.background }]}>
        {/* Header */}
        <View style={[PK.header, { paddingTop: 20, borderBottomColor: colors.border }]}>
          <View style={{ flex: 1 }}>
            <Text style={[PK.title, { color: colors.foreground }]}>Wallpaper</Text>
            <Text style={[PK.sub, { color: colors.mutedForeground }]}>
              {TAB_LABELS[tab]} tab background
            </Text>
          </View>
          <TouchableOpacity
            style={[PK.closeBtn, { backgroundColor: colors.muted }]}
            onPress={onClose}
            activeOpacity={0.8}
          >
            <Feather name="x" size={18} color={colors.foreground} />
          </TouchableOpacity>
        </View>

        {/* My Photos section */}
        <View style={[PK.photoSection, { borderBottomColor: colors.border }]}>
          <View style={PK.sectionRow}>
            <Text style={[PK.sectionHeading, { color: colors.mutedForeground }]}>MY PHOTOS</Text>
            <Text style={[PK.sectionCount, { color: colors.mutedForeground }]}>
              {savedPhotos.length}/{MAX_SAVED_PHOTOS} saved
            </Text>
          </View>
          <SavedPhotosGrid
            savedPhotos={savedPhotos}
            activeUri={isPhoto ? (photoUri ?? null) : null}
            onSelect={handleSelectPhoto}
            onRemove={handleRemovePhoto}
            onAdd={handleAddPhoto}
          />
          {isPhoto && (
            <TouchableOpacity
              style={[PK.clearPhotoBtn, { borderColor: "#ef444440" }]}
              onPress={() => { Haptics.selectionAsync(); setPhotoWallpaper(null); }}
              activeOpacity={0.8}
            >
              <Feather name="x" size={13} color="#ef4444" />
              <Text style={[PK.clearPhotoBtnTxt, { color: "#ef4444" }]}>Remove custom photo</Text>
            </TouchableOpacity>
          )}
        </View>

        {/* Gradient presets */}
        <Text style={[PK.sectionHeading, { color: colors.mutedForeground, paddingHorizontal: 16, paddingTop: 14 }]}>
          GRADIENTS
        </Text>
        <FlatList
          data={PRESETS}
          numColumns={3}
          keyExtractor={(p) => p.id}
          columnWrapperStyle={PK.row}
          contentContainerStyle={{ paddingHorizontal: 12, paddingTop: 8, paddingBottom: insets.bottom + 32 }}
          showsVerticalScrollIndicator={false}
          renderItem={({ item }) => {
            const isSelected = !isPhoto && item.id === presetId;
            return (
              <TouchableOpacity
                style={PK.swatchWrap}
                onPress={() => {
                  Haptics.selectionAsync();
                  setWallpaper(item.id);
                  onClose();
                }}
                activeOpacity={0.8}
              >
                <LinearGradient
                  colors={[...item.colors] as [string, string, ...string[]]}
                  start={item.start ?? { x: 0, y: 0 }}
                  end={item.end ?? { x: 1, y: 1 }}
                  style={[
                    PK.swatch,
                    {
                      borderColor: isSelected ? "#0D9E7E" : colors.border,
                      borderWidth: isSelected ? 3 : 1.5,
                    },
                  ]}
                >
                  {isSelected && (
                    <View style={PK.checkCircle}>
                      <Ionicons name="checkmark" size={14} color="#fff" />
                    </View>
                  )}
                </LinearGradient>
                <Text
                  style={[
                    PK.swatchLabel,
                    { color: isSelected ? "#0D9E7E" : colors.mutedForeground },
                  ]}
                >
                  {item.label}
                </Text>
              </TouchableOpacity>
            );
          }}
        />
      </View>
    </Modal>
  );
}

// ── All-tabs picker ────────────────────────────────────────────────────────────
type TargetKey = "all" | TabKey;

const TARGET_TABS: { key: TargetKey; label: string }[] = [
  { key: "all",     label: "All Tabs" },
  { key: "nearby",  label: "Nearby" },
  { key: "map",     label: "Navigate" },
  { key: "home",    label: "Home" },
  { key: "explore", label: "Explore" },
  { key: "gas",     label: "Gas" },
  { key: "profile", label: "Profile" },
];

export function AllTabsWallpaperPicker({
  visible,
  onClose,
}: {
  visible: boolean;
  onClose: () => void;
}) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const [target, setTarget] = React.useState<TargetKey>("all");
  const {
    wallpapers, photoUris,
    savedPhotos, addSavedPhoto, removeSavedPhoto,
    setWallpaper, setPhotoWallpaper,
    setAllWallpapers, setAllPhotoWallpapers,
  } = useWallpaperRaw();

  const allSame = Object.values(wallpapers).every((v) => v === wallpapers.home);
  const currentPresetId = target === "all"
    ? (allSame ? wallpapers.home : "mixed")
    : wallpapers[target];
  const currentPhotoUri = target === "all"
    ? (allSame ? (photoUris.home ?? null) : null)
    : (photoUris[target] ?? null);
  const isPhoto = currentPresetId === "custom-photo" && !!currentPhotoUri;
  const isMixed = currentPresetId === "mixed";

  const targetLabel = TARGET_TABS.find((t) => t.key === target)?.label ?? "All Tabs";

  async function handleAddPhoto() {
    const uri = await pickImage();
    if (!uri) return;
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    addSavedPhoto(uri);
    if (target === "all") setAllPhotoWallpapers(uri);
    else setPhotoWallpaper(target, uri);
    onClose();
  }

  function handleSelectPhoto(uri: string) {
    if (target === "all") setAllPhotoWallpapers(uri);
    else setPhotoWallpaper(target, uri);
    onClose();
  }

  function handleRemovePhoto(uri: string) {
    removeSavedPhoto(uri);
    // Clear from any tab that was using this photo
    if (target === "all") {
      if (currentPhotoUri === uri) setAllPhotoWallpapers(null);
    } else {
      if (photoUris[target] === uri) setPhotoWallpaper(target, null);
    }
  }

  function handleApplyPreset(presetId: string) {
    Haptics.selectionAsync();
    if (target === "all") setAllWallpapers(presetId);
    else setWallpaper(target, presetId);
    onClose();
  }

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <View style={[PK.root, { backgroundColor: colors.background }]}>
        {/* Header */}
        <View style={[PK.header, { paddingTop: 20, borderBottomColor: colors.border }]}>
          <View style={{ flex: 1 }}>
            <Text style={[PK.title, { color: colors.foreground }]}>Wallpaper</Text>
            <Text style={[PK.sub, { color: colors.mutedForeground }]}>
              {target === "all" ? "Applied to all tabs & screens" : `${targetLabel} tab background`}
            </Text>
          </View>
          <TouchableOpacity
            style={[PK.closeBtn, { backgroundColor: colors.muted }]}
            onPress={onClose}
            activeOpacity={0.8}
          >
            <Feather name="x" size={18} color={colors.foreground} />
          </TouchableOpacity>
        </View>

        {/* Tab selector strip */}
        <FlatList
          data={TARGET_TABS}
          horizontal
          keyExtractor={(t) => t.key}
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ paddingHorizontal: 14, paddingVertical: 10, gap: 8 }}
          style={{ borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border, flexGrow: 0 }}
          renderItem={({ item: t }) => (
            <TouchableOpacity
              style={[PK.tabChip, { backgroundColor: target === t.key ? colors.primary : colors.muted }]}
              onPress={() => { Haptics.selectionAsync(); setTarget(t.key); }}
              activeOpacity={0.8}
            >
              <Text style={[PK.tabChipTxt, { color: target === t.key ? "#fff" : colors.foreground }]}>
                {t.label}
              </Text>
            </TouchableOpacity>
          )}
        />

        {isMixed && (
          <View style={{ backgroundColor: colors.primary + "15", paddingHorizontal: 16, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border }}>
            <Text style={{ fontSize: 12, fontFamily: "Inter_400Regular", color: colors.primary }}>
              Tabs currently have different wallpapers — selecting one will apply to all.
            </Text>
          </View>
        )}

        {/* My Photos section */}
        <View style={[PK.photoSection, { borderBottomColor: colors.border }]}>
          <View style={PK.sectionRow}>
            <Text style={[PK.sectionHeading, { color: colors.mutedForeground }]}>MY PHOTOS</Text>
            <Text style={[PK.sectionCount, { color: colors.mutedForeground }]}>
              {savedPhotos.length}/{MAX_SAVED_PHOTOS} saved
            </Text>
          </View>
          <SavedPhotosGrid
            savedPhotos={savedPhotos}
            activeUri={isPhoto ? currentPhotoUri : null}
            onSelect={handleSelectPhoto}
            onRemove={handleRemovePhoto}
            onAdd={handleAddPhoto}
          />
          {isPhoto && (
            <TouchableOpacity
              style={[PK.clearPhotoBtn, { borderColor: "#ef444440" }]}
              onPress={() => {
                Haptics.selectionAsync();
                if (target === "all") setAllPhotoWallpapers(null);
                else setPhotoWallpaper(target, null);
              }}
              activeOpacity={0.8}
            >
              <Feather name="x" size={13} color="#ef4444" />
              <Text style={[PK.clearPhotoBtnTxt, { color: "#ef4444" }]}>Remove custom photo</Text>
            </TouchableOpacity>
          )}
        </View>

        {/* Gradient presets */}
        <Text style={[PK.sectionHeading, { color: colors.mutedForeground, paddingHorizontal: 16, paddingTop: 14 }]}>
          GRADIENTS
        </Text>
        <FlatList
          data={PRESETS}
          numColumns={3}
          keyExtractor={(p) => p.id}
          columnWrapperStyle={PK.row}
          contentContainerStyle={{ paddingHorizontal: 12, paddingTop: 8, paddingBottom: insets.bottom + 32 }}
          showsVerticalScrollIndicator={false}
          renderItem={({ item }) => {
            const isSelected = !isPhoto && !isMixed && item.id === currentPresetId;
            return (
              <TouchableOpacity
                style={PK.swatchWrap}
                onPress={() => handleApplyPreset(item.id)}
                activeOpacity={0.8}
              >
                <LinearGradient
                  colors={[...item.colors] as [string, string, ...string[]]}
                  start={item.start ?? { x: 0, y: 0 }}
                  end={item.end ?? { x: 1, y: 1 }}
                  style={[PK.swatch, { borderColor: isSelected ? "#0D9E7E" : colors.border, borderWidth: isSelected ? 3 : 1.5 }]}
                >
                  {isSelected && (
                    <View style={PK.checkCircle}>
                      <Ionicons name="checkmark" size={14} color="#fff" />
                    </View>
                  )}
                </LinearGradient>
                <Text style={[PK.swatchLabel, { color: isSelected ? "#0D9E7E" : colors.mutedForeground }]}>
                  {item.label}
                </Text>
              </TouchableOpacity>
            );
          }}
        />
      </View>
    </Modal>
  );
}

const SLOT_SIZE = 78;

const PK = StyleSheet.create({
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
  sub:   { fontSize: 13, fontFamily: "Inter_400Regular", marginTop: 2 },
  closeBtn: {
    width: 36, height: 36, borderRadius: 18,
    alignItems: "center", justifyContent: "center", marginTop: 2,
  },
  sectionHeading: {
    fontSize: 11, fontWeight: "600", fontFamily: "Inter_600SemiBold",
    letterSpacing: 0.8, marginBottom: 10,
  },
  sectionRow: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 10,
  },
  sectionCount: { fontSize: 11, fontFamily: "Inter_400Regular" },
  // Photo section
  photoSection: {
    paddingHorizontal: 16, paddingTop: 14, paddingBottom: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  photoGrid: {
    flexDirection: "row",
    gap: 10,
  },
  photoSlotWrap: { position: "relative" },
  photoSlot: {
    width: SLOT_SIZE, height: SLOT_SIZE,
    borderRadius: 14, borderWidth: 1.5,
    alignItems: "center", justifyContent: "center",
    overflow: "hidden",
  },
  photoSlotAddTxt: {
    fontSize: 10, fontWeight: "600", fontFamily: "Inter_600SemiBold",
    textAlign: "center", marginTop: 2,
  },
  activeOverlay: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: "rgba(0,0,0,0.18)",
    alignItems: "flex-end",
    justifyContent: "flex-start",
    padding: 5,
  },
  activeCheck: {
    width: 22, height: 22, borderRadius: 11,
    backgroundColor: "#0D9E7E",
    alignItems: "center", justifyContent: "center",
    shadowColor: "#000", shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.3, shadowRadius: 3, elevation: 3,
  },
  removeSlotBtn: {
    position: "absolute", top: -7, right: -7,
    borderRadius: 10,
  },
  clearPhotoBtn: {
    flexDirection: "row", alignItems: "center", gap: 5,
    paddingHorizontal: 10, paddingVertical: 6, borderRadius: 10, borderWidth: 1,
    alignSelf: "flex-start", marginTop: 10,
  },
  clearPhotoBtnTxt: { fontSize: 12, fontWeight: "600", fontFamily: "Inter_600SemiBold" },
  // Gradient grid
  row: { gap: 8 },
  swatchWrap: { flex: 1, alignItems: "center", marginBottom: 16 },
  swatch: {
    width: "100%", aspectRatio: 0.78, borderRadius: 16,
    alignItems: "center", justifyContent: "center", overflow: "hidden",
  },
  checkCircle: {
    width: 26, height: 26, borderRadius: 13,
    backgroundColor: "#0D9E7E",
    alignItems: "center", justifyContent: "center",
    shadowColor: "#000", shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3, shadowRadius: 4, elevation: 4,
  },
  swatchLabel: {
    fontSize: 11, fontFamily: "Inter_400Regular",
    marginTop: 6, textAlign: "center",
  },
  tabChip: {
    paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20,
  },
  tabChipTxt: {
    fontSize: 13, fontWeight: "600", fontFamily: "Inter_600SemiBold",
  },
});
