#!/usr/bin/env bash
set -euo pipefail

REPO="${GITHUB_REPOSITORY:-castor-systems/collectool-backend}"
AWS_ACCOUNT_ID="${AWS_ACCOUNT_ID:-655497436708}"
AWS_REGION="${AWS_REGION:-us-east-1}"
DEV_CORS_ALLOWED_ORIGINS="${DEV_CORS_ALLOWED_ORIGINS:-http://localhost:3000}"
PROD_CORS_ALLOWED_ORIGINS="${PROD_CORS_ALLOWED_ORIGINS:-}"

DEV_ROLE_ARN="arn:aws:iam::${AWS_ACCOUNT_ID}:role/collectool-backend-github-actions-development"
PROD_ROLE_ARN="arn:aws:iam::${AWS_ACCOUNT_ID}:role/collectool-backend-github-actions-production"

if [[ -z "${PROD_CORS_ALLOWED_ORIGINS}" ]]; then
  echo "Missing PROD_CORS_ALLOWED_ORIGINS." >&2
  echo "Example: PROD_CORS_ALLOWED_ORIGINS=https://admin.collectool.example npm run github:configure-envs" >&2
  exit 1
fi

gh auth status >/dev/null

echo "Configuring GitHub environments for ${REPO}"
gh api --method PUT "repos/${REPO}/environments/development" >/dev/null
gh api --method PUT "repos/${REPO}/environments/production" >/dev/null

echo "Configuring development secrets and variables"
gh secret set AWS_DEPLOY_ROLE_ARN --repo "${REPO}" --env development --body "${DEV_ROLE_ARN}"
gh variable set AWS_REGION --repo "${REPO}" --env development --body "${AWS_REGION}"
gh variable set DEV_CORS_ALLOWED_ORIGINS --repo "${REPO}" --env development --body "${DEV_CORS_ALLOWED_ORIGINS}"
gh variable set DEV_SEED_INITIAL_DATA --repo "${REPO}" --env development --body "false"

echo "Configuring production secrets and variables"
gh secret set AWS_DEPLOY_ROLE_ARN --repo "${REPO}" --env production --body "${PROD_ROLE_ARN}"
gh variable set AWS_REGION --repo "${REPO}" --env production --body "${AWS_REGION}"
gh variable set PROD_CORS_ALLOWED_ORIGINS --repo "${REPO}" --env production --body "${PROD_CORS_ALLOWED_ORIGINS}"
gh variable set PROD_SEED_INITIAL_DATA --repo "${REPO}" --env production --body "false"

cat <<EOF
Done.

Development:
  AWS_DEPLOY_ROLE_ARN=${DEV_ROLE_ARN}
  AWS_REGION=${AWS_REGION}
  DEV_CORS_ALLOWED_ORIGINS=${DEV_CORS_ALLOWED_ORIGINS}
  DEV_SEED_INITIAL_DATA=false

Production:
  AWS_DEPLOY_ROLE_ARN=${PROD_ROLE_ARN}
  AWS_REGION=${AWS_REGION}
  PROD_CORS_ALLOWED_ORIGINS=${PROD_CORS_ALLOWED_ORIGINS}
  PROD_SEED_INITIAL_DATA=false
EOF

