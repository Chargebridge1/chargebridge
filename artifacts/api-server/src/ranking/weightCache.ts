import { db } from "@workspace/db";
import { rankingWeightsTable } from "@workspace/db";
import type { RankingWeights } from "./types.js";
import { DEFAULT_WEIGHTS } from "./defaultWeights.js";

const CACHE_TTL_MS = 5 * 60 * 1000;

let cachedWeights: RankingWeights | null = null;
let cacheAt = 0;

export async function getWeights(): Promise<RankingWeights> {
  if (cachedWeights && Date.now() - cacheAt < CACHE_TTL_MS) {
    return cachedWeights;
  }

  try {
    const rows = await db.select().from(rankingWeightsTable);
    if (rows.length > 0) {
      const weights: RankingWeights = { ...DEFAULT_WEIGHTS };
      for (const row of rows) {
        if (row.category in weights) {
          (weights as unknown as Record<string, number>)[row.category] = row.weight;
        }
      }
      cachedWeights = weights;
      cacheAt = Date.now();
      return weights;
    }
  } catch {
    // DB unavailable — fall through to defaults silently
  }

  cachedWeights = { ...DEFAULT_WEIGHTS };
  cacheAt = Date.now();
  return cachedWeights;
}

export function invalidateWeightsCache(): void {
  cachedWeights = null;
  cacheAt = 0;
}
