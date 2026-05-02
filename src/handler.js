'use strict';

const {
  GetCommand,
  PutCommand,
  QueryCommand,
  ScanCommand,
} = require('@aws-sdk/lib-dynamodb');
const {
  CognitoIdentityProviderClient,
  AdminDisableUserCommand,
  AdminEnableUserCommand,
  AdminGetUserCommand,
  GetUserCommand,
  ListUsersCommand,
} = require('@aws-sdk/client-cognito-identity-provider');
const { error, json } = require('./http/responses');
const { ddb } = require('./repositories/dynamo');
const { buildRuntimeResponse, validateFlow } = require('./runtime');
const { buildSeedData, nowSeconds } = require('./seed');

const cognito = new CognitoIdentityProviderClient({});

const CATEGORY_STATUSES = new Set([
  'ACTIVE',
  'DRAFT',
  'COMING_SOON',
  'ARCHIVED',
]);
const PROGRESS_MODES = new Set(['FULL', 'WISHLIST', 'NONE']);
const ENTITY_STATUSES = new Set(['ACTIVE', 'DRAFT', 'ARCHIVED']);
const DEFAULT_LIMIT = 25;

let seedPromise;

function table(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing environment variable ${name}`);
  }
  return value;
}

function parseBody(event) {
  if (!event.body) {
    return {};
  }
  const body = event.isBase64Encoded
    ? Buffer.from(event.body, 'base64').toString('utf8')
    : event.body;
  try {
    return JSON.parse(body);
  } catch (_err) {
    throw Object.assign(new Error('Invalid JSON body'), { statusCode: 400 });
  }
}

function claims(event) {
  return event.requestContext?.authorizer?.jwt?.claims || {};
}

function claimGroups(jwtClaims) {
  const raw = jwtClaims['cognito:groups'];
  if (Array.isArray(raw)) {
    return raw;
  }
  if (typeof raw === 'string') {
    return raw
      .split(',')
      .map((group) => group.trim())
      .filter(Boolean);
  }
  return [];
}

function assertAdmin(event) {
  const jwtClaims = claims(event);
  const groups = claimGroups(jwtClaims);
  const allowed = (
    process.env.ALLOWED_ADMIN_GROUPS || 'admin,collectool-admins'
  )
    .split(',')
    .map((group) => group.trim())
    .filter(Boolean);

  if (allowed.length > 0 && !groups.some((group) => allowed.includes(group))) {
    throw Object.assign(new Error('Admin privileges required'), {
      statusCode: 403,
    });
  }

  return { jwtClaims, groups };
}

function bearerToken(event) {
  const headers = event.headers || {};
  const value = headers.authorization || headers.Authorization || '';
  const match = value.match(/^Bearer\s+(.+)$/i);
  return match ? match[1] : null;
}

async function getCategory(categoryId) {
  const result = await ddb.send(
    new GetCommand({
      TableName: table('CATEGORIES_TABLE'),
      Key: { id: categoryId },
    })
  );
  return result.Item || null;
}

async function putCategory(category) {
  await ddb.send(
    new PutCommand({
      TableName: table('CATEGORIES_TABLE'),
      Item: category,
    })
  );
  return category;
}

async function listCategories({ includeDrafts = true } = {}) {
  const result = await ddb.send(
    new ScanCommand({ TableName: table('CATEGORIES_TABLE') })
  );
  return (result.Items || [])
    .filter((category) => includeDrafts || category.status === 'ACTIVE')
    .sort((a, b) => a.name.localeCompare(b.name));
}

async function getEntity(entityId) {
  const result = await ddb.send(
    new GetCommand({
      TableName: table('ENTITIES_TABLE'),
      Key: { id: entityId },
    })
  );
  return result.Item || null;
}

async function putEntity(entity) {
  await ddb.send(
    new PutCommand({
      TableName: table('ENTITIES_TABLE'),
      Item: entity,
    })
  );
  return entity;
}

async function listEntities(type) {
  const result = await ddb.send(
    new ScanCommand({ TableName: table('ENTITIES_TABLE') })
  );
  return (result.Items || [])
    .filter((entity) => !type || entity.type === type)
    .sort(
      (a, b) => a.type.localeCompare(b.type) || a.name.localeCompare(b.name)
    );
}

async function getFlow(categoryId, flowKey) {
  const result = await ddb.send(
    new GetCommand({
      TableName: table('FLOWS_TABLE'),
      Key: { category_id: categoryId, flow_key: flowKey },
    })
  );
  const item = result.Item;
  return item ? item.flow : null;
}

async function putFlow(categoryId, flowKey, flow) {
  await ddb.send(
    new PutCommand({
      TableName: table('FLOWS_TABLE'),
      Item: {
        category_id: categoryId,
        flow_key: flowKey,
        flow,
        version: flow.version,
        status: flow.status,
      },
    })
  );
  return flow;
}

async function listFlows(categoryId) {
  const result = await ddb.send(
    new QueryCommand({
      TableName: table('FLOWS_TABLE'),
      KeyConditionExpression: 'category_id = :categoryId',
      ExpressionAttributeValues: { ':categoryId': categoryId },
    })
  );
  return (result.Items || []).map((item) => item.flow);
}

async function latestPublishedFlow(categoryId) {
  const flows = await listFlows(categoryId);
  return (
    flows
      .filter((flow) => flow.status === 'PUBLISHED')
      .sort((a, b) => (b.version || 0) - (a.version || 0))[0] || null
  );
}

function flowHistory(flows) {
  return flows
    .map((flow) => ({
      id: flow.id,
      version: flow.version,
      status: flow.status,
      notes: flow.notes || '',
      published_at: flow.published_at,
      updated_at: flow.updated_at,
      created_at: flow.created_at,
    }))
    .sort(
      (a, b) =>
        (b.updated_at || b.published_at || b.created_at || 0) -
        (a.updated_at || a.published_at || a.created_at || 0)
    );
}

async function ensureSeeded() {
  if (process.env.SEED_INITIAL_DATA === 'false') {
    return;
  }

  if (!seedPromise) {
    seedPromise = (async () => {
      const { category, entity, flow } = buildSeedData();
      const existing = await getCategory(category.id);
      if (existing) {
        return;
      }

      await putEntity(entity);
      await putCategory(category);
      await putFlow(category.id, 'FLOW#DRAFT', flow);
    })();
  }

  await seedPromise;
}

function attributeMap(attributes) {
  return Object.fromEntries(
    (attributes || []).map((attribute) => [attribute.Name, attribute.Value])
  );
}

function mapCognitoUser(user) {
  const attrs = attributeMap(user.Attributes);
  const enabled = user.Enabled !== false;
  return {
    id: attrs.sub || user.Username,
    username: user.Username,
    name: attrs.name || attrs.given_name || attrs.email || user.Username,
    email: attrs.email || '',
    verified: attrs.email_verified === 'true',
    status: enabled ? 'active' : 'inactive',
    enabled,
    cognitoStatus: user.UserStatus || 'UNKNOWN',
    createdAt: user.UserCreateDate
      ? new Date(user.UserCreateDate).toISOString()
      : new Date(0).toISOString(),
    lastUpdatedAt: user.UserLastModifiedDate
      ? new Date(user.UserLastModifiedDate).toISOString()
      : new Date(0).toISOString(),
  };
}

function matchesUserFilters(user, query) {
  if (query.status && user.status !== query.status) {
    return false;
  }
  if (query.verified === 'true' && !user.verified) {
    return false;
  }
  if (query.verified === 'false' && user.verified) {
    return false;
  }

  if (query.search) {
    const needle = query.search.toLowerCase();
    const haystack = [user.username, user.email, user.name]
      .join(' ')
      .toLowerCase();
    if (!haystack.includes(needle)) {
      return false;
    }
  }

  return true;
}

async function listAppUsers(query) {
  const limit = Math.min(Number(query.limit || DEFAULT_LIMIT), 60);
  const result = await cognito.send(
    new ListUsersCommand({
      UserPoolId: table('APP_USER_POOL_ID'),
      Limit: limit,
      PaginationToken: query.paginationToken,
    })
  );
  const users = (result.Users || [])
    .map(mapCognitoUser)
    .filter((user) => matchesUserFilters(user, query));
  return { users, nextToken: result.PaginationToken };
}

async function loadUsersForMetrics() {
  const maxUsers = Number(process.env.METRICS_USER_SCAN_LIMIT || 500);
  const users = [];
  let token;

  while (users.length < maxUsers) {
    const result = await cognito.send(
      new ListUsersCommand({
        UserPoolId: table('APP_USER_POOL_ID'),
        Limit: Math.min(60, maxUsers - users.length),
        PaginationToken: token,
      })
    );

    users.push(...(result.Users || []).map(mapCognitoUser));
    token = result.PaginationToken;
    if (!token) {
      break;
    }
  }

  return users;
}

function startOfHour(date) {
  const value = new Date(date);
  value.setMinutes(0, 0, 0);
  return value;
}

function buildMetrics(users) {
  const now = new Date();
  const oneHour = now.getTime() - 60 * 60 * 1000;
  const oneDay = now.getTime() - 24 * 60 * 60 * 1000;
  const sevenDays = now.getTime() - 7 * 24 * 60 * 60 * 1000;
  const createdTimes = users.map((user) => ({
    user,
    time: new Date(user.createdAt).getTime(),
  }));

  const hourlyChart = [];
  for (let index = 23; index >= 0; index -= 1) {
    const hour = startOfHour(new Date(now.getTime() - index * 60 * 60 * 1000));
    const nextHour = new Date(hour.getTime() + 60 * 60 * 1000);
    hourlyChart.push({
      hour: hour.toISOString().slice(11, 16),
      timestamp: hour.toISOString(),
      users: createdTimes.filter(
        ({ time }) => time >= hour.getTime() && time < nextHour.getTime()
      ).length,
    });
  }

  const dailyChart = [];
  for (let index = 6; index >= 0; index -= 1) {
    const day = new Date(now);
    day.setUTCHours(0, 0, 0, 0);
    day.setUTCDate(day.getUTCDate() - index);
    const nextDay = new Date(day.getTime() + 24 * 60 * 60 * 1000);
    dailyChart.push({
      day: day.toISOString().slice(0, 10),
      date: day.toISOString(),
      users: createdTimes.filter(
        ({ time }) => time >= day.getTime() && time < nextDay.getTime()
      ).length,
    });
  }

  return {
    kpis: {
      newUsersLastHour: createdTimes.filter(({ time }) => time >= oneHour)
        .length,
      newUsersLast24Hours: createdTimes.filter(({ time }) => time >= oneDay)
        .length,
      newUsersLast7Days: createdTimes.filter(({ time }) => time >= sevenDays)
        .length,
      totalRegistered: users.length,
    },
    statusSummary: [
      {
        label: 'active',
        value: users.filter((user) => user.status === 'active').length,
      },
      {
        label: 'inactive',
        value: users.filter((user) => user.status === 'inactive').length,
      },
    ],
    verificationSummary: [
      {
        label: 'verified',
        value: users.filter((user) => user.verified).length,
      },
      {
        label: 'unverified',
        value: users.filter((user) => !user.verified).length,
      },
    ],
    recentSignups: [...users]
      .sort(
        (a, b) =>
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      )
      .slice(0, 8)
      .map(({ username, name, email, createdAt }) => ({
        username,
        name,
        email,
        createdAt,
      })),
    recentlyUpdatedUsers: [...users]
      .sort(
        (a, b) =>
          new Date(b.lastUpdatedAt).getTime() -
          new Date(a.lastUpdatedAt).getTime()
      )
      .slice(0, 8)
      .map(({ username, name, email, status, lastUpdatedAt }) => ({
        username,
        name,
        email,
        status,
        lastUpdatedAt,
      })),
    hourlyChart,
    dailyChart,
    generatedAt: now.toISOString(),
  };
}

async function getUser(username) {
  const result = await cognito.send(
    new AdminGetUserCommand({
      UserPoolId: table('APP_USER_POOL_ID'),
      Username: username,
    })
  );

  return mapCognitoUser({
    Username: result.Username,
    Attributes: result.UserAttributes,
    Enabled: result.Enabled,
    UserStatus: result.UserStatus,
    UserCreateDate: result.UserCreateDate,
    UserLastModifiedDate: result.UserLastModifiedDate,
  });
}

async function handleSession(event) {
  const { jwtClaims, groups } = assertAdmin(event);
  const token = bearerToken(event);
  let userAttributes = {};

  if (token) {
    try {
      const user = await cognito.send(
        new GetUserCommand({ AccessToken: token })
      );
      userAttributes = attributeMap(user.UserAttributes);
    } catch (err) {
      console.warn(
        'Unable to load Cognito user attributes for session',
        err.name || err.message
      );
    }
  }

  return json(200, {
    user: {
      email: userAttributes.email || jwtClaims.email || '',
      name:
        userAttributes.name ||
        userAttributes.given_name ||
        jwtClaims.name ||
        jwtClaims.given_name ||
        jwtClaims.email ||
        jwtClaims.username ||
        jwtClaims.sub ||
        '',
      groups,
    },
  });
}

async function handleUsers(path, method, query) {
  if (method === 'GET' && path === '/admin/users') {
    return json(200, await listAppUsers(query));
  }

  const match = path.match(
    /^\/admin\/users\/([^/]+)\/(enable|disable|unlock|ban|unban)$/
  );
  if (method === 'POST' && match) {
    const username = decodeURIComponent(match[1]);
    const action = match[2];

    if (action === 'disable' || action === 'ban') {
      await cognito.send(
        new AdminDisableUserCommand({
          UserPoolId: table('APP_USER_POOL_ID'),
          Username: username,
        })
      );
    }

    if (action === 'enable' || action === 'unban' || action === 'unlock') {
      await cognito.send(
        new AdminEnableUserCommand({
          UserPoolId: table('APP_USER_POOL_ID'),
          Username: username,
        })
      );
    }

    return json(200, { user: await getUser(username) });
  }

  return null;
}

async function handleCategories(path, method, body) {
  if (method === 'GET' && path === '/admin/collection-builder/categories') {
    return json(200, { categories: await listCategories() });
  }

  if (method === 'POST' && path === '/admin/collection-builder/categories') {
    if (!body.id || !body.name) {
      return error(400, 'Category id and name are required');
    }
    if (await getCategory(body.id)) {
      return error(409, 'Category id already exists');
    }

    const timestamp = nowSeconds();
    const status = CATEGORY_STATUSES.has(body.status) ? body.status : 'DRAFT';
    const progressMode = PROGRESS_MODES.has(body.progress_mode)
      ? body.progress_mode
      : 'NONE';
    const category = {
      id: body.id,
      name: body.name,
      description: body.description || '',
      status,
      current_version_id: `${body.id}-v1-draft`,
      progress_mode: progressMode,
      published_version: null,
      draft_version: 1,
      updated_at: timestamp,
      created_at: timestamp,
    };
    const flow = {
      id: `flow-${body.id}-draft`,
      category_id: body.id,
      version: 1,
      status: 'DRAFT',
      root_question_ids: [],
      question_groups: {},
      conditions: [],
      questions: [],
      notes: 'Initial draft',
      updated_at: timestamp,
      created_at: timestamp,
    };

    await putCategory(category);
    await putFlow(category.id, 'FLOW#DRAFT', flow);
    return json(201, { category });
  }

  const match = path.match(
    /^\/admin\/collection-builder\/categories\/([^/]+)$/
  );
  if (method === 'PUT' && match) {
    const categoryId = decodeURIComponent(match[1]);
    const existing = await getCategory(categoryId);
    if (!existing) {
      return error(404, 'Category not found');
    }

    if (body.status && !CATEGORY_STATUSES.has(body.status)) {
      return error(400, 'Invalid category status');
    }
    if (body.progress_mode && !PROGRESS_MODES.has(body.progress_mode)) {
      return error(400, 'Invalid progress mode');
    }

    const category = {
      ...existing,
      ...body,
      id: existing.id,
      updated_at: nowSeconds(),
      created_at: existing.created_at,
    };

    await putCategory(category);
    return json(200, { category });
  }

  if (
    method === 'POST' &&
    path.match(/^\/admin\/collection-builder\/categories\/([^/]+)\/archive$/)
  ) {
    const categoryId = decodeURIComponent(
      path.match(
        /^\/admin\/collection-builder\/categories\/([^/]+)\/archive$/
      )[1]
    );
    const existing = await getCategory(categoryId);
    if (!existing) {
      return error(404, 'Category not found');
    }
    const category = {
      ...existing,
      status: 'ARCHIVED',
      updated_at: nowSeconds(),
    };
    await putCategory(category);
    return json(200, { category });
  }

  return null;
}

async function handleEntities(path, method, query, body) {
  if (method === 'GET' && path === '/admin/collection-builder/entities') {
    return json(200, { entities: await listEntities(query.type) });
  }

  if (method === 'POST' && path === '/admin/collection-builder/entities') {
    if (!body.id || !body.type || !body.name) {
      return error(400, 'Entity id, type, and name are required');
    }
    if (await getEntity(body.id)) {
      return error(409, 'Entity id already exists');
    }

    for (const parentId of body.parents || []) {
      if (!(await getEntity(parentId))) {
        return error(400, `Parent entity not found: ${parentId}`);
      }
    }

    const timestamp = nowSeconds();
    const entity = {
      id: body.id,
      type: body.type,
      name: body.name,
      status: ENTITY_STATUSES.has(body.status)
        ? body.status
        : body.status || 'DRAFT',
      parents: Array.isArray(body.parents) ? body.parents : [],
      tags: Array.isArray(body.tags) ? body.tags : [],
      description: body.description || '',
      updated_at: timestamp,
      created_at: timestamp,
    };

    await putEntity(entity);
    return json(201, { entity });
  }

  const match = path.match(/^\/admin\/collection-builder\/entities\/([^/]+)$/);
  if (method === 'PUT' && match) {
    const entityId = decodeURIComponent(match[1]);
    const existing = await getEntity(entityId);
    if (!existing) {
      return error(404, 'Entity not found');
    }

    for (const parentId of body.parents || []) {
      if (!(await getEntity(parentId))) {
        return error(400, `Parent entity not found: ${parentId}`);
      }
    }

    const entity = {
      ...existing,
      ...body,
      id: existing.id,
      updated_at: nowSeconds(),
      created_at: existing.created_at,
    };

    await putEntity(entity);
    return json(200, { entity });
  }

  return null;
}

async function flowSummary(categoryId) {
  const category = await getCategory(categoryId);
  if (!category) {
    return null;
  }
  const flows = await listFlows(categoryId);
  return {
    draft: flows.find((flow) => flow.status === 'DRAFT') || null,
    published:
      flows
        .filter((flow) => flow.status === 'PUBLISHED')
        .sort((a, b) => b.version - a.version)[0] || null,
    history: flowHistory(flows),
  };
}

async function handleFlows(path, method, body) {
  const flowMatch = path.match(
    /^\/admin\/collection-builder\/categories\/([^/]+)\/flow$/
  );
  if (flowMatch) {
    const categoryId = decodeURIComponent(flowMatch[1]);
    const category = await getCategory(categoryId);
    if (!category) {
      return error(404, 'Category not found');
    }

    if (method === 'GET') {
      return json(200, await flowSummary(categoryId));
    }

    if (method === 'PUT') {
      const existingDraft = await getFlow(categoryId, 'FLOW#DRAFT');
      const timestamp = nowSeconds();
      const version =
        body.version || existingDraft?.version || category.draft_version || 1;
      const flow = {
        id: body.id || existingDraft?.id || `flow-${categoryId}-draft`,
        category_id: categoryId,
        version,
        status: 'DRAFT',
        root_question_ids:
          body.root_question_ids || existingDraft?.root_question_ids || [],
        question_groups:
          body.question_groups || existingDraft?.question_groups || {},
        conditions: body.conditions || existingDraft?.conditions || [],
        questions: body.questions || existingDraft?.questions || [],
        notes: body.notes || existingDraft?.notes || '',
        created_at: existingDraft?.created_at || timestamp,
        updated_at: timestamp,
      };
      const validationErrors = validateFlow(flow, await listEntities());
      if (validationErrors.length > 0) {
        return error(400, validationErrors.join('; '));
      }

      await putFlow(categoryId, 'FLOW#DRAFT', flow);
      await putCategory({
        ...category,
        draft_version: version,
        current_version_id: flow.id,
        updated_at: timestamp,
      });
      return json(200, { flow });
    }
  }

  const previewMatch = path.match(
    /^\/admin\/collection-builder\/categories\/([^/]+)\/preview$/
  );
  if (method === 'POST' && previewMatch) {
    const categoryId = decodeURIComponent(previewMatch[1]);
    const category = await getCategory(categoryId);
    if (!category) {
      return error(404, 'Category not found');
    }

    const flow = body.use_draft
      ? await getFlow(categoryId, 'FLOW#DRAFT')
      : await latestPublishedFlow(categoryId);
    if (!flow) {
      return error(404, 'Flow not found');
    }
    return json(200, buildRuntimeResponse(flow, body.answers || {}));
  }

  const publishMatch = path.match(
    /^\/admin\/collection-builder\/categories\/([^/]+)\/publish$/
  );
  if (method === 'POST' && publishMatch) {
    const categoryId = decodeURIComponent(publishMatch[1]);
    const category = await getCategory(categoryId);
    if (!category) {
      return error(404, 'Category not found');
    }

    const draft = await getFlow(categoryId, 'FLOW#DRAFT');
    if (!draft) {
      return error(400, 'Draft flow is required before publishing');
    }

    const validationErrors = validateFlow(draft, await listEntities());
    if (validationErrors.length > 0) {
      return error(400, validationErrors.join('; '));
    }

    const timestamp = nowSeconds();
    const nextVersion = (category.published_version || 0) + 1;
    const published = {
      ...draft,
      id: `${categoryId}-v${nextVersion}`,
      version: nextVersion,
      status: 'PUBLISHED',
      notes: body.notes || draft.notes || '',
      published_at: timestamp,
      updated_at: timestamp,
    };
    const updatedCategory = {
      ...category,
      status:
        body.category_status && CATEGORY_STATUSES.has(body.category_status)
          ? body.category_status
          : category.status,
      published_version: nextVersion,
      current_version_id: published.id,
      updated_at: timestamp,
    };

    await putFlow(categoryId, `FLOW#PUBLISHED#v${nextVersion}`, published);
    await putCategory(updatedCategory);
    return json(200, { flow: published, category: updatedCategory });
  }

  return null;
}

async function handleBootstrap(path, method) {
  if (method !== 'GET' || path !== '/admin/collection-builder/bootstrap') {
    return null;
  }

  const categories = await listCategories();
  const entities = await listEntities();
  const flows = {};
  for (const category of categories) {
    flows[category.id] = await flowSummary(category.id);
  }

  return json(200, { categories, entities, flows });
}

async function handlePublicRuntime(path, method, body) {
  if (method === 'GET' && path === '/collection-builder/categories') {
    return json(200, {
      categories: await listCategories({ includeDrafts: false }),
    });
  }

  const flowMatch = path.match(
    /^\/collection-builder\/categories\/([^/]+)\/flow$/
  );
  if (method === 'GET' && flowMatch) {
    const categoryId = decodeURIComponent(flowMatch[1]);
    const category = await getCategory(categoryId);
    if (!category || category.status !== 'ACTIVE') {
      return error(404, 'Category not found');
    }
    const flow = await latestPublishedFlow(categoryId);
    if (!flow) {
      return error(404, 'Published flow not found');
    }
    return json(200, { flow });
  }

  const runtimeMatch = path.match(
    /^\/collection-builder\/categories\/([^/]+)\/runtime$/
  );
  if (method === 'POST' && runtimeMatch) {
    const categoryId = decodeURIComponent(runtimeMatch[1]);
    const category = await getCategory(categoryId);
    if (!category || category.status !== 'ACTIVE') {
      return error(404, 'Category not found');
    }
    const flow = await latestPublishedFlow(categoryId);
    if (!flow) {
      return error(404, 'Published flow not found');
    }
    return json(200, buildRuntimeResponse(flow, body.answers || {}));
  }

  return null;
}

async function route(event) {
  const method = event.requestContext?.http?.method || event.httpMethod;
  const path = event.rawPath || event.path || '/';
  const query = event.queryStringParameters || {};
  const body = ['POST', 'PUT', 'PATCH'].includes(method)
    ? parseBody(event)
    : {};

  if (method === 'GET' && path === '/health') {
    return json(200, {
      ok: true,
      environment: process.env.ENVIRONMENT || 'dev',
    });
  }

  await ensureSeeded();

  if (path.startsWith('/admin/')) {
    assertAdmin(event);

    if (method === 'GET' && path === '/admin/session') {
      return handleSession(event);
    }
    if (method === 'GET' && path === '/admin/metrics/users') {
      return json(200, buildMetrics(await loadUsersForMetrics()));
    }

    const handlers = [
      () => handleUsers(path, method, query),
      () => handleBootstrap(path, method),
      () => handleCategories(path, method, body),
      () => handleEntities(path, method, query, body),
      () => handleFlows(path, method, body),
    ];

    for (const handler of handlers) {
      const response = await handler();
      if (response) {
        return response;
      }
    }
  }

  const publicRuntimeResponse = await handlePublicRuntime(path, method, body);
  if (publicRuntimeResponse) {
    return publicRuntimeResponse;
  }

  return error(404, 'Route not found');
}

exports.handler = async function handler(event) {
  const startedAt = Date.now();
  const requestId = event.requestContext?.requestId || 'unknown';
  const method = event.requestContext?.http?.method || event.httpMethod;
  const path = event.rawPath || event.path || '/';

  try {
    const response = await route(event);
    console.info(
      JSON.stringify({
        level: 'info',
        message: 'request_completed',
        requestId,
        method,
        path,
        statusCode: response.statusCode,
        durationMs: Date.now() - startedAt,
      })
    );
    return response;
  } catch (err) {
    const statusCode = err.statusCode || err.$metadata?.httpStatusCode || 500;
    console.error(
      JSON.stringify({
        level: 'error',
        message: 'request_failed',
        requestId,
        method,
        path,
        statusCode,
        durationMs: Date.now() - startedAt,
        error: err.message || 'Unexpected server error',
      })
    );

    const details = statusCode >= 500 ? { requestId } : {};
    return error(statusCode, err.message || 'Unexpected server error', details);
  }
};
