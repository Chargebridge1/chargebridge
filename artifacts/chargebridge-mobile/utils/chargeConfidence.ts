export type StationInput = {
  status: string;
  availablePorts: number | null | undefined;
  totalPorts: number | null | undefined;
  chargerType: string | null | undefined;
  powerKw: number | null | undefined;
  pricePerKwh: number | string | null | undefined;
  averageRating?: number | null | undefined;
  connectorType?: string | null;
  connectorTypes?: string[] | null;
};

export type VehicleInput = {
  plugTypes?: string[] | null;
  connectorType?: string | null;
  batteryKwh?: number | null;
  rangePerCharge?: number | null;
};

export type ConfidenceResult = {
  score: number;
  label:
    | "Excellent Choice"
    | "Good Option"
    | "Consider Alternatives"
    | "Consider Another Station";
  explanation: string;
  compatible: boolean | null;
  tint: string;
};

export function computeChargeConfidence(
  station: StationInput,
  vehicle?: VehicleInput | null
): ConfidenceResult {
  const isOffline = station.status === "offline";

  // Availability: 0–30 pts
  let availability = 10;
  if (isOffline) {
    availability = 0;
  } else if (station.totalPorts != null && station.totalPorts > 0) {
    const pct =
      station.availablePorts != null
        ? station.availablePorts / station.totalPorts
        : 0;
    availability = Math.round(pct * 30);
    if (station.status === "available" && availability === 0) availability = 5;
  }

  // Compatibility: 0–20 pts (null means no vehicle data)
  let compatibility: number | null = null;
  let compatible: boolean | null = null;
  if (vehicle) {
    const vPlugs = [
      ...(vehicle.plugTypes ?? []),
      ...(vehicle.connectorType ? [vehicle.connectorType] : []),
    ].filter(Boolean);
    const sConnectors = [
      ...(station.connectorTypes ?? []),
      ...(station.connectorType ? [station.connectorType] : []),
    ].filter(Boolean);
    if (vPlugs.length > 0 && sConnectors.length > 0) {
      compatible = vPlugs.some((p) => sConnectors.includes(p));
      compatibility = compatible ? 20 : 0;
    }
  }

  // Rating: 0–20 pts
  const rating =
    station.averageRating != null
      ? Math.round((station.averageRating / 5) * 20)
      : 10;

  // Speed: 0–15 pts
  const speed =
    station.chargerType === "DCFC"
      ? 15
      : station.chargerType === "Level2"
        ? 10
        : station.chargerType === "Level1"
          ? 3
          : 7;

  // Price: 0–15 pts
  const pkwh =
    station.pricePerKwh != null ? Number(station.pricePerKwh) : null;
  const price =
    pkwh == null
      ? 10
      : pkwh === 0
        ? 15
        : pkwh <= 0.2
          ? 15
          : pkwh <= 0.3
            ? 12
            : pkwh <= 0.4
              ? 8
              : 4;

  // Total — scale to 100 if no compatibility data
  let raw = availability + rating + speed + price;
  if (compatibility !== null) {
    raw += compatibility;
  } else {
    raw = Math.round((raw / 80) * 100);
  }

  const score = Math.max(0, Math.min(100, raw));

  const label: ConfidenceResult["label"] =
    score >= 80
      ? "Excellent Choice"
      : score >= 65
        ? "Good Option"
        : score >= 45
          ? "Consider Alternatives"
          : "Consider Another Station";

  const tint =
    score >= 80
      ? "#22c55e"
      : score >= 65
        ? "#0D9E7E"
        : score >= 45
          ? "#f59e0b"
          : "#ef4444";

  // Build a short plain-language explanation
  const parts: string[] = [];
  if (station.chargerType === "DCFC") parts.push("fast DC charging");
  else if (station.chargerType === "Level2") parts.push("Level 2 charging");

  if (isOffline) {
    parts.push("station currently offline");
  } else if (availability >= 20) {
    parts.push("multiple stalls available");
  } else if (availability >= 10) {
    parts.push("stalls available");
  }

  if (pkwh === 0 || pkwh == null) {
    // omit price note
  } else if (pkwh <= 0.25) {
    parts.push("competitive pricing");
  } else if (pkwh > 0.4) {
    parts.push("higher pricing");
  }

  if (compatible === false) parts.push("connector may not match your vehicle");
  else if (compatible === true) parts.push("compatible with your vehicle");

  if (station.averageRating != null && station.averageRating >= 4.5)
    parts.push("highly rated");
  else if (station.averageRating != null && station.averageRating < 3)
    parts.push("mixed reviews");

  const explanation =
    parts.length > 0
      ? parts
          .slice(0, 3)
          .join(", ")
          .replace(/^./, (c) => c.toUpperCase()) + "."
      : label === "Excellent Choice"
        ? "Great option for your next charge."
        : label === "Good Option"
          ? "A solid choice nearby."
          : "Check availability before heading over.";

  return { score, label, compatible, tint, explanation };
}

export type EstimatesResult = {
  minsTo80: number | null;
  minsTo100: number | null;
  milesPerMin: number | null;
  estimatedCost: number | null;
};

export function computeChargeEstimates(
  station: StationInput,
  vehicle: VehicleInput,
  batteryPercent?: number | null
): EstimatesResult {
  const EFF = 0.9;
  const powerKw = station.powerKw != null ? Number(station.powerKw) : null;
  const kwhCap =
    vehicle.batteryKwh != null ? Number(vehicle.batteryKwh) : null;
  const range =
    vehicle.rangePerCharge != null ? Number(vehicle.rangePerCharge) : null;
  const pkwh =
    station.pricePerKwh != null ? Number(station.pricePerKwh) : null;
  const currentPct = batteryPercent != null ? batteryPercent : 0;

  const minsTo80 =
    powerKw && kwhCap
      ? Math.max(
          0,
          Math.round(
            (((0.8 - currentPct / 100) * kwhCap) / (powerKw * EFF)) * 60
          )
        )
      : null;
  const minsTo100 =
    powerKw && kwhCap
      ? Math.max(
          0,
          Math.round(
            (((1 - currentPct / 100) * kwhCap) / (powerKw * EFF)) * 60
          )
        )
      : null;
  const milesPerMin =
    powerKw && kwhCap && range
      ? Math.round(((range * powerKw * EFF) / kwhCap / 60) * 10) / 10
      : null;
  const estimatedCost =
    kwhCap && pkwh != null && pkwh > 0
      ? Math.round((1 - currentPct / 100) * kwhCap * pkwh * 100) / 100
      : null;

  return { minsTo80, minsTo100, milesPerMin, estimatedCost };
}
