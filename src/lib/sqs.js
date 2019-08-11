const log = require("@dazn/lambda-powertools-logger");
const _ = require("lodash");

const { BaseTarget } = require("./baseTarget");

class Sqs extends BaseTarget {
	constructor () {
		super("AWS::SQS::Queue");
	}
  
	getConfig(logicalId, resource, defaultConfig, overrideConfig) {
		const config = _.cloneDeep(defaultConfig.sqs);
		const override = _.get(overrideConfig, "sqsQueues", []).find(
			x => x.logicalId === logicalId || x.queueName === resource.Properties.QueueName
		);

		return _.merge(config, override || {});
	}
  
	createAlarmsFor(logicalId, _resource, config) {
		const alarms = {};
		const stackParams = {};
		const stackParamValues = {};
    
		// for each queue, we will need to define a param for the nested stack
		const queueNameParam = `${logicalId}Name`;
    
		stackParams[queueNameParam] = {
			Type: "String",
			Description: `Name of the SQS queue identified as ${logicalId} in the parent stack`
		};
    
		// its value need to be provided by the parent stack
		stackParamValues[queueNameParam] = {
			"Fn::GetAtt": [logicalId, "QueueName"]
		};
    
		// the alarm would need to reference them
		const name = { Ref: queueNameParam };
    
		if (_.get(config, "messageAge.enabled", false)) {
			log.debug("generating SQS mesage age alarm...", { logicalId });
			alarms[`${logicalId}MessageAgeAlarm`] = generateMessageAgeAlarm(name, config.messageAge);
		}
    
		return { alarms, stackParams, stackParamValues };
	}
}

function generateMessageAgeAlarm(queueName, { threshold, evaluationPeriods }) {
	const alarmName = {
		"Fn::Sub": [
			`SQS [\${queueName}]: message age > ${threshold}ms over the last ${evaluationPeriods} mins`,
			{
				queueName
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
			Dimensions: [{ Name: "QueueName", Value: queueName }],
			MetricName: "ApproximateAgeOfOldestMessage",
			Namespace: "AWS/SQS",
			Statistic: "Maximum",
			EvaluationPeriods: evaluationPeriods,
			Period: 60,
			Threshold: threshold
		}
	};
}

module.exports = {
	Sqs
};
