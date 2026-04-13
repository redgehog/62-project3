# Boba House POS Suite

Operational web app for running a bubble tea shop across customer, cashier, kitchen, and manager workflows.

## What This App Covers

- Customer self-order flow with item customization
- Cashier order entry and checkout
- Kitchen queue and order completion
- Manager console for inventory, menu state, employees, and reporting
- Dedicated menu board display route

## Tech Stack

- React 19 + React Router 7 (full-stack data loaders/actions)
- TypeScript
- Tailwind CSS 4 + custom app theme layer
- Node.js runtime
- PostgreSQL via `pg`
- Docker multi-stage image for production packaging

## High-Level Architecture

- **Route-driven modules:** each role lives in its own route under `app/routes`
- **Server mutations in route actions:** order creation, status updates, and manager operations are handled server-side in route action functions
- **Database access layer:** centralized PostgreSQL pool in `app/db.server.ts`
- **Shared UI theming:** global tokens/utilities in `app/app.css`

## Typical User Flows

- **Customer:** browse categories -> customize drink -> submit order
- **Cashier:** build order quickly -> submit
- **Kitchen:** view pending queue -> mark complete
- **Manager:** maintain inventory/menu + view operational reports

## Local Development

1. Install dependencies:

```bash
npm install
```

2. Provide PostgreSQL environment variables (`PGHOST`, `PGPORT`, `PGDATABASE`, `PGUSER`, `PGPASSWORD`).

3. Start dev server:

```bash
npm run dev
```

4. Optional checks:

```bash
npm run typecheck
```

## Build and Run

```bash
npm run build
npm run start
```

## Docker

```bash
docker build -t boba-house-pos .
docker run -p 3000:3000 boba-house-pos
```
