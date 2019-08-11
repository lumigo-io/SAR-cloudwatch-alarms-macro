const log = require("@dazn/lambda-powertools-logger");
const _ = require("lodash");
const Path = require("path");
const { BaseTarget } = require("./baseTarget");
const { createNestedStack } = require("./nestedStack");

const RESOURCE_TYPE = "AWS::ApiGateway::RestApi";

class ApiGateway extends BaseTarget {
	constructor() {
		super("AWS::ApiGateway::RestApi");
	}
  
	async createAlarms(fragment, defaultConfig, overrideConfig = {}) {
		const resource = findApiGatewayResource(fragment);
		if (!resource) {
			return null;
		}
    
		const alarms = {};
		// use the physical name if it's specified
		const physicalName = _.get(resource, "Properties.Name");
    
		// for each function, we will need to define a couple of params for the nested stack
		const stackParams = {
			TopicArn: {
				Type: "String",
				Description: "The ARN for the SNS topic for the CloudWatch Alarms"
			},
			Stage: {
				Type: "String",
				Description: "The name of the API Gateway deployment stage"
			},
			ApiName: {
				Type: "String",
				Description: "The name of the API"
			}
		};
    
		// their values need to be provided by the parent stack
		const stackParamValues = {
			TopicArn: {
				Ref: "MacroParamTopicArn"
			},
			Stage: {
				Ref: "MacroParamStage"
			},
			ApiName: physicalName || { Ref: "AWS::StackName" }
		};
    
		// the alarm would need to reference them
		const apiName = { Ref: "ApiName" };
		const stage = { Ref: "Stage" };
    
		const methods = findApiGatewayPaths(resource, fragment);
		methods.forEach(({ path, method }) => {
			const config = getConfig(path, defaultConfig, overrideConfig);
			const methodAlarms = createAlarmsFor(apiName, stage, path, method, config);
			_.merge(alarms, methodAlarms);
		});
  
		if (_.isEmpty(alarms)) {
			return null;
		}
  
		const nestedStack = await createNestedStack(alarms, stackParams, stackParamValues);
		return nestedStack;
	}
}

function createAlarmsFor(apiName, stage, path, method, config) {
	const pathName = titleCase(path.replace(/[/{}]/g, ""));
	const methodName = titleCase(method);
  
	const alarms = {};
  
	if (_.get(config, "p90.enabled", false)) {
		log.debug("generating API Gateway p90 latency alarm...", { path, method });
		alarms[`${pathName}${methodName}P90LatencyAlarm`] = 
      generateLatencyAlarm(apiName, stage, path, method, "p90", config.p90);
	}
  
	if (_.get(config, "p95.enabled", false)) {
		log.debug("generating API Gateway p95 latency alarm...", { path, method });
		alarms[`${pathName}${methodName}P95LatencyAlarm`] =
      generateLatencyAlarm(apiName, stage, path, method, "p95", config.p95);
	}
  
	if (_.get(config, "p99.enabled", false)) {
		log.debug("generating API Gateway p99 latency alarm...", { path, method });
		alarms[`${pathName}${methodName}P99LatencyAlarm`] =
      generateLatencyAlarm(apiName, stage, path, method, "p99", config.p99);
	}
  
	if (_.get(config, "status4xxRate.enabled", false)) {
		log.debug("generating API Gateway 4xx error rate alarm...", { path, method });
		alarms[`${pathName}${methodName}4xxAlarm`] =
      generate4xxRateAlarm(apiName, stage, path, method, config.status4xxRate);
	}
  
	if (_.get(config, "status5xxRate.enabled", false)) {
		log.debug("generating API Gateway 5xx error rate alarm...", { path, method });
		alarms[`${pathName}${methodName}5xxAlarm`] =
      generate5xxRateAlarm(apiName, stage, path, method, config.status5xxRate);
	}
  
	if (_.get(config, "status2xxRate.enabled", false)) {
		log.debug("generating API Gateway 2xx success rate alarm...", { path, method });
		alarms[`${pathName}${methodName}2xxAlarm`] =
      generate2xxRateAlarm(apiName, stage, path, method, config.status2xxRate);
	}
  
	return alarms;
}

function titleCase(name) {
	return name.charAt(0).toUpperCase() + name.slice(1);
}

// returns [{path, method}, {path, method}]
function findApiGatewayPaths(restApi, fragment) {
	// if Body is defined then we can get the methods and paths from there
	if (restApi.Properties.Body) {
		const paths = Object.keys(restApi.Properties.Body.paths);
		return _.flatMap(paths, path => {
			const methods = Object.keys(restApi.Properties.Body.paths[path]).map(x =>
				x.toUpperCase()
			);
  
			return methods.map(method => ({ path, method }));
		});
	} else {
		const methods = Object.values(fragment.Resources)
			.filter(x => x.Type === "AWS::ApiGateway::Method");
		return methods.map(x => {
			const method = x.Properties.HttpMethod.toUpperCase();
			const path = constructPath(x.Properties.ResourceId, fragment);
      
			return { path, method };
		});
	}	
}

function constructPath(resourceId, fragment, path = "") {
	// when the resource is not the root '/' resource then it'll be a Ref
	// and we have to get the ref'd resource to find its PathPart
	if (resourceId.Ref) {
		const resource = fragment.Resources[resourceId.Ref];
		const parentId = resource.Properties.ParentId;

		// we found the root!
		if (_.get(parentId, "Fn::GetAtt.1") === "RootResourceId") {
			return Path.join("/", resource.Properties.PathPart, path);
		} else {
		// otherwise, keep going
			const newPath = Path.join(resource.Properties.PathPart, path);
			return constructPath(resource.Properties.ParentId, fragment, newPath);
		}
	} else {
		// otherwise, resource Id would be Fn::GetAtt: ["ApiGatewayRestApi", "RootResourceId"]
		// and we've hit the root, and no need to recurse anymore
		return Path.join("/", path);
	}
}

function findApiGatewayResource(fragment) {
	const logicalIds = Object.keys(fragment.Resources);
	const apiGwLogicalId = logicalIds.find(
		logicalId => fragment.Resources[logicalId].Type === RESOURCE_TYPE
	);

	if (!apiGwLogicalId) {
		log.debug("no API, skipped API Gateway alarms...");
		return null;
	}

	log.debug("found API Gateway resource", {		
		resourceType: RESOURCE_TYPE
	});

	return fragment.Resources[apiGwLogicalId];
}

function getConfig(path, defaultConfig, overrideConfig) {
	const config = _.cloneDeep(defaultConfig.apiGateway);
	const override = _.get(overrideConfig, "apiGatewayPaths", []).find(
		x => x.path === path
	);

	return _.merge(config, override || {});
}

function generateLatencyAlarm(apiName, stage, path, method, percentile, { threshold, evaluationPeriods }) {
	const alarmName = {
		"Fn::Sub": [
			`API Gateway [${method}:\${apiName}${path}]: ${percentile} latency > ${threshold}ms over the last ${evaluationPeriods} mins`,
			{ apiName }
		]
	};

	return {
		Type: "AWS::CloudWatch::Alarm",
		Properties: {
			AlarmActions: [BaseTarget.TOPIC_ARN_PARAM],
			AlarmDescription: alarmName,
			AlarmName: alarmName,
			ComparisonOperator: "GreaterThanThreshold",
			Dimensions: [
				{ Name: "ApiName", Value: apiName },
				{ Name: "Resource", Value: path },
				{ Name: "Method", Value: method },
				{ Name: "Stage", Value: stage }
			],
			EvaluationPeriods: evaluationPeriods,
			MetricName: "Latency",
			Namespace: "AWS/ApiGateway",
			Period: 60,
			ExtendedStatistic: percentile.toLowerCase(),
			Threshold: threshold
		}
	};
}

function generate4xxRateAlarm(apiName, stage, path, method, { threshold, evaluationPeriods }) {
	const alarmName = {
		"Fn::Sub": [
			`API Gateway [${method}:\${apiName}${path}]: 4xx rate > ${threshold * 100}% over the last ${evaluationPeriods} mins`,
			{ apiName }
		]
	};
	const dimensions = [
		{ Name: "ApiName", Value: apiName },
		{ Name: "Resource", Value: path },
		{ Name: "Method", Value: method },
		{ Name: "Stage", Value: stage }
	];

	return {
		Type: "AWS::CloudWatch::Alarm",
		Properties: {
			AlarmActions: [BaseTarget.TOPIC_ARN_PARAM],
			AlarmDescription: alarmName,
			AlarmName: alarmName,
			ComparisonOperator: "GreaterThanThreshold",
			Metrics: [
				{
					Id: "count",
					Label: "Count",
					MetricStat: {
						Metric: {
							Dimensions: dimensions,
							MetricName: "Count",
							Namespace: "AWS/ApiGateway"
						},
						Period: 60,
						Stat: "Sum",
						Unit: "Count"
					},
					ReturnData: false
				},
				{
					Id: "error4xx",
					Label: "4XX Error",
					MetricStat: {
						Metric: {
							Dimensions: dimensions,
							MetricName: "4XXError",
							Namespace: "AWS/ApiGateway"
						},
						Period: 60,
						Stat: "Sum",
						Unit: "Count"
					},
					ReturnData: false
				},
				{
					Id: "errorRate",
					Label: "4XX Rate (%)",
					Expression: "error4xx / count",
					ReturnData: true
				}
			],
			EvaluationPeriods: evaluationPeriods,
			Threshold: threshold,
			TreatMissingData: "notBreaching"
		}
	};
}

function generate5xxRateAlarm(apiName, stage, path, method, { threshold, evaluationPeriods }) {
	const alarmName = {
		"Fn::Sub": [
			`API Gateway [${method}:\${apiName}${path}]: 5xx rate > ${threshold * 100}% over the last ${evaluationPeriods} mins`,
			{ apiName }
		]
	};
	const dimensions = [
		{ Name: "ApiName", Value: apiName },
		{ Name: "Resource", Value: path },
		{ Name: "Method", Value: method },
		{ Name: "Stage", Value: stage }
	];

	return {
		Type: "AWS::CloudWatch::Alarm",
		Properties: {
			AlarmActions: [BaseTarget.TOPIC_ARN_PARAM],
			AlarmDescription: alarmName,
			AlarmName: alarmName,
			ComparisonOperator: "GreaterThanThreshold",
			Metrics: [
				{
					Id: "count",
					Label: "Count",
					MetricStat: {
						Metric: {
							Dimensions: dimensions,
							MetricName: "Count",
							Namespace: "AWS/ApiGateway"
						},
						Period: 60,
						Stat: "Sum",
						Unit: "Count"
					},
					ReturnData: false
				},
				{
					Id: "error5xx",
					Label: "5XX Error",
					MetricStat: {
						Metric: {
							Dimensions: dimensions,
							MetricName: "5XXError",
							Namespace: "AWS/ApiGateway"
						},
						Period: 60,
						Stat: "Sum",
						Unit: "Count"
					},
					ReturnData: false
				},
				{
					Id: "errorRate",
					Label: "5XX Rate (%)",
					Expression: "error5xx / count",
					ReturnData: true
				}
			],
			EvaluationPeriods: evaluationPeriods,
			Threshold: threshold,
			TreatMissingData: "notBreaching"
		}
	};
}

function generate2xxRateAlarm(apiName, stage, path, method, { threshold, evaluationPeriods }) {
	const alarmName = {
		"Fn::Sub": [
			`API Gateway [${method}:\${apiName}${path}]: 2xx rate < ${threshold * 100}% over the last ${evaluationPeriods} mins`,
			{ apiName }
		]
	};
	const dimensions = [
		{ Name: "ApiName", Value: apiName },
		{ Name: "Resource", Value: path },
		{ Name: "Method", Value: method },
		{ Name: "Stage", Value: stage }
	];

	return {
		Type: "AWS::CloudWatch::Alarm",
		Properties: {
			AlarmActions: [BaseTarget.TOPIC_ARN_PARAM],
			AlarmDescription: alarmName,
			AlarmName: alarmName,
			ComparisonOperator: "LessThanThreshold",
			Metrics: [
				{
					Id: "count",
					Label: "Count",
					MetricStat: {
						Metric: {
							Dimensions: dimensions,
							MetricName: "Count",
							Namespace: "AWS/ApiGateway"
						},
						Period: 60,
						Stat: "Sum",
						Unit: "Count"
					},
					ReturnData: false
				},
				{
					Id: "error4xx",
					Label: "4XX Error",
					MetricStat: {
						Metric: {
							Dimensions: dimensions,
							MetricName: "4XXError",
							Namespace: "AWS/ApiGateway"
						},
						Period: 60,
						Stat: "Sum",
						Unit: "Count"
					},
					ReturnData: false
				},
				{
					Id: "error5xx",
					Label: "5XX Error",
					MetricStat: {
						Metric: {
							Dimensions: dimensions,
							MetricName: "5XXError",
							Namespace: "AWS/ApiGateway"
						},
						Period: 60,
						Stat: "Sum",
						Unit: "Count"
					},
					ReturnData: false
				},
				{
					Id: "rate2xx",
					Label: "2XX Rate (%)",
					Expression: "(count - error4xx - error5xx) / count",
					ReturnData: true
				}
			],
			EvaluationPeriods: evaluationPeriods,
			Threshold: threshold,
			TreatMissingData: "notBreaching"
		}
	};
}

module.exports = {
	ApiGateway
};
