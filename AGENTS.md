# Collectool Backend Agent Guide

Use this file as the local operating manual for automatic agents working in `collectool-backend`.

## Project Role

`collectool-backend` owns the AWS infrastructure and backend API for Collectool. It defines Cognito, API Gateway, Lambda, DynamoDB, deployment behavior, and the admin/public Collection Builder runtime.

It also owns the S3 bucket, CloudFront distribution, and GitHub OIDC role used to deploy `collectool-admin`.

## Required Baseline

Before finishing broad code or infrastructure changes, run:

```bash
npm run check
```

For narrow changes, run the smallest relevant subset and report what was skipped:

```bash
npm run typecheck
npm run lint
npm run format:check
npm run openapi:lint
npm test
npm run security:iac
```

The full final workflow for humans and agents is documented in `docs/DEVELOPMENT_WORKFLOW.md`.

For local end-to-end backend checks without AWS deploys, use:

```bash
npm run local:up
```

This runs DynamoDB Local, creates local tables, loads `src/seed.ts`, and serves
the Lambda handler through `http://localhost:3001`.

Local admin auth accepts `Authorization: Bearer mock-admin-access-token` only
with `LOCAL_FAKE_AUTH=true`. Never carry that flag into shared `dev` or `prod`.

## Package Manager And Runtime

Use npm only.

- Keep `package-lock.json`.
- Do not add `pnpm-lock.yaml`, `yarn.lock`, or Bun lockfiles.
- Install dependencies with `npm install` or `npm ci`.
- Use Node 24 for local tooling and Lambda runtime.
- Source code is TypeScript and compiles to `dist/`.

## Deploy Safety

Do not deploy or mutate AWS resources unless the user explicitly asks for it.

- `npm run deploy:dev` is allowed only when requested.
- `npm run deploy:prod` requires an explicit production deploy request.
- Prefer `npm run diff:dev` / `npm run diff:prod` before any deploy.
- Never commit credentials, local AWS profiles, `cdk.out`, or generated asset bundles.
- Every AWS resource must keep a representative `collectool-{environment}-...`
  name where the service supports physical names, and every taggable resource
  must keep the standard project/environment tags plus resource-level
  `Name`/`Component` tags.

## Environment Variables

When adding a new CDK/deploy-time variable, update `.env.example`, `README.md`, and `docs/DEPLOYMENT.md`.

Current non-secret inputs:

- `DEPLOY_ENV`
- `CORS_ALLOWED_ORIGINS`
- `SEED_INITIAL_DATA`
- `ADMIN_GITHUB_REPOSITORY`

## Code Organization

Keep business logic and AWS integration separate.

- Pure runtime logic belongs in `src/runtime.ts` or other pure modules.
- HTTP response helpers belong in `src/http/`.
- AWS persistence belongs in `src/repositories/`.
- Cognito/user/metrics behavior belongs in `src/services/`.
- `src/handler.ts` should stay as the Lambda composition root and request dispatcher.
- CDK stack code belongs under `lib/`; split constructs when one stack file becomes hard to review.

## Testing

Use:

- Jest for unit tests and CDK assertions.
- AWS SDK mocks for Lambda handler/integration tests.
- Contract fixtures under `test/fixtures/`.
- JSON schemas under `schemas/` for backend/frontend contract validation.
- OpenAPI 3.1 contract under `docs/openapi.yaml`, validated with Redocly CLI.
- `collectool-backend` is the source of truth for shared backend/frontend contracts. Touch `collectool-admin` only when syncing frontend expectations to a backend contract change.

Do not make tests call real AWS services.

## Documentation

Update docs in the same change when behavior changes:

- API contract changes: `docs/API_CONTRACTS.md` and `schemas/`.
- HTTP route changes: `docs/openapi.yaml`.
- Infra/deploy changes: `docs/ARCHITECTURE.md` and `docs/DEPLOYMENT.md`.
- Tooling/workflow changes: `docs/AGENT_DEVELOPMENT_TOOLING.md` and this file.
- Final development workflow changes: `docs/DEVELOPMENT_WORKFLOW.md`.

## Adding A Feature

1. Define or update the API contract, OpenAPI path, and schema first.
2. Add or update fixtures.
3. Implement pure logic in a service/runtime module.
4. Add repository methods for persistence.
5. Wire the route in the handler/router.
6. Grant the minimum IAM permissions in CDK.
7. Add unit and handler integration tests.
8. Run the relevant checks and update docs.

## Git And PRs

Use Conventional Commits, for example:

- `feat: add metrics snapshots table`
- `fix: reject draft public runtime flows`
- `test: add handler integration tests`
- `chore: configure backend ci`
