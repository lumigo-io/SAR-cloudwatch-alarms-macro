const uuid = require("uuid/v4");
const log = require("@dazn/lambda-powertools-logger");
const AWS = require("aws-sdk");
const S3 = new AWS.S3();

const { BUCKET } = process.env;

async function createNestedStack(resources, parameters, parameterValues) {
	const nestedStack = {
		AWSTemplateFormatVersion: "2010-09-09",
		Description: "Nested stack with auto-generated Alarms",
		Resources: resources,
		Parameters: parameters
	};
  
	const body = JSON.stringify(nestedStack, undefined, 2);
  
	const s3Key = uuid();
	log.debug(
		"generating nested stack...", 
		{ 
			resourceCount: resources.length,
			parameters,
			key: s3Key,
			bucket: BUCKET,
			body
		});
  
	await S3.putObject({ Bucket: BUCKET, Key: s3Key, Body: body }).promise();
	const url = S3.getSignedUrl("getObject", {
		Bucket: BUCKET,
		Key: s3Key
	});
  
	log.debug("generating nested stack...SUCCESS!", { url, parameterValues });
  
	// resource for the parent stack
	const resource = {
		Type: "AWS::CloudFormation::Stack",
		Properties: {
			TemplateURL: url,
			Parameters: parameterValues
		}
	};
  
	return resource;
}

module.exports = {
	createNestedStack
};
