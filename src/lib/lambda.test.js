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

const { Lambda } = require("./lambda");
const defaultConfig = require("./config/config.example.json");

beforeEach(() => {
	mockPutObject.mockClear();
	mockGetSignedUrl.mockClear();
});

describe("#lambda", () => {
	const lambda = new Lambda();
  
	test("when there are no Lambda functions, it returns no alarms", async () => {
		const nestedStack = await lambda.createAlarms({ Resources: {} }, defaultConfig);
		expect(nestedStack).toBeNull();
		expect(mockPutObject).not.toBeCalled();
	});
  
	describe("given there are 2 Lambda functions", () => {
		let fragment;
    
		beforeEach(() => {
			fragment = {
				Resources: {
					HelloFunction: {
						Type: "AWS::Lambda::Function",
						Properties: {
							FunctionName: "hello",
							DeadLetterConfig: {
								TargetArn: "my-topic-arn"
							}
						}
					},
					WorldFunction: {
						Type: "AWS::Lambda::Function",
						Properties: {
							FunctionName: "world",
							DeadLetterConfig: {
								TargetArn: "my-topic-arn"
							}
						}
					}
				}
			};
		});
    
		const checkNestedStackParameters = (parameters) => {
			expect(Object.keys(parameters)).toHaveLength(3);
			expect(parameters).toHaveProperty("HelloFunctionName");
			expect(parameters).toHaveProperty("WorldFunctionName");
			expect(parameters).toHaveProperty("TopicArn");
		};
    
		const checkNestedStackParameterValues = (values) => {
			expect(Object.keys(values)).toHaveLength(3);

			expect(values).toHaveProperty("HelloFunctionName");
			expect(values.HelloFunctionName).toEqual({
				Ref: "HelloFunction"
			});
      
			expect(values).toHaveProperty("WorldFunctionName");
			expect(values.WorldFunctionName).toEqual({
				Ref: "WorldFunction"
			});
      
			expect(values).toHaveProperty("TopicArn");
			expect(values.TopicArn).toEqual({
				Ref: "MacroParamTopicArn"
			});
		};
    
		test("when there is no override config, it generates four alarms for each function", async () => {
			const nestedStack = await lambda.createAlarms(fragment, defaultConfig);
			expect(nestedStack).not.toBeNull();
			expect(mockPutObject).toBeCalled();
			expect(mockGetSignedUrl).toBeCalled();
      
			const [{ Body, Bucket }] = mockPutObject.mock.calls[0];
			expect(Bucket).toBe(process.env.BUCKET);
			const { Resources, Parameters } = JSON.parse(Body);
      
			checkNestedStackParameters(Parameters);
			checkNestedStackParameterValues(nestedStack.Properties.Parameters);

			const logicalIds = Object.keys(Resources);
			expect(logicalIds).toHaveLength(8);
  
			const expectedLogicalIds = [
				"HelloFunctionErrorRateAlarm",
				"HelloFunctionThrottleCountAlarm",
				"HelloFunctionDlqErrorCountAlarm",
				"HelloFunctionIteratorAgeAlarm",
				"WorldFunctionErrorRateAlarm",
				"WorldFunctionThrottleCountAlarm",
				"WorldFunctionDlqErrorCountAlarm",
				"WorldFunctionIteratorAgeAlarm"
			];
			expect(logicalIds).toEqual(expect.arrayContaining(expectedLogicalIds));
  
			Object.values(Resources).forEach(resource => {
				expect(resource.Type).toBe("AWS::CloudWatch::Alarm");
				expect(resource).toHaveProperty("Properties.AlarmName");
				expect(resource).toHaveProperty("Properties.EvaluationPeriods");
				expect(resource).toHaveProperty("Properties.Threshold");
				expect(resource).toHaveProperty("Properties.AlarmActions", [{ Ref: "TopicArn" }]);
        
				if (!_.has(resource, "Properties.Metrics")) {
					expect(resource).toHaveProperty("Properties.Period", 60);
					expect(resource).toHaveProperty("Properties.Statistic");
				}
			});
		});
    
		test("when the override config disables an alarm, no alarm is generated", async () => {
			const overrideConfig = {
				lambdaFunctions: [
					{
						// HelloFunction should generate only the errorRate alarm
						logicalId: "HelloFunction",
						throttleCount: { enabled: false },
						dlqErrorCount: { enabled: false },
						iteratorAge: { enabled: false }
					},
					{
						// WorldFunction should generate only the throttleCount alarm
						functionName: "world",
						errorRate: { enabled: false },
						dlqErrorCount: { enabled: false },
						iteratorAge: { enabled: false }
					}
				]
			};
  
			const nestedStack = await lambda.createAlarms(fragment, defaultConfig, overrideConfig);
			expect(nestedStack).not.toBeNull();
			expect(mockPutObject).toBeCalled();
			expect(mockGetSignedUrl).toBeCalled();
      
			const [{ Body, Bucket }] = mockPutObject.mock.calls[0];
			expect(Bucket).toBe(process.env.BUCKET);
			const { Resources } = JSON.parse(Body);
  
			const logicalIds = Object.keys(Resources);
			expect(logicalIds).toHaveLength(2);
			const expectedLogicalIds = [
				"HelloFunctionErrorRateAlarm", 
				"WorldFunctionThrottleCountAlarm"
			];
			expect(logicalIds).toEqual(expect.arrayContaining(expectedLogicalIds));
		});
    
		test("when there is no DLQ, no DLQ alarm is generated", async () => {
			delete fragment.Resources.HelloFunction.Properties.DeadLetterConfig;
			delete fragment.Resources.WorldFunction.Properties.DeadLetterConfig;
      
			const nestedStack = await lambda.createAlarms(fragment, defaultConfig);
			expect(nestedStack).not.toBeNull();
			expect(mockPutObject).toBeCalled();
			expect(mockGetSignedUrl).toBeCalled();
      
			const [{ Body, Bucket }] = mockPutObject.mock.calls[0];
			expect(Bucket).toBe(process.env.BUCKET);
			const { Resources, Parameters } = JSON.parse(Body);
      
			checkNestedStackParameters(Parameters);
			checkNestedStackParameterValues(nestedStack.Properties.Parameters);

			const logicalIds = Object.keys(Resources);
			expect(logicalIds).toHaveLength(6);
  
			const expectedLogicalIds = [
				"HelloFunctionErrorRateAlarm",
				"HelloFunctionThrottleCountAlarm",
				"HelloFunctionIteratorAgeAlarm",
				"WorldFunctionErrorRateAlarm",
				"WorldFunctionThrottleCountAlarm",
				"WorldFunctionIteratorAgeAlarm"
			];
			expect(logicalIds).toEqual(expect.arrayContaining(expectedLogicalIds));
		});
	});
});
