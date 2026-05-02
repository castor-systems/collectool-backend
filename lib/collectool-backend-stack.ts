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
const cloudwatch = require('aws-cdk-lib/aws-cloudwatch');
const cloudfront = require('aws-cdk-lib/aws-cloudfront');
const origins = require('aws-cdk-lib/aws-cloudfront-origins');
const cognito = require('aws-cdk-lib/aws-cognito');
const dynamodb = require('aws-cdk-lib/aws-dynamodb');
const iam = require('aws-cdk-lib/aws-iam');
const lambda = require('aws-cdk-lib/aws-lambda');
const lambdaNodejs = require('aws-cdk-lib/aws-lambda-nodejs');
const logs = require('aws-cdk-lib/aws-logs');
const s3 = require('aws-cdk-lib/aws-s3');
const { NagSuppressions } = require('cdk-nag');

class CollectoolBackendStack extends Stack {
  constructor(scope, id, props = {}) {
    super(scope, id, props);

    const environment =
      this.node.tryGetContext('environment') || process.env.DEPLOY_ENV || 'dev';
    const isProd = environment === 'prod';
    const allowedAdminGroups =
      this.node.tryGetContext('allowedAdminGroups') ||
      process.env.ALLOWED_ADMIN_GROUPS ||
      'admin,collectool-admins';
    const seedInitialData = String(
      this.node.tryGetContext('seedInitialData') ||
        process.env.SEED_INITIAL_DATA ||
        'true'
    );
    const corsAllowedOrigins = (
      this.node.tryGetContext('corsAllowedOrigins') ||
      process.env.CORS_ALLOWED_ORIGINS ||
      'http://localhost:3000'
    )
      .split(',')
      .map((origin) => origin.trim())
      .filter(Boolean);
    const adminGithubRepository =
      this.node.tryGetContext('adminGithubRepository') ||
      process.env.ADMIN_GITHUB_REPOSITORY ||
      'castor-systems/collectool-admin';
    const githubEnvironment =
      environment === 'prod' ? 'production' : 'development';

    const removalPolicy = isProd ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY;
    const pointInTimeRecoverySpecification = {
      pointInTimeRecoveryEnabled: isProd,
    };

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
    const collectoolAdminsGroup = adminUserPool.addGroup(
      'CollectoolAdminsGroup',
      {
        groupName: 'collectool-admins',
        description: 'Collectool admin backoffice users',
        precedence: 2,
      }
    );

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
        requireSymbols: true,
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
      partitionKey: {
        name: 'category_id',
        type: dynamodb.AttributeType.STRING,
      },
      sortKey: { name: 'flow_key', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      pointInTimeRecoverySpecification,
      removalPolicy,
    });

    const apiLogGroup = new logs.LogGroup(this, 'ApiHandlerLogGroup', {
      logGroupName: `/aws/lambda/collectool-${environment}-api`,
      retention: isProd
        ? logs.RetentionDays.ONE_MONTH
        : logs.RetentionDays.ONE_WEEK,
      removalPolicy,
    });
    const apiAccessLogGroup = new logs.LogGroup(this, 'HttpApiAccessLogGroup', {
      logGroupName: `/aws/apigateway/collectool-${environment}-backend`,
      retention: isProd
        ? logs.RetentionDays.ONE_MONTH
        : logs.RetentionDays.ONE_WEEK,
      removalPolicy,
    });
    const adminSiteBucket = new s3.Bucket(this, 'AdminSiteBucket', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      versioned: isProd,
      removalPolicy,
    });
    const adminSiteDistribution = new cloudfront.Distribution(
      this,
      'AdminSiteDistribution',
      {
        comment: `collectool ${environment} admin frontend`,
        defaultRootObject: 'index.html',
        defaultBehavior: {
          origin:
            origins.S3BucketOrigin.withOriginAccessControl(adminSiteBucket),
          allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD_OPTIONS,
          cachedMethods: cloudfront.CachedMethods.CACHE_GET_HEAD_OPTIONS,
          compress: true,
          viewerProtocolPolicy:
            cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          responseHeadersPolicy:
            cloudfront.ResponseHeadersPolicy.SECURITY_HEADERS,
        },
        errorResponses: [
          {
            httpStatus: 403,
            responseHttpStatus: 200,
            responsePagePath: '/index.html',
            ttl: Duration.minutes(5),
          },
          {
            httpStatus: 404,
            responseHttpStatus: 200,
            responsePagePath: '/index.html',
            ttl: Duration.minutes(5),
          },
        ],
        httpVersion: cloudfront.HttpVersion.HTTP2_AND_3,
        minimumProtocolVersion: cloudfront.SecurityPolicyProtocol.TLS_V1_2_2021,
        priceClass: cloudfront.PriceClass.PRICE_CLASS_100,
      }
    );
    const adminSiteUrl = `https://${adminSiteDistribution.distributionDomainName}`;
    const effectiveCorsAllowedOrigins = Array.from(
      new Set([...corsAllowedOrigins, adminSiteUrl])
    );
    const githubOidcProviderArn = `arn:${Stack.of(this).partition}:iam::${Stack.of(this).account}:oidc-provider/token.actions.githubusercontent.com`;
    const adminDeployRole = new iam.Role(this, 'AdminDeployRole', {
      roleName: `collectool-${environment}-admin-github-actions`,
      description: `Deploy collectool-admin static assets for ${environment}.`,
      assumedBy: new iam.WebIdentityPrincipal(githubOidcProviderArn, {
        StringEquals: {
          'token.actions.githubusercontent.com:aud': 'sts.amazonaws.com',
          'token.actions.githubusercontent.com:sub': `repo:${adminGithubRepository}:environment:${githubEnvironment}`,
        },
      }),
    });
    adminDeployRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ['s3:GetBucketLocation', 's3:ListBucket'],
        resources: [adminSiteBucket.bucketArn],
      })
    );
    adminDeployRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ['s3:DeleteObject', 's3:GetObject', 's3:PutObject'],
        resources: [adminSiteBucket.arnForObjects('*')],
      })
    );
    adminDeployRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ['cloudfront:CreateInvalidation'],
        resources: [
          Stack.of(this).formatArn({
            service: 'cloudfront',
            region: '',
            resource: 'distribution',
            resourceName: adminSiteDistribution.distributionId,
          }),
        ],
      })
    );
    adminDeployRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ['cloudformation:DescribeStacks'],
        resources: [
          Stack.of(this).formatArn({
            service: 'cloudformation',
            resource: 'stack',
            resourceName: `${Stack.of(this).stackName}/*`,
          }),
        ],
      })
    );

    const apiHandler = new lambdaNodejs.NodejsFunction(this, 'ApiHandler', {
      functionName: `collectool-${environment}-api`,
      runtime: lambda.Runtime.NODEJS_24_X,
      architecture: lambda.Architecture.ARM_64,
      entry: path.join(process.cwd(), 'src', 'handler.ts'),
      handler: 'handler',
      memorySize: 256,
      timeout: Duration.seconds(15),
      logGroup: apiLogGroup,
      bundling: {
        target: 'node24',
        minify: true,
        sourceMap: true,
        externalModules: [],
      },
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

    new cloudwatch.Alarm(this, 'ApiHandlerErrorsAlarm', {
      alarmName: `collectool-${environment}-api-errors`,
      metric: apiHandler.metricErrors({
        period: Duration.minutes(5),
        statistic: 'sum',
      }),
      threshold: 1,
      evaluationPeriods: isProd ? 1 : 3,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });

    new cloudwatch.Alarm(this, 'ApiHandlerThrottlesAlarm', {
      alarmName: `collectool-${environment}-api-throttles`,
      metric: apiHandler.metricThrottles({
        period: Duration.minutes(5),
        statistic: 'sum',
      }),
      threshold: 1,
      evaluationPeriods: isProd ? 1 : 3,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });

    new cloudwatch.Alarm(this, 'ApiHandlerDurationAlarm', {
      alarmName: `collectool-${environment}-api-duration`,
      metric: apiHandler.metricDuration({
        period: Duration.minutes(5),
        statistic: 'p95',
      }),
      threshold: 10000,
      evaluationPeriods: isProd ? 3 : 6,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
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
        allowOrigins: effectiveCorsAllowedOrigins,
        maxAge: Duration.days(1),
      },
    });
    const defaultStage = httpApi.defaultStage?.node.defaultChild;
    if (defaultStage instanceof apigatewayv2.CfnStage) {
      defaultStage.accessLogSettings = {
        destinationArn: apiAccessLogGroup.logGroupArn,
        format: JSON.stringify({
          requestId: '$context.requestId',
          ip: '$context.identity.sourceIp',
          requestTime: '$context.requestTime',
          httpMethod: '$context.httpMethod',
          routeKey: '$context.routeKey',
          status: '$context.status',
          protocol: '$context.protocol',
          responseLength: '$context.responseLength',
          integrationErrorMessage: '$context.integrationErrorMessage',
        }),
      };
    }

    const integration = new integrations.HttpLambdaIntegration(
      'ApiIntegration',
      apiHandler
    );
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

    NagSuppressions.addResourceSuppressions(
      [adminUserPool, appUserPool],
      [
        {
          id: 'AwsSolutions-COG2',
          reason:
            'MFA is deferred until the product decides the admin/app login UX; Cognito passwords are strong and advanced security/MFA must be enabled intentionally for production.',
        },
        {
          id: 'AwsSolutions-COG8',
          reason:
            'Cognito Plus tier advanced security is intentionally deferred to preserve the low-cost serverless baseline; enable it as a product/security decision for prod.',
        },
      ],
      true
    );
    NagSuppressions.addResourceSuppressions(
      [categoriesTable, entitiesTable, flowsTable],
      [
        {
          id: 'AwsSolutions-DDB3',
          reason:
            'Point-in-time recovery is enabled for prod and intentionally disabled for dev to keep the shared development stack low cost.',
        },
      ],
      true
    );
    NagSuppressions.addResourceSuppressions(
      apiHandler,
      [
        {
          id: 'AwsSolutions-IAM4',
          reason:
            'The Lambda construct attaches AWSLambdaBasicExecutionRole for CloudWatch Logs; business permissions remain scoped explicitly below.',
        },
        {
          id: 'AwsSolutions-IAM5',
          reason:
            'cognito-idp:GetUser uses the caller access token and is not resource-scoped by Cognito; admin Cognito operations are scoped to the app user pool ARN.',
          appliesTo: ['Resource::*'],
        },
      ],
      true
    );
    NagSuppressions.addResourceSuppressions(
      [adminSiteBucket],
      [
        {
          id: 'AwsSolutions-S1',
          reason:
            'CloudFront distribution metrics are enough for the first low-cost admin hosting baseline; S3 server access logs add another bucket and storage cost.',
        },
      ],
      true
    );
    NagSuppressions.addResourceSuppressions(
      adminSiteDistribution,
      [
        {
          id: 'AwsSolutions-CFR1',
          reason:
            'The admin app is internet-facing for authorized administrators; country restrictions are a business/compliance decision and are not required for the first hosted baseline.',
        },
        {
          id: 'AwsSolutions-CFR2',
          reason:
            'AWS WAF is deferred to avoid fixed monthly cost while the admin surface is low-traffic and protected by Cognito; add it when threat model or traffic justifies it.',
        },
        {
          id: 'AwsSolutions-CFR3',
          reason:
            'CloudFront access logs are deferred to keep the admin static hosting baseline low cost; enable them when operational analytics require it.',
        },
        {
          id: 'AwsSolutions-CFR4',
          reason:
            'The distribution enforces TLSv1.2_2021 as the minimum protocol version.',
        },
      ],
      true
    );
    NagSuppressions.addResourceSuppressions(
      adminDeployRole,
      [
        {
          id: 'AwsSolutions-IAM5',
          reason:
            'The GitHub role needs to publish and delete arbitrary static export objects under the dedicated admin site bucket, and CloudFormation stack ARNs include the generated stack id suffix.',
          appliesTo: [
            'Resource::<AdminSiteBucket6BE9C9FA.Arn>/*',
            `Resource::arn:aws:cloudformation:us-east-1:<AWS::AccountId>:stack/CollectoolBackendStack-${environment}/*`,
          ],
        },
      ],
      true
    );
    NagSuppressions.addStackSuppressions(this, [
      {
        id: 'AwsSolutions-APIG4',
        reason:
          'The health check and public published Collection Builder runtime are intentionally unauthenticated; /admin/* routes use Cognito JWT authorization.',
      },
    ]);

    new CfnOutput(this, 'ApiUrl', {
      value: httpApi.apiEndpoint,
      description:
        'Use this value as NEXT_PUBLIC_COLLECTOOL_API_URL in collectool-admin.',
    });
    new CfnOutput(this, 'AdminSiteBucketName', {
      value: adminSiteBucket.bucketName,
      description: 'S3 bucket where collectool-admin static export is synced.',
    });
    new CfnOutput(this, 'AdminSiteDistributionId', {
      value: adminSiteDistribution.distributionId,
      description: 'CloudFront distribution id for admin invalidations.',
    });
    new CfnOutput(this, 'AdminSiteUrl', {
      value: adminSiteUrl,
      description: 'CloudFront URL for collectool-admin.',
    });
    new CfnOutput(this, 'AdminDeployRoleArn', {
      value: adminDeployRole.roleArn,
      description:
        'Use this as AWS_DEPLOY_ROLE_ARN in the collectool-admin GitHub Environment.',
    });
    new CfnOutput(this, 'CategoriesTableName', {
      value: categoriesTable.tableName,
    });
    new CfnOutput(this, 'EntitiesTableName', {
      value: entitiesTable.tableName,
    });
    new CfnOutput(this, 'FlowsTableName', { value: flowsTable.tableName });
    new CfnOutput(this, 'AdminUserPoolId', { value: adminUserPool.userPoolId });
    new CfnOutput(this, 'AdminUserPoolClientId', {
      value: adminUserPoolClient.userPoolClientId,
    });
    new CfnOutput(this, 'AppUserPoolId', { value: appUserPool.userPoolId });
    new CfnOutput(this, 'AppUserPoolClientId', {
      value: appUserPoolClient.userPoolClientId,
    });
    new CfnOutput(this, 'AdminGroupName', { value: adminGroup.groupName });
    new CfnOutput(this, 'CollectoolAdminsGroupName', {
      value: collectoolAdminsGroup.groupName,
    });
    new CfnOutput(this, 'Environment', { value: environment });
  }
}

module.exports = { CollectoolBackendStack };
