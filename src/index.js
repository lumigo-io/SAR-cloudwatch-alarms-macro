const log = require("@dazn/lambda-powertools-logger");
const _ = require("lodash");
const AWS = require("aws-sdk");
const SSM = new AWS.SSM();

const Joi = require("@hapi/joi");
const { Lambda } = require("./lib/lambda");
const lambda = new Lambda();
const { Sqs } = require("./lib/sqs");
const sqs = new Sqs();
const { StepFunctions } = require("./lib/stepFunctions");
const stepFunctions = new StepFunctions();
const { ApiGateway } = require("./lib/apiGateway");
const apiGateway = new ApiGateway();
const { defaultConfigSchema, overrideConfigSchema } = require("./lib/config/schema");

const TopicArnParamName = "MacroParamTopicArn";
const OverrideConfigParamName = "MacroParamOverrideConfigParamName";

const { DEFAULT_CONFIG_PARAM_NAME } = process.env;

module.exports.handler = async event => {
	log.debug("received invocation event...", { event });
	const { requestId, fragment } = event;

	validate(fragment.Parameters);

	const defaultConfig = await getDefaultConfig();
	const overrideConfig = await getOverrideConfig(fragment);

	const newFragment = _.cloneDeep(fragment);
	const sfnStack = await stepFunctions.createAlarms(newFragment, defaultConfig, overrideConfig);
	if (sfnStack) {
		newFragment.Resources["NestedStackStepFunctionsAlarms"] = sfnStack;
	}
  
	const sqsStack = await sqs.createAlarms(newFragment, defaultConfig, overrideConfig);
	if (sqsStack) {
		newFragment.Resources["NestedStackSqsAlarms"] = sqsStack;
	}
  
	const lambdaStack = await lambda.createAlarms(newFragment, defaultConfig, overrideConfig);
	if (lambdaStack) {
		newFragment.Resources["NestedStackLambdaAlarms"] = lambdaStack;
	}
  
	const apigwStack = await apiGateway.createAlarms(newFragment, defaultConfig, overrideConfig);
	if (apigwStack) {
		newFragment.Resources["NestedStackApiGatewayAlarms"] = apigwStack;
	}

	log.debug("transformed parent stack", { fragment: newFragment });

	return {
		requestId,
		status: "success",
		fragment: newFragment
	};
};

function validate(parameters) {
	if (!_.has(parameters, TopicArnParamName)) {
		const errorMessage =
      `You must declare a CloudFormation parameter [${TopicArnParamName}]. ` +
      "It should be the ARN to an SNS topic, to be used by the generated CloudWatch alarms.";

		throw new Error(errorMessage);
	}
}

async function getDefaultConfig() {
	log.debug("loading default config...", { paramName: DEFAULT_CONFIG_PARAM_NAME });
	return await loadAndValidateConfig(DEFAULT_CONFIG_PARAM_NAME, defaultConfigSchema);
}

async function getOverrideConfig(fragment) {
	const paramName = _.get(fragment, `Parameter.${OverrideConfigParamName}`);
	if (!paramName) {
		log.debug("no override config parameter is configured, skipped loading override config...");
		return {};
	}

	log.debug("loading override config...", { paramName });
	return await loadAndValidateConfig(paramName, overrideConfigSchema);
}

async function loadAndValidateConfig(paramName, schema) {
	const req = {
		Name: paramName
	};
	const resp = await SSM.getParameter(req).promise();
	const configObj = JSON.parse(resp.Parameter.Value);

	const { error, value } = Joi.validate(configObj, schema, {
		allowUnknown: false
	});
	if (error) {
		throw new Error(`[${paramName}]: config is not valid. ${error}`);
	}

	return value;
}
