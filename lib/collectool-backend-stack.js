'use strict';

const path = require('path');
const {
  CfnOutput,
  Duration,
  RemovalPolicy,
  Stack,
  Tags,
} = require('aws-cdk-lib');
const apigatewayv2 = require('aws-cdk-lib/aws-apigatewayv2');
const authorizers = require('aws-cdk-lib/aws-apigatewayv2-authorizers');
const integrations = require('aws-cdk-lib/aws-apigatewayv2-integrations');
const cognito = require('aws-cdk-lib/aws-cognito');
const dynamodb = require('aws-cdk-lib/aws-dynamodb');
const iam = require('aws-cdk-lib/aws-iam');
const lambda = require('aws-cdk-lib/aws-lambda');
const logs = require('aws-cdk-lib/aws-logs');

class CollectoolBackendStack extends Stack {
  constructor(scope, id, props = {}) {
    super(scope, id, props);

    const environment = this.node.tryGetContext('environment') || process.env.DEPLOY_ENV || 'dev';
    const isProd = environment === 'prod';
    const allowedAdminGroups =
      this.node.tryGetContext('allowedAdminGroups') || process.env.ALLOWED_ADMIN_GROUPS || 'admin,collectool-admins';
    const seedInitialData = String(
      this.node.tryGetContext('seedInitialData') || process.env.SEED_INITIAL_DATA || 'true'
    );
    const corsAllowedOrigins = (
      this.node.tryGetContext('corsAllowedOrigins') ||
      process.env.CORS_ALLOWED_ORIGINS ||
      'http://localhost:3000'
    )
      .split(',')
      .map((origin) => origin.trim())
      .filter(Boolean);

    const removalPolicy = isProd ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY;
    const pointInTimeRecoverySpecification = { pointInTimeRecoveryEnabled: isProd };

    const adminUserPool = new cognito.UserPool(this, 'AdminUserPool', {
      userPoolName: `collectool-${environment}-admin-users`,
      selfSignUpEnabled: false,
      signInAliases: {
        email: true,
        username: true,
      },
      autoVerify: {
        email: true,
      },
      standardAttributes: {
        email: {
          required: true,
          mutable: true,
        },
        fullname: {
          required: false,
          mutable: true,
        },
      },
      passwordPolicy: {
        minLength: 12,
        requireDigits: true,
        requireLowercase: true,
        requireSymbols: true,
        requireUppercase: true,
      },
      accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
      removalPolicy,
    });

    const adminUserPoolClient = adminUserPool.addClient('AdminUserPoolClient', {
      userPoolClientName: `collectool-${environment}-admin-web`,
      disableOAuth: true,
      generateSecret: false,
      authFlows: {
        userPassword: true,
        userSrp: true,
      },
      preventUserExistenceErrors: true,
      accessTokenValidity: Duration.hours(1),
      idTokenValidity: Duration.hours(1),
      refreshTokenValidity: Duration.days(30),
    });

    const adminGroup = adminUserPool.addGroup('AdminGroup', {
      groupName: 'admin',
      description: 'Collectool administrators',
      precedence: 1,
    });
    const collectoolAdminsGroup = adminUserPool.addGroup('CollectoolAdminsGroup', {
      groupName: 'collectool-admins',
      description: 'Collectool admin backoffice users',
      precedence: 2,
    });

    const appUserPool = new cognito.UserPool(this, 'AppUserPool', {
      userPoolName: `collectool-${environment}-app-users`,
      selfSignUpEnabled: true,
      signInAliases: {
        email: true,
        username: true,
      },
      autoVerify: {
        email: true,
      },
      standardAttributes: {
        email: {
          required: true,
          mutable: true,
        },
        fullname: {
          required: false,
          mutable: true,
        },
      },
      passwordPolicy: {
        minLength: 10,
        requireDigits: true,
        requireLowercase: true,
        requireSymbols: false,
        requireUppercase: true,
      },
      accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
      removalPolicy,
    });

    const appUserPoolClient = appUserPool.addClient('AppUserPoolClient', {
      userPoolClientName: `collectool-${environment}-app-web`,
      disableOAuth: true,
      generateSecret: false,
      authFlows: {
        userPassword: true,
        userSrp: true,
      },
      preventUserExistenceErrors: true,
      accessTokenValidity: Duration.hours(1),
      idTokenValidity: Duration.hours(1),
      refreshTokenValidity: Duration.days(30),
    });

    const categoriesTable = new dynamodb.Table(this, 'CategoriesTable', {
      tableName: `collectool-${environment}-collection-categories`,
      partitionKey: { name: 'id', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      pointInTimeRecoverySpecification,
      removalPolicy,
    });

    const entitiesTable = new dynamodb.Table(this, 'EntitiesTable', {
      tableName: `collectool-${environment}-collection-entities`,
      partitionKey: { name: 'id', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      pointInTimeRecoverySpecification,
      removalPolicy,
    });

    const flowsTable = new dynamodb.Table(this, 'FlowsTable', {
      tableName: `collectool-${environment}-collection-flows`,
      partitionKey: { name: 'category_id', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'flow_key', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      pointInTimeRecoverySpecification,
      removalPolicy,
    });

    const apiLogGroup = new logs.LogGroup(this, 'ApiHandlerLogGroup', {
      logGroupName: `/aws/lambda/collectool-${environment}-api`,
      retention: isProd ? logs.RetentionDays.ONE_MONTH : logs.RetentionDays.ONE_WEEK,
      removalPolicy,
    });

    const apiHandler = new lambda.Function(this, 'ApiHandler', {
      functionName: `collectool-${environment}-api`,
      runtime: lambda.Runtime.NODEJS_20_X,
      architecture: lambda.Architecture.ARM_64,
      handler: 'handler.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '..', 'src')),
      memorySize: 256,
      timeout: Duration.seconds(15),
      logGroup: apiLogGroup,
      environment: {
        ENVIRONMENT: environment,
        CATEGORIES_TABLE: categoriesTable.tableName,
        ENTITIES_TABLE: entitiesTable.tableName,
        FLOWS_TABLE: flowsTable.tableName,
        ADMIN_USER_POOL_ID: adminUserPool.userPoolId,
        ADMIN_USER_POOL_CLIENT_ID: adminUserPoolClient.userPoolClientId,
        APP_USER_POOL_ID: appUserPool.userPoolId,
        ALLOWED_ADMIN_GROUPS: allowedAdminGroups,
        METRICS_USER_SCAN_LIMIT: isProd ? '1000' : '250',
        SEED_INITIAL_DATA: seedInitialData,
      },
    });

    categoriesTable.grantReadWriteData(apiHandler);
    entitiesTable.grantReadWriteData(apiHandler);
    flowsTable.grantReadWriteData(apiHandler);
    apiHandler.addToRolePolicy(
      new iam.PolicyStatement({
        actions: [
          'cognito-idp:AdminDisableUser',
          'cognito-idp:AdminEnableUser',
          'cognito-idp:AdminGetUser',
          'cognito-idp:ListUsers',
        ],
        resources: [
          Stack.of(this).formatArn({
            service: 'cognito-idp',
            resource: 'userpool',
            resourceName: appUserPool.userPoolId,
          }),
        ],
      })
    );
    apiHandler.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['cognito-idp:GetUser'],
        resources: ['*'],
      })
    );

    const httpApi = new apigatewayv2.HttpApi(this, 'HttpApi', {
      apiName: `collectool-${environment}-backend`,
      corsPreflight: {
        allowCredentials: true,
        allowHeaders: ['authorization', 'content-type'],
        allowMethods: [
          apigatewayv2.CorsHttpMethod.GET,
          apigatewayv2.CorsHttpMethod.POST,
          apigatewayv2.CorsHttpMethod.PUT,
          apigatewayv2.CorsHttpMethod.OPTIONS,
        ],
        allowOrigins: corsAllowedOrigins,
        maxAge: Duration.days(1),
      },
    });

    const integration = new integrations.HttpLambdaIntegration('ApiIntegration', apiHandler);
    const jwtAuthorizer = new authorizers.HttpJwtAuthorizer(
      'AdminJwtAuthorizer',
      `https://cognito-idp.${Stack.of(this).region}.amazonaws.com/${adminUserPool.userPoolId}`,
      {
        jwtAudience: [adminUserPoolClient.userPoolClientId],
      }
    );

    httpApi.addRoutes({
      path: '/health',
      methods: [apigatewayv2.HttpMethod.GET],
      integration,
    });
    httpApi.addRoutes({
      path: '/admin/{proxy+}',
      methods: [apigatewayv2.HttpMethod.ANY],
      integration,
      authorizer: jwtAuthorizer,
    });
    httpApi.addRoutes({
      path: '/collection-builder/{proxy+}',
      methods: [apigatewayv2.HttpMethod.ANY],
      integration,
    });

    Tags.of(this).add('Application', 'collectool');
    Tags.of(this).add('Environment', environment);
    Tags.of(this).add('CostProfile', 'serverless-on-demand');

    new CfnOutput(this, 'ApiUrl', {
      value: httpApi.apiEndpoint,
      description: 'Use this value as NEXT_PUBLIC_COLLECTOOL_API_URL in collectool-admin.',
    });
    new CfnOutput(this, 'CategoriesTableName', { value: categoriesTable.tableName });
    new CfnOutput(this, 'EntitiesTableName', { value: entitiesTable.tableName });
    new CfnOutput(this, 'FlowsTableName', { value: flowsTable.tableName });
    new CfnOutput(this, 'AdminUserPoolId', { value: adminUserPool.userPoolId });
    new CfnOutput(this, 'AdminUserPoolClientId', { value: adminUserPoolClient.userPoolClientId });
    new CfnOutput(this, 'AppUserPoolId', { value: appUserPool.userPoolId });
    new CfnOutput(this, 'AppUserPoolClientId', { value: appUserPoolClient.userPoolClientId });
    new CfnOutput(this, 'AdminGroupName', { value: adminGroup.groupName });
    new CfnOutput(this, 'CollectoolAdminsGroupName', { value: collectoolAdminsGroup.groupName });
    new CfnOutput(this, 'Environment', { value: environment });
  }
}

module.exports = { CollectoolBackendStack };
