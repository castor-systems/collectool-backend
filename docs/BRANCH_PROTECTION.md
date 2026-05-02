# Branch Protection

Recommended GitHub repository settings for `collectool-backend`.

## `dev`

- Require pull requests before merging.
- Require status checks:
  - `Backend check`
  - `Conventional commits`
  - `Dependency audit`
  - `CDK Nag`
- Allow the `Deploy Backend Dev` workflow to run only from `dev` or manual dispatch.

## `main`

- Require pull requests before merging.
- Require at least one approval.
- Require status checks:
  - `Backend check`
  - `Conventional commits`
  - `Dependency audit`
  - `CDK Nag`
  - `CodeQL / Analyze JavaScript`
- Block force pushes and deletions.
- Require the `production` GitHub Environment with manual approval for `Deploy Backend Prod`.

## Secrets And Variables

Configure these GitHub values before enabling deploy workflows:

- Secret: `AWS_DEPLOY_ROLE_ARN`
- Variable: `AWS_REGION`
- Variable: `DEV_CORS_ALLOWED_ORIGINS`
- Variable: `DEV_SEED_INITIAL_DATA` (`false` for shared dev)
- Variable: `PROD_CORS_ALLOWED_ORIGINS`
- Variable: `PROD_SEED_INITIAL_DATA` (`false`)

Enable GitHub secret scanning/push protection from repository settings when the plan supports it. The repo also runs CodeQL and `npm audit` to catch dependency and JavaScript security issues.

You can configure the required GitHub Environments, secrets, and variables with:

```bash
PROD_CORS_ALLOWED_ORIGINS=https://admin.collectool.example \
DEV_CORS_ALLOWED_ORIGINS=http://localhost:3000 \
npm run github:configure-envs
```

`gh auth status` must be healthy before running the command.
