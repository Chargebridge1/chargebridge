export type AccessibilityLevel = "EASY" | "MODERATE" | "RESTRICTED" | "UNKNOWN";

export interface RankableStation {
  id: string;
  name: string;
  source: "community" | "nrel" | "osm" | "ocm";
  distanceMiles: number;
  chargerType: "Level1" | "Level2" | "DCFC";
  powerKw: number | null;
  isFree: boolean;
  pricePerKwh: number | null;
  totalPorts: number | null;
  availablePorts: number | null;
  status: "available" | "busy" | "offline" | "unknown";
  averageRating: number | null;
  reviewCount: number;
  facilityType: string | null;
  accessType: "public" | "restricted" | "unknown";
}

export interface RankingWeights {
  accessibility: number;
  cost: number;
  reliability: number;
  availability: number;
  speed: number;
  distance: number;
}

export interface ScoreBreakdown {
  accessibility: number;
  cost: number;
  reliability: number;
  availability: number;
  speed: number;
  distance: number;
}

export interface StationScore {
  total: number;
  breakdown: ScoreBreakdown;
  accessibilityLevel: AccessibilityLevel;
}
