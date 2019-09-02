const log = require("@dazn/lambda-powertools-logger");
const _ = require("lodash");

const { BaseTarget } = require("./baseTarget");

class Lambda extends BaseTarget {
	constructor() {
		super("AWS::Lambda::Function");
	}

	getConfig(logicalId, resource, defaultConfig, overrideConfig) {
		const config = _.cloneDeep(defaultConfig.lambda);
		const override = _.get(overrideConfig, "lambdaFunctions", []).find(
			x => x.logicalId === logicalId || x.functionName === resource.Properties.FunctionName
		);

		return _.merge(config, override || {});
	}

	createAlarmsFor(logicalId, resource, config) {
		const alarms = {};
		const stackParams = {};
		const stackParamValues = {};

		// for each function, we will need to define a param for the nested stack
		const functionNameParam = `${logicalId}Name`;

		stackParams[functionNameParam] = {
			Type: "String",
			Description: `Name of the Lambda function identified as ${logicalId} in the parent stack`
		};

		// its value need to be provided by the parent stack
		stackParamValues[functionNameParam] = {
			Ref: logicalId
		};

		// the alarm would need to reference them
		const name = { Ref: functionNameParam };

		if (_.get(config, "errorRate.enabled", false)) {
			log.debug("generating lambda error rate alarm...", { logicalId });
			alarms[`${logicalId}ErrorRateAlarm`] = generateErrorRateAlarm(name, config.errorRate);
		}

		if (_.get(config, "throttleCount.enabled", false)) {
			log.debug("generating lambda throttle count alarms...", { logicalId });
			alarms[`${logicalId}ThrottleCountAlarm`] = generateThrottleCountAlarm(name, config.throttleCount);
		}

		const hasDlq = _.has(resource, "Properties.DeadLetterConfig.TargetArn");
		if (hasDlq && _.get(config, "dlqErrorCount.enabled", false)) {
			log.debug("generating lambda DLQ error count alarms...", { logicalId });
			alarms[`${logicalId}DlqErrorCountAlarm`] = generateDlqErrorCountAlarm(name, config.dlqErrorCount);
		}

		if (_.get(config, "iteratorAge.enabled", false)) {
			log.debug("generating lambda iterator age alarms...", { logicalId });
			alarms[`${logicalId}IteratorAgeAlarm`] = generateIteratorAgeAlarm(name, config.iteratorAge);
		}

		return { alarms, stackParams, stackParamValues };
	}
}

function generateErrorRateAlarm(functionName, { threshold, evaluationPeriods }) {
	const alarmName = {
		"Fn::Sub": [
			`Lambda [\${functionName}]: error rate > ${threshold * 100}% over the last ${evaluationPeriods} mins`,
			{
				functionName
			}
		]
	};

	return {
		Type: "AWS::CloudWatch::Alarm",
		Properties: {
			AlarmActions: [BaseTarget.TOPIC_ARN_PARAM],
			AlarmDescription: alarmName,
			AlarmName: alarmName,
			ComparisonOperator: "GreaterThanThreshold",
			Metrics: [
				{
					Id: "invocations",
					Label: "Invocations",
					MetricStat: {
						Metric: {
							Dimensions: [
								{
									Name: "FunctionName",
									Value: functionName
								}
							],
							MetricName: "Invocations",
							Namespace: "AWS/Lambda"
						},
						Period: 60,
						Stat: "Sum",
						Unit: "Count"
					},
					ReturnData: false
				},
				{
					Id: "errors",
					Label: "Errors",
					MetricStat: {
						Metric: {
							Dimensions: [
								{
									Name: "FunctionName",
									Value: functionName
								}
							],
							MetricName: "Errors",
							Namespace: "AWS/Lambda"
						},
						Period: 60,
						Stat: "Sum",
						Unit: "Count"
					},
					ReturnData: false
				},
				{
					Id: "errorRate",
					Label: "Error Rate (%)",
					Expression: "errors / invocations",
					ReturnData: true
				}
			],
			EvaluationPeriods: evaluationPeriods,
			Threshold: threshold
		}
	};
}

function generateThrottleCountAlarm(functionName, { threshold, evaluationPeriods }) {
	const alarmName = {
		"Fn::Sub": [
			`Lambda [\${functionName}]: throttle count > ${threshold} over the last ${evaluationPeriods} mins`,
			{
				functionName
			}
		]
	};

	return {
		Type: "AWS::CloudWatch::Alarm",
		Properties: {
			AlarmActions: [BaseTarget.TOPIC_ARN_PARAM],
			AlarmDescription: alarmName,
			AlarmName: alarmName,
			ComparisonOperator: "GreaterThanThreshold",
			Dimensions: [{ Name: "FunctionName", Value: functionName }],
			MetricName: "Throttles",
			Namespace: "AWS/Lambda",
			Statistic: "Sum",
			EvaluationPeriods: evaluationPeriods,
			Period: 60,
			Threshold: threshold
		}
	};
}

function generateDlqErrorCountAlarm(functionName, { threshold, evaluationPeriods }) {
	const alarmName = {
		"Fn::Sub": [
			`Lambda [\${functionName}]: DLQ error count > ${threshold} over the last ${evaluationPeriods} mins`,
			{
				functionName
			}
		]
	};

	return {
		Type: "AWS::CloudWatch::Alarm",
		Properties: {
			AlarmActions: [BaseTarget.TOPIC_ARN_PARAM],
			AlarmDescription: alarmName,
			AlarmName: alarmName,
			ComparisonOperator: "GreaterThanThreshold",
			Dimensions: [{ Name: "FunctionName", Value: functionName }],
			MetricName: "DeadLetterErrors",
			Namespace: "AWS/Lambda",
			Statistic: "Sum",
			EvaluationPeriods: evaluationPeriods,
			Period: 60,
			Threshold: threshold
		}
	};
}

function generateIteratorAgeAlarm(functionName, { threshold, evaluationPeriods }) {
	const alarmName = {
		"Fn::Sub": [
			`Lambda [\${functionName}]: iterator age > ${threshold}ms over the last ${evaluationPeriods} mins`,
			{
				functionName
			}
		]
	};

	return {
		Type: "AWS::CloudWatch::Alarm",
		Properties: {
			AlarmActions: [BaseTarget.TOPIC_ARN_PARAM],
			AlarmDescription: alarmName,
			AlarmName: alarmName,
			ComparisonOperator: "GreaterThanThreshold",
			Dimensions: [{ Name: "FunctionName", Value: functionName }],
			MetricName: "IteratorAge",
			Namespace: "AWS/Lambda",
			Statistic: "Maximum",
			EvaluationPeriods: evaluationPeriods,
			Period: 60,
			Threshold: threshold
		}
	};
}

module.exports = {
	Lambda
};
