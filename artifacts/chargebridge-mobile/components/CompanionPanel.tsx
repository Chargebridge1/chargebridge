import React, { useEffect, useRef } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Linking,
  Animated,
} from "react-native";
import { Feather, Ionicons } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";

export interface WeatherData {
  tempC: number;
  tempF: number;
  feelsLikeC: number;
  feelsLikeF: number;
  condition: string;
  humidity: number;
  windKph: number;
}

export interface NearbyPlace {
  name: string;
  type: string;
  rating: number | null;
  distM: number;
  walkMinutes: number;
  openNow: boolean | null;
}

export interface CompanionData {
  weather: WeatherData | null;
  nearbyPlaces: NearbyPlace[];
}

interface Props {
  data: CompanionData;
  minutesToTarget: number;
  stationName?: string;
}

function weatherEmoji(condition: string): string {
  const c = condition.toLowerCase();
  if (c.includes("sunny") || c.includes("clear")) return "☀️";
  if (c.includes("partly cloudy")) return "⛅";
  if (c.includes("overcast") || c.includes("cloudy")) return "☁️";
  if (c.includes("rain") || c.includes("drizzle") || c.includes("shower")) return "🌧️";
  if (c.includes("thunder") || c.includes("storm")) return "⛈️";
  if (c.includes("snow") || c.includes("sleet") || c.includes("blizzard")) return "❄️";
  if (c.includes("fog") || c.includes("mist") || c.includes("haze")) return "🌫️";
  if (c.includes("wind") || c.includes("breezy")) return "💨";
  return "🌤️";
}

function placeEmoji(type: string): string {
  if (type.includes("cafe") || type.includes("bakery") || type.includes("coffee")) return "☕";
  if (type.includes("restaurant") || type.includes("food")) return "🍽️";
  if (type.includes("grocery") || type.includes("supermarket")) return "🛒";
  if (type.includes("bar")) return "🍺";
  return "📍";
}

function placeTypeLabel(type: string): string {
  if (type.includes("cafe") || type.includes("coffee")) return "Café";
  if (type.includes("bakery")) return "Bakery";
  if (type.includes("restaurant")) return "Restaurant";
  if (type.includes("grocery") || type.includes("supermarket")) return "Grocery";
  if (type.includes("bar")) return "Bar";
  if (type.includes("food")) return "Food";
  return "Nearby";
}

function getSmartSuggestion(
  minutesToTarget: number,
  places: NearbyPlace[],
): string | null {
  if (minutesToTarget <= 3 || places.length === 0) return null;

  const reachable = places.filter((p) => p.walkMinutes * 2.5 <= minutesToTarget && p.openNow !== false);
  if (reachable.length === 0) return null;

  const cafe = reachable.find((p) => p.type.includes("cafe") || p.type.includes("bakery") || p.type.includes("coffee"));
  const restaurant = reachable.find((p) => p.type === "restaurant" || p.type === "food");
  const grocery = reachable.find((p) => p.type.includes("grocery") || p.type.includes("supermarket"));

  const place = cafe ?? restaurant ?? grocery ?? reachable[0];
  const activity = cafe
    ? "grab a coffee"
    : restaurant
      ? "grab a bite"
      : grocery
        ? "pick up groceries"
        : "explore nearby";

  const timeStr = minutesToTarget < 60
    ? `~${minutesToTarget} min`
    : `~${Math.round(minutesToTarget / 60)}h ${minutesToTarget % 60}m`;

  return `You'll finish charging in ${timeStr} — enough time to ${activity} at ${place.name}.`;
}

export default function CompanionPanel({ data, minutesToTarget }: Props) {
  const colors = useColors();
  const fadeAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(fadeAnim, {
      toValue: 1,
      duration: 600,
      useNativeDriver: true,
    }).start();
  }, [fadeAnim]);

  const { weather, nearbyPlaces } = data;
  const suggestion = getSmartSuggestion(minutesToTarget, nearbyPlaces);
  const hasContent = !!weather || nearbyPlaces.length > 0;

  if (!hasContent) return null;

  return (
    <Animated.View style={[S.container, { opacity: fadeAnim }]}>
      {/* Section header */}
      <View style={S.header}>
        <Ionicons name="time-outline" size={14} color={colors.mutedForeground} />
        <Text style={[S.headerTxt, { color: colors.mutedForeground }]}>While You Wait</Text>
      </View>

      {/* Smart suggestion */}
      {!!suggestion && (
        <View style={[S.suggestionCard, { backgroundColor: "#0D9E7E18", borderColor: "#0D9E7E44" }]}>
          <Text style={S.suggestionEmoji}>💡</Text>
          <Text style={[S.suggestionTxt, { color: colors.foreground }]}>{suggestion}</Text>
        </View>
      )}

      {/* Two-column row: Weather + Cost projection */}
      {!!weather && (
        <View style={[S.weatherCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={S.weatherLeft}>
            <Text style={S.weatherEmoji}>{weatherEmoji(weather.condition)}</Text>
            <View>
              <Text style={[S.weatherTemp, { color: colors.foreground }]}>
                {weather.tempF}°F
                <Text style={[S.weatherTempAlt, { color: colors.mutedForeground }]}> · {weather.tempC}°C</Text>
              </Text>
              <Text style={[S.weatherCond, { color: colors.mutedForeground }]} numberOfLines={1}>
                {weather.condition}
              </Text>
            </View>
          </View>
          <View style={S.weatherRight}>
            <View style={S.weatherStat}>
              <Feather name="droplet" size={11} color={colors.mutedForeground} />
              <Text style={[S.weatherStatTxt, { color: colors.mutedForeground }]}>{weather.humidity}%</Text>
            </View>
            <View style={S.weatherStat}>
              <Feather name="wind" size={11} color={colors.mutedForeground} />
              <Text style={[S.weatherStatTxt, { color: colors.mutedForeground }]}>{weather.windKph} km/h</Text>
            </View>
            <Text style={[S.weatherFeels, { color: colors.mutedForeground }]}>
              Feels {weather.feelsLikeF}°F
            </Text>
          </View>
        </View>
      )}

      {/* Nearby places */}
      {nearbyPlaces.length > 0 && (
        <View>
          <Text style={[S.nearbyHeader, { color: colors.mutedForeground }]}>Nearby</Text>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={S.placesList}
          >
            {nearbyPlaces.slice(0, 6).map((place, idx) => (
              <TouchableOpacity
                key={idx}
                style={[S.placeCard, { backgroundColor: colors.card, borderColor: colors.border }]}
                activeOpacity={0.75}
                onPress={() => {
                  const q = encodeURIComponent(place.name);
                  Linking.openURL(`https://maps.apple.com/?q=${q}`).catch(() => {
                    Linking.openURL(`https://www.google.com/maps/search/?api=1&query=${q}`);
                  });
                }}
              >
                <Text style={S.placeEmoji}>{placeEmoji(place.type)}</Text>
                <Text style={[S.placeName, { color: colors.foreground }]} numberOfLines={2}>
                  {place.name}
                </Text>
                <Text style={[S.placeType, { color: colors.mutedForeground }]}>
                  {placeTypeLabel(place.type)}
                </Text>
                <View style={S.placeMeta}>
                  <Feather name="navigation" size={10} color={colors.mutedForeground} />
                  <Text style={[S.placeWalk, { color: colors.mutedForeground }]}>
                    {place.walkMinutes} min walk
                  </Text>
                </View>
                {place.rating !== null && (
                  <View style={S.ratingRow}>
                    <Ionicons name="star" size={10} color="#f59e0b" />
                    <Text style={[S.ratingTxt, { color: colors.mutedForeground }]}>
                      {place.rating.toFixed(1)}
                    </Text>
                  </View>
                )}
                {place.openNow === false && (
                  <View style={[S.closedBadge, { backgroundColor: "#ef444418" }]}>
                    <Text style={S.closedTxt}>Closed</Text>
                  </View>
                )}
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>
      )}
    </Animated.View>
  );
}

const S = StyleSheet.create({
  container: {
    width: "100%",
    gap: 12,
    paddingTop: 4,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 2,
  },
  headerTxt: {
    fontSize: 11,
    fontWeight: "600",
    fontFamily: "Inter_600SemiBold",
    letterSpacing: 0.8,
    textTransform: "uppercase",
  },

  suggestionCard: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    borderRadius: 12,
    borderWidth: 1,
    padding: 12,
  },
  suggestionEmoji: {
    fontSize: 16,
    lineHeight: 22,
  },
  suggestionTxt: {
    flex: 1,
    fontSize: 13,
    fontWeight: "500",
    fontFamily: "Inter_500Medium",
    lineHeight: 19,
  },

  weatherCard: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderRadius: 12,
    borderWidth: 1,
    padding: 14,
    gap: 12,
  },
  weatherLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    flex: 1,
  },
  weatherEmoji: {
    fontSize: 28,
  },
  weatherTemp: {
    fontSize: 17,
    fontWeight: "700",
    fontFamily: "Inter_700Bold",
  },
  weatherTempAlt: {
    fontSize: 13,
    fontWeight: "400",
    fontFamily: "Inter_400Regular",
  },
  weatherCond: {
    fontSize: 12,
    fontWeight: "400",
    fontFamily: "Inter_400Regular",
    marginTop: 1,
  },
  weatherRight: {
    alignItems: "flex-end",
    gap: 3,
  },
  weatherStat: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
  },
  weatherStatTxt: {
    fontSize: 11,
    fontWeight: "500",
    fontFamily: "Inter_500Medium",
  },
  weatherFeels: {
    fontSize: 11,
    fontWeight: "400",
    fontFamily: "Inter_400Regular",
    marginTop: 2,
  },

  nearbyHeader: {
    fontSize: 11,
    fontWeight: "600",
    fontFamily: "Inter_600SemiBold",
    letterSpacing: 0.8,
    textTransform: "uppercase",
    marginBottom: 8,
    paddingHorizontal: 2,
  },
  placesList: {
    gap: 10,
    paddingRight: 4,
  },
  placeCard: {
    width: 128,
    borderRadius: 12,
    borderWidth: 1,
    padding: 12,
    gap: 4,
  },
  placeEmoji: {
    fontSize: 22,
    marginBottom: 4,
  },
  placeName: {
    fontSize: 13,
    fontWeight: "600",
    fontFamily: "Inter_600SemiBold",
    lineHeight: 17,
  },
  placeType: {
    fontSize: 11,
    fontWeight: "400",
    fontFamily: "Inter_400Regular",
    marginTop: 1,
  },
  placeMeta: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    marginTop: 6,
  },
  placeWalk: {
    fontSize: 11,
    fontWeight: "500",
    fontFamily: "Inter_500Medium",
  },
  ratingRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    marginTop: 2,
  },
  ratingTxt: {
    fontSize: 11,
    fontWeight: "500",
    fontFamily: "Inter_500Medium",
  },
  closedBadge: {
    alignSelf: "flex-start",
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
    marginTop: 4,
  },
  closedTxt: {
    fontSize: 10,
    fontWeight: "600",
    fontFamily: "Inter_600SemiBold",
    color: "#ef4444",
  },
});
