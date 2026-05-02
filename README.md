# Collectool Backend

AWS-first backend for `collectool-admin`, implemented from `BACKEND_REIMPLEMENTATION_SPEC.md`.

## Architecture

- API Gateway HTTP API for low-cost HTTP routing.
- Lambda Node.js 20 ARM64 for the admin API and public published-flow runtime.
- DynamoDB on-demand tables for Collection Builder categories, entities, and flows.
- Cognito user pools and JWT authorizer on every `/admin/*` route.
- Cognito ListUsers/Admin APIs for user metrics and user management.

More detail: `docs/ARCHITECTURE.md`.

## Required Configuration

Pass these values with CDK context or environment variables:

```bash
ALLOWED_ADMIN_GROUPS=admin,collectool-admins
CORS_ALLOWED_ORIGINS=http://localhost:3000,https://admin.collectool.example
SEED_INITIAL_DATA=true
```

The stack creates both Cognito pools:

- `collectool-{env}-admin-users`
- `collectool-{env}-app-users`

## Deploy

Development:

```bash
npm ci
npm run deploy:dev -- \
  -c corsAllowedOrigins=$CORS_ALLOWED_ORIGINS \
  -c seedInitialData=true
```

Production:

```bash
npm ci
npm run deploy:prod -- \
  -c corsAllowedOrigins=$CORS_ALLOWED_ORIGINS \
  -c seedInitialData=false
```

Use the stack outputs to configure `collectool-admin`:

- `ApiUrl` -> `NEXT_PUBLIC_COLLECTOOL_API_URL`
- stack region -> `NEXT_PUBLIC_ADMIN_COGNITO_REGION`
- `AdminUserPoolClientId` -> `NEXT_PUBLIC_ADMIN_COGNITO_CLIENT_ID`

Create the first admin user after deploy and add it to `collectool-admins` or `admin`. See `docs/DEPLOYMENT.md`.

## Branch/Environment Model

- Non-main branches deploy with `-c environment=dev`.
- `main` deploys with `-c environment=prod`.
- Dev tables are destroyable to reduce cleanup friction.
- Prod tables are retained and enable point-in-time recovery.

See `docs/DEPLOYMENT.md` for CI examples.

## Commands

- `npm run test`: Jest tests for CDK and runtime logic.
- `npm run synth:dev`: synthesize the dev CloudFormation template.
- `npm run synth:prod`: synthesize the prod CloudFormation template.
- `npm run deploy:dev`: deploy dev.
- `npm run deploy:prod`: deploy prod.
