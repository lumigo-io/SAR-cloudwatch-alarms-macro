const _ = require("lodash");

const mockPutObject = jest.fn().mockImplementation(() => {
	return {
		promise() {
			return Promise.resolve();
		}
	};
});

const mockGetSignedUrl = jest.fn().mockImplementation(() => {
	return "https://lumigo.io";
});

jest.mock("aws-sdk", () => {
	return {
		S3: jest.fn(() => ({
			putObject: mockPutObject,
			getSignedUrl: mockGetSignedUrl
		}))
	};
});

process.env.BUCKET = "test_bucket";
console.log = jest.fn();

const { ApiGateway } = require("./apiGateway");
const defaultConfig = require("./config/config.example.json");

beforeEach(() => {
	mockPutObject.mockClear();
	mockGetSignedUrl.mockClear();
});

describe("#apigateway", () => {
	const apiGateway = new ApiGateway();
  
	const overrideConfig = {
		apiGatewayPaths: [
			{
				path: "/",
				p90: { enabled: false },
				p99: { enabled: false },
				status4xxRate: { enabled: false },
				status5xxRate: { enabled: false },
			}
		]
	};
  
	test("when there are no APIs, it returns no alarms", async () => {
		const nestedStack = await apiGateway.createAlarms({ Resources: {} }, defaultConfig);
		expect(nestedStack).toBeNull();
		expect(mockPutObject).not.toBeCalled();
	});
  
	describe("#sam", () => {
		const fragment = require("./apiGateway.test.sam.json");

		test("when there is no override config, it generates six alarms for each method and resource", async () => {
			const nestedStack = await apiGateway.createAlarms(fragment, defaultConfig);
			expect(nestedStack).not.toBeNull();
			expect(mockPutObject).toBeCalled();
			expect(mockGetSignedUrl).toBeCalled();
  
			const [{ Body, Bucket }] = mockPutObject.mock.calls[0];
			expect(Bucket).toBe(process.env.BUCKET);
			const { Resources, Parameters } = JSON.parse(Body);
      
			checkNestedStackParameters(Parameters);
			checkNestedStackParameterValues(nestedStack.Properties.Parameters);
      
			const logicalIds = Object.keys(Resources);
			expect(logicalIds).toHaveLength(18);    
      
			checkLogicalIds(logicalIds, "GET");
			checkLogicalIds(logicalIds, "UseruserIdGET");
			checkLogicalIds(logicalIds, "UserordersPOST");
      
			checkAlarms(Resources);
		});
    
		test("when the override config disables an alarm, the alarm is generated", async () => {
			const nestedStack = await apiGateway.createAlarms(fragment, defaultConfig, overrideConfig);
			expect(nestedStack).not.toBeNull();
			expect(mockPutObject).toBeCalled();
			expect(mockGetSignedUrl).toBeCalled();
  
			const [{ Body, Bucket }] = mockPutObject.mock.calls[0];
			expect(Bucket).toBe(process.env.BUCKET);
			const { Resources, Parameters } = JSON.parse(Body);
      
			checkNestedStackParameters(Parameters);
			checkNestedStackParameterValues(nestedStack.Properties.Parameters);

			const logicalIds = Object.keys(Resources);
			expect(logicalIds).toHaveLength(14);
      
			// the root path should only record 2 metrics
			checkLogicalIds(logicalIds, "GET", "P95LatencyAlarm", "2xxAlarm");
			// but all other paths records the whole set
			checkLogicalIds(logicalIds, "UseruserIdGET");
			checkLogicalIds(logicalIds, "UserordersPOST");
      
			checkAlarms(Resources);
		});
	});
  
	describe("#sls", () => {
		const fragment = require("./apiGateway.test.sls.json");
    
		test("when there is no override config, it generates six alarms for each method and resource", async () => {
			const nestedStack = await apiGateway.createAlarms(fragment, defaultConfig);
			expect(nestedStack).not.toBeNull();
			expect(mockPutObject).toBeCalled();
			expect(mockGetSignedUrl).toBeCalled();
      
			const [{ Body, Bucket }] = mockPutObject.mock.calls[0];
			expect(Bucket).toBe(process.env.BUCKET);
			const { Resources, Parameters } = JSON.parse(Body);
      
			checkNestedStackParameters(Parameters);
			checkNestedStackParameterValues(nestedStack.Properties.Parameters);

			const logicalIds = Object.keys(Resources);
			expect(logicalIds).toHaveLength(18);
      
			checkLogicalIds(logicalIds, "GET");
			checkLogicalIds(logicalIds, "UseruserIdGET");
			checkLogicalIds(logicalIds, "UserordersPOST");
  
			checkAlarms(Resources);
		});
    
		test("when the override config disables an alarm, the alarm is generated", async () => {
			const nestedStack = await apiGateway.createAlarms(fragment, defaultConfig, overrideConfig);
			expect(nestedStack).not.toBeNull();
			expect(mockPutObject).toBeCalled();
			expect(mockGetSignedUrl).toBeCalled();
  
			const [{ Body, Bucket }] = mockPutObject.mock.calls[0];
			expect(Bucket).toBe(process.env.BUCKET);
			const { Resources, Parameters } = JSON.parse(Body);
      
			checkNestedStackParameters(Parameters);
			checkNestedStackParameterValues(nestedStack.Properties.Parameters);

			const logicalIds = Object.keys(Resources);
			expect(logicalIds).toHaveLength(14);
  
			// the root path should only record 2 metrics
			checkLogicalIds(logicalIds, "GET", "P95LatencyAlarm", "2xxAlarm");
			// but all other paths records the whole set
			checkLogicalIds(logicalIds, "UseruserIdGET");
			checkLogicalIds(logicalIds, "UserordersPOST");
      
			checkAlarms(Resources);
		});
	});
});

function checkNestedStackParameters(parameters) {
	expect(Object.keys(parameters)).toHaveLength(3);
	expect(parameters).toHaveProperty("Stage");
	expect(parameters).toHaveProperty("ApiName");
	expect(parameters).toHaveProperty("TopicArn");
};

function checkNestedStackParameterValues(values) {
	expect(Object.keys(values)).toHaveLength(3);

	expect(values).toHaveProperty("Stage");
	expect(values.Stage).toEqual({
		Ref: "MacroParamStage"
	});
  
	expect(values).toHaveProperty("ApiName");
	if (values.ApiName.Ref) {  // SAM uses the stackname for API name
		expect(values.ApiName).toEqual({
			Ref: "AWS::StackName"
		});
	} else { // SLS includes the API name in the stack
		expect(values.ApiName).toBe("dev-my-api");
	}
  
	expect(values).toHaveProperty("TopicArn");
	expect(values.TopicArn).toEqual({
		Ref: "MacroParamTopicArn"
	});
};

const defaultSuffixes = [
	"P90LatencyAlarm",
	"P95LatencyAlarm",
	"P99LatencyAlarm",
	"4xxAlarm",
	"5xxAlarm",
	"2xxAlarm"
];

function checkLogicalIds(logicalIds, prefix, ...suffixes) {
	(suffixes || defaultSuffixes)
		.map(x => prefix + x)
		.forEach(logicalId => expect(logicalIds).toContain(logicalId));
};

function checkAlarms(resources) {
	Object.values(resources).forEach(resource => {
		expect(resource.Type).toBe("AWS::CloudWatch::Alarm");
		expect(resource).toHaveProperty("Properties.AlarmName");
		expect(resource).toHaveProperty("Properties.EvaluationPeriods");
		expect(resource).toHaveProperty("Properties.Threshold");
		expect(resource).toHaveProperty("Properties.AlarmActions", [{ Ref: "TopicArn" }]);
    
		if (!_.has(resource, "Properties.Metrics")) {
			expect(resource).toHaveProperty("Properties.Period", 60);
			// latency metrics should have ExtendedStatistic
			expect(resource).toHaveProperty("Properties.ExtendedStatistic");
		}
	});
}
