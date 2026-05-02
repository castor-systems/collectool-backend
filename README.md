# Collectool Backend

AWS-first backend for `collectool-admin`, implemented from `BACKEND_REIMPLEMENTATION_SPEC.md`.

## Architecture

- API Gateway HTTP API for low-cost HTTP routing.
- Lambda Node.js 24 ARM64 for the admin API and public published-flow runtime.
- DynamoDB on-demand tables for Collection Builder categories, entities, and flows.
- Cognito user pools and JWT authorizer on every `/admin/*` route.
- Cognito ListUsers/Admin APIs for user metrics and user management.

More detail: `docs/ARCHITECTURE.md`.

## Required Configuration

Pass these values with CDK context or environment variables:

```bash
ALLOWED_ADMIN_GROUPS=admin,collectool-admins
CORS_ALLOWED_ORIGINS=http://localhost:3000,https://admin.collectool.example
SEED_INITIAL_DATA=false
```

Use `SEED_INITIAL_DATA=true` only for local/manual sandbox testing. Shared dev and prod deployments should keep it disabled and use real managed data.

The stack creates both Cognito pools:

- `collectool-{env}-admin-users`
- `collectool-{env}-app-users`

## Deploy

Development:

```bash
npm ci
npm run deploy:dev -- \
  -c corsAllowedOrigins=$CORS_ALLOWED_ORIGINS \
  -c seedInitialData=false
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

- `npm run check`: local quality gate for typecheck, lint, format, tests, and dev synth.
- `npm run test`: Jest tests for CDK, runtime logic, contract fixtures, and handler integration with AWS mocks.
- `npm run openapi:lint`: validate the OpenAPI 3.1 contract in `docs/openapi.yaml`.
- `npm run openapi:bundle`: bundle the OpenAPI contract to `/tmp/collectool-openapi.yaml` for local inspection or tooling.
- `npm run security:iac`: synthesize with `cdk-nag` AWS Solutions checks enabled.
- `npm run audit:deps`: run `npm audit --audit-level=high`.
- `npm run changelog`: generate `CHANGELOG.md` from Conventional Commits.
- `npm run synth:dev`: synthesize the dev CloudFormation template.
- `npm run synth:prod`: synthesize the prod CloudFormation template.
- `npm run deploy:dev`: deploy dev.
- `npm run deploy:prod`: deploy prod.

Workflow and repository protection details live in `docs/BRANCH_PROTECTION.md`.

The HTTP API contract lives in `docs/openapi.yaml`. Update it together with `docs/API_CONTRACTS.md`, `schemas/api-contracts.schema.json`, and fixtures whenever endpoint behavior changes.

The full human/agent development workflow lives in `docs/DEVELOPMENT_WORKFLOW.md`.
