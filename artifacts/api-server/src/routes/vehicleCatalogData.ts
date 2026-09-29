// ── Types ─────────────────────────────────────────────────────────────────────
export type ChargingSpec = {
  dcConnector: string | null;
  acConnector: string | null;
  batteryKwh?: number | null;
  usableKwh?: number | null;
  acMaxKw?: number | null;
  dcMaxKw?: number | null;
  onboardChargerKw?: number | null;
  rangeMiles?: number | null;
  typicalMpg?: number | null;
  plugAndCharge?: boolean;
  superchargerEligible?: boolean;
  notes?: string | null;
};

export type TrimSpec = {
  name: string;   // '' = base / only trim
  years: number[];
  specs: ChargingSpec;
};

export type ModelSpec = {
  name: string;
  fuelCategory: "BEV" | "PHEV" | "HEV" | "GAS" | "DIESEL" | "E85";
  bodyStyle?: string;
  segment?: string;
  trims: TrimSpec[];
};

export type ManufacturerSpec = {
  name: string;
  slug: string;
  country: string;
  models: ModelSpec[];
};

// ── Compact spec helpers ───────────────────────────────────────────────────────
// N = NACS (Tesla native / post-2024 adopters), plug-and-charge + Supercharger eligible
function N(dcKw: number, bat: number, usable: number, range: number, acKw = 11.5, pc = true, sc = true): ChargingSpec {
  return { dcConnector: "NACS", acConnector: "NACS", dcMaxKw: dcKw, acMaxKw: acKw, batteryKwh: bat, usableKwh: usable, rangeMiles: range, plugAndCharge: pc, superchargerEligible: sc };
}
// C = CCS + J1772 AC (most non-Tesla BEVs through 2024)
function C(dcKw: number, bat: number, usable: number, range: number, acKw = 7.2, pc = false): ChargingSpec {
  return { dcConnector: "CCS", acConnector: "J1772", dcMaxKw: dcKw, acMaxKw: acKw, batteryKwh: bat, usableKwh: usable, rangeMiles: range, plugAndCharge: pc };
}
// D = CHAdeMO + J1772 AC (Nissan legacy)
function D(dcKw: number, bat: number, usable: number, range: number, acKw = 6.6): ChargingSpec {
  return { dcConnector: "CHAdeMO", acConnector: "J1772", dcMaxKw: dcKw, acMaxKw: acKw, batteryKwh: bat, usableKwh: usable, rangeMiles: range };
}
// P = PHEV (AC-only charging)
function P(bat: number, acKw: number, mpg: number): ChargingSpec {
  return { dcConnector: null, acConnector: "J1772", batteryKwh: bat, usableKwh: +(bat * 0.8).toFixed(1), acMaxKw: acKw, typicalMpg: mpg };
}
// H = HEV (no plug)
function H(mpg: number): ChargingSpec { return { dcConnector: null, acConnector: null, typicalMpg: mpg }; }
// G = conventional gas/diesel/flex
function G(mpg: number): ChargingSpec { return { dcConnector: null, acConnector: null, typicalMpg: mpg }; }
// Expand from..to into an inclusive year array
function yrs(from: number, to: number): number[] {
  return Array.from({ length: to - from + 1 }, (_, i) => from + i);
}

// ── Comprehensive North-American catalog ──────────────────────────────────────
export const SEED_CATALOG: ManufacturerSpec[] = [

  // ── Tesla ──────────────────────────────────────────────────────────────────
  { name: "Tesla", slug: "tesla", country: "US", models: [
    { name: "Model S", fuelCategory: "BEV", bodyStyle: "sedan", segment: "luxury", trims: [
      { name: "85", years: [2012,2013,2014], specs: N(120, 85, 81, 265, 10) },
      { name: "P85", years: [2012,2013,2014], specs: N(120, 85, 81, 253, 10) },
      { name: "60", years: [2013,2014,2015,2016], specs: N(90, 60, 57, 208, 10) },
      { name: "70D", years: [2015,2016], specs: N(120, 70, 66.5, 240, 10) },
      { name: "85D", years: [2015,2016], specs: N(120, 85, 81, 270, 10) },
      { name: "P90D", years: [2015,2016], specs: N(120, 90, 85.5, 253, 10) },
      { name: "75D", years: [2017,2018], specs: N(120, 75, 71, 259, 11.5) },
      { name: "100D", years: [2017,2018], specs: N(145, 100, 98.5, 335, 11.5) },
      { name: "P100D", years: [2017,2018], specs: N(145, 100, 98.5, 315, 11.5) },
      { name: "Long Range AWD", years: [2019,2020], specs: N(200, 100, 98.5, 373) },
      { name: "Performance AWD", years: [2019,2020], specs: N(200, 100, 98.5, 348) },
      { name: "Long Range AWD", years: [2021,2022,2023,2024], specs: N(250, 100, 98.5, 405) },
      { name: "Plaid", years: [2021,2022,2023,2024], specs: N(250, 100, 98.5, 396) },
    ]},
    { name: "Model 3", fuelCategory: "BEV", bodyStyle: "sedan", segment: "midsize", trims: [
      { name: "Long Range RWD", years: [2017], specs: N(150, 75, 70, 310) },
      { name: "Long Range AWD", years: [2018,2019,2020], specs: N(150, 75, 70, 322) },
      { name: "Mid Range RWD", years: [2018], specs: N(150, 62, 59, 264, 7.7) },
      { name: "Performance AWD", years: [2018,2019,2020], specs: N(250, 75, 70, 315) },
      { name: "Standard Range Plus RWD", years: [2019,2020], specs: N(170, 50, 47.5, 250, 7.7) },
      { name: "Standard Range RWD", years: [2021,2022,2023], specs: N(170, 60, 57.5, 272) },
      { name: "Long Range AWD", years: [2021,2022,2023], specs: N(250, 82, 75, 358) },
      { name: "Performance AWD", years: [2021,2022,2023], specs: N(250, 82, 75, 315) },
      { name: "RWD", years: [2024], specs: N(170, 57.5, 54.6, 272) },
      { name: "Long Range RWD", years: [2024], specs: N(250, 82, 75, 341) },
      { name: "Performance AWD", years: [2024], specs: N(250, 82, 75, 315) },
    ]},
    { name: "Model X", fuelCategory: "BEV", bodyStyle: "suv", segment: "luxury", trims: [
      { name: "90D", years: [2015,2016], specs: N(120, 90, 85.5, 257, 10) },
      { name: "P90D", years: [2015,2016], specs: N(120, 90, 85.5, 250, 10) },
      { name: "75D", years: [2017,2018], specs: N(120, 75, 71, 237, 11.5) },
      { name: "100D", years: [2017,2018,2019,2020], specs: N(150, 100, 98.5, 305) },
      { name: "P100D", years: [2017,2018,2019,2020], specs: N(150, 100, 98.5, 289) },
      { name: "Long Range AWD", years: [2021,2022,2023,2024], specs: N(250, 100, 98.5, 348) },
      { name: "Plaid", years: [2021,2022,2023,2024], specs: N(250, 100, 98.5, 333) },
    ]},
    { name: "Model Y", fuelCategory: "BEV", bodyStyle: "suv", segment: "midsize", trims: [
      { name: "Long Range AWD", years: [2019,2020], specs: N(200, 75, 70, 316) },
      { name: "Performance AWD", years: [2019,2020], specs: N(250, 75, 70, 291) },
      { name: "Standard Range RWD", years: [2021,2022,2023], specs: N(170, 57.5, 54.6, 244) },
      { name: "Long Range AWD", years: [2021,2022,2023], specs: N(250, 82, 75, 330) },
      { name: "Performance AWD", years: [2021,2022,2023], specs: N(250, 82, 75, 303) },
      { name: "RWD", years: [2024], specs: N(170, 57.5, 54.6, 260) },
      { name: "Long Range AWD", years: [2024], specs: N(250, 82, 75, 330) },
      { name: "Performance AWD", years: [2024], specs: N(250, 82, 75, 303) },
    ]},
    { name: "Cybertruck", fuelCategory: "BEV", bodyStyle: "truck", segment: "fullsize", trims: [
      { name: "AWD", years: [2024], specs: N(250, 123, 108, 340) },
      { name: "Cyberbeast AWD", years: [2024], specs: N(300, 123, 108, 320) },
    ]},
  ]},

  // ── Rivian ─────────────────────────────────────────────────────────────────
  { name: "Rivian", slug: "rivian", country: "US", models: [
    { name: "R1T", fuelCategory: "BEV", bodyStyle: "truck", segment: "fullsize", trims: [
      { name: "Adventure AWD", years: [2022,2023], specs: C(220, 135, 125, 314, 11.5) },
      { name: "Standard AWD", years: [2024], specs: N(140, 92, 80, 278, 11.5, false, false) },
      { name: "Max AWD", years: [2024], specs: N(220, 149, 136, 410, 11.5, false, false) },
    ]},
    { name: "R1S", fuelCategory: "BEV", bodyStyle: "suv", segment: "fullsize", trims: [
      { name: "Adventure AWD", years: [2022,2023], specs: C(220, 135, 125, 321, 11.5) },
      { name: "Standard AWD", years: [2024], specs: N(140, 92, 80, 260, 11.5, false, false) },
      { name: "Max AWD", years: [2024], specs: N(220, 149, 136, 389, 11.5, false, false) },
    ]},
  ]},

  // ── Ford ───────────────────────────────────────────────────────────────────
  { name: "Ford", slug: "ford", country: "US", models: [
    { name: "Mustang Mach-E", fuelCategory: "BEV", bodyStyle: "suv", segment: "midsize", trims: [
      { name: "Select RWD", years: [2021,2022,2023,2024], specs: C(115, 70, 68, 270, 10.5) },
      { name: "Premium Extended Range RWD", years: [2021,2022,2023,2024], specs: C(150, 91, 88, 312, 10.5) },
      { name: "GT AWD", years: [2021,2022,2023,2024], specs: C(150, 91, 88, 270, 10.5) },
      { name: "Select RWD", years: [2025], specs: N(115, 70, 68, 270, 10.5, false, false) },
      { name: "Premium Extended Range RWD", years: [2025], specs: N(150, 91, 88, 312, 10.5, false, false) },
      { name: "GT AWD", years: [2025], specs: N(150, 91, 88, 270, 10.5, false, false) },
    ]},
    { name: "F-150 Lightning", fuelCategory: "BEV", bodyStyle: "truck", segment: "fullsize", trims: [
      { name: "Standard Range Pro", years: [2022,2023,2024], specs: C(150, 98, 80, 240, 19.2) },
      { name: "Extended Range Lariat", years: [2022,2023,2024], specs: C(150, 131, 115, 320, 19.2) },
      { name: "Standard Range Pro", years: [2025], specs: N(150, 98, 80, 240, 19.2, false, false) },
      { name: "Extended Range Lariat", years: [2025], specs: N(150, 131, 115, 320, 19.2, false, false) },
    ]},
    { name: "Escape PHEV", fuelCategory: "PHEV", bodyStyle: "suv", segment: "compact", trims: [
      { name: "", years: yrs(2021, 2024), specs: P(14.4, 3.3, 41) },
    ]},
    { name: "Maverick Hybrid", fuelCategory: "HEV", bodyStyle: "truck", segment: "midsize", trims: [
      { name: "", years: yrs(2022, 2024), specs: H(42) },
    ]},
    { name: "F-150", fuelCategory: "GAS", bodyStyle: "truck", segment: "fullsize", trims: [
      { name: "", years: yrs(2015, 2025), specs: G(24) },
    ]},
    { name: "Explorer", fuelCategory: "GAS", bodyStyle: "suv", segment: "fullsize", trims: [
      { name: "", years: yrs(2015, 2025), specs: G(24) },
    ]},
    { name: "Bronco", fuelCategory: "GAS", bodyStyle: "suv", segment: "midsize", trims: [
      { name: "", years: yrs(2021, 2025), specs: G(20) },
    ]},
    { name: "Mustang", fuelCategory: "GAS", bodyStyle: "coupe", segment: "midsize", trims: [
      { name: "", years: yrs(2015, 2025), specs: G(21) },
    ]},
    { name: "Edge", fuelCategory: "GAS", bodyStyle: "suv", segment: "midsize", trims: [
      { name: "", years: yrs(2015, 2024), specs: G(27) },
    ]},
    { name: "Ranger", fuelCategory: "GAS", bodyStyle: "truck", segment: "midsize", trims: [
      { name: "", years: yrs(2019, 2025), specs: G(26) },
    ]},
  ]},

  // ── Chevrolet ──────────────────────────────────────────────────────────────
  { name: "Chevrolet", slug: "chevrolet", country: "US", models: [
    { name: "Bolt EV", fuelCategory: "BEV", bodyStyle: "hatchback", segment: "compact", trims: [
      { name: "", years: [2017,2018,2019,2020,2021], specs: C(55, 60, 57, 238, 7.2) },
      { name: "", years: [2022,2023], specs: C(55, 65, 60, 259, 7.2) },
    ]},
    { name: "Bolt EUV", fuelCategory: "BEV", bodyStyle: "suv", segment: "compact", trims: [
      { name: "", years: [2022,2023], specs: C(55, 65, 60, 247, 7.2) },
    ]},
    { name: "Equinox EV", fuelCategory: "BEV", bodyStyle: "suv", segment: "midsize", trims: [
      { name: "LT RWD", years: [2024,2025], specs: N(150, 79, 73, 319, 11.5, false, false) },
      { name: "2RS AWD", years: [2024,2025], specs: N(150, 85, 78, 280, 11.5, false, false) },
    ]},
    { name: "Blazer EV", fuelCategory: "BEV", bodyStyle: "suv", segment: "midsize", trims: [
      { name: "LT FWD", years: [2024,2025], specs: N(190, 85, 78, 293, 11.5, false, false) },
      { name: "SS AWD", years: [2024,2025], specs: N(190, 85, 78, 290, 11.5, false, false) },
    ]},
    { name: "Silverado EV", fuelCategory: "BEV", bodyStyle: "truck", segment: "fullsize", trims: [
      { name: "Work Truck", years: [2024,2025], specs: N(200, 107, 102, 391, 11.5, false, false) },
      { name: "RST", years: [2024,2025], specs: N(200, 200, 190, 450, 19.2, false, false) },
    ]},
    { name: "Silverado", fuelCategory: "GAS", bodyStyle: "truck", segment: "fullsize", trims: [
      { name: "", years: yrs(2015, 2025), specs: G(22) },
    ]},
    { name: "Equinox", fuelCategory: "GAS", bodyStyle: "suv", segment: "compact", trims: [
      { name: "", years: yrs(2015, 2023), specs: G(30) },
    ]},
    { name: "Colorado", fuelCategory: "GAS", bodyStyle: "truck", segment: "midsize", trims: [
      { name: "", years: yrs(2015, 2025), specs: G(24) },
    ]},
    { name: "Malibu", fuelCategory: "GAS", bodyStyle: "sedan", segment: "midsize", trims: [
      { name: "", years: yrs(2015, 2024), specs: G(32) },
    ]},
    { name: "Traverse", fuelCategory: "GAS", bodyStyle: "suv", segment: "fullsize", trims: [
      { name: "", years: yrs(2018, 2025), specs: G(24) },
    ]},
    { name: "Trax", fuelCategory: "GAS", bodyStyle: "suv", segment: "compact", trims: [
      { name: "", years: yrs(2015, 2025), specs: G(31) },
    ]},
    { name: "Silverado 1500 Diesel", fuelCategory: "DIESEL", bodyStyle: "truck", segment: "fullsize", trims: [
      { name: "", years: yrs(2019, 2024), specs: G(27) },
    ]},
  ]},

  // ── GMC ────────────────────────────────────────────────────────────────────
  { name: "GMC", slug: "gmc", country: "US", models: [
    { name: "Hummer EV", fuelCategory: "BEV", bodyStyle: "truck", segment: "fullsize", trims: [
      { name: "Edition 1 AWD", years: [2022], specs: C(350, 213, 200, 329, 11.5) },
      { name: "3X AWD", years: [2022,2023,2024], specs: C(350, 213, 200, 329, 11.5) },
      { name: "2X AWD", years: [2023,2024], specs: C(200, 213, 200, 279, 11.5) },
    ]},
    { name: "Hummer EV SUV", fuelCategory: "BEV", bodyStyle: "suv", segment: "fullsize", trims: [
      { name: "3X AWD", years: [2023,2024], specs: C(350, 213, 200, 314, 11.5) },
      { name: "2X AWD", years: [2023,2024], specs: C(200, 213, 200, 250, 11.5) },
    ]},
    { name: "Sierra EV", fuelCategory: "BEV", bodyStyle: "truck", segment: "fullsize", trims: [
      { name: "Denali Edition 1", years: [2024], specs: N(200, 200, 190, 440, 19.2, false, false) },
    ]},
    { name: "Sierra", fuelCategory: "GAS", bodyStyle: "truck", segment: "fullsize", trims: [
      { name: "", years: yrs(2015, 2025), specs: G(21) },
    ]},
    { name: "Canyon", fuelCategory: "GAS", bodyStyle: "truck", segment: "midsize", trims: [
      { name: "", years: yrs(2015, 2025), specs: G(23) },
    ]},
    { name: "Yukon", fuelCategory: "GAS", bodyStyle: "suv", segment: "fullsize", trims: [
      { name: "", years: yrs(2015, 2025), specs: G(19) },
    ]},
    { name: "Terrain", fuelCategory: "GAS", bodyStyle: "suv", segment: "compact", trims: [
      { name: "", years: yrs(2015, 2025), specs: G(30) },
    ]},
    { name: "Acadia", fuelCategory: "GAS", bodyStyle: "suv", segment: "midsize", trims: [
      { name: "", years: yrs(2017, 2025), specs: G(27) },
    ]},
    { name: "Yukon FlexFuel", fuelCategory: "E85", bodyStyle: "suv", segment: "fullsize", trims: [
      { name: "", years: yrs(2015, 2024), specs: G(16) },
    ]},
    { name: "Canyon Diesel", fuelCategory: "DIESEL", bodyStyle: "truck", segment: "midsize", trims: [
      { name: "", years: [2016,2017,2018,2019,2020,2021,2022], specs: G(28) },
    ]},
  ]},

  // ── Hyundai ────────────────────────────────────────────────────────────────
  { name: "Hyundai", slug: "hyundai", country: "KR", models: [
    { name: "IONIQ 5", fuelCategory: "BEV", bodyStyle: "suv", segment: "midsize", trims: [
      { name: "Standard Range RWD", years: [2022,2023], specs: C(220, 58, 54, 220, 10.9) },
      { name: "Long Range RWD", years: [2022,2023,2024], specs: C(220, 77.4, 74, 266, 10.9) },
      { name: "Long Range AWD", years: [2022,2023,2024], specs: C(220, 77.4, 74, 266, 10.9) },
    ]},
    { name: "IONIQ 6", fuelCategory: "BEV", bodyStyle: "sedan", segment: "midsize", trims: [
      { name: "Standard Range RWD", years: [2023,2024], specs: C(220, 53, 50, 240, 10.9) },
      { name: "Long Range RWD", years: [2023,2024], specs: C(220, 77.4, 74, 361, 10.9) },
      { name: "Long Range AWD", years: [2023,2024], specs: C(220, 77.4, 74, 316, 10.9) },
    ]},
    { name: "Tucson PHEV", fuelCategory: "PHEV", bodyStyle: "suv", segment: "compact", trims: [
      { name: "", years: yrs(2022, 2024), specs: P(13.8, 7.2, 35) },
    ]},
    { name: "Tucson Hybrid", fuelCategory: "HEV", bodyStyle: "suv", segment: "compact", trims: [
      { name: "", years: yrs(2022, 2024), specs: H(38) },
    ]},
    { name: "Elantra", fuelCategory: "GAS", bodyStyle: "sedan", segment: "compact", trims: [
      { name: "", years: yrs(2015, 2025), specs: G(37) },
    ]},
    { name: "Sonata", fuelCategory: "GAS", bodyStyle: "sedan", segment: "midsize", trims: [
      { name: "", years: yrs(2015, 2025), specs: G(36) },
    ]},
    { name: "Tucson", fuelCategory: "GAS", bodyStyle: "suv", segment: "compact", trims: [
      { name: "", years: yrs(2015, 2024), specs: G(31) },
    ]},
    { name: "Santa Fe", fuelCategory: "GAS", bodyStyle: "suv", segment: "midsize", trims: [
      { name: "", years: yrs(2015, 2025), specs: G(28) },
    ]},
    { name: "Palisade", fuelCategory: "GAS", bodyStyle: "suv", segment: "fullsize", trims: [
      { name: "", years: yrs(2020, 2025), specs: G(25) },
    ]},
  ]},

  // ── Kia ────────────────────────────────────────────────────────────────────
  { name: "Kia", slug: "kia", country: "KR", models: [
    { name: "EV6", fuelCategory: "BEV", bodyStyle: "suv", segment: "midsize", trims: [
      { name: "Light RWD", years: [2022,2023,2024], specs: C(350, 58, 54, 232, 10.9) },
      { name: "Long Range RWD", years: [2022,2023,2024], specs: C(350, 77.4, 74, 310, 10.9) },
      { name: "Long Range AWD", years: [2022,2023,2024], specs: C(350, 77.4, 74, 274, 10.9) },
      { name: "GT AWD", years: [2023,2024], specs: C(350, 77.4, 74, 206, 10.9) },
    ]},
    { name: "EV9", fuelCategory: "BEV", bodyStyle: "suv", segment: "fullsize", trims: [
      { name: "Long Range RWD", years: [2024,2025], specs: C(350, 99.8, 92, 304, 10.9) },
      { name: "Long Range AWD", years: [2024,2025], specs: C(350, 99.8, 92, 280, 10.9) },
      { name: "GT-Line AWD", years: [2024,2025], specs: C(350, 99.8, 92, 270, 10.9) },
    ]},
    { name: "Sportage PHEV", fuelCategory: "PHEV", bodyStyle: "suv", segment: "compact", trims: [
      { name: "", years: yrs(2023, 2025), specs: P(13.8, 7.2, 35) },
    ]},
    { name: "Sportage Hybrid", fuelCategory: "HEV", bodyStyle: "suv", segment: "compact", trims: [
      { name: "", years: yrs(2023, 2025), specs: H(40) },
    ]},
    { name: "Sorento Hybrid", fuelCategory: "HEV", bodyStyle: "suv", segment: "midsize", trims: [
      { name: "", years: yrs(2021, 2025), specs: H(37) },
    ]},
    { name: "K5", fuelCategory: "GAS", bodyStyle: "sedan", segment: "midsize", trims: [
      { name: "", years: yrs(2021, 2025), specs: G(32) },
    ]},
    { name: "Sorento", fuelCategory: "GAS", bodyStyle: "suv", segment: "midsize", trims: [
      { name: "", years: yrs(2015, 2025), specs: G(29) },
    ]},
    { name: "Telluride", fuelCategory: "GAS", bodyStyle: "suv", segment: "fullsize", trims: [
      { name: "", years: yrs(2020, 2025), specs: G(25) },
    ]},
  ]},

  // ── Genesis ────────────────────────────────────────────────────────────────
  { name: "Genesis", slug: "genesis", country: "KR", models: [
    { name: "GV60", fuelCategory: "BEV", bodyStyle: "suv", segment: "luxury", trims: [
      { name: "Standard AWD", years: [2023,2024], specs: C(350, 58, 54, 235, 10.9) },
      { name: "Performance AWD", years: [2023,2024], specs: C(350, 77.4, 74, 248, 10.9) },
    ]},
    { name: "GV70 Electrified", fuelCategory: "BEV", bodyStyle: "suv", segment: "luxury", trims: [
      { name: "AWD", years: [2023,2024], specs: C(350, 77.4, 74, 236, 10.9) },
    ]},
  ]},

  // ── Volkswagen ─────────────────────────────────────────────────────────────
  { name: "Volkswagen", slug: "volkswagen", country: "DE", models: [
    { name: "ID.4", fuelCategory: "BEV", bodyStyle: "suv", segment: "midsize", trims: [
      { name: "Pro RWD", years: [2021,2022,2023,2024], specs: C(135, 82, 77, 275, 11) },
      { name: "Pro S RWD", years: [2021,2022,2023,2024], specs: C(135, 82, 77, 275, 11) },
      { name: "Pro S AWD", years: [2021,2022,2023,2024], specs: C(135, 82, 77, 260, 11) },
    ]},
    { name: "ID.7", fuelCategory: "BEV", bodyStyle: "sedan", segment: "midsize", trims: [
      { name: "Pro RWD", years: [2024,2025], specs: C(200, 82, 77, 291, 11) },
    ]},
    { name: "Jetta", fuelCategory: "GAS", bodyStyle: "sedan", segment: "compact", trims: [
      { name: "", years: yrs(2015, 2025), specs: G(36) },
    ]},
    { name: "Tiguan", fuelCategory: "GAS", bodyStyle: "suv", segment: "compact", trims: [
      { name: "", years: yrs(2015, 2025), specs: G(27) },
    ]},
    { name: "Atlas", fuelCategory: "GAS", bodyStyle: "suv", segment: "fullsize", trims: [
      { name: "", years: yrs(2018, 2025), specs: G(22) },
    ]},
    { name: "Jetta TDI", fuelCategory: "DIESEL", bodyStyle: "sedan", segment: "compact", trims: [
      { name: "", years: [2009,2010,2011,2012,2013,2014,2015], specs: G(43) },
    ]},
  ]},

  // ── Audi ───────────────────────────────────────────────────────────────────
  { name: "Audi", slug: "audi", country: "DE", models: [
    { name: "e-tron", fuelCategory: "BEV", bodyStyle: "suv", segment: "luxury", trims: [
      { name: "50 quattro", years: [2019,2020,2021,2022], specs: C(150, 95, 83.6, 204, 11) },
      { name: "55 quattro", years: [2019,2020,2021,2022], specs: C(150, 95, 83.6, 222, 11) },
      { name: "S quattro", years: [2021,2022], specs: C(150, 95, 83.6, 208, 11) },
    ]},
    { name: "Q8 e-tron", fuelCategory: "BEV", bodyStyle: "suv", segment: "luxury", trims: [
      { name: "50 quattro", years: [2023,2024], specs: C(170, 95, 89, 222, 11) },
      { name: "55 quattro", years: [2023,2024], specs: C(170, 114, 106, 285, 11) },
      { name: "SQ8 quattro", years: [2023,2024], specs: C(170, 114, 106, 253, 11) },
    ]},
    { name: "e-tron GT", fuelCategory: "BEV", bodyStyle: "sedan", segment: "luxury", trims: [
      { name: "quattro", years: [2022,2023,2024], specs: C(270, 93.4, 83.7, 238, 11, true) },
      { name: "RS quattro", years: [2022,2023,2024], specs: C(270, 93.4, 83.7, 232, 11, true) },
    ]},
    { name: "Q4 e-tron", fuelCategory: "BEV", bodyStyle: "suv", segment: "midsize", trims: [
      { name: "45 RWD", years: [2022,2023,2024], specs: C(135, 82, 76.8, 241, 11) },
      { name: "50 quattro", years: [2022,2023,2024], specs: C(135, 82, 76.8, 220, 11) },
    ]},
    { name: "A4", fuelCategory: "GAS", bodyStyle: "sedan", segment: "compact", trims: [
      { name: "", years: yrs(2015, 2025), specs: G(30) },
    ]},
    { name: "Q5", fuelCategory: "GAS", bodyStyle: "suv", segment: "compact", trims: [
      { name: "", years: yrs(2015, 2025), specs: G(27) },
    ]},
    { name: "Q7", fuelCategory: "GAS", bodyStyle: "suv", segment: "fullsize", trims: [
      { name: "", years: yrs(2015, 2025), specs: G(22) },
    ]},
  ]},

  // ── BMW ────────────────────────────────────────────────────────────────────
  { name: "BMW", slug: "bmw", country: "DE", models: [
    { name: "i3", fuelCategory: "BEV", bodyStyle: "hatchback", segment: "compact", trims: [
      { name: "60Ah", years: [2014,2015,2016], specs: C(50, 22, 18.8, 81, 7.4) },
      { name: "94Ah", years: [2015,2016,2017,2018], specs: C(50, 33, 27.2, 114, 7.4) },
      { name: "120Ah", years: [2018,2019,2020,2021], specs: C(50, 42.2, 37.9, 153, 11) },
    ]},
    { name: "i4", fuelCategory: "BEV", bodyStyle: "sedan", segment: "midsize", trims: [
      { name: "eDrive40", years: [2022,2023,2024], specs: C(205, 83.9, 81.5, 307, 11) },
      { name: "M50 xDrive", years: [2022,2023,2024], specs: C(205, 83.9, 81.5, 271, 11) },
    ]},
    { name: "iX", fuelCategory: "BEV", bodyStyle: "suv", segment: "luxury", trims: [
      { name: "xDrive50", years: [2022,2023,2024], specs: C(200, 111.5, 105.2, 324, 11) },
      { name: "M60 xDrive", years: [2022,2023,2024], specs: C(200, 111.5, 105.2, 288, 11) },
    ]},
    { name: "i5", fuelCategory: "BEV", bodyStyle: "sedan", segment: "luxury", trims: [
      { name: "eDrive40", years: [2024], specs: C(205, 83.9, 81.5, 295, 11) },
      { name: "M60 xDrive", years: [2024], specs: C(205, 83.9, 81.5, 256, 11) },
      { name: "eDrive40", years: [2025], specs: N(205, 83.9, 81.5, 295, 11, false, false) },
    ]},
    { name: "i7", fuelCategory: "BEV", bodyStyle: "sedan", segment: "luxury", trims: [
      { name: "xDrive60", years: [2023,2024], specs: C(195, 101.7, 95.1, 318, 11) },
      { name: "M70 xDrive", years: [2024], specs: C(195, 101.7, 95.1, 275, 11) },
    ]},
    { name: "330e", fuelCategory: "PHEV", bodyStyle: "sedan", segment: "compact", trims: [
      { name: "", years: yrs(2016, 2024), specs: P(12, 3.7, 23) },
    ]},
    { name: "3 Series", fuelCategory: "GAS", bodyStyle: "sedan", segment: "compact", trims: [
      { name: "", years: yrs(2015, 2025), specs: G(31) },
    ]},
    { name: "5 Series", fuelCategory: "GAS", bodyStyle: "sedan", segment: "midsize", trims: [
      { name: "", years: yrs(2015, 2025), specs: G(30) },
    ]},
    { name: "X5", fuelCategory: "GAS", bodyStyle: "suv", segment: "midsize", trims: [
      { name: "", years: yrs(2015, 2025), specs: G(25) },
    ]},
    { name: "X5 xDrive45e PHEV", fuelCategory: "PHEV", bodyStyle: "suv", segment: "midsize", trims: [
      { name: "", years: yrs(2021, 2024), specs: P(24.5, 3.7, 25) },
    ]},
    { name: "X5 Diesel", fuelCategory: "DIESEL", bodyStyle: "suv", segment: "midsize", trims: [
      { name: "", years: [2009,2010,2011,2012,2013,2014,2015,2016,2017,2018,2019], specs: G(28) },
    ]},
  ]},

  // ── Mercedes-Benz ──────────────────────────────────────────────────────────
  { name: "Mercedes-Benz", slug: "mercedes-benz", country: "DE", models: [
    { name: "EQS", fuelCategory: "BEV", bodyStyle: "sedan", segment: "luxury", trims: [
      { name: "450+", years: [2022,2023,2024], specs: C(200, 107.8, 100, 350, 11.5) },
      { name: "580 4MATIC", years: [2022,2023,2024], specs: C(200, 107.8, 100, 340, 11.5) },
    ]},
    { name: "EQE", fuelCategory: "BEV", bodyStyle: "sedan", segment: "luxury", trims: [
      { name: "350+", years: [2023,2024], specs: C(170, 90.6, 84.3, 305, 9.6) },
      { name: "500 4MATIC", years: [2023,2024], specs: C(170, 90.6, 84.3, 260, 9.6) },
    ]},
    { name: "EQS SUV", fuelCategory: "BEV", bodyStyle: "suv", segment: "luxury", trims: [
      { name: "450+", years: [2023,2024], specs: C(200, 107.8, 100, 305, 11.5) },
      { name: "580 4MATIC", years: [2023,2024], specs: C(200, 107.8, 100, 285, 11.5) },
    ]},
    { name: "EQB", fuelCategory: "BEV", bodyStyle: "suv", segment: "compact", trims: [
      { name: "300 4MATIC", years: [2023,2024], specs: C(100, 66.5, 63, 227, 9.6) },
    ]},
    { name: "GLE 350e PHEV", fuelCategory: "PHEV", bodyStyle: "suv", segment: "luxury", trims: [
      { name: "", years: yrs(2021, 2024), specs: P(31.2, 7.4, 23) },
    ]},
    { name: "C-Class", fuelCategory: "GAS", bodyStyle: "sedan", segment: "compact", trims: [
      { name: "", years: yrs(2015, 2025), specs: G(30) },
    ]},
    { name: "E-Class", fuelCategory: "GAS", bodyStyle: "sedan", segment: "midsize", trims: [
      { name: "", years: yrs(2015, 2025), specs: G(28) },
    ]},
    { name: "GLC", fuelCategory: "GAS", bodyStyle: "suv", segment: "compact", trims: [
      { name: "", years: yrs(2015, 2025), specs: G(27) },
    ]},
    { name: "GLE", fuelCategory: "GAS", bodyStyle: "suv", segment: "midsize", trims: [
      { name: "", years: yrs(2015, 2025), specs: G(24) },
    ]},
    { name: "E 300 Bluetec", fuelCategory: "DIESEL", bodyStyle: "sedan", segment: "midsize", trims: [
      { name: "", years: [2012,2013,2014,2015,2016], specs: G(40) },
    ]},
  ]},

  // ── Porsche ────────────────────────────────────────────────────────────────
  { name: "Porsche", slug: "porsche", country: "DE", models: [
    { name: "Taycan", fuelCategory: "BEV", bodyStyle: "sedan", segment: "luxury", trims: [
      { name: "RWD", years: [2020,2021,2022,2023,2024], specs: C(270, 93.4, 83.7, 246, 9.6, true) },
      { name: "4S AWD", years: [2020,2021,2022,2023,2024], specs: C(270, 93.4, 83.7, 227, 9.6, true) },
      { name: "GTS AWD", years: [2022,2023,2024], specs: C(270, 93.4, 83.7, 246, 9.6, true) },
      { name: "Turbo AWD", years: [2020,2021,2022,2023,2024], specs: C(270, 93.4, 83.7, 246, 9.6, true) },
      { name: "Turbo S AWD", years: [2020,2021,2022,2023,2024], specs: C(270, 93.4, 83.7, 227, 9.6, true) },
    ]},
    { name: "Taycan Cross Turismo", fuelCategory: "BEV", bodyStyle: "suv", segment: "luxury", trims: [
      { name: "4 AWD", years: [2022,2023,2024], specs: C(270, 93.4, 83.7, 246, 9.6, true) },
      { name: "Turbo S AWD", years: [2022,2023,2024], specs: C(270, 93.4, 83.7, 225, 9.6, true) },
    ]},
  ]},

  // ── Nissan ─────────────────────────────────────────────────────────────────
  { name: "Nissan", slug: "nissan", country: "JP", models: [
    { name: "LEAF", fuelCategory: "BEV", bodyStyle: "hatchback", segment: "compact", trims: [
      { name: "24 kWh", years: yrs(2011, 2015), specs: D(50, 24, 21.3, 84) },
      { name: "30 kWh", years: [2016,2017], specs: D(50, 30, 27, 107) },
      { name: "40 kWh", years: yrs(2018, 2024), specs: D(50, 40, 36, 149) },
      { name: "62 kWh Plus", years: [2019,2020,2021,2022], specs: D(100, 62, 57, 226, 6.6) },
    ]},
    { name: "Ariya", fuelCategory: "BEV", bodyStyle: "suv", segment: "midsize", trims: [
      { name: "FWD", years: [2023,2024], specs: D(130, 87, 82, 304) },
      { name: "AWD", years: [2023,2024], specs: D(130, 87, 82, 265) },
    ]},
    { name: "Altima", fuelCategory: "GAS", bodyStyle: "sedan", segment: "midsize", trims: [
      { name: "", years: yrs(2015, 2025), specs: G(32) },
    ]},
    { name: "Rogue", fuelCategory: "GAS", bodyStyle: "suv", segment: "compact", trims: [
      { name: "", years: yrs(2015, 2025), specs: G(33) },
    ]},
    { name: "Frontier", fuelCategory: "GAS", bodyStyle: "truck", segment: "midsize", trims: [
      { name: "", years: yrs(2015, 2025), specs: G(22) },
    ]},
    { name: "Pathfinder", fuelCategory: "GAS", bodyStyle: "suv", segment: "fullsize", trims: [
      { name: "", years: yrs(2015, 2025), specs: G(25) },
    ]},
    { name: "Armada", fuelCategory: "GAS", bodyStyle: "suv", segment: "fullsize", trims: [
      { name: "", years: yrs(2015, 2025), specs: G(16) },
    ]},
  ]},

  // ── Lucid ──────────────────────────────────────────────────────────────────
  { name: "Lucid", slug: "lucid", country: "US", models: [
    { name: "Air", fuelCategory: "BEV", bodyStyle: "sedan", segment: "luxury", trims: [
      { name: "Pure RWD", years: [2023,2024], specs: C(300, 88, 84, 410, 19.2) },
      { name: "Grand Touring AWD", years: [2022,2023,2024], specs: C(300, 112, 107, 516, 19.2) },
      { name: "Sapphire AWD", years: [2023,2024], specs: C(300, 118, 113, 427, 19.2) },
    ]},
  ]},

  // ── Cadillac ───────────────────────────────────────────────────────────────
  { name: "Cadillac", slug: "cadillac", country: "US", models: [
    { name: "Lyriq", fuelCategory: "BEV", bodyStyle: "suv", segment: "luxury", trims: [
      { name: "RWD", years: [2023,2024], specs: N(190, 102, 95, 314, 11.5, false, false) },
      { name: "AWD", years: [2024], specs: N(190, 102, 95, 307, 11.5, false, false) },
    ]},
    { name: "Escalade", fuelCategory: "GAS", bodyStyle: "suv", segment: "fullsize", trims: [
      { name: "", years: yrs(2015, 2025), specs: G(18) },
    ]},
  ]},

  // ── Polestar ───────────────────────────────────────────────────────────────
  { name: "Polestar", slug: "polestar", country: "SE", models: [
    { name: "2", fuelCategory: "BEV", bodyStyle: "sedan", segment: "midsize", trims: [
      { name: "Long Range Single Motor", years: [2021,2022,2023,2024], specs: C(155, 82, 78, 270, 11) },
      { name: "Long Range Dual Motor", years: [2021,2022,2023,2024], specs: C(155, 82, 78, 249, 11) },
      { name: "Performance Dual Motor", years: [2021,2022,2023,2024], specs: C(155, 82, 78, 235, 11) },
    ]},
    { name: "3", fuelCategory: "BEV", bodyStyle: "suv", segment: "midsize", trims: [
      { name: "Long Range Single Motor", years: [2024], specs: C(200, 111, 107, 315, 11) },
      { name: "Long Range Dual Motor", years: [2024], specs: C(200, 111, 107, 291, 11) },
    ]},
  ]},

  // ── Volvo ──────────────────────────────────────────────────────────────────
  { name: "Volvo", slug: "volvo", country: "SE", models: [
    { name: "XC40 Recharge", fuelCategory: "BEV", bodyStyle: "suv", segment: "compact", trims: [
      { name: "Twin Motor AWD", years: [2021,2022,2023,2024], specs: C(150, 82, 78, 226, 11) },
      { name: "Single Motor RWD", years: [2023,2024], specs: C(130, 82, 78, 254, 11) },
    ]},
    { name: "C40 Recharge", fuelCategory: "BEV", bodyStyle: "suv", segment: "compact", trims: [
      { name: "Twin Motor AWD", years: [2022,2023,2024], specs: C(150, 82, 78, 226, 11) },
      { name: "Single Motor RWD", years: [2023,2024], specs: C(130, 82, 78, 261, 11) },
    ]},
    { name: "XC60 Recharge PHEV", fuelCategory: "PHEV", bodyStyle: "suv", segment: "compact", trims: [
      { name: "", years: yrs(2020, 2024), specs: P(18.8, 3.7, 26) },
    ]},
    { name: "XC90 Recharge PHEV", fuelCategory: "PHEV", bodyStyle: "suv", segment: "fullsize", trims: [
      { name: "", years: yrs(2016, 2024), specs: P(18.8, 3.7, 27) },
    ]},
    { name: "XC90", fuelCategory: "GAS", bodyStyle: "suv", segment: "fullsize", trims: [
      { name: "", years: yrs(2015, 2025), specs: G(23) },
    ]},
  ]},

  // ── MINI ───────────────────────────────────────────────────────────────────
  { name: "MINI", slug: "mini", country: "GB", models: [
    { name: "Cooper SE", fuelCategory: "BEV", bodyStyle: "hatchback", segment: "compact", trims: [
      { name: "", years: yrs(2020, 2024), specs: C(50, 28.9, 25.7, 110, 7.4) },
    ]},
    { name: "Countryman SE ALL4", fuelCategory: "BEV", bodyStyle: "suv", segment: "compact", trims: [
      { name: "", years: [2024,2025], specs: C(95, 64.7, 60, 212, 11) },
    ]},
  ]},

  // ── Honda ──────────────────────────────────────────────────────────────────
  { name: "Honda", slug: "honda", country: "JP", models: [
    { name: "Prologue", fuelCategory: "BEV", bodyStyle: "suv", segment: "midsize", trims: [
      { name: "EX-L FWD", years: [2024,2025], specs: N(150, 85, 78, 296, 11.5, false, false) },
      { name: "Elite AWD", years: [2024,2025], specs: N(150, 85, 78, 273, 11.5, false, false) },
    ]},
    { name: "Accord Hybrid", fuelCategory: "HEV", bodyStyle: "sedan", segment: "midsize", trims: [
      { name: "", years: yrs(2014, 2025), specs: H(46) },
    ]},
    { name: "CR-V Hybrid", fuelCategory: "HEV", bodyStyle: "suv", segment: "compact", trims: [
      { name: "", years: yrs(2020, 2025), specs: H(40) },
    ]},
    { name: "Civic", fuelCategory: "GAS", bodyStyle: "sedan", segment: "compact", trims: [
      { name: "", years: yrs(2015, 2025), specs: G(36) },
    ]},
    { name: "Accord", fuelCategory: "GAS", bodyStyle: "sedan", segment: "midsize", trims: [
      { name: "", years: yrs(2015, 2025), specs: G(33) },
    ]},
    { name: "CR-V", fuelCategory: "GAS", bodyStyle: "suv", segment: "compact", trims: [
      { name: "", years: yrs(2015, 2025), specs: G(30) },
    ]},
    { name: "Pilot", fuelCategory: "GAS", bodyStyle: "suv", segment: "fullsize", trims: [
      { name: "", years: yrs(2015, 2025), specs: G(24) },
    ]},
    { name: "Ridgeline", fuelCategory: "GAS", bodyStyle: "truck", segment: "midsize", trims: [
      { name: "", years: yrs(2016, 2025), specs: G(23) },
    ]},
  ]},

  // ── Acura ──────────────────────────────────────────────────────────────────
  { name: "Acura", slug: "acura", country: "JP", models: [
    { name: "ZDX", fuelCategory: "BEV", bodyStyle: "suv", segment: "luxury", trims: [
      { name: "A-Spec AWD", years: [2024,2025], specs: N(190, 102, 95, 300, 11.5, false, false) },
      { name: "Type S AWD", years: [2024,2025], specs: N(190, 102, 95, 288, 11.5, false, false) },
    ]},
    { name: "MDX", fuelCategory: "GAS", bodyStyle: "suv", segment: "fullsize", trims: [
      { name: "", years: yrs(2015, 2025), specs: G(25) },
    ]},
    { name: "RDX", fuelCategory: "GAS", bodyStyle: "suv", segment: "compact", trims: [
      { name: "", years: yrs(2015, 2025), specs: G(28) },
    ]},
  ]},

  // ── Subaru ─────────────────────────────────────────────────────────────────
  { name: "Subaru", slug: "subaru", country: "JP", models: [
    { name: "Solterra", fuelCategory: "BEV", bodyStyle: "suv", segment: "compact", trims: [
      { name: "AWD", years: [2023,2024], specs: C(150, 72.8, 71.4, 228, 6.6) },
    ]},
    { name: "Outback", fuelCategory: "GAS", bodyStyle: "suv", segment: "midsize", trims: [
      { name: "", years: yrs(2015, 2025), specs: G(30) },
    ]},
    { name: "Forester", fuelCategory: "GAS", bodyStyle: "suv", segment: "compact", trims: [
      { name: "", years: yrs(2015, 2025), specs: G(29) },
    ]},
    { name: "Crosstrek", fuelCategory: "GAS", bodyStyle: "suv", segment: "compact", trims: [
      { name: "", years: yrs(2015, 2025), specs: G(33) },
    ]},
    { name: "Impreza", fuelCategory: "GAS", bodyStyle: "sedan", segment: "compact", trims: [
      { name: "", years: yrs(2015, 2025), specs: G(32) },
    ]},
  ]},

  // ── Toyota ─────────────────────────────────────────────────────────────────
  { name: "Toyota", slug: "toyota", country: "JP", models: [
    { name: "bZ4X", fuelCategory: "BEV", bodyStyle: "suv", segment: "midsize", trims: [
      { name: "XLE FWD", years: [2023,2024], specs: C(150, 72.8, 71.4, 252, 6.6) },
      { name: "Limited AWD", years: [2023,2024], specs: C(150, 72.8, 71.4, 222, 6.6) },
    ]},
    { name: "Prius Prime", fuelCategory: "PHEV", bodyStyle: "sedan", segment: "compact", trims: [
      { name: "", years: yrs(2017, 2024), specs: P(8.8, 3.3, 54) },
    ]},
    { name: "RAV4 Prime", fuelCategory: "PHEV", bodyStyle: "suv", segment: "compact", trims: [
      { name: "", years: yrs(2021, 2024), specs: P(18.1, 3.3, 42) },
    ]},
    { name: "Prius", fuelCategory: "HEV", bodyStyle: "sedan", segment: "compact", trims: [
      { name: "", years: yrs(2001, 2024), specs: H(57) },
    ]},
    { name: "Camry Hybrid", fuelCategory: "HEV", bodyStyle: "sedan", segment: "midsize", trims: [
      { name: "", years: yrs(2007, 2024), specs: H(51) },
    ]},
    { name: "RAV4 Hybrid", fuelCategory: "HEV", bodyStyle: "suv", segment: "compact", trims: [
      { name: "", years: yrs(2016, 2024), specs: H(38) },
    ]},
    { name: "Corolla Hybrid", fuelCategory: "HEV", bodyStyle: "sedan", segment: "compact", trims: [
      { name: "", years: yrs(2020, 2024), specs: H(52) },
    ]},
    { name: "Highlander Hybrid", fuelCategory: "HEV", bodyStyle: "suv", segment: "fullsize", trims: [
      { name: "", years: yrs(2006, 2024), specs: H(36) },
    ]},
    { name: "Sienna", fuelCategory: "HEV", bodyStyle: "van", segment: "fullsize", trims: [
      { name: "", years: yrs(2021, 2024), specs: H(36) },
    ]},
    { name: "Camry", fuelCategory: "GAS", bodyStyle: "sedan", segment: "midsize", trims: [
      { name: "", years: yrs(2015, 2025), specs: G(32) },
    ]},
    { name: "Corolla", fuelCategory: "GAS", bodyStyle: "sedan", segment: "compact", trims: [
      { name: "", years: yrs(2015, 2025), specs: G(34) },
    ]},
    { name: "RAV4", fuelCategory: "GAS", bodyStyle: "suv", segment: "compact", trims: [
      { name: "", years: yrs(2015, 2025), specs: G(30) },
    ]},
    { name: "Tacoma", fuelCategory: "GAS", bodyStyle: "truck", segment: "midsize", trims: [
      { name: "", years: yrs(2015, 2025), specs: G(23) },
    ]},
    { name: "Tundra", fuelCategory: "GAS", bodyStyle: "truck", segment: "fullsize", trims: [
      { name: "", years: yrs(2015, 2025), specs: G(19) },
    ]},
    { name: "4Runner", fuelCategory: "GAS", bodyStyle: "suv", segment: "midsize", trims: [
      { name: "", years: yrs(2015, 2025), specs: G(17) },
    ]},
    { name: "Sequoia", fuelCategory: "GAS", bodyStyle: "suv", segment: "fullsize", trims: [
      { name: "", years: yrs(2015, 2024), specs: G(17) },
    ]},
  ]},

  // ── Lexus ──────────────────────────────────────────────────────────────────
  { name: "Lexus", slug: "lexus", country: "JP", models: [
    { name: "RZ 450e", fuelCategory: "BEV", bodyStyle: "suv", segment: "luxury", trims: [
      { name: "AWD", years: [2023,2024], specs: C(150, 71.4, 64, 220, 6.6) },
    ]},
    { name: "RX 450h", fuelCategory: "HEV", bodyStyle: "suv", segment: "luxury", trims: [
      { name: "", years: yrs(2006, 2024), specs: H(36) },
    ]},
    { name: "ES 300h", fuelCategory: "HEV", bodyStyle: "sedan", segment: "luxury", trims: [
      { name: "", years: yrs(2013, 2024), specs: H(44) },
    ]},
    { name: "UX 250h", fuelCategory: "HEV", bodyStyle: "suv", segment: "luxury", trims: [
      { name: "", years: yrs(2019, 2024), specs: H(39) },
    ]},
    { name: "RX", fuelCategory: "GAS", bodyStyle: "suv", segment: "luxury", trims: [
      { name: "", years: yrs(2015, 2025), specs: G(27) },
    ]},
    { name: "ES", fuelCategory: "GAS", bodyStyle: "sedan", segment: "luxury", trims: [
      { name: "", years: yrs(2015, 2025), specs: G(31) },
    ]},
    { name: "NX", fuelCategory: "GAS", bodyStyle: "suv", segment: "compact", trims: [
      { name: "", years: yrs(2015, 2025), specs: G(28) },
    ]},
  ]},

  // ── Jeep ───────────────────────────────────────────────────────────────────
  { name: "Jeep", slug: "jeep", country: "US", models: [
    { name: "Wrangler 4xe", fuelCategory: "PHEV", bodyStyle: "suv", segment: "midsize", trims: [
      { name: "", years: yrs(2021, 2024), specs: P(17.3, 7.2, 20) },
    ]},
    { name: "Grand Cherokee 4xe", fuelCategory: "PHEV", bodyStyle: "suv", segment: "midsize", trims: [
      { name: "", years: yrs(2022, 2024), specs: P(17.3, 7.2, 23) },
    ]},
    { name: "Wrangler", fuelCategory: "GAS", bodyStyle: "suv", segment: "midsize", trims: [
      { name: "", years: yrs(2015, 2025), specs: G(20) },
    ]},
    { name: "Grand Cherokee", fuelCategory: "GAS", bodyStyle: "suv", segment: "midsize", trims: [
      { name: "", years: yrs(2015, 2025), specs: G(23) },
    ]},
    { name: "Cherokee", fuelCategory: "GAS", bodyStyle: "suv", segment: "compact", trims: [
      { name: "", years: yrs(2015, 2023), specs: G(26) },
    ]},
  ]},

  // ── Ram ────────────────────────────────────────────────────────────────────
  { name: "Ram", slug: "ram", country: "US", models: [
    { name: "1500", fuelCategory: "GAS", bodyStyle: "truck", segment: "fullsize", trims: [
      { name: "", years: yrs(2015, 2025), specs: G(22) },
    ]},
    { name: "2500", fuelCategory: "GAS", bodyStyle: "truck", segment: "fullsize", trims: [
      { name: "", years: yrs(2015, 2025), specs: G(17) },
    ]},
    { name: "2500 Diesel", fuelCategory: "DIESEL", bodyStyle: "truck", segment: "fullsize", trims: [
      { name: "", years: yrs(2015, 2025), specs: G(20) },
    ]},
    { name: "ProMaster", fuelCategory: "GAS", bodyStyle: "van", segment: "fullsize", trims: [
      { name: "", years: yrs(2015, 2025), specs: G(18) },
    ]},
  ]},

  // ── Dodge ──────────────────────────────────────────────────────────────────
  { name: "Dodge", slug: "dodge", country: "US", models: [
    { name: "Charger", fuelCategory: "GAS", bodyStyle: "sedan", segment: "midsize", trims: [
      { name: "", years: yrs(2015, 2024), specs: G(20) },
    ]},
    { name: "Challenger", fuelCategory: "GAS", bodyStyle: "coupe", segment: "midsize", trims: [
      { name: "", years: yrs(2015, 2023), specs: G(19) },
    ]},
    { name: "Durango", fuelCategory: "GAS", bodyStyle: "suv", segment: "fullsize", trims: [
      { name: "", years: yrs(2015, 2025), specs: G(21) },
    ]},
  ]},

  // ── Mazda ──────────────────────────────────────────────────────────────────
  { name: "Mazda", slug: "mazda", country: "JP", models: [
    { name: "MX-30", fuelCategory: "BEV", bodyStyle: "suv", segment: "compact", trims: [
      { name: "FWD", years: [2022,2023], specs: C(50, 35.5, 30, 100, 6.6) },
    ]},
    { name: "CX-5", fuelCategory: "GAS", bodyStyle: "suv", segment: "compact", trims: [
      { name: "", years: yrs(2015, 2025), specs: G(31) },
    ]},
    { name: "CX-9", fuelCategory: "GAS", bodyStyle: "suv", segment: "fullsize", trims: [
      { name: "", years: yrs(2016, 2024), specs: G(25) },
    ]},
    { name: "3", fuelCategory: "GAS", bodyStyle: "sedan", segment: "compact", trims: [
      { name: "", years: yrs(2015, 2025), specs: G(35) },
    ]},
    { name: "CX-50", fuelCategory: "GAS", bodyStyle: "suv", segment: "compact", trims: [
      { name: "", years: yrs(2023, 2025), specs: G(29) },
    ]},
  ]},

  // ── Mitsubishi ─────────────────────────────────────────────────────────────
  { name: "Mitsubishi", slug: "mitsubishi", country: "JP", models: [
    { name: "Outlander PHEV", fuelCategory: "PHEV", bodyStyle: "suv", segment: "midsize", trims: [
      { name: "", years: yrs(2023, 2025), specs: P(20, 3.3, 26) },
    ]},
    { name: "Outlander", fuelCategory: "GAS", bodyStyle: "suv", segment: "midsize", trims: [
      { name: "", years: yrs(2015, 2025), specs: G(27) },
    ]},
  ]},

  // ── Chrysler ───────────────────────────────────────────────────────────────
  { name: "Chrysler", slug: "chrysler", country: "US", models: [
    { name: "Pacifica Hybrid", fuelCategory: "PHEV", bodyStyle: "van", segment: "fullsize", trims: [
      { name: "", years: yrs(2017, 2024), specs: P(16, 3.6, 30) },
    ]},
  ]},

  // ── Chevrolet FlexFuel ─ E85 ───────────────────────────────────────────────
  { name: "Chevrolet", slug: "chevrolet", country: "US", models: [
    { name: "Tahoe FlexFuel", fuelCategory: "E85", bodyStyle: "suv", segment: "fullsize", trims: [
      { name: "", years: yrs(2015, 2024), specs: G(16) },
    ]},
    { name: "Silverado FlexFuel", fuelCategory: "E85", bodyStyle: "truck", segment: "fullsize", trims: [
      { name: "", years: yrs(2015, 2024), specs: G(18) },
    ]},
  ]},

  // ── Ford FlexFuel ── E85 ────────────────────────────────────────────────────
  { name: "Ford", slug: "ford", country: "US", models: [
    { name: "F-150 FlexFuel", fuelCategory: "E85", bodyStyle: "truck", segment: "fullsize", trims: [
      { name: "", years: yrs(2015, 2024), specs: G(18) },
    ]},
  ]},

  // ── Stellantis / Ram Diesel ─────────────────────────────────────────────────
  { name: "Ford", slug: "ford", country: "US", models: [
    { name: "F-250 Super Duty", fuelCategory: "DIESEL", bodyStyle: "truck", segment: "fullsize", trims: [
      { name: "", years: yrs(2015, 2025), specs: G(19) },
    ]},
  ]},

  // ── Lincoln ────────────────────────────────────────────────────────────────
  { name: "Lincoln", slug: "lincoln", country: "US", models: [
    { name: "Aviator Grand Touring", fuelCategory: "PHEV", bodyStyle: "suv", segment: "luxury", trims: [
      { name: "", years: yrs(2020, 2024), specs: P(13.6, 3.3, 28) },
    ]},
    { name: "Corsair Grand Touring", fuelCategory: "PHEV", bodyStyle: "suv", segment: "compact", trims: [
      { name: "", years: yrs(2021, 2024), specs: P(12.8, 3.6, 31) },
    ]},
    { name: "Nautilus PHEV", fuelCategory: "PHEV", bodyStyle: "suv", segment: "midsize", trims: [
      { name: "", years: yrs(2024, 2025), specs: P(12.8, 3.6, 32) },
    ]},
  ]},

  // ── Buick ──────────────────────────────────────────────────────────────────
  { name: "Buick", slug: "buick", country: "US", models: [
    { name: "Envision", fuelCategory: "GAS", bodyStyle: "suv", segment: "compact", trims: [
      { name: "", years: yrs(2016, 2025), specs: G(27) },
    ]},
    { name: "Enclave", fuelCategory: "GAS", bodyStyle: "suv", segment: "midsize", trims: [
      { name: "", years: yrs(2018, 2025), specs: G(21) },
    ]},
    { name: "Encore GX", fuelCategory: "GAS", bodyStyle: "suv", segment: "subcompact", trims: [
      { name: "", years: yrs(2020, 2025), specs: G(29) },
    ]},
  ]},

  // ── Infiniti ───────────────────────────────────────────────────────────────
  { name: "Infiniti", slug: "infiniti", country: "JP", models: [
    { name: "QX60", fuelCategory: "GAS", bodyStyle: "suv", segment: "midsize", trims: [
      { name: "", years: yrs(2013, 2025), specs: G(22) },
    ]},
    { name: "QX60 Hybrid", fuelCategory: "HEV", bodyStyle: "suv", segment: "midsize", trims: [
      { name: "", years: yrs(2014, 2015), specs: H(25) },
    ]},
    { name: "QX50", fuelCategory: "GAS", bodyStyle: "suv", segment: "compact", trims: [
      { name: "", years: yrs(2019, 2025), specs: G(27) },
    ]},
    { name: "QX80", fuelCategory: "GAS", bodyStyle: "suv", segment: "fullsize", trims: [
      { name: "", years: yrs(2014, 2025), specs: G(16) },
    ]},
  ]},

  // ── Jaguar ─────────────────────────────────────────────────────────────────
  { name: "Jaguar", slug: "jaguar", country: "UK", models: [
    { name: "I-Pace", fuelCategory: "BEV", bodyStyle: "suv", segment: "compact", trims: [
      { name: "S",               years: yrs(2019, 2024), specs: C(100, 90, 84.7, 234, 11) },
      { name: "SE",              years: yrs(2019, 2024), specs: C(100, 90, 84.7, 234, 11) },
      { name: "HSE",             years: yrs(2019, 2024), specs: C(100, 90, 84.7, 234, 11) },
      { name: "EV400 R-Dynamic", years: yrs(2019, 2023), specs: C(100, 90, 84.7, 234, 11) },
    ]},
    { name: "F-Pace", fuelCategory: "GAS", bodyStyle: "suv", segment: "compact", trims: [
      { name: "", years: yrs(2017, 2025), specs: G(22) },
    ]},
    { name: "E-Pace", fuelCategory: "GAS", bodyStyle: "suv", segment: "subcompact", trims: [
      { name: "", years: yrs(2018, 2025), specs: G(26) },
    ]},
  ]},

  // ── Land Rover ─────────────────────────────────────────────────────────────
  { name: "Land Rover", slug: "land-rover", country: "UK", models: [
    { name: "Range Rover PHEV", fuelCategory: "PHEV", bodyStyle: "suv", segment: "luxury", trims: [
      { name: "", years: yrs(2019, 2025), specs: P(31.8, 7.4, 25) },
    ]},
    { name: "Range Rover Sport PHEV", fuelCategory: "PHEV", bodyStyle: "suv", segment: "luxury", trims: [
      { name: "", years: yrs(2019, 2025), specs: P(31.8, 7.4, 25) },
    ]},
    { name: "Defender 90 PHEV", fuelCategory: "PHEV", bodyStyle: "suv", segment: "midsize", trims: [
      { name: "", years: yrs(2021, 2025), specs: P(19.2, 7.4, 30) },
    ]},
    { name: "Defender 110 PHEV", fuelCategory: "PHEV", bodyStyle: "suv", segment: "midsize", trims: [
      { name: "", years: yrs(2021, 2025), specs: P(19.2, 7.4, 30) },
    ]},
    { name: "Discovery PHEV", fuelCategory: "PHEV", bodyStyle: "suv", segment: "fullsize", trims: [
      { name: "", years: yrs(2021, 2025), specs: P(31.8, 7.4, 27) },
    ]},
    { name: "Discovery Sport PHEV", fuelCategory: "PHEV", bodyStyle: "suv", segment: "compact", trims: [
      { name: "", years: yrs(2021, 2025), specs: P(15, 7.4, 34) },
    ]},
  ]},

  // ── Alfa Romeo ─────────────────────────────────────────────────────────────
  { name: "Alfa Romeo", slug: "alfa-romeo", country: "IT", models: [
    { name: "Tonale PHEV", fuelCategory: "PHEV", bodyStyle: "suv", segment: "compact", trims: [
      { name: "Ti",      years: yrs(2024, 2025), specs: P(15.5, 7.4, 29) },
      { name: "Veloce",  years: yrs(2024, 2025), specs: P(15.5, 7.4, 29) },
    ]},
    { name: "Stelvio", fuelCategory: "GAS", bodyStyle: "suv", segment: "compact", trims: [
      { name: "", years: yrs(2018, 2025), specs: G(24) },
    ]},
    { name: "Giulia", fuelCategory: "GAS", bodyStyle: "sedan", segment: "compact", trims: [
      { name: "", years: yrs(2017, 2025), specs: G(27) },
    ]},
  ]},

  // ── Fisker ─────────────────────────────────────────────────────────────────
  { name: "Fisker", slug: "fisker", country: "US", models: [
    { name: "Ocean", fuelCategory: "BEV", bodyStyle: "suv", segment: "midsize", trims: [
      { name: "Sport",   years: [2023, 2024], specs: C(150, 55,  49,  250, 11.5) },
      { name: "Ultra",   years: [2023, 2024], specs: C(200, 89,  80,  360, 11.5) },
      { name: "Extreme", years: [2023, 2024], specs: C(200, 113, 106, 440, 11.5) },
      { name: "One",     years: [2023],       specs: C(200, 113, 106, 440, 11.5) },
    ]},
  ]},

  // ── VinFast ────────────────────────────────────────────────────────────────
  { name: "VinFast", slug: "vinfast", country: "VN", models: [
    { name: "VF 8", fuelCategory: "BEV", bodyStyle: "suv", segment: "midsize", trims: [
      { name: "City", years: yrs(2023, 2025), specs: C(87,  82, 59, 207, 11) },
      { name: "Plus", years: yrs(2023, 2025), specs: C(87,  82, 75, 292, 11) },
    ]},
    { name: "VF 9", fuelCategory: "BEV", bodyStyle: "suv", segment: "fullsize", trims: [
      { name: "Eco",  years: yrs(2024, 2025), specs: C(87, 123, 104, 369, 11) },
      { name: "Plus", years: yrs(2024, 2025), specs: C(87, 123, 104, 369, 11) },
    ]},
  ]},

  // ── Lotus ──────────────────────────────────────────────────────────────────
  { name: "Lotus", slug: "lotus", country: "UK", models: [
    { name: "Eletre", fuelCategory: "BEV", bodyStyle: "suv", segment: "luxury", trims: [
      { name: "S",  years: yrs(2024, 2025), specs: C(350, 112, 100, 373, 22) },
      { name: "R",  years: yrs(2024, 2025), specs: C(450, 112, 100, 348, 22) },
      { name: "RS", years: yrs(2024, 2025), specs: C(450, 112, 100, 348, 22) },
    ]},
    { name: "Emeya", fuelCategory: "BEV", bodyStyle: "sedan", segment: "luxury", trims: [
      { name: "S", years: [2025], specs: C(350, 100, 92, 354, 22) },
      { name: "R", years: [2025], specs: C(450, 100, 92, 329, 22) },
    ]},
  ]},

  // ── Bentley ────────────────────────────────────────────────────────────────
  { name: "Bentley", slug: "bentley", country: "UK", models: [
    { name: "Bentayga PHEV", fuelCategory: "PHEV", bodyStyle: "suv", segment: "luxury", trims: [
      { name: "", years: yrs(2021, 2025), specs: P(18, 7.4, 28) },
    ]},
    { name: "Flying Spur Hybrid", fuelCategory: "PHEV", bodyStyle: "sedan", segment: "luxury", trims: [
      { name: "", years: yrs(2022, 2025), specs: P(14.1, 7.4, 30) },
    ]},
  ]},

  // ════════════════════════════════════════════════════════════════════════════
  // CATALOG UPDATE — 2026.07 r2
  // Adds: missing 2025/2026 model years, new models (EX30, EX90, Gravity,
  // Polestar 4, IONIQ 9, IONIQ 5 N, GV80e, ID.Buzz, EQE SUV, Macan EV,
  // Charger Daytona EV, Ram REV, Escalade IQ, OPTIQ, Vistiq, R2),
  // and new manufacturer Scout Motors.
  // ════════════════════════════════════════════════════════════════════════════

  // ── Tesla 2025 / 2026 ─────────────────────────────────────────────────────
  { name: "Tesla", slug: "tesla", country: "US", models: [
    { name: "Model S", fuelCategory: "BEV", bodyStyle: "sedan", segment: "luxury", trims: [
      { name: "Long Range AWD", years: [2025, 2026], specs: N(250, 100, 98.5, 405) },
      { name: "Plaid",          years: [2025, 2026], specs: N(250, 100, 98.5, 396) },
    ]},
    { name: "Model 3", fuelCategory: "BEV", bodyStyle: "sedan", segment: "midsize", trims: [
      { name: "RWD",             years: [2025, 2026], specs: N(170, 57.5, 54.6, 272) },
      { name: "Long Range RWD",  years: [2025, 2026], specs: N(250, 82, 75, 341) },
      { name: "Performance AWD", years: [2025, 2026], specs: N(250, 82, 75, 315) },
    ]},
    { name: "Model X", fuelCategory: "BEV", bodyStyle: "suv", segment: "luxury", trims: [
      { name: "Long Range AWD", years: [2025, 2026], specs: N(250, 100, 98.5, 348) },
      { name: "Plaid",          years: [2025, 2026], specs: N(250, 100, 98.5, 333) },
    ]},
    { name: "Model Y", fuelCategory: "BEV", bodyStyle: "suv", segment: "midsize", trims: [
      // Juniper refresh — updated battery/range
      { name: "RWD",             years: [2025, 2026], specs: N(170, 75, 72, 311) },
      { name: "Long Range AWD",  years: [2025, 2026], specs: N(250, 82, 75, 334) },
      { name: "Performance AWD", years: [2025, 2026], specs: N(250, 82, 75, 303) },
    ]},
    { name: "Cybertruck", fuelCategory: "BEV", bodyStyle: "truck", segment: "fullsize", trims: [
      { name: "AWD",          years: [2025, 2026], specs: N(250, 123, 108, 340) },
      { name: "Cyberbeast AWD", years: [2025, 2026], specs: N(300, 123, 108, 320) },
    ]},
  ]},

  // ── Rivian 2025 / 2026 + R2 ───────────────────────────────────────────────
  { name: "Rivian", slug: "rivian", country: "US", models: [
    { name: "R1T", fuelCategory: "BEV", bodyStyle: "truck", segment: "fullsize", trims: [
      { name: "Standard AWD", years: [2025, 2026], specs: N(140, 92, 80, 278, 11.5, false, false) },
      { name: "Max AWD",      years: [2025, 2026], specs: N(220, 149, 136, 410, 11.5, false, false) },
    ]},
    { name: "R1S", fuelCategory: "BEV", bodyStyle: "suv", segment: "fullsize", trims: [
      { name: "Standard AWD", years: [2025, 2026], specs: N(140, 92, 80, 260, 11.5, false, false) },
      { name: "Max AWD",      years: [2025, 2026], specs: N(220, 149, 136, 389, 11.5, false, false) },
    ]},
    { name: "R2", fuelCategory: "BEV", bodyStyle: "suv", segment: "midsize", trims: [
      { name: "RWD",      years: [2025, 2026], specs: N(140, 65, 60, 260, 11.5, false, false) },
      { name: "Dual AWD", years: [2025, 2026], specs: N(140, 65, 60, 240, 11.5, false, false) },
    ]},
  ]},

  // ── Dodge — Charger Daytona EV (2024 CCS, 2025 NACS) ─────────────────────
  { name: "Dodge", slug: "dodge", country: "US", models: [
    { name: "Charger Daytona EV", fuelCategory: "BEV", bodyStyle: "coupe", segment: "midsize", trims: [
      { name: "RWD",       years: [2024], specs: C(150, 100.5, 92, 291, 9.6) },
      { name: "Scat Pack AWD", years: [2024], specs: { dcConnector: "CCS", acConnector: "J1772", dcMaxKw: 270, acMaxKw: 9.6, batteryKwh: 100.5, usableKwh: 92, rangeMiles: 241 } },
      { name: "RWD",       years: [2025, 2026], specs: N(150, 100.5, 92, 291, 9.6, false, false) },
      { name: "Scat Pack AWD", years: [2025, 2026], specs: N(270, 100.5, 92, 241, 9.6, false, false) },
    ]},
  ]},

  // ── Ram — 1500 REV BEV (2025 NACS) ───────────────────────────────────────
  { name: "Ram", slug: "ram", country: "US", models: [
    { name: "1500 REV", fuelCategory: "BEV", bodyStyle: "truck", segment: "fullsize", trims: [
      { name: "Standard RWD",         years: [2025, 2026], specs: N(350, 168, 150, 350, 19.2, false, false) },
      { name: "Extended Range REX RWD", years: [2025, 2026], specs: N(350, 168, 150, 500, 19.2, false, false) },
    ]},
  ]},

  // ── Volvo — EX30, EX90 (2024 CCS → 2025 NACS) ────────────────────────────
  { name: "Volvo", slug: "volvo", country: "SE", models: [
    { name: "EX30", fuelCategory: "BEV", bodyStyle: "suv", segment: "subcompact", trims: [
      { name: "Single Motor Extended Range", years: [2024],       specs: C(153, 69, 64, 275, 11) },
      { name: "Twin Motor Performance",      years: [2024],       specs: C(153, 69, 64, 254, 11) },
      { name: "Single Motor Extended Range", years: [2025, 2026], specs: N(153, 69, 64, 275, 11, false, false) },
      { name: "Twin Motor Performance",      years: [2025, 2026], specs: N(153, 69, 64, 254, 11, false, false) },
    ]},
    { name: "EX90", fuelCategory: "BEV", bodyStyle: "suv", segment: "fullsize", trims: [
      { name: "Twin Motor AWD",             years: [2025, 2026], specs: N(250, 111, 107, 300, 11, false, false) },
      { name: "Twin Motor Performance AWD", years: [2025, 2026], specs: N(250, 111, 107, 290, 11, false, false) },
    ]},
    { name: "XC40 Recharge", fuelCategory: "BEV", bodyStyle: "suv", segment: "compact", trims: [
      { name: "Twin Motor AWD",   years: [2025, 2026], specs: N(150, 82, 78, 226, 11, false, false) },
      { name: "Single Motor RWD", years: [2025, 2026], specs: N(130, 82, 78, 254, 11, false, false) },
    ]},
    { name: "C40 Recharge", fuelCategory: "BEV", bodyStyle: "suv", segment: "compact", trims: [
      { name: "Twin Motor AWD",   years: [2025, 2026], specs: N(150, 82, 78, 226, 11, false, false) },
      { name: "Single Motor RWD", years: [2025, 2026], specs: N(130, 82, 78, 261, 11, false, false) },
    ]},
  ]},

  // ── Cadillac — Escalade IQ, OPTIQ, Vistiq + Lyriq 2025/2026 ─────────────
  { name: "Cadillac", slug: "cadillac", country: "US", models: [
    { name: "Lyriq", fuelCategory: "BEV", bodyStyle: "suv", segment: "luxury", trims: [
      { name: "RWD", years: [2025, 2026], specs: N(190, 102, 95, 314, 11.5, false, false) },
      { name: "AWD", years: [2025, 2026], specs: N(190, 102, 95, 307, 11.5, false, false) },
    ]},
    { name: "Escalade IQ", fuelCategory: "BEV", bodyStyle: "suv", segment: "luxury", trims: [
      { name: "AWD", years: [2025, 2026], specs: N(200, 200, 180, 450, 19.2, false, false) },
    ]},
    { name: "OPTIQ", fuelCategory: "BEV", bodyStyle: "suv", segment: "luxury", trims: [
      { name: "FWD", years: [2025, 2026], specs: N(190, 85, 79, 300, 11.5, false, false) },
      { name: "AWD", years: [2025, 2026], specs: N(190, 85, 79, 278, 11.5, false, false) },
    ]},
    { name: "Vistiq", fuelCategory: "BEV", bodyStyle: "suv", segment: "luxury", trims: [
      { name: "AWD", years: [2025, 2026], specs: N(190, 102, 95, 307, 11.5, false, false) },
    ]},
  ]},

  // ── Lucid — Air 2025/2026, Gravity 2025/2026 ──────────────────────────────
  { name: "Lucid", slug: "lucid", country: "US", models: [
    { name: "Air", fuelCategory: "BEV", bodyStyle: "sedan", segment: "luxury", trims: [
      { name: "Pure RWD",          years: [2025, 2026], specs: C(300, 88, 84, 410, 19.2) },
      { name: "Grand Touring AWD", years: [2025, 2026], specs: C(300, 112, 107, 516, 19.2) },
      { name: "Sapphire AWD",      years: [2025, 2026], specs: C(300, 118, 113, 427, 19.2) },
    ]},
    { name: "Gravity", fuelCategory: "BEV", bodyStyle: "suv", segment: "luxury", trims: [
      { name: "Grand Touring AWD", years: [2025, 2026], specs: N(300, 112, 107, 440, 19.2, false, false) },
      { name: "Performance AWD",   years: [2025, 2026], specs: N(300, 112, 107, 400, 19.2, false, false) },
    ]},
  ]},

  // ── Polestar 4 + 2025/2026 updates ────────────────────────────────────────
  { name: "Polestar", slug: "polestar", country: "SE", models: [
    { name: "2", fuelCategory: "BEV", bodyStyle: "sedan", segment: "midsize", trims: [
      { name: "Long Range Single Motor", years: [2025, 2026], specs: C(155, 82, 78, 270, 11) },
      { name: "Long Range Dual Motor",   years: [2025, 2026], specs: C(155, 82, 78, 249, 11) },
    ]},
    { name: "3", fuelCategory: "BEV", bodyStyle: "suv", segment: "midsize", trims: [
      { name: "Long Range Single Motor", years: [2025, 2026], specs: C(200, 111, 107, 315, 11) },
      { name: "Long Range Dual Motor",   years: [2025, 2026], specs: C(200, 111, 107, 291, 11) },
    ]},
    { name: "4", fuelCategory: "BEV", bodyStyle: "suv", segment: "midsize", trims: [
      { name: "Long Range Single Motor", years: [2024, 2025, 2026], specs: C(200, 100, 94, 300, 22) },
      { name: "Long Range Dual Motor",   years: [2024, 2025, 2026], specs: C(200, 100, 94, 270, 22) },
    ]},
  ]},

  // ── Hyundai — IONIQ 5 N, IONIQ 9, 2025/2026 IONIQ 5/6 ───────────────────
  { name: "Hyundai", slug: "hyundai", country: "KR", models: [
    { name: "IONIQ 5", fuelCategory: "BEV", bodyStyle: "suv", segment: "midsize", trims: [
      { name: "Long Range RWD", years: [2025, 2026], specs: C(220, 84, 80, 310, 10.9) },
      { name: "Long Range AWD", years: [2025, 2026], specs: C(220, 84, 80, 266, 10.9) },
    ]},
    { name: "IONIQ 5 N", fuelCategory: "BEV", bodyStyle: "suv", segment: "midsize", trims: [
      { name: "AWD", years: [2025, 2026], specs: { dcConnector: "CCS", acConnector: "J1772", dcMaxKw: 350, acMaxKw: 10.9, batteryKwh: 84, usableKwh: 80, rangeMiles: 266 } },
    ]},
    { name: "IONIQ 6", fuelCategory: "BEV", bodyStyle: "sedan", segment: "midsize", trims: [
      { name: "Long Range RWD", years: [2025, 2026], specs: C(220, 77.4, 74, 361, 10.9) },
      { name: "Long Range AWD", years: [2025, 2026], specs: C(220, 77.4, 74, 316, 10.9) },
    ]},
    { name: "IONIQ 9", fuelCategory: "BEV", bodyStyle: "suv", segment: "fullsize", trims: [
      { name: "Long Range RWD",   years: [2025, 2026], specs: C(350, 110.3, 105, 335, 10.9) },
      { name: "Long Range AWD",   years: [2025, 2026], specs: C(350, 110.3, 105, 320, 10.9) },
      { name: "Performance AWD",  years: [2025, 2026], specs: C(350, 110.3, 105, 270, 10.9) },
    ]},
  ]},

  // ── Kia — EV6 / EV9 2025/2026 ────────────────────────────────────────────
  { name: "Kia", slug: "kia", country: "KR", models: [
    { name: "EV6", fuelCategory: "BEV", bodyStyle: "suv", segment: "midsize", trims: [
      { name: "Light RWD",       years: [2025, 2026], specs: C(350, 58, 54, 232, 10.9) },
      { name: "Long Range RWD",  years: [2025, 2026], specs: C(350, 77.4, 74, 310, 10.9) },
      { name: "Long Range AWD",  years: [2025, 2026], specs: C(350, 77.4, 74, 274, 10.9) },
      { name: "GT AWD",          years: [2025, 2026], specs: C(350, 77.4, 74, 206, 10.9) },
    ]},
    { name: "EV9", fuelCategory: "BEV", bodyStyle: "suv", segment: "fullsize", trims: [
      { name: "Long Range RWD",  years: [2025, 2026], specs: C(350, 99.8, 92, 304, 10.9) },
      { name: "Long Range AWD",  years: [2025, 2026], specs: C(350, 99.8, 92, 280, 10.9) },
      { name: "GT-Line AWD",     years: [2025, 2026], specs: C(350, 99.8, 92, 270, 10.9) },
    ]},
  ]},

  // ── Genesis — GV80 Electrified + GV60/GV70 2025/2026 ─────────────────────
  { name: "Genesis", slug: "genesis", country: "KR", models: [
    { name: "GV60", fuelCategory: "BEV", bodyStyle: "suv", segment: "luxury", trims: [
      { name: "Standard AWD",    years: [2025, 2026], specs: C(350, 58, 54, 235, 10.9) },
      { name: "Performance AWD", years: [2025, 2026], specs: C(350, 77.4, 74, 248, 10.9) },
    ]},
    { name: "GV70 Electrified", fuelCategory: "BEV", bodyStyle: "suv", segment: "luxury", trims: [
      { name: "AWD", years: [2025, 2026], specs: C(350, 77.4, 74, 236, 10.9) },
    ]},
    { name: "GV80 Electrified", fuelCategory: "BEV", bodyStyle: "suv", segment: "luxury", trims: [
      { name: "AWD",          years: [2025, 2026], specs: C(350, 86.1, 81, 248, 10.9) },
      { name: "Advanced AWD", years: [2025, 2026], specs: C(350, 86.1, 81, 248, 10.9) },
    ]},
  ]},

  // ── Volkswagen — ID.4 NACS 2025/2026, ID.Buzz 2025/2026, ID.7 2025/2026 ──
  { name: "Volkswagen", slug: "volkswagen", country: "DE", models: [
    { name: "ID.4", fuelCategory: "BEV", bodyStyle: "suv", segment: "midsize", trims: [
      { name: "Pro RWD",    years: [2025, 2026], specs: N(135, 82, 77, 275, 11, false, false) },
      { name: "Pro S AWD",  years: [2025, 2026], specs: N(135, 82, 77, 260, 11, false, false) },
    ]},
    { name: "ID.Buzz", fuelCategory: "BEV", bodyStyle: "van", segment: "fullsize", trims: [
      { name: "LWB AWD", years: [2025, 2026], specs: N(135, 91, 82, 263, 11, false, false) },
    ]},
    { name: "ID.7", fuelCategory: "BEV", bodyStyle: "sedan", segment: "midsize", trims: [
      { name: "Pro RWD", years: [2025, 2026], specs: C(200, 82, 77, 291, 11) },
    ]},
  ]},

  // ── Mercedes-Benz — EQE SUV (missing) + 2025 updates ─────────────────────
  { name: "Mercedes-Benz", slug: "mercedes-benz", country: "DE", models: [
    { name: "EQE SUV", fuelCategory: "BEV", bodyStyle: "suv", segment: "luxury", trims: [
      { name: "350+ 4MATIC", years: [2023, 2024, 2025], specs: C(170, 90.6, 84.3, 215, 9.6) },
      { name: "500 4MATIC",  years: [2023, 2024, 2025], specs: C(170, 90.6, 84.3, 210, 9.6) },
    ]},
    { name: "EQS",     fuelCategory: "BEV", bodyStyle: "sedan", segment: "luxury", trims: [
      { name: "450+",        years: [2025], specs: C(200, 107.8, 100, 350, 11.5) },
      { name: "580 4MATIC",  years: [2025], specs: C(200, 107.8, 100, 340, 11.5) },
    ]},
    { name: "EQE",     fuelCategory: "BEV", bodyStyle: "sedan", segment: "luxury", trims: [
      { name: "350+",        years: [2025], specs: C(170, 90.6, 84.3, 305, 9.6) },
      { name: "500 4MATIC",  years: [2025], specs: C(170, 90.6, 84.3, 260, 9.6) },
    ]},
    { name: "EQS SUV", fuelCategory: "BEV", bodyStyle: "suv", segment: "luxury", trims: [
      { name: "450+",        years: [2025], specs: C(200, 107.8, 100, 305, 11.5) },
      { name: "580 4MATIC",  years: [2025], specs: C(200, 107.8, 100, 285, 11.5) },
    ]},
    { name: "EQB",     fuelCategory: "BEV", bodyStyle: "suv", segment: "compact", trims: [
      { name: "300 4MATIC",  years: [2025], specs: C(100, 66.5, 63, 227, 9.6) },
    ]},
  ]},

  // ── BMW — NACS-switched 2025/2026 trims ───────────────────────────────────
  { name: "BMW", slug: "bmw", country: "DE", models: [
    { name: "i4", fuelCategory: "BEV", bodyStyle: "sedan", segment: "midsize", trims: [
      { name: "eDrive40",    years: [2025, 2026], specs: N(205, 83.9, 81.5, 307, 11, false, false) },
      { name: "M50 xDrive",  years: [2025, 2026], specs: N(205, 83.9, 81.5, 271, 11, false, false) },
    ]},
    { name: "iX", fuelCategory: "BEV", bodyStyle: "suv", segment: "luxury", trims: [
      { name: "xDrive50",    years: [2025, 2026], specs: N(200, 111.5, 105.2, 324, 11, false, false) },
      { name: "M60 xDrive",  years: [2025, 2026], specs: N(200, 111.5, 105.2, 288, 11, false, false) },
    ]},
    { name: "i5", fuelCategory: "BEV", bodyStyle: "sedan", segment: "luxury", trims: [
      { name: "eDrive40",    years: [2026], specs: N(205, 83.9, 81.5, 295, 11, false, false) },
    ]},
    { name: "i7", fuelCategory: "BEV", bodyStyle: "sedan", segment: "luxury", trims: [
      { name: "xDrive60",    years: [2025, 2026], specs: N(195, 101.7, 95.1, 318, 11, false, false) },
      { name: "M70 xDrive",  years: [2025, 2026], specs: N(195, 101.7, 95.1, 275, 11, false, false) },
    ]},
  ]},

  // ── Audi — 2025 updates ───────────────────────────────────────────────────
  { name: "Audi", slug: "audi", country: "DE", models: [
    { name: "Q4 e-tron", fuelCategory: "BEV", bodyStyle: "suv", segment: "midsize", trims: [
      { name: "45 RWD",      years: [2025, 2026], specs: C(135, 82, 76.8, 241, 11) },
      { name: "50 quattro",  years: [2025, 2026], specs: C(135, 82, 76.8, 220, 11) },
    ]},
    { name: "Q8 e-tron", fuelCategory: "BEV", bodyStyle: "suv", segment: "luxury", trims: [
      { name: "50 quattro",  years: [2025], specs: C(170, 95, 89, 222, 11) },
      { name: "55 quattro",  years: [2025], specs: C(170, 114, 106, 285, 11) },
      { name: "SQ8 quattro", years: [2025], specs: C(170, 114, 106, 253, 11) },
    ]},
    { name: "e-tron GT", fuelCategory: "BEV", bodyStyle: "sedan", segment: "luxury", trims: [
      { name: "quattro",    years: [2025], specs: C(270, 93.4, 83.7, 238, 11, true) },
      { name: "RS quattro", years: [2025], specs: C(270, 93.4, 83.7, 232, 11, true) },
    ]},
  ]},

  // ── Porsche — Taycan 2025/2026 (refreshed battery) + Macan EV ────────────
  { name: "Porsche", slug: "porsche", country: "DE", models: [
    { name: "Taycan", fuelCategory: "BEV", bodyStyle: "sedan", segment: "luxury", trims: [
      { name: "RWD",        years: [2025, 2026], specs: C(270, 105, 97, 318, 9.6, true) },
      { name: "4S AWD",     years: [2025, 2026], specs: C(270, 105, 97, 298, 9.6, true) },
      { name: "GTS AWD",    years: [2025, 2026], specs: C(270, 105, 97, 283, 9.6, true) },
      { name: "Turbo AWD",  years: [2025, 2026], specs: C(320, 105, 97, 273, 9.6, true) },
      { name: "Turbo S AWD", years: [2025, 2026], specs: C(320, 105, 97, 256, 9.6, true) },
    ]},
    { name: "Taycan Cross Turismo", fuelCategory: "BEV", bodyStyle: "suv", segment: "luxury", trims: [
      { name: "4 AWD",      years: [2025, 2026], specs: C(270, 105, 97, 283, 9.6, true) },
      { name: "Turbo S AWD", years: [2025, 2026], specs: C(320, 105, 97, 256, 9.6, true) },
    ]},
    { name: "Macan EV", fuelCategory: "BEV", bodyStyle: "suv", segment: "compact", trims: [
      { name: "RWD",        years: [2024, 2025, 2026], specs: C(270, 100, 95, 308, 11, true) },
      { name: "Turbo AWD",  years: [2024, 2025, 2026], specs: C(270, 100, 95, 288, 11, true) },
    ]},
  ]},

  // ── Toyota bZ4X 2025/2026 ─────────────────────────────────────────────────
  { name: "Toyota", slug: "toyota", country: "JP", models: [
    { name: "bZ4X", fuelCategory: "BEV", bodyStyle: "suv", segment: "midsize", trims: [
      { name: "XLE FWD",     years: [2025, 2026], specs: C(150, 72.8, 71.4, 252, 6.6) },
      { name: "Limited AWD", years: [2025, 2026], specs: C(150, 72.8, 71.4, 222, 6.6) },
    ]},
  ]},

  // ── Subaru Solterra 2025/2026 ─────────────────────────────────────────────
  { name: "Subaru", slug: "subaru", country: "JP", models: [
    { name: "Solterra", fuelCategory: "BEV", bodyStyle: "suv", segment: "compact", trims: [
      { name: "AWD", years: [2025, 2026], specs: C(150, 72.8, 71.4, 228, 6.6) },
    ]},
  ]},

  // ── Nissan Ariya 2025 ─────────────────────────────────────────────────────
  { name: "Nissan", slug: "nissan", country: "JP", models: [
    { name: "Ariya", fuelCategory: "BEV", bodyStyle: "suv", segment: "midsize", trims: [
      { name: "FWD", years: [2025], specs: D(130, 87, 82, 304) },
      { name: "AWD", years: [2025], specs: D(130, 87, 82, 265) },
    ]},
  ]},

  // ── Lexus RZ 450e 2025/2026 ───────────────────────────────────────────────
  { name: "Lexus", slug: "lexus", country: "JP", models: [
    { name: "RZ 450e", fuelCategory: "BEV", bodyStyle: "suv", segment: "luxury", trims: [
      { name: "AWD", years: [2025, 2026], specs: C(150, 71.4, 64, 220, 6.6) },
    ]},
  ]},

  // ── Honda Prologue / Acura ZDX 2026 ──────────────────────────────────────
  { name: "Honda", slug: "honda", country: "JP", models: [
    { name: "Prologue", fuelCategory: "BEV", bodyStyle: "suv", segment: "midsize", trims: [
      { name: "EX-L FWD",  years: [2026], specs: N(150, 85, 78, 296, 11.5, false, false) },
      { name: "Elite AWD", years: [2026], specs: N(150, 85, 78, 273, 11.5, false, false) },
    ]},
  ]},
  { name: "Acura", slug: "acura", country: "JP", models: [
    { name: "ZDX", fuelCategory: "BEV", bodyStyle: "suv", segment: "luxury", trims: [
      { name: "A-Spec AWD", years: [2026], specs: N(190, 102, 95, 300, 11.5, false, false) },
      { name: "Type S AWD", years: [2026], specs: N(190, 102, 95, 288, 11.5, false, false) },
    ]},
  ]},

  // ── MINI 2025/2026 ────────────────────────────────────────────────────────
  { name: "MINI", slug: "mini", country: "GB", models: [
    { name: "Cooper SE", fuelCategory: "BEV", bodyStyle: "hatchback", segment: "compact", trims: [
      { name: "", years: [2025, 2026], specs: C(50, 28.9, 25.7, 110, 7.4) },
    ]},
    { name: "Countryman SE ALL4", fuelCategory: "BEV", bodyStyle: "suv", segment: "compact", trims: [
      { name: "", years: [2026], specs: C(95, 64.7, 60, 212, 11) },
    ]},
  ]},

  // ── GMC — Sierra EV more trims + Hummer EV NACS 2025 ─────────────────────
  { name: "GMC", slug: "gmc", country: "US", models: [
    { name: "Sierra EV", fuelCategory: "BEV", bodyStyle: "truck", segment: "fullsize", trims: [
      { name: "Denali Edition 1", years: [2025, 2026], specs: N(200, 200, 190, 440, 19.2, false, false) },
      { name: "AT4",              years: [2025, 2026], specs: N(200, 200, 190, 440, 19.2, false, false) },
      { name: "Elevation",        years: [2025, 2026], specs: N(200, 107, 102, 350, 19.2, false, false) },
    ]},
    { name: "Hummer EV", fuelCategory: "BEV", bodyStyle: "truck", segment: "fullsize", trims: [
      { name: "3X AWD", years: [2025], specs: N(350, 213, 200, 329, 11.5, false, false) },
      { name: "2X AWD", years: [2025], specs: N(200, 213, 200, 279, 11.5, false, false) },
    ]},
    { name: "Hummer EV SUV", fuelCategory: "BEV", bodyStyle: "suv", segment: "fullsize", trims: [
      { name: "3X AWD", years: [2025], specs: N(350, 213, 200, 314, 11.5, false, false) },
      { name: "2X AWD", years: [2025], specs: N(200, 213, 200, 250, 11.5, false, false) },
    ]},
  ]},

  // ── Ford 2026 ─────────────────────────────────────────────────────────────
  { name: "Ford", slug: "ford", country: "US", models: [
    { name: "Mustang Mach-E", fuelCategory: "BEV", bodyStyle: "suv", segment: "midsize", trims: [
      { name: "Select RWD",                  years: [2026], specs: N(115, 70, 68, 270, 10.5, false, false) },
      { name: "Premium Extended Range RWD",  years: [2026], specs: N(150, 91, 88, 312, 10.5, false, false) },
      { name: "GT AWD",                      years: [2026], specs: N(150, 91, 88, 270, 10.5, false, false) },
    ]},
    { name: "F-150 Lightning", fuelCategory: "BEV", bodyStyle: "truck", segment: "fullsize", trims: [
      { name: "Standard Range Pro",      years: [2026], specs: N(150, 98, 80, 240, 19.2, false, false) },
      { name: "Extended Range Lariat",   years: [2026], specs: N(150, 131, 115, 320, 19.2, false, false) },
    ]},
  ]},

  // ── Chevrolet 2026 ────────────────────────────────────────────────────────
  { name: "Chevrolet", slug: "chevrolet", country: "US", models: [
    { name: "Equinox EV", fuelCategory: "BEV", bodyStyle: "suv", segment: "midsize", trims: [
      { name: "LT RWD",  years: [2026], specs: N(150, 79, 73, 319, 11.5, false, false) },
      { name: "2RS AWD", years: [2026], specs: N(150, 85, 78, 280, 11.5, false, false) },
    ]},
    { name: "Blazer EV", fuelCategory: "BEV", bodyStyle: "suv", segment: "midsize", trims: [
      { name: "LT FWD",  years: [2026], specs: N(190, 85, 78, 293, 11.5, false, false) },
      { name: "SS AWD",  years: [2026], specs: N(190, 85, 78, 290, 11.5, false, false) },
    ]},
    { name: "Silverado EV", fuelCategory: "BEV", bodyStyle: "truck", segment: "fullsize", trims: [
      { name: "Work Truck", years: [2026], specs: N(200, 107, 102, 391, 11.5, false, false) },
      { name: "RST",        years: [2026], specs: N(200, 200, 190, 450, 19.2, false, false) },
    ]},
  ]},

  // ── Scout Motors — Terra (pickup) and Traveler (SUV) — new brand 2026 ─────
  { name: "Scout", slug: "scout", country: "US", models: [
    { name: "Terra", fuelCategory: "BEV", bodyStyle: "truck", segment: "fullsize", trims: [
      { name: "Standard AWD",       years: [2026], specs: N(350, 100, 95, 350, 11.5, false, false) },
      { name: "Extended Range AWD", years: [2026], specs: N(350, 130, 124, 450, 11.5, false, false) },
    ]},
    { name: "Traveler", fuelCategory: "BEV", bodyStyle: "suv", segment: "fullsize", trims: [
      { name: "Standard AWD",       years: [2026], specs: N(350, 100, 95, 350, 11.5, false, false) },
      { name: "Extended Range AWD", years: [2026], specs: N(350, 130, 124, 450, 11.5, false, false) },
    ]},
  ]},
];
