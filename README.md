# SAR-cloudwatch-alarms-macro

[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](LICENSE)
[![CircleCI](https://circleci.com/gh/lumigo/SAR-cloudwatch-alarms-macro.svg?style=svg)](https://circleci.com/gh/lumigo/SAR-cloudwatch-alarms-macro)

This SAR app deploys a CloudFormation macro for auto-generating CloudWatch alarms based on your configuration.

When applied to a CloudFormation stack, the macro would scan the resources in the stack, and generate corresponding alarms. The macro supports the following resource types:

* Lambda
* SQS
* API Gateway
* Step Functions

You can control `what` alarms are created and their `threshold` values using a combination of two configurations:

* A `default` configuration that defines the organization-wide convention. E.g. every Lambda function should have an error rate alarm at 1%.

* An **optional** `override` configuration that overrides the default configuration for specific resources in a CloudFormation stack. E.g. do not generate throttle count alarm for the `ThrottleAlot` Lambda function in this stack.

Both configurations need to be configured in SSM parameter store.

The full schema for both `default` and `override` configurations can be found [here](/src/lib/config/schema.js).

## Configurations

### SNS topic

To inform the macro what SNS topic to use for the alarm action, you need to specify a `MacroParamTopicArn` parameter in the stack you wish to deploy.

For example:

```yml
Parameters:
  MacroParamTopicArn:
    Type: String
    Description: The ARN of the SNS topic to use in the alarms.
    Default: arn:sns:...
```

### Default Configuration

The location of the `default` configuration is specified when you deploy the SAR app, via the `DefaultConfigParamName` parameter. This should point to a `String` paramter in SSM paramter store. 

You can see an example `default` config below.

<details>
<summary><b>example default configuration</b></summary><p>

```json
{
  "lambda": {
    "errorRate": {
      "threshold": 0.01,
      "evaluationPeriods": 5,
      "enabled": true
    },
    "throttleCount": {
      "threshold": 1,
      "evaluationPeriods": 1,
      "enabled": true
    },
    "dlqErrorCount": {
      "threshold": 1,
      "evaluationPeriods": 1,
      "enabled": true
    },
    "iteratorAge": {
      "threshold": 60000,
      "evaluationPeriods": 5,
      "enabled": true
    }
  },
  "sqs": {
    "messageAge": {
      "threshold": 600000,
      "evaluationPeriods": 1,
      "enabled": true
    }
  },
  "apiGateway": {
    "p90": {
      "threshold": 1000,
      "evaluationPeriods": 5,
      "enabled": true
    },
    "p95": {
      "threshold": 3000,
      "evaluationPeriods": 5,
      "enabled": true
    },
    "p99": {
      "threshold": 5000,
      "evaluationPeriods": 5,
      "enabled": true
    },
    "status4xxRate": {
      "threshold": 0.05,
      "evaluationPeriods": 5,
      "enabled": true
    },
    "status5xxRate": {
      "threshold": 0.01,
      "evaluationPeriods": 5,
      "enabled": true
    },
    "status2xxRate": {
      "threshold": 0.99,
      "evaluationPeriods": 5,
      "enabled": true
    }
  },
  "stepFunctions": {
    "failedCount": {
      "threshold": 1,
      "evaluationPeriods": 1,
      "enabled": true
    },
    "throttleCount": {
      "threshold": 1,
      "evaluationPeriods": 1,
      "enabled": true
    },
    "timedOutCount": {
      "threshold": 1,
      "evaluationPeriods": 1,
      "enabled": true
    }
  }
}
```

</p></details>

### Override Configuration

The location of the `override` configuration is specified in the CloudFormation stack you wish to deploy. You will need to specify a `MacroParamOverrideConfigParamName` parameter in the stack, which points to a `String` paramter in SSM paramter store.

For example:

```yml
Parameters:
  MacroParamOverrideConfigParamName:
    Type: String
    Description: The name of the SSM parameter with the override config.
    Default: /alarms-demo/dev/overrideConfig
```

You can see an example `override` config below.

<details>
<summary><b>example override configuration</b></summary><p>

```json
{
  "lambdaFunctions": [
    {
      "logicalId": "HelloLambdaFunction",
      "errorRate": {
        "threshold": 0.05,
        "evaluationPeriods": 5,
        "enabled": true
      },
      "throttleCount": {
        "enabled": false
      }
    },
    {
      "functionName": "hello-function",
      "errorRate": {
        "enabled": false
      }
    }
  ],
  "sqsQueues": [
    {
      "logicalId": "MyQueue",
      "messageAge": {
        "threshold": 300000,
        "evaluationPeriods": 1,
        "enabled": true
      }
    },
    {
      "queueName": "my-other-queue",
      "messageAge": {
        "enabled": false
      }
    }
  ],
  "apiGatewayPaths": [
    {
      "path": "/",
      "p90": {
        "enabled": false
      },
      "p95": {
        "enabled": false
      }
    }
  ],
  "stepFunctions": [
    {
      "logicalId": "MyStateMachine",
      "failedCount": {
        "threshold": 3,
        "evaluationPeriods": 1,
        "enabled": true
      }
    },
    {
      "stateMachineName": "my-state-machine",
      "failedCount": {
        "enabled": false
      },
      "throttleCount": {
        "enabled": false
      }
    }
  ]
}
```

</p></details>

## Deployment

### Deploying to your account (via the console)

Go to this [page](https://serverlessrepo.aws.amazon.com/applications/arn:aws:serverlessrepo:us-east-1:374852340823:applications~cloudwatch-alarms-macro) and click the `Deploy` button.

### Deploying via SAM/Serverless framework/CloudFormation

To deploy this app via SAM, you need something like this in the CloudFormation template:

```yml
AutoDeployMyAwesomeLambdaLayer:
  Type: AWS::Serverless::Application
  Properties:
    Location:
      ApplicationId: arn:aws:serverlessrepo:us-east-1:374852340823:applications/cloudwatch-alarms-macro
      SemanticVersion: <enter latest version>
    Parameters:
      DefaultConfigParamName: <SSM param key for the default config>
      MacroName: <optional, name of the macro>
```

To do the same via CloudFormation or the Serverless framework, you need to first add the following `Transform`:

```yml
Transform: AWS::Serverless-2016-10-31
```

For more details, read this [post](https://theburningmonk.com/2019/05/how-to-include-serverless-repository-apps-in-serverless-yml/).

### Parameters

`DefaultConfigParamName`: This is the name of the SSM parameter of the default configuration. e.g. `/alarms/defaultConfig`.

`MacroName`: Optional. The name of the macro that is created. This is the name you will include in the `Transform` clause. By default, the SAR app calls the macro `AddCloudWatchAlarms`.
