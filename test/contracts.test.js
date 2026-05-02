'use strict';

const Ajv2020 = require('ajv/dist/2020').default;
const schema = require('../schemas/api-contracts.schema.json');
const adminSession = require('./fixtures/admin-session.json');
const usersResponse = require('./fixtures/users-response.json');
const userMetrics = require('./fixtures/user-metrics.json');
const collectionCategory = require('./fixtures/collection-category.json');
const collectionEntity = require('./fixtures/collection-entity.json');
const collectionFlow = require('./fixtures/collection-flow.json');
const runtimeResponse = require('./fixtures/runtime-response.json');

const ajv = new Ajv2020({ strict: false });
ajv.addSchema(schema);

const cases = [
  { name: 'admin session', ref: 'adminSession', data: adminSession },
  { name: 'users response', ref: 'usersResponse', data: usersResponse },
  { name: 'user metrics', ref: 'metricsResponse', data: userMetrics },
  {
    name: 'category response',
    ref: 'categoryResponse',
    data: collectionCategory,
  },
  { name: 'entity response', ref: 'entityResponse', data: collectionEntity },
  { name: 'flow summary', ref: 'flowSummary', data: collectionFlow },
  { name: 'runtime response', ref: 'runtimeResponse', data: runtimeResponse },
];

for (const { name, ref, data } of cases) {
  test(`${name} fixture matches backend/admin contract`, () => {
    const validate = ajv.getSchema(
      `https://collectool.local/schemas/api-contracts.schema.json#/$defs/${ref}`
    );

    expect(validate).toBeDefined();
    expect(validate && validate(data)).toBe(true);
  });
}
