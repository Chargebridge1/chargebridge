import React, { useRef, useEffect, useState } from "react";
import { View, Text, StyleSheet, ActivityIndicator } from "react-native";
import { useColors } from "@/hooks/useColors";
import { useSafeAreaInsets } from "react-native-safe-area-context";

const BASE = `https://${process.env.EXPO_PUBLIC_DOMAIN}`;

type EvStation = {
  id: string;
  name: string;
  lat: number;
  lng: number;
  status: string;
};

function evStatusColor(status: string) {
  if (status === "available") return "#22c55e";
  if (status === "busy") return "#f59e0b";
  return "#ef4444";
}

function WebLeafletMap({
  stations,
  userLat,
  userLng,
}: {
  stations: EvStation[];
  userLat: number | null;
  userLng: number | null;
}) {
  const mapRef = useRef<any>(null);
  const instanceRef = useRef<any>(null);

  useEffect(() => {
    const mountMap = () => {
      if (!mapRef.current || instanceRef.current) return;
      const L = (globalThis as any).L;
      if (!L) return;
      const center: [number, number] =
        userLat != null && userLng != null ? [userLat, userLng] : [39.5, -98.35];
      const map = L.map(mapRef.current, { zoomControl: true }).setView(
        center,
        userLat != null ? 13 : 4
      );
      instanceRef.current = map;
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: "© OpenStreetMap contributors",
        maxZoom: 19,
      }).addTo(map);
      if (userLat != null && userLng != null) {
        L.circleMarker([userLat, userLng], {
          radius: 9,
          fillColor: "#0D9E7E",
          color: "#fff",
          weight: 2.5,
          fillOpacity: 1,
        })
          .addTo(map)
          .bindPopup("<b>Your location</b>");
      }
      stations.forEach((s) => {
        const dot = evStatusColor(s.status);
        const icon = L.divIcon({
          html: `<div style="width:28px;height:28px;border-radius:50%;background:#0D9E7E;border:2px solid white;box-shadow:0 2px 6px rgba(0,0,0,0.3);display:flex;align-items:center;justify-content:center;"><div style="width:8px;height:8px;border-radius:50%;background:${dot};"></div></div>`,
          className: "",
          iconSize: [28, 28],
          iconAnchor: [14, 14],
        });
        L.marker([s.lat, s.lng], { icon })
          .addTo(map)
          .bindPopup(
            `<b style="font-size:13px">${s.name}</b><br>` +
            `<a href="https://www.google.com/maps/dir/?api=1&destination=${s.lat},${s.lng}" target="_blank" ` +
            `style="display:block;margin-top:8px;background:#0D9E7E;color:white;border-radius:6px;padding:5px 10px;text-decoration:none;text-align:center;font-size:12px">Get Directions</a>`
          );
      });
    };

    if (!document.getElementById("leaflet-css")) {
      const link = document.createElement("link");
      link.id = "leaflet-css";
      link.rel = "stylesheet";
      link.href = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";
      document.head.appendChild(link);
    }
    if ((globalThis as any).L) {
      mountMap();
    } else if (!document.getElementById("leaflet-js")) {
      const script = document.createElement("script");
      script.id = "leaflet-js";
      script.src = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js";
      script.onload = mountMap;
      document.head.appendChild(script);
    } else {
      const check = setInterval(() => {
        if ((globalThis as any).L) {
          clearInterval(check);
          mountMap();
        }
      }, 100);
      return () => clearInterval(check);
    }
    return () => {
      if (instanceRef.current) {
        instanceRef.current.remove();
        instanceRef.current = null;
      }
    };
  }, [stations, userLat, userLng]);

  return <View ref={mapRef} style={StyleSheet.absoluteFill} />;
}

export default function MapScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const [stations, setStations] = useState<EvStation[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`${BASE}/api/ev-stations?lat=39.5&lng=-98.35&radius=50`)
      .then((r) => r.ok ? r.json() : [])
      .then((data) => setStations(Array.isArray(data) ? data : []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  return (
    <View style={[S.root, { backgroundColor: colors.background }]}>
      <View
        style={[
          S.header,
          {
            paddingTop: insets.top + 14,
            backgroundColor: colors.background,
            borderBottomColor: colors.border,
          },
        ]}
      >
        <Text style={[S.title, { color: colors.foreground }]}>Live Map</Text>
        <Text style={[S.sub, { color: colors.mutedForeground }]}>
          Open on your iOS or Android device for full turn-by-turn navigation
        </Text>
      </View>
      <View style={{ flex: 1, position: "relative" }}>
        {loading ? (
          <View style={S.loader}>
            <ActivityIndicator size="large" color="#0D9E7E" />
          </View>
        ) : (
          <WebLeafletMap stations={stations} userLat={null} userLng={null} />
        )}
      </View>
    </View>
  );
}

const S = StyleSheet.create({
  root: { flex: 1 },
  header: {
    paddingHorizontal: 20,
    paddingBottom: 14,
    borderBottomWidth: 1,
  },
  title: {
    fontSize: 22,
    fontWeight: "700",
    fontFamily: "Inter_700Bold",
  },
  sub: {
    fontSize: 13,
    marginTop: 4,
    fontFamily: "Inter_400Regular",
  },
  loader: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
});
