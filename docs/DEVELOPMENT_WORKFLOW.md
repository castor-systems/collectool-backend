# Development Workflow

This document is the final operating guide for humans and agents working on `collectool-backend`.

## Project Ownership

`collectool-backend` owns the backend API and all AWS infrastructure for Collectool:

- API Gateway HTTP API.
- Lambda API handler.
- Cognito admin and app user pools.
- DynamoDB tables.
- CloudWatch logs and alarms.
- S3 and CloudFront for the admin frontend.
- GitHub OIDC role used by `collectool-admin` to publish static assets.
- GitHub Actions deployment workflow.

Infrastructure changes must originate here.

## Installed Tooling

- Node 24 and npm.
- AWS CDK v2.
- Jest for unit, CDK, contract, and handler integration tests.
- AWS SDK v3 and `aws-sdk-client-mock` for mocked handler tests.
- TypeScript strict typecheck for source files.
- ESLint flat config.
- Prettier.
- Redocly CLI for OpenAPI 3.1 validation.
- AJV for JSON Schema contract tests.
- `cdk-nag` for AWS Solutions security checks.
- `esbuild` through `aws-lambda-nodejs` for Lambda bundling.
- S3 + CloudFront static hosting for `collectool-admin`.
- Commitlint and Conventional Commits.
- Conventional changelog generation.
- GitHub Actions CI, deploy, security, changelog, CodeQL, and Dependabot workflows.

## Branch And Environment Model

- Feature branches target `dev`.
- `dev` deploys the shared development stack with `environment=dev`.
- `main` deploys production with `environment=prod`.
- GitHub Environments must be named exactly:
  - `development`
  - `production`

Shared `dev` and `prod` must use real managed data. Seed data is disabled in both:

```text
DEV_SEED_INITIAL_DATA=false
PROD_SEED_INITIAL_DATA=false
```

Use `SEED_INITIAL_DATA=true` only for local/manual sandbox testing.

## Local Setup

Use npm only:

```bash
npm ci
```

Use Node 24:

```bash
nvm use
```

Use `.env.example` as the non-secret deploy-time reference.

Build output is generated under `dist/` and must not be committed:

```bash
npm run build
```

## Daily Development Flow

1. Pull the latest target branch.
2. Create a feature branch.
3. Make a focused change.
4. Update docs/contracts for behavior changes.
5. Run validation:

```bash
npm run check
```

For narrow changes, use the smallest relevant subset, but report what was skipped:

```bash
npm run typecheck
npm run lint
npm run format:check
npm run openapi:lint
npm test
npm run security:iac
```

## API Contract Flow

When adding or changing an endpoint, update all relevant contract files in the same PR:

- `docs/openapi.yaml`
- `docs/API_CONTRACTS.md`
- `schemas/api-contracts.schema.json`
- `test/fixtures/*.json`
- handler or service integration tests

`collectool-backend` is the source of truth for shared API contracts. If `collectool-admin` must change, update the backend contract first and then sync the frontend fixtures/types/docs from it.

Validate OpenAPI:

```bash
npm run openapi:lint
npm run openapi:bundle
```

The bundle command writes to `/tmp/collectool-openapi.yaml` for local inspection or tooling.

## Testing Strategy

- Pure logic: test small functions in `src/runtime.ts` and future service modules.
- TypeScript source compiles to `dist/`; Jest imports compiled modules.
- Handler integration: call Lambda handler directly with API Gateway fixtures and mock AWS SDK clients.
- Contracts: validate JSON fixtures against JSON Schema with AJV.
- Infrastructure: assert synthesized CloudFormation through CDK assertions.
- Security: run `cdk-nag` through:

```bash
npm run security:iac
```

Do not make tests call real AWS services.

`cdk-nag` is part of `npm run check`; do not bypass it for PR-ready work. Suppressions must stay targeted and include a concrete reason in the CDK code.

## Infrastructure Change Flow

For any AWS resource, IAM, Cognito, API Gateway, Lambda, DynamoDB, logging, or alarm change:

1. Keep the change in CDK under `lib/`.
2. Prefer low-cost serverless defaults.
3. Keep IAM scoped to the resources required by the backend.
4. Run:

```bash
npm run check
npm run security:iac
npm run diff:dev -- -c corsAllowedOrigins=http://localhost:3000 -c seedInitialData=false
```

Before production, run:

```bash
npm run diff:prod -- -c corsAllowedOrigins=<prod-admin-origin> -c seedInitialData=false
```

## GitHub And AWS Deployment Setup

AWS OIDC roles already expected by the workflows:

- `arn:aws:iam::655497436708:role/collectool-backend-github-actions-development`
- `arn:aws:iam::655497436708:role/collectool-backend-github-actions-production`

Configure GitHub Environments with:

```bash
PROD_CORS_ALLOWED_ORIGINS=https://admin.collectool.example \
DEV_CORS_ALLOWED_ORIGINS=http://localhost:3000 \
npm run github:configure-envs
```

The script creates or updates:

- Environment `development`
- Environment `production`
- Secret `AWS_DEPLOY_ROLE_ARN`
- Variable `AWS_REGION`
- Variable `DEV_CORS_ALLOWED_ORIGINS`
- Variable `DEV_SEED_INITIAL_DATA=false`
- Variable `PROD_CORS_ALLOWED_ORIGINS`
- Variable `PROD_SEED_INITIAL_DATA=false`

`gh auth status` must be healthy before running the script.

## Deployment Flow

Development:

1. Open a PR into `dev`.
2. CI must pass.
3. Merge to `dev`.
4. `Deploy Backend Dev` runs with OIDC and deploys `environment=dev`.

Production:

1. Open a PR from `dev` into `main`.
2. CI, security, OpenAPI, and contract checks must pass.
3. Merge to `main`.
4. `Deploy Backend Prod` runs with OIDC and deploys `environment=prod`.
5. Production should require GitHub Environment approval.

Admin frontend:

1. Backend deploy creates or updates `AdminSiteBucketName`, `AdminSiteDistributionId`, `AdminSiteUrl`, and `AdminDeployRoleArn`.
2. Configure the matching `collectool-admin` GitHub Environment with `AWS_DEPLOY_ROLE_ARN=<AdminDeployRoleArn>` and `AWS_REGION=us-east-1`.
3. Push to `dev` or `main` in `collectool-admin`.
4. `Deploy Admin To S3` assumes the backend-created role, reads backend stack outputs, builds static Next output, syncs `out/` to S3, and invalidates CloudFront.

## Diagnostics

After a deploy, inspect stack outputs and health:

```bash
AWS_PROFILE=castor npm run outputs:dev
npm run health -- <ApiUrl>
```

For production:

```bash
AWS_PROFILE=castor npm run outputs:prod
npm run health -- <ApiUrl>
```

## First Admin User

After a fresh stack deploy, create the first admin user manually and attach it to `collectool-admins` or `admin`. See `docs/DEPLOYMENT.md`.

## PR Checklist

Every PR should answer:

- Did API behavior change?
- Did OpenAPI/schema/fixtures change?
- Did infrastructure change?
- Did IAM/Cognito/security posture change?
- Was `npm run check` executed?
- Was `npm run security:iac` executed for infrastructure changes?
- Does `collectool-admin` need matching environment or contract updates?

## Agent Rules

Agents should:

- Work only in `collectool-backend` unless explicitly asked otherwise.
- The only current exception is shared API contract alignment: backend remains canonical, and frontend docs/fixtures may be touched only when a backend contract decision requires it.
- The admin deploy workflow is another explicit exception: backend owns the AWS infra, while `collectool-admin` owns the static build workflow that publishes into those resources.
- Keep generated artifacts out of commits.
- Never deploy unless explicitly asked.
- Never enable seed data in shared dev/prod.
- Keep OpenAPI, JSON Schema, fixtures, and docs aligned.
- Prefer incremental refactors over large rewrites.
- Report skipped validations clearly.
