# Backend Architecture

## Goals

The backend is designed for AWS-first operation, low idle cost, and compatibility with the current `collectool-admin` API contract.

## AWS Resources

- `AWS::ApiGatewayV2::Api`: HTTP API. Cheaper and simpler than REST API for this contract.
- `AWS::ApiGatewayV2::Authorizer`: JWT authorizer backed by the admin Cognito user pool.
- `AWS::Cognito::UserPool`: admin user pool for backoffice users.
- `AWS::Cognito::UserPoolClient`: admin SPA/API auth client with `USER_PASSWORD_AUTH` and SRP enabled.
- `AWS::Cognito::UserPoolGroup`: `admin` and `collectool-admins` groups.
- `AWS::Cognito::UserPool`: app user pool for main Collectool users.
- `AWS::Cognito::UserPoolClient`: app SPA/API auth client.
- `AWS::Lambda::Function`: single Node.js 24 ARM64 handler for admin and public runtime routes.
- `AWS::DynamoDB::Table`: three on-demand tables:
  - `collectool-{env}-collection-categories`
  - `collectool-{env}-collection-entities`
  - `collectool-{env}-collection-flows`
- `AWS::S3::Bucket`: private bucket for the `collectool-admin` static export.
- `AWS::CloudFront::Distribution`: HTTPS CDN in front of the private admin bucket.
- `AWS::IAM::Role`: GitHub OIDC role for `collectool-admin` deploys.

## Data Model

Categories table:

```text
PK id
```

Entities table:

```text
PK id
```

Flows table:

```text
PK category_id
SK flow_key
```

Known flow keys:

- `FLOW#DRAFT`
- `FLOW#PUBLISHED#v{version}`

## Authentication

All `/admin/*` routes use API Gateway JWT validation against the Cognito resources created in this stack:

- issuer: `https://cognito-idp.{region}.amazonaws.com/{ADMIN_USER_POOL_ID}`
- audience: `{ADMIN_USER_POOL_CLIENT_ID}`

The Lambda then checks Cognito groups from `cognito:groups`. Default accepted groups:

```text
admin,collectool-admins
```

Public runtime routes under `/collection-builder/*` do not require admin auth and only expose active categories with published flows.

## Cognito Ownership

`collectool-backend` owns Cognito. The frontend should consume the CloudFormation outputs rather than hardcoding pool ids:

- `AdminUserPoolId`
- `AdminUserPoolClientId`
- `AppUserPoolId`
- `AppUserPoolClientId`

## Admin Frontend Hosting

`collectool-backend` also owns the admin static hosting infrastructure:

- S3 is private, encrypted with S3-managed encryption, and blocks public access.
- CloudFront uses Origin Access Control and redirects viewers to HTTPS.
- CloudFront maps `403` and `404` to `index.html` so the static Next.js admin can handle client-side navigation.
- The admin deploy role trusts `repo:castor-systems/collectool-admin:environment:{development|production}` through GitHub OIDC.
- The backend API CORS allowlist automatically includes the CloudFront admin URL for the same environment.

Relevant outputs:

- `AdminSiteBucketName`
- `AdminSiteDistributionId`
- `AdminSiteUrl`
- `AdminDeployRoleArn`

The stack does not create a permanent admin password. Create the first admin user after deployment and attach it to `collectool-admins` or `admin`.

## Cost Controls

- DynamoDB uses pay-per-request billing. This avoids provisioned capacity waste in dev and early prod.
- Lambda uses ARM64 and 256 MB memory.
- HTTP API is used instead of REST API.
- Metrics scan is capped by `METRICS_USER_SCAN_LIMIT` to avoid unbounded Cognito reads.
- Dev resources use `RemovalPolicy.DESTROY`; prod resources use `RemovalPolicy.RETAIN`.
- Prod DynamoDB tables enable point-in-time recovery.

## Seed Data

On first Lambda use, if the `kpop` category does not exist, the backend inserts:

- `kpop` category
- `group-bts` entity
- initial draft flow with one artist question

Set `-c seedInitialData=false` during deploy if automatic seed is not desired.

## Runtime Logic

`src/runtime.ts` is storage-independent and shared by admin preview and public runtime:

- evaluates conditional groups
- normalizes answers
- removes answers for invisible questions
- derives tags from selected options
- computes completion and next required question
- validates flow references before save/publish
