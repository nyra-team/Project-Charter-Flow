import type { Request, Response, NextFunction } from "express";
import { db, vendorMasterTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { getVendorAuthDb } from "../lib/vendorAuthDb";

export interface VendorAuthedUser {
  authUserId: string;
  email: string;
  vendorId: number;
  vendorName: string;
  segment: string;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      vendor?: VendorAuthedUser;
    }
  }
}

/**
 * Validates a bearer JWT against the vendor-auth Supabase project, resolves
 * the caller to a pmo_vendor_master row via auth_user_id, and populates
 * req.vendor. Returns 401 on missing/expired token, 403 on no matching
 * vendor row (signed up but profile not yet created).
 *
 * Mounted ONLY on /api/vendor/* — distinct from requireAuth which handles
 * internal PMO traffic against the master employee DB.
 */
export async function requireVendorAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  const authHeader = req.header("authorization") ?? req.header("Authorization");
  const token = authHeader?.toLowerCase().startsWith("bearer ")
    ? authHeader.slice(7).trim()
    : null;
  if (!token) {
    res.status(401).json({ error: "Missing bearer token" });
    return;
  }
  let supa;
  try {
    supa = getVendorAuthDb();
  } catch (err) {
    req.log?.error({ err }, "Vendor auth DB misconfigured");
    res.status(500).json({ error: "Vendor auth not configured" });
    return;
  }
  const { data: authData, error: authError } = await supa.auth.getUser(token);
  if (authError || !authData?.user?.email) {
    res.status(401).json({ error: "Invalid or expired token" });
    return;
  }
  const authUser = authData.user;
  const [vendor] = await db.select().from(vendorMasterTable).where(eq(vendorMasterTable.authUserId, authUser.id));
  if (!vendor) {
    res.status(403).json({ error: "No vendor profile for this account — complete registration first" });
    return;
  }
  if (vendor.segment === "blocked") {
    res.status(403).json({ error: "Vendor blocked" });
    return;
  }
  req.vendor = {
    authUserId: authUser.id,
    email: authUser.email!,
    vendorId: vendor.id,
    vendorName: vendor.name,
    segment: vendor.segment,
  };
  next();
}
