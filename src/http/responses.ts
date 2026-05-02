'use strict';

function json(statusCode, payload, headers = {}) {
  return {
    statusCode,
    headers: {
      'content-type': 'application/json',
      ...headers,
    },
    body: JSON.stringify(payload),
  };
}

function error(statusCode, message, details = {}) {
  return json(statusCode, { message, ...details });
}

module.exports = { error, json };
