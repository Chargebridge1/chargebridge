import type { RankableStation, RankingWeights, StationScore, AccessibilityLevel } from "./types.js";
import { classifyFacilityType } from "./accessibility.js";

function scoreAccessibility(level: AccessibilityLevel): number {
  switch (level) {
    case "EASY":       return 1.0;
    case "UNKNOWN":    return 0.7;
    case "MODERATE":   return 0.6;
    case "RESTRICTED": return 0.2;
  }
}

function scoreCost(s: RankableStation, accessLevel: AccessibilityLevel): number {
  if (s.isFree) return 1.0;

  if (s.pricePerKwh !== null && s.pricePerKwh > 0) {
    const base = accessLevel === "RESTRICTED" ? 0.35 : 0.7;
    const pricePenalty = Math.max(0, (s.pricePerKwh - 0.35) * 0.4);
    return Math.max(0.2, base - pricePenalty);
  }

  switch (accessLevel) {
    case "EASY":       return 0.75;
    case "UNKNOWN":    return 0.6;
    case "MODERATE":   return 0.45;
    case "RESTRICTED": return 0.25;
  }
}

function scoreReliability(s: RankableStation): number {
  let score = 0;

  if (s.averageRating !== null && s.reviewCount > 0) {
    const confidence = Math.min(1.0, Math.log(s.reviewCount + 1) / Math.log(31));
    const ratingNorm = (s.averageRating - 1) / 4;
    score += 0.6 * (confidence * ratingNorm + (1 - confidence) * 0.5);
  } else {
    score += 0.6 * 0.5;
  }

  switch (s.status) {
    case "available": score += 0.4; break;
    case "busy":      score += 0.25; break;
    case "offline":   score += 0.0; break;
    case "unknown":   score += 0.28; break;
  }

  return Math.min(1.0, score);
}

function scoreAvailability(s: RankableStation): number {
  if (s.availablePorts !== null && s.totalPorts !== null && s.totalPorts > 0) {
    const ratio = s.availablePorts / s.totalPorts;
    const capacityBonus = Math.min(0.2, s.totalPorts / 20);
    return Math.min(1.0, ratio * 0.8 + capacityBonus);
  }

  if (s.totalPorts !== null && s.totalPorts > 0) {
    const capacity = Math.min(0.5, 0.3 + s.totalPorts / 20);
    switch (s.status) {
      case "available": return Math.min(1.0, capacity + 0.4);
      case "busy":      return Math.min(1.0, capacity + 0.2);
      case "offline":   return 0.0;
      default:          return capacity;
    }
  }

  switch (s.status) {
    case "available": return 0.7;
    case "busy":      return 0.4;
    case "offline":   return 0.0;
    case "unknown":   return 0.5;
  }
}

function scoreSpeed(s: RankableStation): number {
  const kw = s.powerKw;
  if (s.chargerType === "DCFC") {
    if (kw !== null && kw >= 150) return 1.0;
    if (kw !== null && kw >= 100) return 0.9;
    if (kw !== null && kw >= 50)  return 0.8;
    return 0.75;
  }
  if (s.chargerType === "Level2") {
    if (kw !== null && kw >= 19) return 0.6;
    if (kw !== null && kw >= 11) return 0.5;
    if (kw !== null && kw >= 7)  return 0.4;
    return 0.4;
  }
  return 0.1;
}

function scoreDistance(distanceMiles: number): number {
  return Math.exp(-0.1 * Math.max(0, distanceMiles));
}

export function computeScore(s: RankableStation, weights: RankingWeights): StationScore {
  const accessibilityLevel = classifyFacilityType(
    s.facilityType,
    s.accessType,
    s.name,
    s.source
  );

  const raw = {
    accessibility: scoreAccessibility(accessibilityLevel),
    cost:          scoreCost(s, accessibilityLevel),
    reliability:   scoreReliability(s),
    availability:  scoreAvailability(s),
    speed:         scoreSpeed(s),
    distance:      scoreDistance(s.distanceMiles),
  };

  const breakdown = {
    accessibility: Math.round(raw.accessibility * weights.accessibility * 10) / 10,
    cost:          Math.round(raw.cost          * weights.cost          * 10) / 10,
    reliability:   Math.round(raw.reliability   * weights.reliability   * 10) / 10,
    availability:  Math.round(raw.availability  * weights.availability  * 10) / 10,
    speed:         Math.round(raw.speed         * weights.speed         * 10) / 10,
    distance:      Math.round(raw.distance      * weights.distance      * 10) / 10,
  };

  const total = Math.round(
    (breakdown.accessibility + breakdown.cost + breakdown.reliability +
     breakdown.availability  + breakdown.speed + breakdown.distance) * 10
  ) / 10;

  return { total, breakdown, accessibilityLevel };
}
