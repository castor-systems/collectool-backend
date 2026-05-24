'use strict';

const { PutCommand } = require('@aws-sdk/lib-dynamodb');
const { applyLocalDefaults } = require('./env');

applyLocalDefaults();

const { ddb } = require('../repositories/dynamo');
const { buildSeedData } = require('../seed');

async function main() {
  const { category, entity, flow } = buildSeedData();

  await ddb.send(
    new PutCommand({
      TableName: process.env.CATEGORIES_TABLE,
      Item: category,
    })
  );
  await ddb.send(
    new PutCommand({
      TableName: process.env.ENTITIES_TABLE,
      Item: entity,
    })
  );
  await ddb.send(
    new PutCommand({
      TableName: process.env.FLOWS_TABLE,
      Item: {
        category_id: category.id,
        flow_key: 'FLOW#DRAFT',
        flow,
      },
    })
  );

  console.info(
    `local seed loaded into ${process.env.CATEGORIES_TABLE}, ${process.env.ENTITIES_TABLE}, ${process.env.FLOWS_TABLE}`
  );
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
