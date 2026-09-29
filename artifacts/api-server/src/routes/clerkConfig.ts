import { Router } from "express";

const router = Router();

router.get("/clerk/config", (_req, res) => {
  const publishableKey = process.env.CLERK_PUBLISHABLE_KEY ?? "";
  return res.json({ publishableKey });
});

export default router;
