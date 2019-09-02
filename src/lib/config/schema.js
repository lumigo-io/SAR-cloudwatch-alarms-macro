const Joi = require("@hapi/joi");

const ONE_SEC = 1000;
const ONE_MIN = 60 * ONE_SEC;

const intThreshold = Joi.number()
	.integer()
	.min(1);
const floatThreshold = Joi.number()
	.min(0.0)
	.max(1.0);
const evaluationPeriods = Joi.number()
	.integer()
	.min(1);

const alarm = Joi.object().keys({
	enabled: Joi.boolean().default(false)
});

// LAMBDA configurations

const lambdaErrorRate = alarm.keys({
	threshold: floatThreshold.default(0.01), // 1%
	evaluationPeriods: evaluationPeriods.default(5)
});

const lambdaThrottleCount = alarm.keys({
	threshold: intThreshold.default(1),
	evaluationPeriods: evaluationPeriods.default(1)
});

const lambdaDlqErrorCount = alarm.keys({
	threshold: intThreshold.default(1),
	evaluationPeriods: evaluationPeriods.default(1)
});

const lambdaIteratorAge = alarm.keys({
	threshold: intThreshold.default(ONE_MIN),
	evaluationPeriods: evaluationPeriods.default(5)
});

const lambda = Joi.object().keys({
	errorRate: lambdaErrorRate,
	throttleCount: lambdaThrottleCount,
	dlqErrorCount: lambdaDlqErrorCount,
	iteratorAge: lambdaIteratorAge
});

// SQS configurations

const sqsMessageAge = alarm.keys({
	threshold: intThreshold.default(10 * ONE_MIN),
	evaluationPeriods: evaluationPeriods.default(1)
});

const sqs = Joi.object().keys({
	messageAge: sqsMessageAge
});

// API GATEWAY configurations

const apigwP90 = alarm.keys({
	threshold: intThreshold.default(1 * ONE_SEC),
	evaluationPeriods: evaluationPeriods.default(5)
});

const apigwP95 = alarm.keys({
	threshold: intThreshold.default(3 * ONE_SEC),
	evaluationPeriods: evaluationPeriods.default(5)
});

const apigwP99 = alarm.keys({
	threshold: intThreshold.default(5 * ONE_SEC),
	evaluationPeriods: evaluationPeriods.default(5)
});

const apigwStatus4xxRate = alarm.keys({
	threshold: floatThreshold.default(0.05), // 5%
	evaluationPeriods: evaluationPeriods.default(5)
});

const apigwStatus5xxRate = alarm.keys({
	threshold: floatThreshold.default(0.01), // 1%
	evaluationPeriods: evaluationPeriods.default(5)
});

const apigwStatus2xxRate = alarm.keys({
	threshold: floatThreshold.default(0.99), // 99%
	evaluationPeriods: evaluationPeriods.default(5)
});

const apiGateway = Joi.object().keys({
	p90: apigwP90,
	p95: apigwP95,
	p99: apigwP99,
	status4xxRate: apigwStatus4xxRate,
	status5xxRate: apigwStatus5xxRate,
	status2xxRate: apigwStatus2xxRate
});

// STEP FUNCTIONS configurations

const sfnFailedCount = alarm.keys({
	threshold: intThreshold.default(1),
	evaluationPeriods: evaluationPeriods.default(1)
});

const sfnThrottleCount = alarm.keys({
	threshold: intThreshold.default(1),
	evaluationPeriods: evaluationPeriods.default(1)
});

const sfnTimedOutCount = alarm.keys({
	threshold: intThreshold.default(1),
	evaluationPeriods: evaluationPeriods.default(1)
});

const stepFunctions = alarm.keys({
	failedCount: sfnFailedCount,
	throttleCount: sfnThrottleCount,
	timedOutCount: sfnTimedOutCount
});

const defaultConfigSchema = Joi.object().keys({
	lambda,
	sqs,
	apiGateway,
	stepFunctions
});

const logicalId = Joi.string();
const functionName = Joi.string();
const queueName = Joi.string();
const stateMachineName = Joi.string();
const path = Joi.string();

const overrideConfigSchema = Joi.object().keys({
	lambdaFunctions: Joi.array().items(lambda.keys({ logicalId, functionName }).without("logicalId", "functionName")),
	sqsQueues: Joi.array().items(sqs.keys({ logicalId, queueName }).without("logicalId", "queueName")),
	apiGatewayPaths: Joi.array().items(apiGateway.keys({ path: path.required() })),
	stepFunctions: stepFunctions.keys({ logicalId, stateMachineName }).without("logicalId", "stateMachineName")
});

module.exports = {
	defaultConfigSchema,
	overrideConfigSchema
};
