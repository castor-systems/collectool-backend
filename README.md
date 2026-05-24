# Collectool Backend

AWS-first backend for `collectool-admin`, implemented from `BACKEND_REIMPLEMENTATION_SPEC.md`.

The source is TypeScript. CDK compiles the app into `dist/`, and the Lambda handler is bundled from `src/handler.ts` with `aws-lambda-nodejs`/`esbuild`.

## Architecture

- API Gateway HTTP API for low-cost HTTP routing.
- Lambda Node.js 24 ARM64 for the admin API and public published-flow runtime.
- DynamoDB on-demand tables for Collection Builder categories, entities, and flows.
- Cognito user pools and JWT authorizer on every `/admin/*` route.
- Cognito ListUsers/Admin APIs for user metrics and user management.
- Private S3 bucket and CloudFront distribution for the `collectool-admin` static frontend.
- GitHub OIDC role for the admin repo to sync static assets and invalidate CloudFront.

More detail: `docs/ARCHITECTURE.md`.

## Required Configuration

Pass these values with CDK context or environment variables:

```bash
CORS_ALLOWED_ORIGINS=http://localhost:3000,https://admin.collectool.example
ADMIN_GITHUB_REPOSITORY=castor-systems/collectool-admin
SEED_INITIAL_DATA=false
```

Use `SEED_INITIAL_DATA=true` only for local/manual sandbox testing. Shared dev and prod deployments should keep it disabled and use real managed data.

The stack creates both Cognito pools:

- `collectool-{env}-admin-users`
- `collectool-{env}-app-users`

All AWS resources created by this stack must keep representative
`collectool-{env}-...` names when AWS supports physical names. The stack also
applies standard tags for cost and operations: `Project`, `Application`,
`Environment`, `ManagedBy`, `Repository`, `CostProfile`, plus per-resource
`Name` and `Component` tags where the AWS resource supports tags.

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
- `AdminSiteUrl` -> deployed admin URL
- `AdminDeployRoleArn` -> `AWS_DEPLOY_ROLE_ARN` secret in the matching `collectool-admin` GitHub Environment

Create the first admin user in the admin Cognito user pool after deploy. See
`docs/DEPLOYMENT.md`.

## Branch/Environment Model

- Non-main branches deploy with `-c environment=dev`.
- `main` deploys with `-c environment=prod`.
- Dev tables are destroyable to reduce cleanup friction.
- Prod tables are retained and enable point-in-time recovery.

See `docs/DEPLOYMENT.md` for CI examples.

## Commands

- `npm run build`: compile TypeScript into `dist/`.
- `npm run check`: local and CI quality gate for typecheck, lint, format, OpenAPI, tests, and mandatory `cdk-nag`.
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
- `npm run outputs:dev`: print CloudFormation outputs for the dev stack.
- `npm run outputs:prod`: print CloudFormation outputs for the prod stack.
- `npm run health -- <api-url>`: call the deployed `/health` endpoint.
- `npm run local:infra`: start DynamoDB Local with Docker Compose.
- `npm run local:tables`: create local DynamoDB tables.
- `npm run local:seed`: load reusable local seed data.
- `npm run local:api`: run the local HTTP API on `http://localhost:3001`.
- `npm run local:up`: start DynamoDB Local, ensure tables, seed data, and run the API.
- `npm run local:reset`: stop local infra and remove the DynamoDB Local volume.

## Local Development

The lightweight local environment simulates the AWS runtime without deploying:

- DynamoDB Local stores Collection Builder data.
- The same Lambda handler is invoked through a local Node HTTP server.
- The admin mock login token `mock-admin-access-token` is accepted only when
  `LOCAL_FAKE_AUTH=true`.
- Cognito user list/metrics/moderation endpoints use local mock users.
- `src/seed.ts` is reused for local seed data.

Start everything:

```bash
npm run local:up
```

Then test:

```bash
curl http://localhost:3001/health
curl -H 'Authorization: Bearer mock-admin-access-token' http://localhost:3001/admin/session
curl -H 'Authorization: Bearer mock-admin-access-token' http://localhost:3001/admin/collection-builder/bootstrap
```

The token value matches `collectool-admin` mock login. Local admin claims can be
overridden with `x-local-*` headers.

Point `collectool-admin` local development to:

```bash
NEXT_PUBLIC_COLLECTOOL_API_URL=http://localhost:3001
NEXT_PUBLIC_ADMIN_AUTH_MODE=mock
NEXT_PUBLIC_APP_ENV=local
```

Do not set `LOCAL_FAKE_AUTH=true` in shared `dev` or `prod`; those environments
use the real Cognito/API Gateway authorizer created by CDK.

Workflow and repository protection details live in `docs/BRANCH_PROTECTION.md`.

The admin frontend deploy is implemented in `collectool-admin/.github/workflows/deploy-s3.yml`; its S3 bucket, CloudFront distribution, and GitHub OIDC role are created here by CDK.

The HTTP API contract lives in `docs/openapi.yaml`. Update it together with `docs/API_CONTRACTS.md`, `schemas/api-contracts.schema.json`, and fixtures whenever endpoint behavior changes.

The full human/agent development workflow lives in `docs/DEVELOPMENT_WORKFLOW.md`.
