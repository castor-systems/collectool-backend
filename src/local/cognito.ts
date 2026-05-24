'use strict';

type AnyRecord = Record<string, any>;

const now = new Date().toISOString();
let users: AnyRecord[] | null = null;

function isLocalAwsMocks() {
  return (
    process.env.LOCAL_AWS_MOCKS === 'true' ||
    process.env.ENVIRONMENT === 'local'
  );
}

function isLocalFakeAuthEnabled() {
  return (
    process.env.LOCAL_FAKE_AUTH === 'true' ||
    process.env.ENVIRONMENT === 'local'
  );
}

function bearerTokenFromHeaders(headers: AnyRecord = {}) {
  const value = headers.authorization || headers.Authorization || '';
  const match = String(value).match(/^Bearer\s+(.+)$/i);
  return match ? match[1] : null;
}

function fakeAdminGroups(headers: AnyRecord = {}) {
  const groupHeader = headers['x-local-groups'];
  if (groupHeader === 'none') {
    return [];
  }

  return String(groupHeader || '')
    .split(',')
    .map((group) => group.trim())
    .filter(Boolean);
}

function fakeAdminClaims(headers: AnyRecord = {}) {
  return {
    sub: headers['x-local-sub'] || 'mock-admin',
    username: headers['x-local-username'] || 'mock-admin',
    email:
      headers['x-local-email'] ||
      process.env.LOCAL_FAKE_ADMIN_EMAIL ||
      'admin@collectool.local',
    name:
      headers['x-local-name'] ||
      process.env.LOCAL_FAKE_ADMIN_NAME ||
      'Mock Admin',
    'cognito:groups': fakeAdminGroups(headers),
  };
}

function fakeAdminClaimsFromEvent(event) {
  if (!isLocalFakeAuthEnabled()) {
    return null;
  }

  const headers = event.headers || {};
  const token = bearerTokenFromHeaders(headers);
  const fakeToken =
    process.env.LOCAL_FAKE_ACCESS_TOKEN || 'mock-admin-access-token';
  const hasLocalOverride = Object.keys(headers).some((header) =>
    header.toLowerCase().startsWith('x-local-')
  );

  if (token === fakeToken || hasLocalOverride) {
    return fakeAdminClaims(headers);
  }

  return null;
}

function defaultUsers() {
  return [
    {
      id: 'local-user-1',
      username: 'local-user-1',
      name: 'Local Active User',
      email: 'active.local@collectool.test',
      verified: true,
      status: 'active',
      enabled: true,
      cognitoStatus: 'CONFIRMED',
      createdAt: now,
      lastUpdatedAt: now,
    },
    {
      id: 'local-user-2',
      username: 'local-user-2',
      name: 'Local Pending User',
      email: 'pending.local@collectool.test',
      verified: false,
      status: 'active',
      enabled: true,
      cognitoStatus: 'UNCONFIRMED',
      createdAt: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
      lastUpdatedAt: now,
    },
    {
      id: 'local-user-disabled',
      username: 'local-user-disabled',
      name: 'Local Disabled User',
      email: 'disabled.local@collectool.test',
      verified: true,
      status: 'inactive',
      enabled: false,
      cognitoStatus: 'CONFIRMED',
      createdAt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(),
      lastUpdatedAt: now,
    },
  ];
}

function loadUsers() {
  if (users) {
    return users;
  }

  if (process.env.LOCAL_COGNITO_USERS) {
    users = JSON.parse(process.env.LOCAL_COGNITO_USERS);
    return users;
  }

  users = defaultUsers();
  return users;
}

function matchesUserFilters(user, query: AnyRecord = {}) {
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
    const needle = String(query.search).toLowerCase();
    const haystack = [user.username, user.email, user.name]
      .join(' ')
      .toLowerCase();
    if (!haystack.includes(needle)) {
      return false;
    }
  }

  return true;
}

function listLocalUsers(query = {}, limit = 25) {
  const loadedUsers = loadUsers() || [];
  return loadedUsers
    .filter((user) => matchesUserFilters(user, query))
    .slice(0, limit);
}

function getLocalUser(username) {
  const loadedUsers = loadUsers() || [];
  const user = loadedUsers.find((candidate) => candidate.username === username);
  if (!user) {
    const err = new Error(`Local user ${username} not found`);
    (err as AnyRecord).statusCode = 404;
    throw err;
  }
  return user;
}

function setLocalUserEnabled(username, enabled) {
  const user = getLocalUser(username);
  user.enabled = enabled;
  user.status = enabled ? 'active' : 'inactive';
  user.lastUpdatedAt = new Date().toISOString();
  return user;
}

function localSessionAttributes(jwtClaims: AnyRecord = {}) {
  return {
    email: jwtClaims.email || 'admin.local@collectool.test',
    name: jwtClaims.name || jwtClaims.given_name || 'Local Admin',
  };
}

module.exports = {
  fakeAdminClaims,
  fakeAdminClaimsFromEvent,
  getLocalUser,
  isLocalAwsMocks,
  isLocalFakeAuthEnabled,
  listLocalUsers,
  localSessionAttributes,
  setLocalUserEnabled,
};
