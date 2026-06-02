import { Router, type IRouter } from "express";
import { z } from "zod/v4";
import { getVendorAuthDb } from "../lib/vendorAuthDb";
import { db, vendorMasterTable } from "@workspace/db";
import { eq } from "drizzle-orm";

// Public, pre-auth routes for vendor portal signup/login. Mounted at
// /api/auth/vendor — does NOT pass through requireAuth or requireVendorAuth.
//
// Uses Supabase's email OTP flow under the hood. The frontend calls these
// from the vendors.granulesrecruit.com portal exactly the way careers calls
// /api/auth/candidate/*.

const router: IRouter = Router();

const SendOtpBody = z.object({
  email: z.string().email(),
  fullName: z.string().min(1).optional(),
  vendorName: z.string().min(1).optional(),
});

router.post("/auth/vendor/send-verification-code", async (req, res) => {
  const parsed = SendOtpBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  let supa;
  try { supa = getVendorAuthDb(); }
  catch (err) { res.status(500).json({ error: "Vendor auth not configured" }); return; }
  const { error } = await supa.auth.signInWithOtp({
    email: parsed.data.email,
    options: {
      shouldCreateUser: true,
      data: {
        full_name: parsed.data.fullName ?? "",
        vendor_name: parsed.data.vendorName ?? "",
        role: "vendor",
      },
    },
  });
  if (error) {
    req.log?.error({ err: error }, "OTP send failed");
    res.status(500).json({ error: "Failed to send verification code" });
    return;
  }
  res.json({ ok: true });
});

const VerifyOtpBody = z.object({
  email: z.string().email(),
  code: z.string().min(4).max(10),
  vendorName: z.string().min(1).optional(),
  legalName: z.string().optional(),
  country: z.string().optional(),
  category: z.string().optional(),
});

router.post("/auth/vendor/verify-email-code", async (req, res) => {
  const parsed = VerifyOtpBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  let supa;
  try { supa = getVendorAuthDb(); }
  catch (err) { res.status(500).json({ error: "Vendor auth not configured" }); return; }
  const { data, error } = await supa.auth.verifyOtp({
    email: parsed.data.email,
    token: parsed.data.code,
    type: "email",
  });
  if (error || !data?.session || !data.user) {
    res.status(401).json({ error: "Invalid or expired code" });
    return;
  }
  // First-time login → create the vendor master row keyed by auth_user_id.
  const authUserId = data.user.id;
  const [existing] = await db.select().from(vendorMasterTable).where(eq(vendorMasterTable.authUserId, authUserId));
  if (!existing) {
    await db.insert(vendorMasterTable).values({
      name: parsed.data.vendorName ?? (data.user.user_metadata?.vendor_name as string) ?? data.user.email!.split("@")[0]!,
      legalName: parsed.data.legalName ?? "",
      country: parsed.data.country ?? "IN",
      category: parsed.data.category ?? "",
      email: data.user.email!,
      segment: "provisional",
      riskStatus: "unknown",
      authUserId,
    });
  }
  res.json({
    accessToken: data.session.access_token,
    refreshToken: data.session.refresh_token,
    expiresAt: data.session.expires_at,
    user: { id: data.user.id, email: data.user.email },
  });
});

export default router;
