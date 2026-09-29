import type { RankingWeights } from "./types.js";

export const DEFAULT_WEIGHTS: RankingWeights = {
  accessibility: 35,
  cost: 15,
  reliability: 20,
  availability: 10,
  speed: 5,
  distance: 15,
};

export const WEIGHT_CATEGORIES = Object.keys(DEFAULT_WEIGHTS) as Array<keyof RankingWeights>;

export function validateWeights(weights: Partial<RankingWeights>): string | null {
  for (const [k, v] of Object.entries(weights)) {
    if (typeof v !== "number" || v < 0 || v > 100) {
      return `Weight "${k}" must be a number between 0 and 100`;
    }
  }
  const merged = { ...DEFAULT_WEIGHTS, ...weights };
  const sum = Object.values(merged).reduce((a, b) => a + b, 0);
  if (Math.abs(sum - 100) > 0.01) {
    return `Weights must sum to 100 (got ${sum.toFixed(2)})`;
  }
  return null;
}
