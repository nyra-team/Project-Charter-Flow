# Workspace

## Overview

pnpm workspace monorepo using TypeScript. Each package manages its own dependencies.

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **API framework**: Express 5
- **Database**: PostgreSQL + Drizzle ORM
- **Validation**: Zod (`zod/v4`), `drizzle-zod`
- **API codegen**: Orval (from OpenAPI spec)
- **Build**: esbuild (CJS bundle)
- **Frontend**: React + Vite + TailwindCSS + shadcn/ui
- **State**: Zustand
- **Charts**: Recharts

## Application: Project Hub

Enterprise project management system with full charter-to-execution lifecycle.

### Workflow
1. **Project Charter** — User creates charter with scope, deliverables, vendors, risks, squad, budget
2. **Parallel Review** — HOD, Executive Director, CFO review simultaneously
3. **SCM Negotiation** — SCM enters final negotiated price
4. **Chairman Approval** — Final executive sign-off
5. **Finance** — SAP internal order entry
6. **PMO** — Team and PM selection
7. **Project Execution** — Milestones, tasks, owners, dependencies, critical path, burndown

### Key Entities
- Users (roles: initiator, hod, executive_director, cfo, scm, chairman, finance, pmo, pm, team_member)
- Charters (status flow: draft → submitted → parallel_review → scm_review → chairman_review → finance_review → pmo_review → approved → active)
- Vendors, Risks, Squad Members (charter sub-entities)
- Approvals (per-role decisions with comments)
- Projects, Milestones, Tasks (with dependencies and critical path)

### Features
- Role switcher in UI sidebar to simulate different approver roles
- Approval timeline on charter detail
- Critical path calculation (longest dependency chain)
- Burndown charts with Recharts
- Activity feed on dashboard

## Key Commands

- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- `pnpm --filter @workspace/api-server run dev` — run API server locally

See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details.
