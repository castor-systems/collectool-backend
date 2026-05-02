'use strict';

const path = require('path');
const {
  CfnOutput,
  Duration,
  RemovalPolicy,
  Stack,
  Tags,
} = require('aws-cdk-lib');
const apigateway = require('aws-cdk-lib/aws-apigateway');
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
    super(scope, id, { ...props, analyticsReporting: false });

    const environment =
      this.node.tryGetContext('environment') || process.env.DEPLOY_ENV || 'dev';
    const isProd = environment === 'prod';
    const projectName = 'collectool';
    const resourcePrefix = `${projectName}-${environment}`;
    const adminGroupName = `${resourcePrefix}-admin`;
    const collectoolAdminsGroupName = `${resourcePrefix}-collectool-admins`;
    const allowedAdminGroups =
      this.node.tryGetContext('allowedAdminGroups') ||
      process.env.ALLOWED_ADMIN_GROUPS ||
      `${adminGroupName},${collectoolAdminsGroupName}`;
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
    const applyResourceTags = (resource, name, component) => {
      Tags.of(resource).add('Name', name);
      Tags.of(resource).add('Component', component);
    };

    Tags.of(this).add('Project', projectName);
    Tags.of(this).add('Application', projectName);
    Tags.of(this).add('Environment', environment);
    Tags.of(this).add('ManagedBy', 'aws-cdk');
    Tags.of(this).add('Repository', 'collectool-backend');
    Tags.of(this).add('CostProfile', 'serverless-on-demand');

    const adminUserPool = new cognito.UserPool(this, 'AdminUserPool', {
      userPoolName: `${resourcePrefix}-admin-users`,
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
    applyResourceTags(adminUserPool, `${resourcePrefix}-admin-users`, 'auth');

    const adminUserPoolClient = adminUserPool.addClient('AdminUserPoolClient', {
      userPoolClientName: `${resourcePrefix}-admin-web`,
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
      groupName: adminGroupName,
      description: `Collectool ${environment} administrators`,
      precedence: 1,
    });
    const collectoolAdminsGroup = adminUserPool.addGroup(
      'CollectoolAdminsGroup',
      {
        groupName: collectoolAdminsGroupName,
        description: `Collectool ${environment} admin backoffice users`,
        precedence: 2,
      }
    );

    const appUserPool = new cognito.UserPool(this, 'AppUserPool', {
      userPoolName: `${resourcePrefix}-app-users`,
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
    applyResourceTags(appUserPool, `${resourcePrefix}-app-users`, 'auth');

    const appUserPoolClient = appUserPool.addClient('AppUserPoolClient', {
      userPoolClientName: `${resourcePrefix}-app-web`,
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
      tableName: `${resourcePrefix}-collection-categories`,
      partitionKey: { name: 'id', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      pointInTimeRecoverySpecification,
      removalPolicy,
    });
    applyResourceTags(
      categoriesTable,
      `${resourcePrefix}-collection-categories`,
      'data'
    );

    const entitiesTable = new dynamodb.Table(this, 'EntitiesTable', {
      tableName: `${resourcePrefix}-collection-entities`,
      partitionKey: { name: 'id', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      pointInTimeRecoverySpecification,
      removalPolicy,
    });
    applyResourceTags(
      entitiesTable,
      `${resourcePrefix}-collection-entities`,
      'data'
    );

    const flowsTable = new dynamodb.Table(this, 'FlowsTable', {
      tableName: `${resourcePrefix}-collection-flows`,
      partitionKey: {
        name: 'category_id',
        type: dynamodb.AttributeType.STRING,
      },
      sortKey: { name: 'flow_key', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      pointInTimeRecoverySpecification,
      removalPolicy,
    });
    applyResourceTags(flowsTable, `${resourcePrefix}-collection-flows`, 'data');

    const apiLogGroup = new logs.LogGroup(this, 'ApiHandlerLogGroup', {
      logGroupName: `/aws/lambda/${resourcePrefix}-api`,
      retention: isProd
        ? logs.RetentionDays.ONE_MONTH
        : logs.RetentionDays.ONE_WEEK,
      removalPolicy,
    });
    applyResourceTags(
      apiLogGroup,
      `${resourcePrefix}-api-logs`,
      'observability'
    );
    const apiAccessLogGroup = new logs.LogGroup(this, 'HttpApiAccessLogGroup', {
      logGroupName: `/aws/apigateway/${resourcePrefix}-backend`,
      retention: isProd
        ? logs.RetentionDays.ONE_MONTH
        : logs.RetentionDays.ONE_WEEK,
      removalPolicy,
    });
    applyResourceTags(
      apiAccessLogGroup,
      `${resourcePrefix}-backend-access-logs`,
      'observability'
    );
    const adminSiteBucket = new s3.Bucket(this, 'AdminSiteBucket', {
      bucketName: `${resourcePrefix}-admin-site-${Stack.of(this).account}-${Stack.of(this).region}`,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      versioned: isProd,
      removalPolicy,
    });
    applyResourceTags(
      adminSiteBucket,
      `${resourcePrefix}-admin-site`,
      'admin-frontend'
    );
    const adminSiteOriginAccessControl = new cloudfront.S3OriginAccessControl(
      this,
      'AdminSiteOriginAccessControl',
      {
        originAccessControlName: `${resourcePrefix}-admin-site-oac`,
        description: `CloudFront OAC for ${resourcePrefix} admin site bucket.`,
      }
    );
    const adminSiteDistribution = new cloudfront.Distribution(
      this,
      'AdminSiteDistribution',
      {
        comment: `${resourcePrefix}-admin-frontend`,
        defaultRootObject: 'index.html',
        defaultBehavior: {
          origin: origins.S3BucketOrigin.withOriginAccessControl(
            adminSiteBucket,
            {
              originAccessControl: adminSiteOriginAccessControl,
            }
          ),
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
    applyResourceTags(
      adminSiteDistribution,
      `${resourcePrefix}-admin-frontend`,
      'admin-frontend'
    );
    const adminSiteUrl = `https://${adminSiteDistribution.distributionDomainName}`;
    const effectiveCorsAllowedOrigins = Array.from(
      new Set([...corsAllowedOrigins, adminSiteUrl])
    );
    const githubOidcProviderArn = `arn:${Stack.of(this).partition}:iam::${Stack.of(this).account}:oidc-provider/token.actions.githubusercontent.com`;
    const adminDeployRole = new iam.Role(this, 'AdminDeployRole', {
      roleName: `${resourcePrefix}-admin-github-actions`,
      description: `Deploy collectool-admin static assets for ${environment}.`,
      assumedBy: new iam.WebIdentityPrincipal(githubOidcProviderArn, {
        StringEquals: {
          'token.actions.githubusercontent.com:aud': 'sts.amazonaws.com',
          'token.actions.githubusercontent.com:sub': `repo:${adminGithubRepository}:environment:${githubEnvironment}`,
        },
      }),
    });
    applyResourceTags(
      adminDeployRole,
      `${resourcePrefix}-admin-github-actions`,
      'admin-frontend'
    );
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

    const apiHandlerRole = new iam.Role(this, 'ApiHandlerRole', {
      roleName: `${resourcePrefix}-api-lambda-role`,
      description: `Execution role for the ${resourcePrefix} API Lambda.`,
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName(
          'service-role/AWSLambdaBasicExecutionRole'
        ),
      ],
    });
    applyResourceTags(
      apiHandlerRole,
      `${resourcePrefix}-api-lambda-role`,
      'api'
    );

    const apiHandler = new lambdaNodejs.NodejsFunction(this, 'ApiHandler', {
      functionName: `${resourcePrefix}-api`,
      runtime: lambda.Runtime.NODEJS_24_X,
      architecture: lambda.Architecture.ARM_64,
      role: apiHandlerRole,
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
    applyResourceTags(apiHandler, `${resourcePrefix}-api`, 'api');

    const apiHandlerErrorsAlarm = new cloudwatch.Alarm(
      this,
      'ApiHandlerErrorsAlarm',
      {
        alarmName: `${resourcePrefix}-api-errors`,
        metric: apiHandler.metricErrors({
          period: Duration.minutes(5),
          statistic: 'sum',
        }),
        threshold: 1,
        evaluationPeriods: isProd ? 1 : 3,
        treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      }
    );
    applyResourceTags(
      apiHandlerErrorsAlarm,
      `${resourcePrefix}-api-errors`,
      'api'
    );
    const apiHandlerThrottlesAlarm = new cloudwatch.Alarm(
      this,
      'ApiHandlerThrottlesAlarm',
      {
        alarmName: `${resourcePrefix}-api-throttles`,
        metric: apiHandler.metricThrottles({
          period: Duration.minutes(5),
          statistic: 'sum',
        }),
        threshold: 1,
        evaluationPeriods: isProd ? 1 : 3,
        treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      }
    );
    applyResourceTags(
      apiHandlerThrottlesAlarm,
      `${resourcePrefix}-api-throttles`,
      'api'
    );
    const apiHandlerDurationAlarm = new cloudwatch.Alarm(
      this,
      'ApiHandlerDurationAlarm',
      {
        alarmName: `${resourcePrefix}-api-duration`,
        metric: apiHandler.metricDuration({
          period: Duration.minutes(5),
          statistic: 'p95',
        }),
        threshold: 10000,
        evaluationPeriods: isProd ? 3 : 6,
        treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      }
    );
    applyResourceTags(
      apiHandlerDurationAlarm,
      `${resourcePrefix}-api-duration`,
      'api'
    );

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
      apiName: `${resourcePrefix}-backend`,
      createDefaultStage: false,
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
    applyResourceTags(httpApi, `${resourcePrefix}-backend`, 'api');
    const httpStage = new apigatewayv2.HttpStage(this, 'HttpStage', {
      httpApi,
      stageName: environment,
      autoDeploy: true,
      accessLogSettings: {
        destination: new apigatewayv2.LogGroupLogDestination(apiAccessLogGroup),
        format: apigateway.AccessLogFormat.custom(
          JSON.stringify({
            requestId: '$context.requestId',
            ip: '$context.identity.sourceIp',
            requestTime: '$context.requestTime',
            httpMethod: '$context.httpMethod',
            routeKey: '$context.routeKey',
            status: '$context.status',
            protocol: '$context.protocol',
            responseLength: '$context.responseLength',
            integrationErrorMessage: '$context.integrationErrorMessage',
          })
        ),
      },
    });
    applyResourceTags(
      httpStage,
      `${resourcePrefix}-backend-${environment}`,
      'api'
    );

    const integration = new integrations.HttpLambdaIntegration(
      'ApiIntegration',
      apiHandler
    );
    const jwtAuthorizer = new authorizers.HttpJwtAuthorizer(
      `${resourcePrefix}-admin-jwt-authorizer`,
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
      [apiHandlerRole, apiHandler],
      [
        {
          id: 'AwsSolutions-IAM4',
          reason:
            'The explicit Lambda execution role uses AWSLambdaBasicExecutionRole for CloudWatch Logs; business permissions remain scoped explicitly below.',
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
      value: httpStage.url,
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
