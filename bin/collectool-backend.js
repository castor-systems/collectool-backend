#!/usr/bin/env node

const cdk = require('aws-cdk-lib');
const { CollectoolBackendStack } = require('../lib/collectool-backend-stack');

const app = new cdk.App();
const environment = app.node.tryGetContext('environment') || process.env.DEPLOY_ENV || 'dev';

new CollectoolBackendStack(app, `CollectoolBackendStack-${environment}`, {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION || process.env.AWS_REGION || 'us-east-1',
  },
});
