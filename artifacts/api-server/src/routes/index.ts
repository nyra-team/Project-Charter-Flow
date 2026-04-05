import { Router, type IRouter } from "express";
import healthRouter from "./health";
import usersRouter from "./users";
import chartersRouter from "./charters";
import approvalsRouter from "./approvals";
import projectsRouter from "./projects";
import dashboardRouter from "./dashboard";

const router: IRouter = Router();

router.use(healthRouter);
router.use(usersRouter);
router.use(chartersRouter);
router.use(approvalsRouter);
router.use(projectsRouter);
router.use(dashboardRouter);

export default router;
