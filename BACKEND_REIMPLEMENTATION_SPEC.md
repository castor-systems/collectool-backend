# Backend Reimplementation Spec

This document is a handoff for an agent/developer rebuilding the missing Collectool backend/admin API from the current `collectool-admin` frontend. It captures all backend behavior that the admin UI expects today, plus inferred behavior needed by the main Collectool app.

The original backend code is not available. Treat this document as a practical reconstruction spec based on:

- `lib/admin-api.ts`
- `contexts/auth-context.tsx`
- Admin UI components under `app/` and `components/collection-builder/`
- API fixtures under `test/fixtures/`
- Existing technical docs under `docs/`

## How To Use This Document

Give this file to the backend agent as the implementation brief.

Implementation rules for the backend agent:

- Treat endpoint paths, request bodies, response shapes, auth behavior, and error shape documented here as the current frontend contract.
- Treat sections marked as `Recommended`, `Pending`, or `inferred` as product/technical guidance, not as proof that the original backend already had that behavior.
- Keep IDs, tags, condition values, and entity references stable and language-independent.
- Do not expose draft Collection Builder data to the main app runtime.
- Return JSON errors as `{ "message": "..." }` so the current admin can render useful failures.
- Update `docs/API_CONTRACTS.md` in this repo if the backend implementation intentionally changes any contract.

## Contract Confidence Levels

This spec uses three confidence levels:

- **Required by current admin**: directly used by `lib/admin-api.ts`, auth context, pages, components, tests, or fixtures.
- **Required soon / product requirement**: described by the product context or visible in the UI, but not fully wired to API calls yet.
- **Recommended implementation**: backend design advice to recover safely, especially where the lost implementation details are unknown.

When in doubt, implement the "Required by current admin" behavior first, then add recommended behavior behind compatible contracts.

## 1. Backend Role

The backend must support the Collectool admin backoffice. The admin is used to:

- Validate admin sessions after Cognito login.
- Read user metrics from the app user pool.
- Read paginated app users.
- Manage Collection Builder categories.
- Manage reusable collection entities.
- Save draft question flows.
- Preview a question flow runtime.
- Publish a category flow so the main app can consume it.

The first product domain is K-pop collections: groups, soloists, subunits, members, eras, albums, photocards, merch types, and collection options.

## 2. Authentication And Authorization

### 2.1 Admin Login Flow

The frontend performs Cognito login directly against AWS Cognito:

```text
POST https://cognito-idp.{region}.amazonaws.com/
X-Amz-Target: AWSCognitoIdentityProviderService.InitiateAuth
AuthFlow: USER_PASSWORD_AUTH
```

The backend is not responsible for collecting admin passwords. It is responsible for validating the returned Cognito access token.

### 2.2 Required Admin Session Endpoint

```http
GET /admin/session
Authorization: Bearer <cognito_access_token>
```

Expected response:

```ts
{
  user: {
    email: string
    name: string
    groups: string[]
  }
}
```

Required behavior:

- Validate the Cognito JWT signature, issuer, expiration, token use, and audience/client as appropriate.
- Confirm that the user is an admin.
- Recommended admin check: require Cognito group `admin` or `collectool-admins`. The current UI only expects `groups: string[]`.
- Return `401` for missing/invalid/expired token.
- Return `403` for valid token without admin privileges.

### 2.3 Auth For All Admin Endpoints

All `/admin/*` endpoints must require:

```text
Authorization: Bearer <accessToken>
```

Common error shape expected by frontend:

```ts
{
  message: string
}
```

If an error response has no `message`, the frontend shows a generic fallback.

## 3. Conventions

### 3.1 Base URL

Frontend reads backend base URL from:

```text
NEXT_PUBLIC_COLLECTOOL_API_URL
```

The admin client calls:

```ts
fetch(`${apiUrl.replace(/\/$/, "")}${path}`)
```

### 3.2 Date/Timestamp Formats

Current API expects two date styles:

- User/Cognito dates: ISO strings.
- Collection Builder timestamps: Unix seconds.

Examples:

```ts
createdAt: "2026-05-01T12:00:00.000Z"
updated_at: 1777636800
```

Important: current fixtures accidentally use millisecond-like values for Collection Builder. The UI multiplies some flow history timestamps by `1000`, so backend should use Unix seconds for `created_at`, `updated_at`, and `published_at`.

### 3.3 Status Casing

Backend Collection Builder status values are uppercase snake case:

```ts
;"ACTIVE" | "DRAFT" | "COMING_SOON" | "ARCHIVED"
```

Frontend maps them to lowercase kebab case for display.

Entity statuses are sent uppercase from UI:

```ts
;"ACTIVE" | "DRAFT" | "ARCHIVED" | string
```

User statuses are lowercase:

```ts
"active" | "inactive"
```

## 4. User Metrics

### 4.1 Endpoint

```http
GET /admin/metrics/users
```

Expected response:

```ts
interface UserMetricsResponse {
  kpis: {
    newUsersLastHour: number
    newUsersLast24Hours: number
    newUsersLast7Days: number
    totalRegistered: number
  }
  statusSummary: Array<{ label: string; value: number }>
  verificationSummary: Array<{ label: string; value: number }>
  recentSignups: Array<{
    username: string
    name: string
    email: string
    createdAt: string
  }>
  recentlyUpdatedUsers: Array<{
    username: string
    name: string
    email: string
    status: string
    lastUpdatedAt: string
  }>
  hourlyChart: Array<{
    hour: string
    timestamp: string
    users: number
  }>
  dailyChart: Array<{
    day: string
    date: string
    users: number
  }>
  generatedAt: string
}
```

### 4.2 Required Behavior

The dashboard expects:

- KPIs for new users in last hour, 24 hours, 7 days, and total registered users.
- Hourly chart for last 24 hours.
- Daily chart for last 7 days.
- Recent signup list.
- Recently updated users list.
- Summaries grouped by status and verification.

Recommended implementation:

- Source of truth can be Cognito list users plus cached snapshots.
- For cost and speed, maintain hourly aggregate snapshots rather than scanning Cognito on every dashboard request.
- `generatedAt` should be ISO string for the data generation time.

### 4.3 Frontend Display Notes

The dashboard has UI-only tabs for `Users`, `Collections`, `Sales`, `Costs`, and `Revenue`. Only user metrics are currently backed by API.

## 5. Users Management

### 5.1 Endpoint

```http
GET /admin/users
```

Query params:

```ts
{
  limit?: number
  paginationToken?: string
  search?: string
  status?: "active" | "inactive"
  verified?: "true" | "false"
}
```

Expected response:

```ts
interface UsersResponse {
  users: AdminUser[]
  nextToken?: string
}

interface AdminUser {
  id: string
  username: string
  name: string
  email: string
  verified: boolean
  status: "active" | "inactive"
  enabled: boolean
  cognitoStatus: string
  createdAt: string
  lastUpdatedAt: string
}
```

### 5.2 Required Behavior

- Return users from the main app Cognito user pool, not the admin-only user pool unless they are the same by design.
- Support token-based pagination with `nextToken`.
- `limit` defaults should be backend-defined; UI sends `25`.
- `search` should match username, email, or name.
- `status=active` should generally mean enabled and usable.
- `status=inactive` should generally mean disabled or otherwise unusable.
- `verified=true|false` filters email/account verification.

### 5.3 Pending User Actions

The admin UI currently does not call these endpoints, but product requirements mention user unlock/moderation. Backend should plan for:

```http
POST /admin/users/:username/unlock
POST /admin/users/:username/disable
POST /admin/users/:username/enable
POST /admin/users/:username/ban
POST /admin/users/:username/unban
```

Recommended response:

```ts
{
  user: AdminUser
}
```

These are pending and should not be considered required by the current frontend until UI is implemented.

## 6. Collection Builder Data Model

### 6.1 Category

```ts
interface CollectionBuilderCategory {
  id: string
  name: string
  description: string
  status: "ACTIVE" | "DRAFT" | "COMING_SOON" | "ARCHIVED"
  current_version_id: string
  progress_mode: "FULL" | "WISHLIST" | "NONE"
  published_version: number | null
  draft_version: number | null
  updated_at: number
  created_at: number
}
```

Meaning:

- `id`: stable slug, e.g. `kpop`.
- `current_version_id`: backend-defined ID for current flow/category version.
- `progress_mode`:
  - `FULL`: show completion progress.
  - `WISHLIST`: show wishlist progress.
  - `NONE`: hide progress.
- `published_version`: latest version visible to the main app.
- `draft_version`: latest editable draft version.

### 6.2 Entity

```ts
interface CollectionBuilderEntity {
  id: string
  type: string
  name: string
  status: string
  parents: string[]
  tags: string[]
  description: string
  updated_at: number
  created_at: number
}
```

Known K-pop entity types:

- `GROUP`
- `SOLOIST`
- `SUBUNIT`
- `MEMBER`
- `MERCH_TYPE`
- `ALBUM`
- `ERA`
- `COLLECTION_OPTION`

Frontend sends type values uppercase with underscores, derived from UI IDs like `merch-type`.

Relationships:

- `parents` is an array of parent entity IDs.
- Children are derived client-side by scanning entities where `parents.includes(entity.id)`.
- This supports members under groups, albums under groups/eras, subunits under groups, and shared members.

### 6.3 Question Option

```ts
interface CollectionBuilderQuestionOption {
  id: string
  label: string
  value: string
  entity_id?: string | null
  tags: string[]
}
```

Meaning:

- `value` is the stable answer value used by conditions and runtime answers.
- `label` is display text.
- `entity_id` optionally links an answer to a Collection Builder entity.
- `tags` are final filters emitted when this option is selected.

### 6.4 Question

```ts
interface CollectionBuilderQuestion {
  id: string
  type: "SINGLE_SELECT" | "MULTI_SELECT" | "TOGGLE"
  label: string
  helper_text: string
  required: boolean
  allow_all: boolean
  options: CollectionBuilderQuestionOption[]
}
```

Question behavior:

- `SINGLE_SELECT`: one option value.
- `MULTI_SELECT`: multiple option values.
- `TOGGLE`: yes/no style question. Current UI still represents options explicitly.
- `allow_all`: UI expects an "All/Todos" behavior, but backend runtime must define exact semantics.

### 6.5 Question Group

```ts
interface CollectionBuilderQuestionGroup {
  id: string
  label: string
  questions: string[]
}
```

Groups are used as conditional branches. A condition action can show a group.

### 6.6 Condition Rule

```ts
interface CollectionBuilderConditionRule {
  id: string
  condition: {
    question_id: string
    operator: "INCLUDES" | "EQUALS" | "NOT_INCLUDES" | "IS_SET"
    value: string[]
  }
  actions: Array<{
    type: "SHOW_QUESTION_GROUP"
    target: string
  }>
}
```

Condition semantics:

- `EQUALS`: selected answer equals one of `value`.
- `INCLUDES`: selected answer array/string includes one of `value`.
- `NOT_INCLUDES`: selected answer does not include values.
- `IS_SET`: any answer exists for `question_id`; `value` may be ignored.
- Current frontend only creates `SHOW_QUESTION_GROUP` actions.

### 6.7 Flow

```ts
interface CollectionBuilderFlow {
  id: string
  category_id: string
  version: number
  status: string
  root_question_ids: string[]
  question_groups: Record<string, CollectionBuilderQuestionGroup>
  conditions: CollectionBuilderConditionRule[]
  questions: CollectionBuilderQuestion[]
  notes: string
  published_at?: number
  updated_at?: number
  created_at?: number
}
```

Expected statuses:

- `DRAFT`
- `PUBLISHED`
- `ARCHIVED`

## 7. Collection Builder Endpoints

### 7.1 Bootstrap

```http
GET /admin/collection-builder/bootstrap
```

Expected response:

```ts
{
  categories: CollectionBuilderCategory[]
  entities: CollectionBuilderEntity[]
  flows: Record<string, CollectionBuilderFlowSummary>
}
```

Current frontend wrapper exists, but current inspected UI does not render it directly. Implementing it is still useful for future lower-latency startup.

### 7.2 Categories

#### List

```http
GET /admin/collection-builder/categories
```

Response:

```ts
{
  categories: CollectionBuilderCategory[]
}
```

#### Create

```http
POST /admin/collection-builder/categories
Content-Type: application/json
```

Request:

```ts
{
  id: string
  name: string
  description: string
  status: string
  progress_mode: string
}
```

Response:

```ts
{
  category: CollectionBuilderCategory
}
```

Required behavior:

- Validate unique `id`.
- Normalize/validate `status`.
- Normalize/validate `progress_mode`.
- Create an initial draft category.
- Consider creating an empty draft flow automatically, or allow `GET flow` to return `{ draft: null, published: null, history: [] }`.

#### Update

```http
PUT /admin/collection-builder/categories/:id
```

Request:

```ts
Partial<CollectionBuilderCategory>
```

Response:

```ts
{
  category: CollectionBuilderCategory
}
```

Required behavior:

- Update category metadata.
- Do not accidentally reset draft/published versions unless explicitly requested.
- Return `404` if category does not exist.

#### Archive/Delete

Current UI shows archive in dropdown but does not call a backend endpoint. Recommended future endpoint:

```http
POST /admin/collection-builder/categories/:id/archive
```

### 7.3 Entities

#### List

```http
GET /admin/collection-builder/entities?type=GROUP
```

Response:

```ts
{
  entities: CollectionBuilderEntity[]
}
```

Required behavior:

- Optional `type` filter.
- Return all entities when `type` is missing.

#### Create

```http
POST /admin/collection-builder/entities
```

Request:

```ts
{
  id: string
  type: string
  name: string
  status: string
  parents: string[]
  tags: string[]
  description: string
}
```

Response:

```ts
{
  entity: CollectionBuilderEntity
}
```

Required behavior:

- Validate unique `id`.
- Validate parent IDs if possible.
- Allow multiple parents.
- Persist tags as stable strings.

#### Update

```http
PUT /admin/collection-builder/entities/:id
```

Request:

```ts
Partial<CollectionBuilderEntity>
```

Response:

```ts
{
  entity: CollectionBuilderEntity
}
```

## 8. Question Flow Endpoints

### 8.1 Get Flow Summary

```http
GET /admin/collection-builder/categories/:categoryId/flow
```

Response:

```ts
interface CollectionBuilderFlowSummary {
  draft: CollectionBuilderFlow | null
  published: CollectionBuilderFlow | null
  history: CollectionBuilderFlowHistoryEntry[]
}
```

History entry:

```ts
interface CollectionBuilderFlowHistoryEntry {
  id: string
  version: number
  status: string
  notes: string
  published_at?: number
  updated_at?: number
  created_at?: number
}
```

Required behavior:

- Return current draft if one exists.
- Return latest published if one exists.
- Return historical versions in useful order, recommended newest first.
- If no flow exists, return nulls and empty history rather than 404, as long as category exists.
- Return `404` if category does not exist.

### 8.2 Save Draft Flow

```http
PUT /admin/collection-builder/categories/:categoryId/flow
```

Request:

```ts
Partial<CollectionBuilderFlow>
```

Response:

```ts
{
  flow: CollectionBuilderFlow
}
```

Required behavior:

- Save/update the draft flow for the category.
- Keep `status` as `DRAFT`.
- If request has no `id`, generate one.
- If request has no `version`, start or keep draft version.
- Update `draft_version` on category.
- Do not overwrite the published flow.
- Validate references:
  - `root_question_ids` must exist in `questions`.
  - `question_groups.*.questions` must exist in `questions`.
  - `conditions.*.condition.question_id` must exist.
  - `conditions.*.actions[*].target` must exist in `question_groups`.
  - option `entity_id`, if present, should refer to an entity.

### 8.3 Preview Runtime

```http
POST /admin/collection-builder/categories/:categoryId/preview
```

Request:

```ts
{
  answers: Record<string, string | string[]>
  use_draft?: boolean
}
```

Response:

```ts
interface CollectionBuilderRuntimeResponse {
  flow: CollectionBuilderFlow
  visible_questions: CollectionBuilderQuestion[]
  next_question: CollectionBuilderQuestion | null
  answers: Record<string, string | string[]>
  tags: string[]
  is_complete: boolean
}
```

Required behavior:

- Use draft flow when `use_draft: true`; otherwise use published flow.
- Compute visible questions from:
  - root questions
  - conditionally shown question groups
- Normalize answers:
  - Remove answers for questions that are no longer visible.
  - Preserve valid answers.
  - For `SINGLE_SELECT`, value should be a string.
  - For `MULTI_SELECT`, value should be a string array.
- Compute tags from selected option tags across visible answered questions.
- Set `next_question` to the next unanswered required visible question, or next visible question after current progression if backend tracks progression. Current frontend can work with `null`.
- Set `is_complete` true when all required visible questions have valid answers.

### 8.4 Publish Flow

```http
POST /admin/collection-builder/categories/:categoryId/publish
```

Request:

```ts
{
  notes?: string
  category_status?: string
}
```

Response:

```ts
{
  flow: CollectionBuilderFlow
  category: CollectionBuilderCategory
}
```

Required behavior:

- Require an existing draft flow.
- Validate draft before publishing.
- Create an immutable published version.
- Increment published version.
- Preserve history.
- Set `published_at`.
- Update category:
  - `published_version`
  - `current_version_id`
  - `status`, if `category_status` is provided
- Keep or create a future draft depending on product decision. Current UI can reload from either draft or published.
- Return `400` if draft is invalid.
- Return `404` if category does not exist.

## 9. Runtime Logic Details

### 9.1 Visible Question Algorithm

Recommended algorithm:

1. Start with `root_question_ids`.
2. Add each root question to visible list in order.
3. Evaluate all conditions against current answers.
4. For each satisfied condition, add questions from target group.
5. Repeat until no new question group is added.
6. Preserve deterministic ordering:
   - root question order first.
   - then groups in condition order.
   - then questions in each group order.
7. Avoid duplicates.

### 9.2 Condition Evaluation

Pseudocode:

```ts
function isConditionMet(condition, answers) {
  const answer = answers[condition.question_id]
  const values = condition.value

  if (condition.operator === "IS_SET") {
    return answer !== undefined && answer !== null && answer !== ""
  }

  const answerValues = Array.isArray(answer) ? answer : [answer]

  if (condition.operator === "EQUALS") {
    return answerValues.some((value) => values.includes(value))
  }

  if (condition.operator === "INCLUDES") {
    return answerValues.some((value) => values.includes(value))
  }

  if (condition.operator === "NOT_INCLUDES") {
    return !answerValues.some((value) => values.includes(value))
  }

  return false
}
```

### 9.3 Tags

Tags are generated from selected options:

- Find each visible answered question.
- Find selected option(s).
- Merge their `tags`.
- Deduplicate while preserving first occurrence.

Example:

```ts
answers = { artist: "bts" }
option = { value: "bts", tags: ["artist:bts"] }
tags = ["artist:bts"]
```

### 9.4 "All/Todos" Behavior

Current data model has `allow_all: boolean`, but does not define a dedicated option shape.

Recommended backend behavior:

- If `allow_all` is true, frontend/main app may display an "All" option.
- Store the selected value as `"ALL"` or `"__ALL__"` only if both frontend and backend agree.
- Runtime should treat "All" as a wildcard for that question and avoid generating overly broad tags unless explicitly configured.
- Because current admin UI does not yet persist localized all labels, keep the logic language-independent.

Mark this as a product decision before main app runtime depends on it.

## 10. Internationalization Requirements

Current backend-integrated model only supports plain strings:

```ts
label: string
helper_text: string
option.label: string
```

Prototype UI references supported languages:

```text
en, es, ko, pt, ja
```

Future recommended model:

```ts
localized?: {
  en?: { label?: string; helper_text?: string; all_option_label?: string }
  es?: { label?: string; helper_text?: string; all_option_label?: string }
  ko?: { label?: string; helper_text?: string; all_option_label?: string }
  pt?: { label?: string; helper_text?: string; all_option_label?: string }
  ja?: { label?: string; helper_text?: string; all_option_label?: string }
}
```

Do not localize:

- IDs
- option values
- entity IDs
- tags
- condition operators
- condition values
- flow/category IDs

Fallback recommendation:

1. Requested locale.
2. English.
3. Base non-localized string.
4. Empty string or backend validation error for required publish text.

I18N persistence is not required by current backend-integrated admin screens, but it is important for future Collection Builder work.

## 11. Data Storage Recommendations

The original backend may have used AWS. Reimplementation can use DynamoDB, Postgres, or another durable store. A DynamoDB-style layout is likely simple:

### 11.1 Categories Table

Primary key:

```text
PK: CATEGORY#{categoryId}
SK: METADATA
```

Stores `CollectionBuilderCategory`.

### 11.2 Entities Table

Primary key:

```text
PK: ENTITY#{entityId}
SK: METADATA
```

Indexes:

- `type`
- `status`
- maybe parent lookup if needed.

### 11.3 Flows Table

Primary key:

```text
PK: CATEGORY#{categoryId}
SK: FLOW#DRAFT
SK: FLOW#PUBLISHED#v{version}
```

This allows:

- load latest draft
- load latest published
- list history
- publish by copying draft to immutable published item

### 11.4 Metrics Snapshot Table

Recommended keys:

```text
PK: USER_METRICS
SK: SNAPSHOT#{isoHour}
```

Keep latest dashboard summary precomputed.

## 12. Main App Runtime Endpoints

The admin publishes flows for the main Collectool app. The current admin repo does not define main app endpoints, but backend should likely expose public/authenticated app endpoints such as:

```http
GET /collection-builder/categories
GET /collection-builder/categories/:categoryId/flow
POST /collection-builder/categories/:categoryId/runtime
```

Recommended behavior:

- Only return active categories and published flows.
- Never expose draft flows to normal app users.
- Runtime endpoint can share logic with admin preview, but must use published flow only.

These endpoints are inferred and should be coordinated with the main app repo.

## 13. Error Handling

Use standard HTTP status codes:

- `400`: invalid request body or invalid flow references.
- `401`: missing/invalid token.
- `403`: valid token but not admin.
- `404`: category/entity/flow/user not found.
- `409`: duplicate category/entity ID or publish conflict.
- `500`: unexpected server error.

Frontend expects:

```ts
{
  message: string
}
```

## 14. Minimum Seed Data

To get the admin usable quickly, seed:

### 14.1 Category

```ts
{
  id: "kpop",
  name: "K-pop",
  description: "Albums, photocards, merch, artists, groups, members, eras, and subunits.",
  status: "DRAFT",
  current_version_id: "kpop-v1-draft",
  progress_mode: "FULL",
  published_version: null,
  draft_version: 1
}
```

### 14.2 Entity

```ts
{
  id: "artist-bts",
  type: "ARTIST",
  name: "BTS",
  status: "ACTIVE",
  parents: [],
  tags: ["kpop", "artist:bts"],
  description: "K-pop group."
}
```

Note: current UI entity type list uses `GROUP`, not `ARTIST`, but fixtures use `artist-bts`. Prefer `GROUP` for BTS if rebuilding cleanly:

```ts
{
  id: "group-bts",
  type: "GROUP",
  name: "BTS",
  tags: ["kpop", "group:bts"]
}
```

### 14.3 Draft Flow

```ts
{
  id: "flow-kpop-draft",
  category_id: "kpop",
  version: 1,
  status: "DRAFT",
  root_question_ids: ["artist"],
  question_groups: {},
  conditions: [],
  questions: [
    {
      id: "artist",
      type: "SINGLE_SELECT",
      label: "Which artist are you collecting?",
      helper_text: "Pick the artist for this collection.",
      required: true,
      allow_all: true,
      options: [
        {
          id: "bts",
          label: "BTS",
          value: "bts",
          entity_id: "group-bts",
          tags: ["group:bts"]
        }
      ]
    }
  ],
  notes: "Initial K-pop draft"
}
```

## 15. Implementation Priority

Recommended order for backend reimplementation:

1. Auth middleware and `GET /admin/session`.
2. `GET /admin/users`.
3. `GET /admin/metrics/users` with simple live or cached implementation.
4. Category CRUD endpoints.
5. Entity CRUD endpoints.
6. Flow get/save draft endpoints.
7. Preview runtime engine.
8. Publish endpoint with versioning/history.
9. Bootstrap endpoint.
10. Optional user moderation endpoints.
11. Public/main-app published flow endpoints.
12. I18N persistence and fallback.

## 16. Acceptance Checklist

Backend is minimally compatible with current admin when:

- Admin can log in through Cognito and `/admin/session` returns user data.
- Dashboard loads without errors.
- Users page loads users, filters, searches, paginates, and opens detail dialog.
- Collection Builder categories load.
- Admin can create and update a category.
- Admin can publish a category flow.
- Entities load.
- Admin can create/update an entity with parents and tags.
- Question flow editor can load draft/published flow.
- Admin can save draft flow.
- Admin can publish flow.
- Preview endpoint returns visible questions, normalized answers, tags, and completion state.
- `GET /admin/collection-builder/bootstrap` returns the combined payload even if not yet used heavily.

## 17. Known Frontend Limitations To Be Aware Of

- Some workspace screens under `/collection-builder/[categoryId]` are mock/local and should not drive backend design yet.
- `StructureTab`, `CategoryPreviewTab`, and `VersionsTab` in `components/collection-builder/workspace/` have hardcoded data.
- `QuestionLogicTab` has local-only multilingual prototype state.
- `PreviewPublishTab` is backend-integrated but not currently rendered by the main `/collection-builder/page.tsx`.
- Archive/delete actions are visible in some menus but not wired to backend calls.
- User unlock/ban/disable actions are product requirements but not wired in the current UI.

## 18. Open Decisions For Backend Rebuild

These decisions should be made before or during backend reimplementation:

- **Canonical admin group**: current docs mention `admin`; mock auth uses `collectool-admins`. Recommended recovery path is to support both initially through configuration, then standardize one.
- **User pool separation**: confirm whether admin users and app users live in the same Cognito user pool. The admin UI needs to list app users, while admin login may use a separate admin pool.
- **Timestamp standard**: Collection Builder should use Unix seconds for `created_at`, `updated_at`, and `published_at`. Existing fixtures contain millisecond-like values and should not be copied into backend behavior.
- **Draft after publish**: decide whether publishing removes the draft, keeps it as the next editable base, or creates a new draft from published. Current frontend can tolerate either if `GET flow` returns coherent `draft`, `published`, and `history`.
- **"All/Todos" sentinel**: choose a stable answer value such as `__ALL__` before the main app depends on it.
- **Audit fields**: frontend currently hardcodes `"Admin User"` in one history display because backend does not return author metadata. Backend should add audit fields when ready, but this is not required by current types.
- **Main app runtime contract**: this admin repo only infers public/main app endpoints. Confirm exact routes with the app repo before locking them.

## 19. Suggested Backend Test Coverage

Minimum tests for the new backend:

- Auth middleware rejects missing, expired, malformed, and non-admin tokens.
- `GET /admin/session` returns email, name, and groups for a valid admin.
- User listing supports limit, pagination token, search, status filter, and verified filter.
- Metrics endpoint returns the exact dashboard shape with empty-state-safe arrays.
- Category create/update rejects duplicate IDs and invalid enum values.
- Entity create/update rejects duplicate IDs and invalid parent references where enforceable.
- Draft flow save validates question IDs, group references, condition references, action targets, option entity references, and duplicated option values.
- Publish rejects invalid drafts and creates immutable version history.
- Preview computes visible questions, condition branches, tags, normalized answers, and completion state deterministically.
- Public/main-app runtime never returns drafts.

## 20. Backend Agent Delivery Checklist

The backend agent should finish by reporting:

- Implemented endpoint list.
- Storage model/tables/collections created.
- Auth/admin authorization rule used.
- Seed data added or migration path.
- Known deviations from this spec.
- Manual environment variables required.
- Tests executed and their result.
- Any frontend contract changes needed in `collectool-admin`.
