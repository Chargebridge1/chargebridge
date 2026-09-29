import { Router } from "express";
import { db } from "@workspace/db";
import { rankingWeightsTable } from "@workspace/db";
import { requireAdmin } from "../middlewares/requireAuth.js";
import {
  DEFAULT_WEIGHTS,
  WEIGHT_CATEGORIES,
  validateWeights,
  invalidateWeightsCache,
  getWeights,
} from "../ranking/index.js";

const router = Router();

router.get("/admin/ranking-weights", requireAdmin, async (req, res) => {
  const current = await getWeights();
  return res.json({
    weights: current,
    defaults: DEFAULT_WEIGHTS,
    categories: WEIGHT_CATEGORIES.map((cat) => ({
      category: cat,
      weight: current[cat],
      default: DEFAULT_WEIGHTS[cat],
    })),
  });
});

router.put("/admin/ranking-weights", requireAdmin, async (req, res) => {
  const updates: Record<string, number> = req.body ?? {};

  const validKeys = new Set<string>(WEIGHT_CATEGORIES);
  const unknown = Object.keys(updates).filter((k) => !validKeys.has(k));
  if (unknown.length > 0) {
    return res.status(400).json({ error: `Unknown weight categories: ${unknown.join(", ")}` });
  }

  const err = validateWeights(updates as any);
  if (err) return res.status(400).json({ error: err });

  const current = await getWeights();
  const merged = { ...current, ...updates };

  for (const [category, weight] of Object.entries(merged)) {
    await db
      .insert(rankingWeightsTable)
      .values({
        category,
        weight,
        description: `Updated via admin API`,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: rankingWeightsTable.category,
        set: { weight, updatedAt: new Date() },
      });
  }

  invalidateWeightsCache();
  const saved = await getWeights();
  req.log.info({ weights: saved }, "Ranking weights updated");
  return res.json({ weights: saved });
});

router.delete("/admin/ranking-weights", requireAdmin, async (req, res) => {
  await db.delete(rankingWeightsTable);
  invalidateWeightsCache();
  req.log.info("Ranking weights reset to defaults");
  return res.json({ weights: DEFAULT_WEIGHTS, message: "Reset to defaults" });
});

export default router;
