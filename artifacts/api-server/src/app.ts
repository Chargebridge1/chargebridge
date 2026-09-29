import express, { type Express } from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import pinoHttp from "pino-http";
import { clerkMiddleware } from "@clerk/express";
import { publishableKeyFromHost } from "@clerk/shared/keys";
import { stripeWebhookRouter } from "./routes/stripeWebhook";
import ocppApiRouter from "./routes/ocppApi";
import { ocpiRouter } from "./routes/ocpi/index";
import paymentIntentRouter from "./routes/paymentIntent";
import phoneVerifyRouter from "./routes/phoneVerify";
import diagnosticsRouter from "./routes/diagnostics";
import router from "./routes";
import { logger } from "./lib/logger";
import { getAllowedOrigins } from "./lib/corsConfig";
import {
  CLERK_PROXY_PATH,
  clerkProxyMiddleware,
  getClerkProxyHost,
} from "./middlewares/clerkProxyMiddleware";

const app: Express = express();

// Trust exactly one proxy hop (Replit's reverse proxy) so express-rate-limit
// reads the real client IP from X-Forwarded-For. Using `true` is rejected by
// express-rate-limit ≥7 (ERR_ERL_PERMISSIVE_TRUST_PROXY); `1` is the minimum
// safe value — it trusts one hop and no more.
app.set("trust proxy", 1);

// Security headers (no CSP — API-only server; Clerk/Stripe headers handled client-side)
app.use(helmet({ contentSecurityPolicy: false, crossOriginOpenerPolicy: false }));

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);

app.use(CLERK_PROXY_PATH, clerkProxyMiddleware());

// ── CORS allowlist — never reflect arbitrary origins for credentialed requests ─
// Allowed origins: ALLOWED_ORIGINS env var (comma-separated) + REPLIT_DOMAINS.
// Unknown origins get no Access-Control-Allow-Origin header (no credentialed access).
// Startup warnings are emitted by lib/corsConfig.ts.
app.use(
  cors({
    credentials: true,
    origin(requestOrigin, callback) {
      // Same-origin requests (no Origin header) or server-to-server are always fine
      if (!requestOrigin) return callback(null, true);
      if (getAllowedOrigins().has(requestOrigin)) return callback(null, requestOrigin);
      // Unknown origin — allow non-credentialed but omit ACAO (browser blocks credentials)
      callback(null, false);
    },
  }),
);

// Stripe webhook MUST be registered before express.json() — needs raw Buffer body
app.use("/api", stripeWebhookRouter);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Global rate limit: 300 req/min per IP (individual endpoints may be stricter)
app.use("/api", rateLimit({
  windowMs: 60_000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests, please try again later" },
  skip: (req) => req.path.startsWith("/webhook"),
}));

app.use(
  clerkMiddleware((req) => ({
    publishableKey: publishableKeyFromHost(
      getClerkProxyHost(req) ?? "",
      process.env.CLERK_PUBLISHABLE_KEY,
    ),
    secretKey: process.env.CLERK_SECRET_KEY,
  })),
);

app.use("/api", ocppApiRouter);
app.use("/api", ocpiRouter);
app.use("/api", paymentIntentRouter);
app.use("/api/verify", phoneVerifyRouter);
app.use("/api/diagnostics", diagnosticsRouter);
app.use("/api", router);

// Global error handler — must be registered AFTER all routes.
// Express 5 automatically forwards async handler errors here via next(err).
// Without this, Express falls back to its built-in HTML 500 page.
app.use((err: unknown, req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const message = err instanceof Error ? err.message : "Internal server error";
  req.log.error({ err }, message);
  if (!res.headersSent) {
    res.status(500).json({ error: "Internal server error" });
  }
});

export default app;
