import { Router } from "express";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "../lib/logger";
import { requireAdmin } from "../middlewares/requireAuth";

const router = Router();

const BUTTON_DEFAULTS = [
  { key: "mobile_dashboard_find_nearby", label: "Find Nearby", platform: "mobile", location: "Dashboard", description: "Quick action to find nearby EV chargers", enabled: true },
  { key: "mobile_dashboard_explore", label: "Explore", platform: "mobile", location: "Dashboard", description: "Quick action to explore stations by city/zip", enabled: true },
  { key: "mobile_dashboard_add_station", label: "Add Station", platform: "mobile", location: "Dashboard", description: "Quick action to add a new community station", enabled: true },
  { key: "mobile_dashboard_charge_now", label: "Charge Now", platform: "mobile", location: "Dashboard", description: "Quick action to open the Charge Now flow", enabled: true },
  { key: "mobile_dashboard_live_map", label: "Live Map", platform: "mobile", location: "Dashboard", description: "Quick action to view all stations on the live map", enabled: true },
  { key: "mobile_dashboard_gas_prices", label: "Gas Prices", platform: "mobile", location: "Dashboard", description: "Quick action for community gas price tracker", enabled: true },
  { key: "mobile_dashboard_membership", label: "Membership", platform: "mobile", location: "Dashboard", description: "Quick action to view membership plans and pricing", enabled: true },
  { key: "mobile_dashboard_app_reviews", label: "App Reviews", platform: "mobile", location: "Dashboard", description: "Quick action to open app store reviews page", enabled: true },
  { key: "mobile_header_home_button", label: "Home Button", platform: "mobile", location: "Tab Headers", description: "Home navigation button shown in each tab's header bar", enabled: true },
  { key: "mobile_header_charge_now", label: "Charge Now Button", platform: "mobile", location: "Tab Headers", description: "Charge Now shortcut button in Nearby and Explore tab headers", enabled: true },
  { key: "web_sidebar_charge_now", label: "Charge Now", platform: "web", location: "Sidebar", description: "Charge Now CTA button in the sidebar footer", enabled: true },
  { key: "web_sidebar_share", label: "Share App", platform: "web", location: "Sidebar", description: "Share App button in the sidebar footer", enabled: true },
  { key: "web_nav_add_station", label: "Add Station", platform: "web", location: "Navigation", description: "Add Station link in the sidebar navigation", enabled: true },
  { key: "web_nav_gas_stations", label: "Gas Stations", platform: "web", location: "Navigation", description: "Gas Stations link in the sidebar navigation", enabled: true },
  { key: "web_nav_membership", label: "Membership", platform: "web", location: "Navigation", description: "Membership link in the sidebar navigation", enabled: true },
  { key: "web_nav_live_map", label: "Live Map", platform: "web", location: "Navigation", description: "Live Map link in the sidebar navigation", enabled: true },
  { key: "web_station_favorite", label: "Favorite Button", platform: "web", location: "Station Cards", description: "Favorite / unfavorite heart button on each station card", enabled: true },
  { key: "web_station_review", label: "Rate Button", platform: "web", location: "Station Cards", description: "Star rating / review button on each station card", enabled: true },
  { key: "web_page_stations", label: "Stations List", platform: "web", location: "Pages", description: "Browse all community EV charging stations", enabled: true },
  { key: "web_page_nearby", label: "Nearby Search", platform: "web", location: "Pages", description: "Find EV stations near a specific location", enabled: true },
  { key: "web_page_map", label: "Live Map", platform: "web", location: "Pages", description: "Interactive map showing all stations in real time", enabled: true },
  { key: "web_page_favorites", label: "Favorites", platform: "web", location: "Pages", description: "Users' saved favorite stations", enabled: true },
  { key: "web_page_add_station", label: "Add New Station", platform: "web", location: "Pages", description: "Community form to submit a new charging station", enabled: true },
  { key: "web_page_invoices", label: "Invoices", platform: "web", location: "Pages", description: "Charging session invoices and billing history", enabled: true },
  { key: "web_page_gas_stations", label: "Gas Stations", platform: "web", location: "Pages", description: "Community-reported gas price tracker", enabled: true },
  { key: "web_page_membership", label: "Membership Plans", platform: "web", location: "Pages", description: "Subscription plan options and pricing", enabled: true },
] as const;

export async function ensureButtonConfigsTable() {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS button_configs (
      key TEXT PRIMARY KEY,
      label TEXT NOT NULL,
      platform TEXT NOT NULL,
      location TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      enabled BOOLEAN NOT NULL DEFAULT TRUE,
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    );
  `);

  for (const btn of BUTTON_DEFAULTS) {
    await db.execute(sql`
      INSERT INTO button_configs (key, label, platform, location, description, enabled)
      VALUES (${btn.key}, ${btn.label}, ${btn.platform}, ${btn.location}, ${btn.description}, ${btn.enabled})
      ON CONFLICT (key) DO NOTHING;
    `);
  }
  logger.info("button_configs table ready");
}

// GET /api/button-configs — public read (used by frontend and mobile on startup)
router.get("/button-configs", async (_req, res) => {
  try {
    const result = await db.execute(sql`
      SELECT key, label, platform, location, description, enabled
      FROM button_configs
      ORDER BY platform, location, label
    `);
    return res.json(result.rows);
  } catch (err) {
    logger.error({ err }, "Failed to fetch button configs");
    return res.status(500).json({ error: "Failed to fetch button configs" });
  }
});

// PUT /api/admin/button-configs/:key — admin only (requireAdmin returns 401/403)
router.put("/admin/button-configs/:key", requireAdmin, async (req, res) => {
  const { key } = req.params;
  const { enabled } = req.body as { enabled: boolean };

  if (typeof enabled !== "boolean") {
    return res.status(400).json({ error: "enabled must be a boolean" });
  }

  try {
    const result = await db.execute(sql`
      UPDATE button_configs
      SET enabled = ${enabled}, updated_at = NOW()
      WHERE key = ${key}
      RETURNING key, label, platform, location, description, enabled
    `);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Button not found" });
    }

    req.log.info({ key, enabled }, "button config updated");
    return res.json(result.rows[0]);
  } catch (err) {
    req.log.error({ err }, "Failed to update button config");
    return res.status(500).json({ error: "Failed to update button config" });
  }
});

export default router;
