import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import session from "express-session";
import router from "./routes";
import vendorAuthRouter from "./routes/vendor_auth";
import vendorPortalRouter from "./routes/vendor_portal";
import { logger } from "./lib/logger";
import { requireAuth } from "./middlewares/requireAuth";

declare module "express-session" {
  interface SessionData {
    simulatedRole: string;
  }
}

const app: Express = express();

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
app.use(cors({ origin: true, credentials: true }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Server-side session for simulated role. The role is set via POST /api/session/role
// (called by the frontend role-switcher) and read by protected endpoints. This ensures
// the role is stored server-side rather than being a per-request forgeable header.
const sessionSecret = process.env["SESSION_SECRET"];
if (!sessionSecret && process.env["NODE_ENV"] === "production") {
  throw new Error("SESSION_SECRET environment variable is required in production.");
}

app.use(
  session({
    secret: sessionSecret ?? "project-hub-dev-secret-REPLACE-IN-PRODUCTION",
    resave: false,
    saveUninitialized: true,
    cookie: {
      // secure:true requires HTTPS; only set in production where the proxy provides TLS
      secure: process.env["NODE_ENV"] === "production",
      httpOnly: true,
      sameSite: process.env["NODE_ENV"] === "production" ? "strict" : "lax",
      maxAge: 24 * 60 * 60 * 1000, // 24 hours
    },
  }),
);

// Vendor portal traffic — mount BEFORE the master-DB requireAuth chain so
// the vendor JWT (validated against the vendor-auth Supabase project) is
// the only credential the vendor portal needs. /api/auth/vendor/* is the
// public OTP flow; /api/vendor/* runs behind requireVendorAuth inside the
// router itself. Both bypass the master-DB gate by virtue of being mounted
// before it.
app.use("/api", vendorAuthRouter);
app.use("/api", vendorPortalRouter);

app.use("/api", requireAuth, router);

export default app;
