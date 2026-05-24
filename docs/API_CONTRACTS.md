# API Contracts

All admin errors return:

```json
{ "message": "Error details" }
```

Unexpected `5xx` errors also include a `requestId` that matches Lambda structured logs:

```json
{ "message": "Unexpected server error", "requestId": "..." }
```

All `/admin/*` endpoints require:

```text
Authorization: Bearer <cognito_access_token>
```

The token must come from the admin Cognito user pool created by the backend stack.

The executable OpenAPI contract lives in [`docs/openapi.yaml`](openapi.yaml) and is validated by:

```bash
npm run openapi:lint
```

This backend repository is the source of truth for shared API contracts. When `collectool-admin` needs contract updates, change the backend OpenAPI/schema/fixtures first and then sync the frontend expectations to this source.

## Admin Session

```http
GET /admin/session
```

Returns:

```json
{
  "user": {
    "email": "admin@example.com",
    "name": "Admin User",
    "groups": []
  }
}
```

## Users

```http
GET /admin/users?limit=25&paginationToken=...&search=...&status=active&verified=true
GET /admin/metrics/users
POST /admin/users/:username/enable
POST /admin/users/:username/disable
POST /admin/users/:username/unlock
POST /admin/users/:username/ban
POST /admin/users/:username/unban
```

User list and metrics are sourced from `APP_USER_POOL_ID`.

## Collection Builder Admin

```http
GET /admin/collection-builder/bootstrap
GET /admin/collection-builder/categories
POST /admin/collection-builder/categories
PUT /admin/collection-builder/categories/:id
POST /admin/collection-builder/categories/:id/archive
GET /admin/collection-builder/entities?type=GROUP
POST /admin/collection-builder/entities
PUT /admin/collection-builder/entities/:id
GET /admin/collection-builder/categories/:categoryId/flow
PUT /admin/collection-builder/categories/:categoryId/flow
POST /admin/collection-builder/categories/:categoryId/preview
POST /admin/collection-builder/categories/:categoryId/publish
```

Collection Builder timestamps use Unix seconds for `created_at`, `updated_at`, and `published_at`.

## Public Runtime

These endpoints expose published data only:

```http
GET /collection-builder/categories
GET /collection-builder/categories/:categoryId/flow
POST /collection-builder/categories/:categoryId/runtime
```

Only categories with `status: "ACTIVE"` and a published flow are visible through public runtime endpoints.

## Contract Notes

- Executable backend/admin schemas live in `schemas/api-contracts.schema.json`.
- OpenAPI 3.1 documentation lives in `docs/openapi.yaml` and references the JSON schemas where practical.
- Backend fixtures live in `test/fixtures/*.json` and are validated by `test/contracts.test.js`.
- The fixtures were aligned against `collectool-admin/test/fixtures` at the time this tooling pass was implemented.
- Category status: `ACTIVE`, `DRAFT`, `COMING_SOON`, `ARCHIVED`.
- Flow status: `DRAFT`, `PUBLISHED`, `ARCHIVED`.
- Entity status is stored as sent by admin, with standard values `ACTIVE`, `DRAFT`, `ARCHIVED`.
- The publish endpoint keeps the draft and creates immutable published versions as `FLOW#PUBLISHED#v{version}`.
- The runtime treats `"All/Todos"` as a future product decision; no special sentinel is generated automatically yet.
