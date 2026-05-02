'use strict';

const { mockClient } = require('aws-sdk-client-mock');
const {
  CognitoIdentityProviderClient,
  GetUserCommand,
} = require('@aws-sdk/client-cognito-identity-provider');
const {
  DynamoDBDocumentClient,
  GetCommand,
  QueryCommand,
} = require('@aws-sdk/lib-dynamodb');
const collectionCategory = require('./fixtures/collection-category.json');
const collectionFlow = require('./fixtures/collection-flow.json');

const ddbMock = mockClient(DynamoDBDocumentClient);
const cognitoMock = mockClient(CognitoIdentityProviderClient);

function configureEnvironment() {
  process.env.AWS_REGION = 'us-east-1';
  process.env.ENVIRONMENT = 'test';
  process.env.CATEGORIES_TABLE = 'collectool-test-categories';
  process.env.ENTITIES_TABLE = 'collectool-test-entities';
  process.env.FLOWS_TABLE = 'collectool-test-flows';
  process.env.APP_USER_POOL_ID = 'app-user-pool';
  process.env.ALLOWED_ADMIN_GROUPS = 'admin,collectool-admins';
  process.env.SEED_INITIAL_DATA = 'false';
}

function parse(response) {
  return JSON.parse(response.body);
}

/**
 * @param {{
 *   method?: string,
 *   path?: string,
 *   body?: Record<string, unknown>,
 *   claims?: Record<string, string>,
 *   headers?: Record<string, string>
 * }} [options]
 */
function makeEvent(options = {}) {
  const { method = 'GET', path = '/', body, claims, headers } = options;
  return {
    version: '2.0',
    rawPath: path,
    headers: headers || {},
    requestContext: {
      requestId: 'request-123',
      http: { method, path },
      authorizer: claims
        ? {
            jwt: {
              claims,
            },
          }
        : undefined,
    },
    body: body ? JSON.stringify(body) : undefined,
    isBase64Encoded: false,
    queryStringParameters: {},
  };
}

function adminClaims(groups = ['collectool-admins']) {
  return {
    sub: 'admin-sub',
    email: 'admin@collectool.local',
    name: 'Collectool Admin',
    'cognito:groups': groups.join(','),
  };
}

let handler;

beforeEach(() => {
  ddbMock.reset();
  cognitoMock.reset();
  configureEnvironment();
  handler = require('../dist/src/handler').handler;
});

test('health route does not require Cognito or DynamoDB', async () => {
  const response = await handler(makeEvent({ path: '/health' }));

  expect(response.statusCode).toBe(200);
  expect(parse(response)).toEqual({ ok: true, environment: 'test' });
  expect(ddbMock.commandCalls(GetCommand)).toHaveLength(0);
});

test('admin session merges JWT groups with Cognito attributes', async () => {
  cognitoMock.on(GetUserCommand).resolves({
    UserAttributes: [
      { Name: 'email', Value: 'admin@collectool.local' },
      { Name: 'name', Value: 'Collectool Admin' },
    ],
  });

  const response = await handler(
    makeEvent({
      path: '/admin/session',
      claims: adminClaims(),
      headers: { authorization: 'Bearer access-token' },
    })
  );

  expect(response.statusCode).toBe(200);
  expect(parse(response)).toEqual({
    user: {
      email: 'admin@collectool.local',
      name: 'Collectool Admin',
      groups: ['collectool-admins'],
    },
  });
});

test('admin routes reject users outside allowed groups', async () => {
  const response = await handler(
    makeEvent({
      path: '/admin/session',
      claims: adminClaims(['support']),
    })
  );

  expect(response.statusCode).toBe(403);
  expect(parse(response)).toEqual({ message: 'Admin privileges required' });
});

test('public runtime never exposes draft-only flows', async () => {
  ddbMock
    .on(GetCommand, {
      TableName: 'collectool-test-categories',
      Key: { id: 'kpop' },
    })
    .resolves({
      Item: {
        ...collectionCategory.category,
        status: 'ACTIVE',
      },
    });
  ddbMock
    .on(QueryCommand, {
      TableName: 'collectool-test-flows',
      KeyConditionExpression: 'category_id = :categoryId',
      ExpressionAttributeValues: { ':categoryId': 'kpop' },
    })
    .resolves({
      Items: [
        {
          category_id: 'kpop',
          flow_key: 'FLOW#DRAFT',
          flow: collectionFlow.draft,
        },
      ],
    });

  const response = await handler(
    makeEvent({ path: '/collection-builder/categories/kpop/flow' })
  );

  expect(response.statusCode).toBe(404);
  expect(parse(response)).toEqual({ message: 'Published flow not found' });
});
