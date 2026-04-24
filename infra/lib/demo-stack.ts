import * as cdk from "aws-cdk-lib";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as cloudfront from "aws-cdk-lib/aws-cloudfront";
import * as origins from "aws-cdk-lib/aws-cloudfront-origins";
import * as acm from "aws-cdk-lib/aws-certificatemanager";
import * as route53 from "aws-cdk-lib/aws-route53";
import * as route53Targets from "aws-cdk-lib/aws-route53-targets";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as nodejs from "aws-cdk-lib/aws-lambda-nodejs";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as secretsmanager from "aws-cdk-lib/aws-secretsmanager";
import * as iam from "aws-cdk-lib/aws-iam";
import * as path from "path";
import { Construct } from "constructs";

export interface DemoStackProps extends cdk.StackProps {
  stage: string;
}

export class DemoStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: DemoStackProps) {
    super(scope, id, props);

    const prefix = `mentedb-${props.stage}`;

    // --- DNS (import existing hosted zone + wildcard cert) ---
    const hostedZoneId = process.env.HOSTED_ZONE_ID;
    if (!hostedZoneId) {
      throw new Error("HOSTED_ZONE_ID environment variable is required");
    }
    const hostedZone = route53.HostedZone.fromHostedZoneAttributes(
      this,
      "HostedZone",
      {
        hostedZoneId,
        zoneName: "mentedb.com",
      }
    );

    const certArn = process.env.WILDCARD_CERT_ARN;
    if (!certArn) {
      throw new Error("WILDCARD_CERT_ARN environment variable is required");
    }
    const certificate = acm.Certificate.fromCertificateArn(
      this,
      "WildcardCert",
      certArn
    );

    // --- Secrets Manager ---
    const apiSecrets = new secretsmanager.Secret(this, "DemoApiSecrets", {
      secretName: `${prefix}/demo/api-keys`,
      description: "MenteDB API key for demo (no Anthropic key needed — uses Bedrock via IAM)",
    });

    // --- Rate Limit Table ---
    const rateLimitTable = new dynamodb.Table(this, "DemoRateLimit", {
      tableName: `${prefix}-demo-rate-limit`,
      partitionKey: { name: "pk", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      timeToLiveAttribute: "ttl",
    });

    // --- Lambda ---
    const demoDomain =
      props.stage === "prod"
        ? "https://demo.mentedb.com"
        : "http://localhost:5173";

    const repoRoot = path.resolve(__dirname, "../..");

    const demoFn = new nodejs.NodejsFunction(this, "DemoApiFunction", {
      functionName: `${prefix}-demo-api`,
      runtime: lambda.Runtime.NODEJS_22_X,
      architecture: lambda.Architecture.X86_64,
      entry: path.join(repoRoot, "lambda/demo/index.ts"),
      projectRoot: repoRoot,
      depsLockFilePath: path.join(repoRoot, "lambda/demo/package-lock.json"),
      handler: "handler",
      memorySize: 512,
      timeout: cdk.Duration.seconds(60),
      environment: {
        SECRET_ARN: apiSecrets.secretArn,
        RATE_LIMIT_TABLE: rateLimitTable.tableName,
        MENTEDB_API_URL: "https://api.mentedb.com",
        ALLOWED_ORIGIN: demoDomain,
      },
      bundling: {
        minify: true,
        sourceMap: true,
        target: "node22",
        format: nodejs.OutputFormat.ESM,
        mainFields: ["module", "main"],
        externalModules: ["@aws-sdk/*"],
      },
    });

    apiSecrets.grantRead(demoFn);
    rateLimitTable.grantReadWriteData(demoFn);

    // Grant Bedrock invoke permission (Claude Haiku 4.5 via cross-region inference)
    demoFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["bedrock:InvokeModel"],
        resources: [
          `arn:aws:bedrock:*::foundation-model/anthropic.claude-haiku-4-5-20251001-v1:0`,
          `arn:aws:bedrock:*:${this.account}:inference-profile/us.anthropic.claude-haiku-4-5-20251001-v1:0`,
        ],
      })
    );

    const fnUrl = demoFn.addFunctionUrl({
      authType: lambda.FunctionUrlAuthType.NONE,
      invokeMode: lambda.InvokeMode.RESPONSE_STREAM,
      cors: {
        allowedOrigins: [demoDomain],
        allowedMethods: [
          lambda.HttpMethod.POST,
          lambda.HttpMethod.GET,
        ],
        allowedHeaders: ["content-type"],
        maxAge: cdk.Duration.hours(1),
      },
    });

    // --- S3 ---
    const demoBucket = new s3.Bucket(this, "DemoBucket", {
      bucketName: `${prefix}-demo-frontend`,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    const oac = new cloudfront.S3OriginAccessControl(this, "DemoOAC", {
      signing: cloudfront.Signing.SIGV4_ALWAYS,
    });

    // --- CloudFront ---
    const demoDomainName =
      props.stage === "prod" ? "demo.mentedb.com" : `demo-${props.stage}.mentedb.com`;

    const securityHeaders = new cloudfront.ResponseHeadersPolicy(
      this,
      "DemoSecurityHeaders",
      {
        securityHeadersBehavior: {
          strictTransportSecurity: {
            accessControlMaxAge: cdk.Duration.days(365),
            includeSubdomains: true,
            override: true,
          },
          contentTypeOptions: { override: true },
          frameOptions: {
            frameOption: cloudfront.HeadersFrameOption.DENY,
            override: true,
          },
        },
      }
    );

    const distribution = new cloudfront.Distribution(this, "DemoDistribution", {
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessControl(demoBucket, {
          originAccessControl: oac,
        }),
        viewerProtocolPolicy:
          cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        responseHeadersPolicy: securityHeaders,
        cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
      },
      additionalBehaviors: {
        "/api/*": {
          origin: new origins.FunctionUrlOrigin(fnUrl),
          viewerProtocolPolicy:
            cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
          cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
          originRequestPolicy:
            cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
        },
      },
      domainNames: [demoDomainName],
      certificate,
      defaultRootObject: "index.html",
      errorResponses: [
        {
          httpStatus: 404,
          responseHttpStatus: 200,
          responsePagePath: "/index.html",
          ttl: cdk.Duration.seconds(0),
        },
        {
          httpStatus: 403,
          responseHttpStatus: 200,
          responsePagePath: "/index.html",
          ttl: cdk.Duration.seconds(0),
        },
      ],
    });

    // --- Route53 ---
    new route53.ARecord(this, "DemoAliasRecord", {
      zone: hostedZone,
      recordName: demoDomainName,
      target: route53.RecordTarget.fromAlias(
        new route53Targets.CloudFrontTarget(distribution)
      ),
    });

    // --- Outputs ---
    new cdk.CfnOutput(this, "DistributionDomainName", {
      value: distribution.distributionDomainName,
    });
    new cdk.CfnOutput(this, "BucketName", {
      value: demoBucket.bucketName,
    });
    new cdk.CfnOutput(this, "FunctionUrl", {
      value: fnUrl.url,
    });
    new cdk.CfnOutput(this, "SecretArn", {
      value: apiSecrets.secretArn,
    });
  }
}
