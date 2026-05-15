import { Router, type IRouter } from "express";

const router: IRouter = Router();

const VALID_ROLES = [
  "initiator", "hod", "executive_director", "cfo", "scm",
  "chairman", "finance", "pmo", "pm", "team_member",
];

// Set the simulated role in the server-side session.
// IMPORTANT: This endpoint is intentionally available in development/demo mode to simulate
// multi-role approval flows without a full auth system. It is NOT a real authorization
// mechanism — real deployments must replace this with authenticated role assignment.
// In production the endpoint is disabled (returns 403) as a safety guard.
router.post("/session/role", (req, res): void => {
  if (process.env["NODE_ENV"] === "production") {
    res.status(403).json({
      error: "Role simulation is disabled in production. Roles are assigned through the authentication system.",
    });
    return;
  }

  const { role } = req.body as { role?: string };
  if (!role || !VALID_ROLES.includes(role)) {
    res.status(400).json({ error: `Invalid role. Must be one of: ${VALID_ROLES.join(", ")}` });
    return;
  }
  req.session.simulatedRole = role;
  req.session.save((err) => {
    if (err) { res.status(500).json({ error: "Failed to save session" }); return; }
    res.json({ role, message: "Session role updated" });
  });
});

// Read-only: returns the currently active simulated role from session
router.get("/session/role", (req, res): void => {
  res.json({ role: req.session.simulatedRole ?? null });
});

export default router;
