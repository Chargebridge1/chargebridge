/**
 * Smart Charger Match — Vehicle-to-Station Scorer
 *
 * Scoring algorithm (see lib/scoring-algorithm.md for the full spec):
 *
 * Factor              Weight  What it measures
 * ─────────────────── ──────  ────────────────────────────────────────────────
 * Connector compat     30%    Native / adapter / incompatible plug match
 * Charging speed       20%    Effective kW vs vehicle's max DC or AC rate
 * SoC feasibility      20%    Estimated battery % on arrival vs reserve target
 * Port availability    15%    Open ports ratio + station status
 * Cost                 10%    Price/kWh penalty relative to $0.30 baseline
 * Public access         5%    Public > unknown > restricted
 *
 * Scores are 0–100 integers. Grade thresholds: A ≥ 80, B ≥ 60, C ≥ 40, D < 40.
 * Affinity boost: historical connector usage adds up to +8% on the connector sub-score.
 */

export interface VehicleMatchSpec {
  connectorType: string | null;
  plugTypes: string[] | null;
  batteryKwh: number | null;
  rangeMiles: number | null;
  dcMaxKw?: number | null;
  acMaxKw?: number | null;
  // SoC feasibility inputs
  currentSocPercent?: number | null;
  minArrivalSocPercent?: number | null;
}

export interface MatchableStation {
  connectorTypes: string[];
  chargerType: "Level1" | "Level2" | "DCFC";
  powerKw: number | null;
  distanceMiles: number;
  isFree: boolean;
  pricePerKwh: number | null;
  availablePorts: number | null;
  totalPorts: number | null;
  status: "available" | "busy" | "offline" | "unknown";
  accessType?: "public" | "restricted" | "unknown";
}

/**
 * Per-factor breakdown included in every VehicleMatchResult.
 * Each factor has a normalised sub-score (0–1, may slightly exceed 1 for
 * affinity-boosted connectors), a display label, and an optional human-readable
 * reason explaining the score.
 */
export interface MatchFactor {
  /** Display name shown in the explanation UI */
  label: string;
  /** Normalised sub-score in [0, 1] (connector may be slightly above 1) */
  subScore: number;
  /** Weight applied in the final formula, e.g. 0.30 */
  weight: number;
  /** Short human-readable reason, null when not applicable / neutral */
  reason: string | null;
}

export interface VehicleMatchResult {
  matchScore: number;
  matchGrade: "A" | "B" | "C" | "D";
  /** Top 3 reasons (compact, for chips/banner display) */
  matchReasons: string[];
  connectorCompatible: boolean;
  /** Full per-factor breakdown for the "Why?" explanation sheet */
  matchFactors: MatchFactor[];
}

/**
 * Connector affinity weights derived from a user's charging history.
 * Keys are normalised connector types ("CCS", "NACS", "CHAdeMO", "J1772").
 * Values are recency-weighted usage scores (higher = more historically used).
 *
 * Passing an empty object or omitting this argument produces the same result
 * as the affinity-unaware scorer.
 */
export type ConnectorAffinityWeights = Record<string, number>;

export function normalizeConnector(raw: string): string {
  const t = raw.toUpperCase().trim().replace(/[\s_\-]/g, "");
  if (t === "NACS" || t === "J3400" || t === "TESLA" || t === "TESLASUPERCHARGER") return "NACS";
  if (t.includes("CCS") || t.includes("COMBO")) return "CCS";
  if (t.includes("CHADEMO")) return "CHAdeMO";
  if (t.includes("J1772") || t === "TYPE1" || t === "TYPE2" || t === "IEC62196T1" || t === "IEC62196T2") return "J1772";
  return t;
}

/**
 * Compute an affinity boost factor for a connector type based on the user's
 * historical usage weights.
 *
 * The boost is a small fractional addition to the connector score (max +8%).
 * Formula: boost_fraction = weight / (weight + 5)  × 0.08
 *   – weight 0  → 0%  boost
 *   – weight 5  → 4%  boost
 *   – weight ∞  → 8%  boost (never reached in practice)
 */
function affinityBoostFraction(connectorType: string, affinity: ConnectorAffinityWeights): number {
  const w = affinity[connectorType] ?? 0;
  if (w <= 0) return 0;
  return (w / (w + 5)) * 0.08;
}

function connectorScore(
  spec: VehicleMatchSpec,
  station: MatchableStation,
  affinity: ConnectorAffinityWeights,
): { score: number; reason: string | null; compatible: boolean } {
  const vehicleConnectors = [
    ...(spec.connectorType ? [spec.connectorType] : []),
    ...(spec.plugTypes ?? []),
  ].map(normalizeConnector);

  if (vehicleConnectors.length === 0) {
    return { score: 0.5, reason: null, compatible: true };
  }

  const stationNorm = station.connectorTypes.map(normalizeConnector);

  for (const vc of vehicleConnectors) {
    for (const sc of stationNorm) {
      if (vc === sc) {
        const label =
          sc === "NACS"    ? "NACS native" :
          sc === "CCS"     ? "CCS native" :
          sc === "CHAdeMO" ? "CHAdeMO native" :
          sc === "J1772"   ? "J1772 compatible" : `${sc} compatible`;
        // Allow scores above 1.0 for strongly-preferred connectors so that
        // two native-compatible stations can be differentiated by history.
        // The final matchScore is capped at 100 after weighted summation.
        const boost = affinityBoostFraction(sc, affinity);
        return { score: 1.0 + boost, reason: label, compatible: true };
      }
    }
  }

  if (vehicleConnectors.includes("NACS")) {
    if (stationNorm.includes("CCS") && station.chargerType === "DCFC") {
      const boost = affinityBoostFraction("CCS", affinity);
      return { score: 0.7 + boost * 0.7, reason: "CCS · adapter compatible", compatible: true };
    }
    if (stationNorm.includes("CCS") || stationNorm.includes("J1772")) {
      const sc = stationNorm.includes("CCS") ? "CCS" : "J1772";
      const boost = affinityBoostFraction(sc, affinity);
      return { score: 0.5 + boost * 0.5, reason: "L2 via adapter", compatible: true };
    }
  }

  if (vehicleConnectors.includes("CCS")) {
    if (station.chargerType !== "DCFC" && stationNorm.includes("J1772")) {
      const boost = affinityBoostFraction("J1772", affinity);
      return { score: 0.55 + boost * 0.55, reason: "J1772 L2 compatible", compatible: true };
    }
  }

  if (stationNorm.length === 0) {
    return { score: 0.45, reason: "Connector unknown", compatible: true };
  }

  return { score: 0.05, reason: "Incompatible connector", compatible: false };
}

function speedScore(
  spec: VehicleMatchSpec,
  station: MatchableStation,
): { score: number; reason: string | null } {
  if (station.chargerType === "DCFC") {
    const nc = normalizeConnector(spec.connectorType ?? "");
    const vehicleDcMax =
      spec.dcMaxKw ??
      (nc === "NACS" ? 250 : nc === "CCS" ? 150 : nc === "CHAdeMO" ? 50 : 100);
    const stationKw = station.powerKw ?? 100;
    const effective = Math.min(stationKw, vehicleDcMax);
    const score = Math.max(0.3, Math.min(1.0, effective / vehicleDcMax));
    return { score, reason: `${stationKw} kW DC fast` };
  }

  if (station.chargerType === "Level2") {
    const vehicleAcMax = spec.acMaxKw ?? 11.5;
    const stationKw = station.powerKw ?? 7;
    const score = 0.2 + Math.min(0.8, (stationKw / vehicleAcMax) * 0.7);
    return { score, reason: `${stationKw} kW Level 2` };
  }

  return { score: 0.05, reason: "Level 1 · very slow" };
}

function socFeasibilityScore(
  spec: VehicleMatchSpec,
  station: MatchableStation,
): { score: number; reason: string | null } {
  const { currentSocPercent, minArrivalSocPercent, rangeMiles } = spec;

  // No SoC data → neutral score
  if (currentSocPercent == null || minArrivalSocPercent == null || rangeMiles == null || rangeMiles <= 0) {
    return { score: 0.6, reason: null };
  }

  // Estimated SoC at arrival (linear range model)
  const socUsedPct = (station.distanceMiles / rangeMiles) * 100;
  const arrivalSoc = currentSocPercent - socUsedPct;

  if (arrivalSoc < 0) {
    // Can't even reach the station
    return { score: 0.0, reason: "Out of range" };
  }

  const reserve = arrivalSoc - minArrivalSocPercent;

  if (reserve >= 15) {
    // Comfortable margin above reserve
    return { score: 1.0, reason: `~${Math.round(arrivalSoc)}% on arrival` };
  } else if (reserve >= 5) {
    // Tight but feasible
    return { score: 0.65, reason: `~${Math.round(arrivalSoc)}% on arrival` };
  } else if (reserve >= 0) {
    // Right at the limit
    return { score: 0.35, reason: `Low on arrival (~${Math.round(arrivalSoc)}%)` };
  } else {
    // Would arrive below min reserve
    return { score: 0.05, reason: "May not reach safely" };
  }
}

function availabilityScore(station: MatchableStation): { score: number; reason: string | null } {
  if (station.availablePorts != null && station.totalPorts != null && station.totalPorts > 0) {
    const ratio = station.availablePorts / station.totalPorts;
    const score = Math.min(1.0, ratio * 0.8 + Math.min(0.2, station.totalPorts / 20));
    const reason =
      station.availablePorts > 0
        ? `${station.availablePorts}/${station.totalPorts} ports open`
        : "All ports busy";
    return { score, reason };
  }
  switch (station.status) {
    case "available": return { score: 0.7, reason: "Available now" };
    case "busy":      return { score: 0.4, reason: "Busy" };
    case "offline":   return { score: 0.0, reason: "Offline" };
    default:          return { score: 0.5, reason: null };
  }
}

function costScore(station: MatchableStation): { score: number; reason: string | null } {
  if (station.isFree) return { score: 1.0, reason: "Free" };
  if (station.pricePerKwh != null && station.pricePerKwh > 0) {
    const penalty = Math.max(0, (station.pricePerKwh - 0.30) * 0.5);
    return { score: Math.max(0.2, 0.8 - penalty), reason: `$${station.pricePerKwh.toFixed(2)}/kWh` };
  }
  return { score: 0.55, reason: null };
}

function accessScore(station: MatchableStation): { score: number; reason: string | null } {
  switch (station.accessType) {
    case "public":     return { score: 1.0, reason: "Public access" };
    case "restricted": return { score: 0.3, reason: "Restricted access" };
    default:           return { score: 0.7, reason: null };
  }
}

// Weights per code-review spec and lib/scoring-algorithm.md
const WEIGHTS = {
  connector:    0.30,
  speed:        0.20,
  soc:          0.20,
  availability: 0.15,
  cost:         0.10,
  access:       0.05,
} as const;

/**
 * Score a station against a vehicle spec.
 *
 * @param station   The station to score.
 * @param spec      The vehicle's charging spec.
 * @param affinity  Optional connector affinity weights from the user's charging
 *                  history. Connectors with higher weights receive a small score
 *                  boost (max +8% of the connector sub-score). Pass `{}` or omit
 *                  to get the same result as the affinity-unaware scorer.
 */
export function scoreVehicleMatch(
  station: MatchableStation,
  spec: VehicleMatchSpec,
  affinity: ConnectorAffinityWeights = {},
): VehicleMatchResult {
  const conn   = connectorScore(spec, station, affinity);
  const speed  = speedScore(spec, station);
  const soc    = socFeasibilityScore(spec, station);
  const avail  = availabilityScore(station);
  const cost   = costScore(station);
  const access = accessScore(station);

  const rawScore =
    conn.score   * WEIGHTS.connector  +
    speed.score  * WEIGHTS.speed      +
    soc.score    * WEIGHTS.soc        +
    avail.score  * WEIGHTS.availability +
    cost.score   * WEIGHTS.cost       +
    access.score * WEIGHTS.access;

  // Cap at 100 — connector sub-scores can slightly exceed 1.0 when affinity
  // boost applies, which is intentional for differentiating otherwise equal stations.
  const matchScore = Math.min(100, Math.round(rawScore * 100));

  const matchGrade: "A" | "B" | "C" | "D" =
    matchScore >= 80 ? "A" :
    matchScore >= 60 ? "B" :
    matchScore >= 40 ? "C" : "D";

  // Top-3 reasons for compact display (chips, banner)
  const reasons: string[] = [];
  if (conn.reason)  reasons.push(conn.reason);
  if (speed.reason) reasons.push(speed.reason);
  if (soc.reason)   reasons.push(soc.reason);
  if (avail.reason && reasons.length < 3) reasons.push(avail.reason);
  if (cost.reason  && reasons.length < 3) reasons.push(cost.reason);

  // Full per-factor breakdown for the "Why?" explanation sheet
  const matchFactors: MatchFactor[] = [
    { label: "Connector",    subScore: conn.score,   weight: WEIGHTS.connector,    reason: conn.reason },
    { label: "Speed",        subScore: speed.score,  weight: WEIGHTS.speed,        reason: speed.reason },
    { label: "Range / SoC",  subScore: soc.score,    weight: WEIGHTS.soc,          reason: soc.reason },
    { label: "Availability", subScore: avail.score,  weight: WEIGHTS.availability, reason: avail.reason },
    { label: "Cost",         subScore: cost.score,   weight: WEIGHTS.cost,         reason: cost.reason },
    { label: "Access",       subScore: access.score, weight: WEIGHTS.access,       reason: access.reason },
  ];

  return {
    matchScore,
    matchGrade,
    matchReasons: reasons.slice(0, 3),
    connectorCompatible: conn.compatible,
    matchFactors,
  };
}
