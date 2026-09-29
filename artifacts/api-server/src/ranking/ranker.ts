import type { RankableStation, RankingWeights, AccessibilityLevel } from "./types.js";
import { computeScore } from "./scorer.js";

export type RankedStation<T extends RankableStation> = T & {
  rankScore: number;
  accessibilityLevel: AccessibilityLevel;
};

export function rankStations<T extends RankableStation>(
  stations: T[],
  weights: RankingWeights
): RankedStation<T>[] {
  return stations
    .map((s): RankedStation<T> => {
      const score = computeScore(s, weights);
      return { ...s, rankScore: score.total, accessibilityLevel: score.accessibilityLevel };
    })
    .sort((a, b) => b.rankScore - a.rankScore);
}
