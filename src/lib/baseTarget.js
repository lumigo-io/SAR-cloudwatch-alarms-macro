const log = require("@dazn/lambda-powertools-logger");
const _ = require("lodash");
const { createNestedStack } = require("./nestedStack");

class BaseTarget {
	constructor(resourceType) {
		this.resourceType = resourceType;
	}

	static get TOPIC_ARN_PARAM() {
		return { Ref: "TopicArn" };
	}

	async createAlarms(fragment, defaultConfig, overrideConfig = {}) {
		const resources = findResources(fragment, this.resourceType);
		const alarms = {};
		const stackParams = {
			TopicArn: {
				Type: "String",
				Description: "The ARN for the SNS topic for the CloudWatch Alarms"
			}
		};
		const stackParamValues = {
			TopicArn: {
				Ref: "MacroParamTopicArn"
			}
		};

		for (const logicalId of Object.keys(resources)) {
			const resource = resources[logicalId];
			const config = this.getConfig(logicalId, resource, defaultConfig, overrideConfig);
			const res = this.createAlarmsFor(logicalId, resource, config);
			_.merge(alarms, res.alarms);
			_.merge(stackParams, res.stackParams);
			_.merge(stackParamValues, res.stackParamValues);
		}

		if (_.isEmpty(alarms)) {
			return null;
		}

		const nestedStack = await createNestedStack(alarms, stackParams, stackParamValues);
		return nestedStack;
	}

	// eslint-disable-next-line no-unused-vars
	getConfig(logicalId, resource, defaultConfig, overrideConfig) {
		throw new Error("not implemented");
	}

	// eslint-disable-next-line no-unused-vars
	createAlarmsFor(logicalId, config) {
		throw new Error("not implemented");
	}
}

function findResources(fragment, resourceType) {
	const logicalIds = Object.keys(fragment.Resources).filter(
		logicalId => fragment.Resources[logicalId].Type === resourceType
	);

	if (_.isEmpty(logicalIds)) {
		log.debug("no matching resources found, skipped creating alarms...", { resourceType });
		return {};
	}

	log.debug(`found ${logicalIds.length} matching resources`, {
		count: logicalIds.length,
		logicalIds,
		resourceType
	});

	const resources = logicalIds.map(logicalId => fragment.Resources[logicalId]);
	return _.zipObject(logicalIds, resources);
}

module.exports = {
	BaseTarget
};
