export interface EVSpec {
  id: string;
  make: string;
  model: string;
  yearRange: string;
  batteryKwh: number;
  rangeMiles: number;
  plugTypes: string[];
}

export const EV_SPECS: EVSpec[] = [
  { id: "tesla-model-3", make: "Tesla", model: "Model 3", yearRange: "2017–2024", batteryKwh: 75, rangeMiles: 315, plugTypes: ["NACS"] },
  { id: "tesla-model-y", make: "Tesla", model: "Model Y", yearRange: "2020–2024", batteryKwh: 75, rangeMiles: 330, plugTypes: ["NACS"] },
  { id: "tesla-model-s", make: "Tesla", model: "Model S", yearRange: "2012–2024", batteryKwh: 100, rangeMiles: 405, plugTypes: ["NACS"] },
  { id: "tesla-model-x", make: "Tesla", model: "Model X", yearRange: "2015–2024", batteryKwh: 100, rangeMiles: 348, plugTypes: ["NACS"] },
  { id: "tesla-cybertruck", make: "Tesla", model: "Cybertruck", yearRange: "2024+", batteryKwh: 123, rangeMiles: 340, plugTypes: ["NACS"] },
  { id: "rivian-r1t-nacs", make: "Rivian", model: "R1T", yearRange: "2024+", batteryKwh: 135, rangeMiles: 314, plugTypes: ["NACS", "J1772"] },
  { id: "rivian-r1s-nacs", make: "Rivian", model: "R1S", yearRange: "2024+", batteryKwh: 135, rangeMiles: 321, plugTypes: ["NACS", "J1772"] },
  { id: "ford-mach-e-nacs", make: "Ford", model: "Mustang Mach-E", yearRange: "2025+", batteryKwh: 91, rangeMiles: 312, plugTypes: ["NACS", "J1772"] },
  { id: "ford-f150-lightning-nacs", make: "Ford", model: "F-150 Lightning", yearRange: "2025+", batteryKwh: 131, rangeMiles: 320, plugTypes: ["NACS", "J1772"] },
  { id: "chevy-equinox-ev", make: "Chevrolet", model: "Equinox EV", yearRange: "2024+", batteryKwh: 85, rangeMiles: 319, plugTypes: ["NACS", "J1772"] },
  { id: "chevy-silverado-ev", make: "Chevrolet", model: "Silverado EV", yearRange: "2024+", batteryKwh: 200, rangeMiles: 450, plugTypes: ["NACS", "J1772"] },
  { id: "chevy-bolt-ev", make: "Chevrolet", model: "Bolt EV", yearRange: "2017–2023", batteryKwh: 65, rangeMiles: 259, plugTypes: ["CCS", "J1772"] },
  { id: "ford-mach-e-ccs", make: "Ford", model: "Mustang Mach-E", yearRange: "2021–2024", batteryKwh: 91, rangeMiles: 280, plugTypes: ["CCS", "J1772"] },
  { id: "ford-f150-lightning-ccs", make: "Ford", model: "F-150 Lightning", yearRange: "2022–2024", batteryKwh: 131, rangeMiles: 300, plugTypes: ["CCS", "J1772"] },
  { id: "vw-id4", make: "Volkswagen", model: "ID.4", yearRange: "2021–2024", batteryKwh: 82, rangeMiles: 275, plugTypes: ["CCS", "J1772"] },
  { id: "hyundai-ioniq5", make: "Hyundai", model: "IONIQ 5", yearRange: "2022–2024", batteryKwh: 77.4, rangeMiles: 266, plugTypes: ["CCS", "J1772"] },
  { id: "hyundai-ioniq6", make: "Hyundai", model: "IONIQ 6", yearRange: "2023–2024", batteryKwh: 77.4, rangeMiles: 361, plugTypes: ["CCS", "J1772"] },
  { id: "kia-ev6", make: "Kia", model: "EV6", yearRange: "2022–2024", batteryKwh: 77.4, rangeMiles: 310, plugTypes: ["CCS", "J1772"] },
  { id: "kia-ev9", make: "Kia", model: "EV9", yearRange: "2024+", batteryKwh: 99.8, rangeMiles: 304, plugTypes: ["CCS", "J1772"] },
  { id: "bmw-i4", make: "BMW", model: "i4", yearRange: "2022–2024", batteryKwh: 83.9, rangeMiles: 307, plugTypes: ["CCS", "J1772"] },
  { id: "bmw-ix", make: "BMW", model: "iX", yearRange: "2022–2024", batteryKwh: 105.2, rangeMiles: 324, plugTypes: ["CCS", "J1772"] },
  { id: "bmw-i5", make: "BMW", model: "i5", yearRange: "2024+", batteryKwh: 83.9, rangeMiles: 295, plugTypes: ["NACS", "J1772"] },
  { id: "mercedes-eqs", make: "Mercedes-Benz", model: "EQS", yearRange: "2022–2024", batteryKwh: 107.8, rangeMiles: 350, plugTypes: ["CCS", "J1772"] },
  { id: "mercedes-eqe", make: "Mercedes-Benz", model: "EQE", yearRange: "2023–2024", batteryKwh: 90.6, rangeMiles: 305, plugTypes: ["CCS", "J1772"] },
  { id: "audi-etron-gt", make: "Audi", model: "e-tron GT", yearRange: "2022–2024", batteryKwh: 93.4, rangeMiles: 238, plugTypes: ["CCS", "J1772"] },
  { id: "audi-q4-etron", make: "Audi", model: "Q4 e-tron", yearRange: "2022–2024", batteryKwh: 82, rangeMiles: 241, plugTypes: ["CCS", "J1772"] },
  { id: "porsche-taycan", make: "Porsche", model: "Taycan", yearRange: "2020–2024", batteryKwh: 93.4, rangeMiles: 246, plugTypes: ["CCS", "J1772"] },
  { id: "volvo-xc40-recharge", make: "Volvo", model: "XC40 Recharge", yearRange: "2021–2024", batteryKwh: 82, rangeMiles: 226, plugTypes: ["CCS", "J1772"] },
  { id: "polestar-2", make: "Polestar", model: "2", yearRange: "2021–2024", batteryKwh: 82, rangeMiles: 270, plugTypes: ["CCS", "J1772"] },
  { id: "genesis-gv60", make: "Genesis", model: "GV60", yearRange: "2023–2024", batteryKwh: 77.4, rangeMiles: 248, plugTypes: ["CCS", "J1772"] },
  { id: "lucid-air", make: "Lucid", model: "Air", yearRange: "2022–2024", batteryKwh: 112, rangeMiles: 516, plugTypes: ["CCS", "J1772"] },
  { id: "cadillac-lyriq", make: "Cadillac", model: "Lyriq", yearRange: "2023–2024", batteryKwh: 102, rangeMiles: 314, plugTypes: ["CCS", "J1772"] },
  { id: "gmc-hummer-ev", make: "GMC", model: "Hummer EV", yearRange: "2022–2024", batteryKwh: 213, rangeMiles: 329, plugTypes: ["CCS", "J1772"] },
  { id: "honda-prologue", make: "Honda", model: "Prologue", yearRange: "2024+", batteryKwh: 85, rangeMiles: 296, plugTypes: ["CCS", "J1772"] },
  { id: "subaru-solterra", make: "Subaru", model: "Solterra", yearRange: "2023–2024", batteryKwh: 72.8, rangeMiles: 228, plugTypes: ["CCS", "J1772"] },
  { id: "toyota-bz4x", make: "Toyota", model: "bZ4X", yearRange: "2023–2024", batteryKwh: 72.8, rangeMiles: 252, plugTypes: ["CCS", "J1772"] },
  { id: "mini-cooper-se", make: "MINI", model: "Cooper SE", yearRange: "2020–2024", batteryKwh: 28.9, rangeMiles: 110, plugTypes: ["CCS", "J1772"] },
  { id: "nissan-leaf", make: "Nissan", model: "LEAF", yearRange: "2011–2024", batteryKwh: 40, rangeMiles: 149, plugTypes: ["CHAdeMO", "J1772"] },
  { id: "nissan-ariya", make: "Nissan", model: "Ariya", yearRange: "2023–2024", batteryKwh: 87, rangeMiles: 304, plugTypes: ["CHAdeMO", "J1772"] },
];

const EV_SPEC_BY_ID = new Map<string, EVSpec>(EV_SPECS.map((s) => [s.id, s]));

export function lookupEvSpecById(id: string): EVSpec | undefined {
  return EV_SPEC_BY_ID.get(id);
}

export function lookupEvSpecByMakeModel(make: string, model: string): EVSpec | undefined {
  const norm = (s: string) => s.toLowerCase().trim();
  return EV_SPECS.find(
    (s) => norm(s.make) === norm(make) && norm(s.model) === norm(model),
  );
}

export function getPlugTypesForVehicle(make: string | null | undefined, model: string | null | undefined): string[] {
  if (!make || !model) return [];
  return lookupEvSpecByMakeModel(make, model)?.plugTypes ?? [];
}
