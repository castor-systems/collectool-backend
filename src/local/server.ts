'use strict';

const http = require('http');
const { randomUUID } = require('crypto');
const { applyLocalDefaults } = require('./env');
const { fakeAdminClaimsFromEvent } = require('./cognito');

applyLocalDefaults();

const { handler } = require('../handler');

const port = Number(process.env.LOCAL_API_PORT || 3001);
const allowedOrigin = process.env.LOCAL_CORS_ORIGIN || 'http://localhost:3000';

function readBody(request) {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
    request.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    request.on('error', reject);
  });
}

function headersFromRequest(request) {
  const headers: Record<string, any> = {};
  for (const [key, value] of Object.entries(request.headers)) {
    headers[key.toLowerCase()] = Array.isArray(value) ? value.join(',') : value;
  }
  return headers;
}

function queryFromUrl(url) {
  const query = {};
  for (const [key, value] of url.searchParams.entries()) {
    query[key] = value;
  }
  return query;
}

async function makeEvent(request) {
  const headers = headersFromRequest(request);
  const url = new URL(
    request.url || '/',
    `http://${headers.host || `localhost:${port}`}`
  );
  const body = await readBody(request);
  const requestId = randomUUID();

  const event = {
    version: '2.0',
    routeKey: `${request.method} ${url.pathname}`,
    rawPath: url.pathname,
    rawQueryString: url.searchParams.toString(),
    headers,
    queryStringParameters: queryFromUrl(url),
    requestContext: {
      accountId: 'local',
      apiId: 'local',
      domainName: headers.host || `localhost:${port}`,
      domainPrefix: 'local',
      requestId,
      routeKey: `${request.method} ${url.pathname}`,
      stage: '$default',
      time: new Date().toISOString(),
      timeEpoch: Date.now(),
      http: {
        method: request.method,
        path: url.pathname,
        protocol: 'HTTP/1.1',
        sourceIp: request.socket.remoteAddress || '127.0.0.1',
        userAgent: headers['user-agent'] || 'local-server',
      },
      authorizer: {
        jwt: {
          claims: {},
          scopes: [],
        },
      },
    },
    body: body || undefined,
    isBase64Encoded: false,
  };
  const fakeClaims = fakeAdminClaimsFromEvent(event);
  if (fakeClaims) {
    event.requestContext.authorizer.jwt.claims = fakeClaims;
  }
  return event;
}

function writeCors(response) {
  response.setHeader('access-control-allow-origin', allowedOrigin);
  response.setHeader('access-control-allow-credentials', 'true');
  response.setHeader(
    'access-control-allow-headers',
    'authorization,content-type,x-local-email,x-local-groups,x-local-name,x-local-sub,x-local-username'
  );
  response.setHeader(
    'access-control-allow-methods',
    'GET,POST,PUT,PATCH,DELETE,OPTIONS'
  );
}

const server = http.createServer(async (request, response) => {
  writeCors(response);

  if (request.method === 'OPTIONS') {
    response.writeHead(204);
    response.end();
    return;
  }

  try {
    const event = await makeEvent(request);
    const result = await handler(event);

    for (const [key, value] of Object.entries(result.headers || {})) {
      response.setHeader(key, value);
    }

    response.writeHead(result.statusCode || 200);
    response.end(result.body || '');
  } catch (err) {
    console.error(err);
    response.writeHead(500, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ message: 'Local server error' }));
  }
});

server.listen(port, () => {
  console.info(
    `collectool backend local API listening on http://localhost:${port}`
  );
  console.info(`DynamoDB endpoint: ${process.env.DYNAMODB_ENDPOINT}`);
  console.info(`Seed initial data: ${process.env.SEED_INITIAL_DATA}`);
});
