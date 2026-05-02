# Deployment

## Environments

The stack reads the environment from CDK context:

```bash
-c environment=dev
-c environment=prod
```

Recommended branch mapping:

- feature branches and develop workflows: `dev`
- `main`: `prod`

Resource names include the environment, for example `collectool-dev-api` and `collectool-prod-api`.

## Required Inputs

Provide these as CDK context or environment variables:

```bash
ALLOWED_ADMIN_GROUPS=admin,collectool-admins
CORS_ALLOWED_ORIGINS=http://localhost:3000,https://admin.example.com
SEED_INITIAL_DATA=true
```

Context has priority over environment variables:

```bash
npm run deploy:dev -- \
  -c allowedAdminGroups=admin,collectool-admins \
  -c corsAllowedOrigins=http://localhost:3000 \
  -c seedInitialData=true
```

The backend stack creates Cognito. Do not pass pool ids for normal deployments.

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
          node-version: 20
          cache: npm
          cache-dependency-path: collectool-backend/package-lock.json
      - run: npm ci
        working-directory: collectool-backend
      - run: npm test
        working-directory: collectool-backend
      - run: npm run deploy:dev -- --require-approval never
        working-directory: collectool-backend
        env:
          CORS_ALLOWED_ORIGINS: ${{ vars.DEV_CORS_ALLOWED_ORIGINS }}
          SEED_INITIAL_DATA: "true"
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
          node-version: 20
          cache: npm
          cache-dependency-path: collectool-backend/package-lock.json
      - run: npm ci
        working-directory: collectool-backend
      - run: npm test
        working-directory: collectool-backend
      - run: npm run deploy:prod -- --require-approval never
        working-directory: collectool-backend
        env:
          CORS_ALLOWED_ORIGINS: ${{ vars.PROD_CORS_ALLOWED_ORIGINS }}
          SEED_INITIAL_DATA: "false"
```

Use OIDC-based AWS credentials in CI instead of long-lived AWS keys.

## Admin Frontend Wiring

After deployment, copy the CloudFormation outputs into the admin app environment:

```bash
NEXT_PUBLIC_COLLECTOOL_API_URL=https://xxxx.execute-api.us-east-1.amazonaws.com
NEXT_PUBLIC_ADMIN_COGNITO_REGION=us-east-1
NEXT_PUBLIC_ADMIN_COGNITO_CLIENT_ID=<AdminUserPoolClientId>
NEXT_PUBLIC_ADMIN_AUTH_MODE=real
NEXT_PUBLIC_APP_ENV=development
```

The admin login still happens directly against the admin Cognito pool created by this stack. The backend validates that access token through API Gateway and checks admin groups in Lambda.

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
- Metrics are computed from Cognito on demand and capped. If the user base grows, add scheduled aggregate snapshots before increasing the cap.
- The public runtime never returns draft flows.
