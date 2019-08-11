const log = require("@dazn/lambda-powertools-logger");
const _ = require("lodash");

const { BaseTarget } = require("./baseTarget");

class StepFunctions extends BaseTarget {
	constructor () {
		super("AWS::StepFunctions::StateMachine");
	}
  
	getConfig(logicalId, resource, defaultConfig, overrideConfig) {
		const config = _.cloneDeep(defaultConfig.stepFunctions);
		const override = _.get(overrideConfig, "stepFunctions", []).find(
			x => x.logicalId === logicalId || x.stateMachineName === resource.Properties.StateMachineName
		);
  
		return _.merge(config, override || {});
	}
  
	createAlarmsFor(logicalId, _resource, config) {
		const alarms = {};
		const stackParams = {};
		const stackParamValues = {};
  
		// for each state machine, we will need to define two params for the nested stack
		const stateMachineNameParam = `${logicalId}Name`;
		const stateMachineArnParam = `${logicalId}Arn`;
  
		stackParams[stateMachineNameParam] = {
			Type: "String",
			Description: `Name of the state machine identified as ${logicalId} in the parent stack`
		};
		stackParams[stateMachineArnParam] = {
			Type: "String",
			Description: `ARN of the state machine identified as ${logicalId} in the parent stack`
		};
  
		// their values need to be provided by the parent stack
		stackParamValues[stateMachineNameParam] = {
			"Fn::GetAtt": [logicalId, "Name"]
		};
		stackParamValues[stateMachineArnParam] = {
			Ref: logicalId
		};
  
		// the alarms would need to reference them
		const name = { Ref: stateMachineNameParam };
		const arn = { Ref: stateMachineArnParam };
  
		if (_.get(config, "failedCount.enabled", false)) {
			log.debug("generating step functions failed count alarm...", { logicalId });
			const failedAlarm = generateAlarm(arn, name, "ExecutionsFailed", config.failedCount);
        
			alarms[`${logicalId}FailedCountAlarm`] = failedAlarm;
		}
    
		if (_.get(config, "throttleCount.enabled", false)) {
			log.debug("generating step functions throttle count alarm...", { logicalId });
			const throttleAlarm = generateAlarm(arn, name, "ExecutionThrottled", config.throttleCount);
			alarms[`${logicalId}ThrottleCountAlarm`] = throttleAlarm;
		}
    
		if (_.get(config, "timedOutCount.enabled", false)) {
			log.debug("generating step functions time out count alarm...", { logicalId });
			const timeoutAlarm = generateAlarm(arn, name, "ExecutionsTimedOut", config.timedOutCount);
			alarms[`${logicalId}TimeOutCountAlarm`] = timeoutAlarm;
		}
    
		return { alarms, stackParams, stackParamValues };
	}
}

function generateAlarm(stateMachineArn, stateMachineName, metricName, { threshold, evaluationPeriods }) {
	const alarmName = {
		"Fn::Sub": [
			`State Machine [\${stateMachineName}]: ${metricName} > ${threshold} in the last ${evaluationPeriods} minute`,
			{
				stateMachineName
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
			Dimensions: [{ Name: "StateMachineArn", Value: stateMachineArn }],
			MetricName: metricName,
			Namespace: "AWS/States",
			Statistic: "Sum",
			EvaluationPeriods: evaluationPeriods,
			Period: 60,
			Threshold: threshold
		}
	};
}

module.exports = {
	StepFunctions
};
