'use strict';

const cdk = require('aws-cdk-lib');
const { Template, Match } = require('aws-cdk-lib/assertions');
const {
  CollectoolBackendStack,
} = require('../dist/lib/collectool-backend-stack');
const { buildRuntimeResponse, validateFlow } = require('../dist/src/runtime');

function makeStack() {
  const app = new cdk.App({
    context: {
      environment: 'dev',
      corsAllowedOrigins: 'http://localhost:3000',
      seedInitialData: 'false',
    },
  });

  return new CollectoolBackendStack(app, 'TestStack', {
    env: { account: '123456789012', region: 'us-east-1' },
  });
}

function makeStackWithDefaultCors() {
  const app = new cdk.App({
    context: {
      environment: 'dev',
      seedInitialData: 'false',
    },
  });

  return new CollectoolBackendStack(app, 'DefaultCorsTestStack', {
    env: { account: '123456789012', region: 'us-east-1' },
  });
}

function sampleFlow() {
  return {
    id: 'flow-kpop-draft',
    category_id: 'kpop',
    version: 1,
    status: 'DRAFT',
    root_question_ids: ['artist'],
    question_groups: {
      bts_group: {
        id: 'bts_group',
        label: 'BTS details',
        questions: ['member'],
      },
    },
    conditions: [
      {
        id: 'show_bts',
        condition: {
          question_id: 'artist',
          operator: 'EQUALS',
          value: ['bts'],
        },
        actions: [{ type: 'SHOW_QUESTION_GROUP', target: 'bts_group' }],
      },
    ],
    questions: [
      {
        id: 'artist',
        type: 'SINGLE_SELECT',
        label: 'Artist',
        helper_text: '',
        required: true,
        allow_all: false,
        options: [
          {
            id: 'bts',
            label: 'BTS',
            value: 'bts',
            entity_id: 'group-bts',
            tags: ['group:bts'],
          },
          { id: 'txt', label: 'TXT', value: 'txt', tags: ['group:txt'] },
        ],
      },
      {
        id: 'member',
        type: 'MULTI_SELECT',
        label: 'Member',
        helper_text: '',
        required: true,
        allow_all: false,
        options: [
          { id: 'rm', label: 'RM', value: 'rm', tags: ['member:rm'] },
          { id: 'jin', label: 'Jin', value: 'jin', tags: ['member:jin'] },
        ],
      },
    ],
    notes: '',
  };
}

test('CDK stack creates serverless AWS backend resources', () => {
  const template = Template.fromStack(makeStack());

  template.resourceCountIs('AWS::Cognito::UserPool', 2);
  template.resourceCountIs('AWS::Cognito::UserPoolClient', 2);
  template.resourceCountIs('AWS::Cognito::UserPoolGroup', 0);
  template.resourceCountIs('AWS::DynamoDB::Table', 3);
  template.resourceCountIs('AWS::S3::Bucket', 1);
  template.resourceCountIs('AWS::CloudFront::Distribution', 1);
  template.hasResourceProperties('AWS::Cognito::UserPool', {
    UserPoolName: 'collectool-dev-admin-users',
    AliasAttributes: ['email'],
    AutoVerifiedAttributes: ['email'],
  });
  template.hasResourceProperties('AWS::Cognito::UserPoolClient', {
    ExplicitAuthFlows: Match.arrayWith([
      'ALLOW_USER_PASSWORD_AUTH',
      'ALLOW_USER_SRP_AUTH',
    ]),
  });
  template.hasResourceProperties('AWS::Lambda::Function', {
    Runtime: 'nodejs24.x',
    Architectures: ['arm64'],
    Environment: {
      Variables: Match.objectLike({
        ENVIRONMENT: 'dev',
        SEED_INITIAL_DATA: 'false',
      }),
    },
  });
  template.hasResourceProperties('AWS::ApiGatewayV2::Authorizer', {
    Name: 'collectool-dev-admin-jwt-authorizer',
    AuthorizerType: 'JWT',
    IdentitySource: ['$request.header.Authorization'],
  });
  template.hasResourceProperties('AWS::ApiGatewayV2::Route', {
    RouteKey: 'GET /admin/{proxy+}',
    AuthorizationType: 'JWT',
  });
  template.hasResourceProperties('AWS::ApiGatewayV2::Route', {
    RouteKey: 'POST /admin/{proxy+}',
    AuthorizationType: 'JWT',
  });
  template.hasResourceProperties('AWS::ApiGatewayV2::Route', {
    RouteKey: 'PUT /admin/{proxy+}',
    AuthorizationType: 'JWT',
  });
  expect(
    Object.values(template.findResources('AWS::ApiGatewayV2::Route')).map(
      (route) => route.Properties.RouteKey
    )
  ).not.toContain('ANY /admin/{proxy+}');
  template.hasResourceProperties('AWS::ApiGatewayV2::Stage', {
    StageName: 'dev',
    AccessLogSettings: Match.objectLike({
      DestinationArn: {
        'Fn::GetAtt': [Match.stringLikeRegexp('HttpApiAccessLogGroup'), 'Arn'],
      },
    }),
  });
  template.hasResourceProperties('AWS::S3::Bucket', {
    BucketName: 'collectool-dev-admin-site-123456789012-us-east-1',
    Tags: Match.arrayWith([{ Key: 'Project', Value: 'collectool' }]),
  });
  template.hasResourceProperties('AWS::S3::Bucket', {
    BucketName: 'collectool-dev-admin-site-123456789012-us-east-1',
    Tags: Match.arrayWith([{ Key: 'Environment', Value: 'dev' }]),
  });
  template.hasResourceProperties('AWS::S3::Bucket', {
    BucketName: 'collectool-dev-admin-site-123456789012-us-east-1',
    Tags: Match.arrayWith([
      { Key: 'Name', Value: 'collectool-dev-admin-site' },
    ]),
  });
  template.hasResourceProperties('AWS::S3::Bucket', {
    BucketName: 'collectool-dev-admin-site-123456789012-us-east-1',
    Tags: Match.arrayWith([{ Key: 'Component', Value: 'admin-frontend' }]),
  });
  template.hasResourceProperties('AWS::CloudFront::OriginAccessControl', {
    OriginAccessControlConfig: Match.objectLike({
      Name: 'collectool-dev-admin-site-oac',
    }),
  });
  template.hasResourceProperties('AWS::CloudFront::Distribution', {
    DistributionConfig: Match.objectLike({
      Comment: 'collectool-dev-admin-frontend',
      DefaultRootObject: 'index.html',
      PriceClass: 'PriceClass_100',
    }),
  });
  template.hasResourceProperties('AWS::IAM::Role', {
    RoleName: 'collectool-dev-api-lambda-role',
  });
  template.hasResourceProperties('AWS::IAM::Role', {
    RoleName: 'collectool-dev-admin-github-actions',
    AssumeRolePolicyDocument: Match.objectLike({
      Statement: Match.arrayWith([
        Match.objectLike({
          Action: 'sts:AssumeRoleWithWebIdentity',
          Condition: {
            StringEquals: {
              'token.actions.githubusercontent.com:aud': 'sts.amazonaws.com',
              'token.actions.githubusercontent.com:sub':
                'repo:castor-systems/collectool-admin:environment:development',
            },
          },
        }),
      ]),
    }),
  });
});

test('CDK stack leaves admin CORS preflight unauthenticated', () => {
  const template = Template.fromStack(makeStackWithDefaultCors());

  template.hasResourceProperties('AWS::ApiGatewayV2::Api', {
    CorsConfiguration: Match.objectLike({
      AllowCredentials: true,
      AllowHeaders: ['authorization', 'content-type'],
      AllowMethods: ['GET', 'POST', 'PUT', 'OPTIONS'],
      AllowOrigins: Match.arrayWith(['http://localhost:3000']),
    }),
  });
  expect(
    Object.values(template.findResources('AWS::ApiGatewayV2::Route')).map(
      (route) => route.Properties.RouteKey
    )
  ).not.toContain('OPTIONS /admin/{proxy+}');
});

test('runtime computes conditional questions, tags, and completion', () => {
  const response = buildRuntimeResponse(sampleFlow(), {
    artist: 'bts',
    member: ['rm'],
  });

  expect(response.visible_questions.map((question) => question.id)).toEqual([
    'artist',
    'member',
  ]);
  expect(response.tags).toEqual(['group:bts', 'member:rm']);
  expect(response.next_question).toBeNull();
  expect(response.is_complete).toBe(true);
});

test('runtime removes answers for invisible questions', () => {
  const response = buildRuntimeResponse(sampleFlow(), {
    artist: 'txt',
    member: ['rm'],
  });

  expect(response.visible_questions.map((question) => question.id)).toEqual([
    'artist',
  ]);
  expect(response.answers).toEqual({ artist: 'txt' });
  expect(response.tags).toEqual(['group:txt']);
});

test('flow validation catches missing references', () => {
  const flow = sampleFlow();
  flow.root_question_ids = ['missing'];

  expect(validateFlow(flow, [{ id: 'group-bts' }])).toContain(
    'Root question references missing question missing'
  );
});
