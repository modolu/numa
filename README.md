# Numa

**Your onchain inbox.**

Numa turns fragmented wallet activity, protocol updates, governance deadlines, claims, approvals, renewals, and risk events into a prioritized inbox of actions.

## Source of truth
- `NUMA_ARCHITECTURE.md` — technical source of truth.
- `IMPLEMENTATION_PLAN.md` — execution order for the hackathon build.

## MVP principles
- Read-only/advisory.
- Convex-first backend.
- Realtime inbox.
- Small set of high-quality event types.
- Official sources first.
- Deterministic priority and dedupe.
- Source-grounded AI explanations.

## Local bootstrap
Initialize the frontend and Convex in this repository, then preserve the folder boundaries already created here.

Suggested commands after copying this skeleton into the actual repo:

```bash
npx create-next-app@latest . --typescript --tailwind --eslint --app --src-dir=false --import-alias='@/*'
npm install convex
npx convex dev
```

Add other integrations only as their implementation phase begins.
