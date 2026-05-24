'use strict';

const {
  CreateTableCommand,
  DescribeTableCommand,
  DynamoDBClient,
  waitUntilTableExists,
} = require('@aws-sdk/client-dynamodb');
const { applyLocalDefaults } = require('./env');

applyLocalDefaults();

const client = new DynamoDBClient({
  endpoint: process.env.DYNAMODB_ENDPOINT,
  region: process.env.AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

const tableDefinitions = [
  {
    TableName: process.env.CATEGORIES_TABLE,
    AttributeDefinitions: [{ AttributeName: 'id', AttributeType: 'S' }],
    KeySchema: [{ AttributeName: 'id', KeyType: 'HASH' }],
    BillingMode: 'PAY_PER_REQUEST',
  },
  {
    TableName: process.env.ENTITIES_TABLE,
    AttributeDefinitions: [{ AttributeName: 'id', AttributeType: 'S' }],
    KeySchema: [{ AttributeName: 'id', KeyType: 'HASH' }],
    BillingMode: 'PAY_PER_REQUEST',
  },
  {
    TableName: process.env.FLOWS_TABLE,
    AttributeDefinitions: [
      { AttributeName: 'category_id', AttributeType: 'S' },
      { AttributeName: 'flow_key', AttributeType: 'S' },
    ],
    KeySchema: [
      { AttributeName: 'category_id', KeyType: 'HASH' },
      { AttributeName: 'flow_key', KeyType: 'RANGE' },
    ],
    BillingMode: 'PAY_PER_REQUEST',
  },
];

async function tableExists(tableName) {
  try {
    await client.send(new DescribeTableCommand({ TableName: tableName }));
    return true;
  } catch (err) {
    if (err.name === 'ResourceNotFoundException') {
      return false;
    }
    throw err;
  }
}

async function ensureTable(definition) {
  if (await tableExists(definition.TableName)) {
    console.info(`local table exists: ${definition.TableName}`);
    return;
  }

  console.info(`creating local table: ${definition.TableName}`);
  await client.send(new CreateTableCommand(definition));
  await waitUntilTableExists(
    { client, maxWaitTime: 20 },
    { TableName: definition.TableName }
  );
}

async function main() {
  for (const definition of tableDefinitions) {
    await ensureTable(definition);
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
