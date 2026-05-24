'use strict';

function applyLocalDefaults() {
  process.env.ENVIRONMENT ||= 'local';
  process.env.AWS_REGION ||= 'us-east-1';
  process.env.AWS_ACCESS_KEY_ID ||= 'local';
  process.env.AWS_SECRET_ACCESS_KEY ||= 'local';
  process.env.DYNAMODB_ENDPOINT ||= 'http://localhost:8000';
  process.env.CATEGORIES_TABLE ||= 'collectool-local-collection-categories';
  process.env.ENTITIES_TABLE ||= 'collectool-local-collection-entities';
  process.env.FLOWS_TABLE ||= 'collectool-local-collection-flows';
  process.env.ADMIN_USER_POOL_ID ||= 'collectool-local-admin-users';
  process.env.ADMIN_USER_POOL_CLIENT_ID ||= 'collectool-local-admin-web';
  process.env.APP_USER_POOL_ID ||= 'collectool-local-app-users';
  process.env.METRICS_USER_SCAN_LIMIT ||= '250';
  process.env.SEED_INITIAL_DATA ||= 'true';
  process.env.LOCAL_AWS_MOCKS ||= 'true';
  process.env.LOCAL_FAKE_AUTH ||= 'true';
  process.env.LOCAL_FAKE_ACCESS_TOKEN ||= 'mock-admin-access-token';
  process.env.LOCAL_FAKE_ADMIN_EMAIL ||= 'admin@collectool.local';
  process.env.LOCAL_FAKE_ADMIN_NAME ||= 'Mock Admin';
}

module.exports = { applyLocalDefaults };
