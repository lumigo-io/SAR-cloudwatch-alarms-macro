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

const { StepFunctions } = require("./stepFunctions");
const defaultConfig = require("./config/config.example.json");

beforeEach(() => {
	mockPutObject.mockClear();
	mockGetSignedUrl.mockClear();
});

describe("#stepfunctions", () => {
	const sfn = new StepFunctions();
  
	test("given there are no state machines, it returns no alarms", async () => {
		const nestedStack = await sfn.createAlarms({ Resources: {} }, defaultConfig);    
		expect(nestedStack).toBeNull();
		expect(mockPutObject).not.toBeCalled();
	});
  
	describe("given there are 2 state machines", () => {
		const fragment = {
			Resources: {
				HelloStateMachine: {
					Type: "AWS::StepFunctions::StateMachine",
					Properties: {
						StateMachineName: "hello"
					}
				},
				WorldStateMachine: {
					Type: "AWS::StepFunctions::StateMachine",
					Properties: {
						StateMachineName: "world"
					}
				}
			}
		};
    
		const checkNestedStackParameters = (parameters) => {
			expect(Object.keys(parameters)).toHaveLength(5);
      
			expect(parameters).toHaveProperty("HelloStateMachineArn");
			expect(parameters).toHaveProperty("HelloStateMachineName");
			expect(parameters).toHaveProperty("WorldStateMachineArn");
			expect(parameters).toHaveProperty("WorldStateMachineName");
			expect(parameters).toHaveProperty("TopicArn");
		};
    
		const checkNestedStackParameterValues = (values) => {
			expect(Object.keys(values)).toHaveLength(5);
      
			expect(values).toHaveProperty("HelloStateMachineArn");
			expect(values.HelloStateMachineArn).toEqual({
				Ref: "HelloStateMachine"
			});

			expect(values).toHaveProperty("HelloStateMachineName");
			expect(values.HelloStateMachineName).toEqual({
				"Fn::GetAtt": ["HelloStateMachine", "Name"]
			});

			expect(values).toHaveProperty("WorldStateMachineArn");
			expect(values.WorldStateMachineArn).toEqual({
				Ref: "WorldStateMachine"
			});
      
			expect(values).toHaveProperty("WorldStateMachineName");
			expect(values.WorldStateMachineName).toEqual({
				"Fn::GetAtt": ["WorldStateMachine", "Name"]
			});
      
			expect(values).toHaveProperty("TopicArn");
			expect(values.TopicArn).toEqual({
				Ref: "MacroParamTopicArn"
			});
		};
    
		test("when there is no override config, it generates three alarms for each state machine", async () => {
			const nestedStack = await sfn.createAlarms(fragment, defaultConfig);
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
				"HelloStateMachineFailedCountAlarm",
				"HelloStateMachineThrottleCountAlarm",
				"HelloStateMachineTimeOutCountAlarm",
				"WorldStateMachineFailedCountAlarm",
				"WorldStateMachineThrottleCountAlarm",
				"WorldStateMachineTimeOutCountAlarm"
			];
			expect(logicalIds).toEqual(expect.arrayContaining(expectedLogicalIds));
  
			Object.values(Resources).forEach(resource => {
				expect(resource.Type).toBe("AWS::CloudWatch::Alarm");
				expect(resource).toHaveProperty("Properties.AlarmName");
				expect(resource).toHaveProperty("Properties.Period", 60);
				expect(resource).toHaveProperty("Properties.EvaluationPeriods");
				expect(resource).toHaveProperty("Properties.Threshold");
				expect(resource).toHaveProperty("Properties.AlarmActions", [{ Ref: "TopicArn" }]);
				expect(resource).toHaveProperty("Properties.Statistic", "Sum");
			});
		});
    
		test("when the override config disables an alarm, no alarm is generated", async () => {
			const overrideConfig = {
				stepFunctions: [
					{
						// HelloStateMachine should generate only failed count alarm
						logicalId: "HelloStateMachine",
						throttleCount: { enabled: false },
						timedOutCount: { enabled: false }
					},
					{
						// WorldStateMachine should generate only throttle count alarm
						stateMachineName: "world",
						failedCount: { enabled: false },
						timedOutCount: { enabled: false }
					}
				]
			};
  
			const nestedStack = await sfn.createAlarms(fragment, defaultConfig, overrideConfig);
			expect(nestedStack).not.toBeNull();
			expect(mockPutObject).toBeCalled();
			expect(mockGetSignedUrl).toBeCalled();
      
			const [{ Body, Bucket }] = mockPutObject.mock.calls[0];
			expect(Bucket).toBe(process.env.BUCKET);
			const { Resources, Parameters } = JSON.parse(Body);
      
			checkNestedStackParameters(Parameters);
			checkNestedStackParameterValues(nestedStack.Properties.Parameters);
      
			const logicalIds = Object.keys(Resources);
			expect(logicalIds).toHaveLength(2);
			const expectedLogicalIds = [
				"HelloStateMachineFailedCountAlarm",
				"WorldStateMachineThrottleCountAlarm"
			];
			expect(logicalIds).toEqual(expect.arrayContaining(expectedLogicalIds));			
		});
	});
});
