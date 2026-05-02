# Deployment

## Environments

The stack reads the environment from CDK context:

```bash
-c environment=dev
-c environment=prod
```

Recommended branch mapping:

- feature branches target `dev`
- `dev`: shared development stack
- `main`: `prod`

Resource names include the environment, for example `collectool-dev-api` and `collectool-prod-api`.

## Required Inputs

Provide these as CDK context or environment variables:

```bash
ALLOWED_ADMIN_GROUPS=admin,collectool-admins
CORS_ALLOWED_ORIGINS=http://localhost:3000,https://admin.example.com
ADMIN_GITHUB_REPOSITORY=castor-systems/collectool-admin
SEED_INITIAL_DATA=false
```

Use `SEED_INITIAL_DATA=true` only for local/manual sandbox tests. Shared `dev` and `prod` deployments should keep it as `false` so those environments use real managed data.

Context has priority over environment variables:

```bash
npm run deploy:dev -- \
  -c allowedAdminGroups=admin,collectool-admins \
  -c corsAllowedOrigins=http://localhost:3000 \
  -c seedInitialData=false
```

The backend stack creates Cognito. Do not pass pool ids for normal deployments.

The CDK app is TypeScript. Use the npm scripts instead of invoking `node bin/...` directly; `cdk.json` runs `npm run build` before the app starts.

The backend stack also creates the admin frontend hosting resources:

- private S3 bucket
- CloudFront distribution
- GitHub OIDC role for `collectool-admin` deploys

The CloudFront admin URL is automatically added to API Gateway CORS for the same environment.

## CI/CD Example

Development deployment:

```yaml
name: deploy-backend-dev
on:
  push:
    branches-ignore:
      - main
jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version-file: .nvmrc
          cache: npm
          cache-dependency-path: collectool-backend/package-lock.json
      - run: npm ci
        working-directory: collectool-backend
      - run: npm run check
        working-directory: collectool-backend
      - run: npm run deploy:dev -- --require-approval never
        working-directory: collectool-backend
        env:
          CORS_ALLOWED_ORIGINS: ${{ vars.DEV_CORS_ALLOWED_ORIGINS }}
          SEED_INITIAL_DATA: 'false'
```

Production deployment:

```yaml
name: deploy-backend-prod
on:
  push:
    branches:
      - main
jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version-file: .nvmrc
          cache: npm
          cache-dependency-path: collectool-backend/package-lock.json
      - run: npm ci
        working-directory: collectool-backend
      - run: npm run check
        working-directory: collectool-backend
      - run: npm run deploy:prod -- --require-approval never
        working-directory: collectool-backend
        env:
          CORS_ALLOWED_ORIGINS: ${{ vars.PROD_CORS_ALLOWED_ORIGINS }}
          SEED_INITIAL_DATA: 'false'
```

Use OIDC-based AWS credentials in CI instead of long-lived AWS keys.

## Admin Frontend Wiring

For local development, copy the CloudFormation outputs into the admin app environment:

```bash
NEXT_PUBLIC_COLLECTOOL_API_URL=https://xxxx.execute-api.us-east-1.amazonaws.com
NEXT_PUBLIC_ADMIN_COGNITO_REGION=us-east-1
NEXT_PUBLIC_ADMIN_COGNITO_CLIENT_ID=<AdminUserPoolClientId>
NEXT_PUBLIC_ADMIN_AUTH_MODE=real
NEXT_PUBLIC_APP_ENV=development
```

The admin login still happens directly against the admin Cognito pool created by this stack. The backend validates that access token through API Gateway and checks admin groups in Lambda.

For GitHub Actions deploys, configure the `collectool-admin` repository environments:

`development` secret:

```text
AWS_DEPLOY_ROLE_ARN=<dev AdminDeployRoleArn output>
```

`development` variable:

```text
AWS_REGION=us-east-1
```

`production` secret:

```text
AWS_DEPLOY_ROLE_ARN=<prod AdminDeployRoleArn output>
```

`production` variable:

```text
AWS_REGION=us-east-1
```

The admin workflow reads `ApiUrl`, `AdminUserPoolClientId`, `AdminSiteBucketName`, and `AdminSiteDistributionId` from this backend stack at deploy time, then runs `next build`, syncs `out/` to S3, and invalidates CloudFront.

## First Admin User

The stack creates pools, clients, and groups, but it does not store a human password in CloudFormation. Create the first admin user after deploy:

```bash
aws cognito-idp admin-create-user \
  --user-pool-id <AdminUserPoolId> \
  --username admin@example.com \
  --user-attributes Name=email,Value=admin@example.com Name=email_verified,Value=true Name=name,Value="Admin User"
```

Add that user to an admin group:

```bash
aws cognito-idp admin-add-user-to-group \
  --user-pool-id <AdminUserPoolId> \
  --username admin@example.com \
  --group-name collectool-admins
```

Set a permanent password for local/dev testing if you do not want the temporary-password flow:

```bash
aws cognito-idp admin-set-user-password \
  --user-pool-id <AdminUserPoolId> \
  --username admin@example.com \
  --password 'Use-A-Strong-Password-Here1!' \
  --permanent
```

## Operational Notes

- Prod DynamoDB tables are retained on stack deletion.
- Dev DynamoDB tables are destroyed with the stack.
- Prod DynamoDB tables enable point-in-time recovery; dev keeps it disabled to reduce shared environment cost.
- The admin S3 bucket is retained in prod and destroyable in dev. Empty non-prod buckets before deleting a stack if CloudFormation cannot remove non-empty buckets.
- `npm run security:iac` is mandatory in `npm run check` and CI. Current `cdk-nag` suppressions are intentional and documented in CDK with reasons.
- Metrics are computed from Cognito on demand and capped. If the user base grows, add scheduled aggregate snapshots before increasing the cap.
- The public runtime never returns draft flows.

Useful diagnostics:

```bash
AWS_PROFILE=castor npm run outputs:dev
npm run health -- https://xxxx.execute-api.us-east-1.amazonaws.com
```
