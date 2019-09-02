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

const { Sqs } = require("./sqs");
const defaultConfig = require("./config/config.example.json");

beforeEach(() => {
	mockPutObject.mockClear();
	mockGetSignedUrl.mockClear();
});

describe("#sqs", () => {
	const sqs = new Sqs();

	test("given there are no SQS queues, it returns no alarms", async () => {
		const nestedStack = await sqs.createAlarms({ Resources: {} }, defaultConfig);
		expect(nestedStack).toBeNull();
		expect(mockPutObject).not.toBeCalled();
	});

	describe("given there are 2 SQS queues", () => {
		const fragment = {
			Resources: {
				HelloQueue: {
					Type: "AWS::SQS::Queue",
					Properties: {
						QueueName: "hello"
					}
				},
				WorldQueue: {
					Type: "AWS::SQS::Queue",
					Properties: {
						QueueName: "world"
					}
				}
			}
		};

		const checkNestedStackParameters = parameters => {
			expect(Object.keys(parameters)).toHaveLength(3);
			expect(parameters).toHaveProperty("HelloQueueName");
			expect(parameters).toHaveProperty("WorldQueueName");
			expect(parameters).toHaveProperty("TopicArn");
		};

		const checkNestedStackParameterValues = values => {
			expect(Object.keys(values)).toHaveLength(3);

			expect(values).toHaveProperty("HelloQueueName");
			expect(values.HelloQueueName).toEqual({
				"Fn::GetAtt": ["HelloQueue", "QueueName"]
			});

			expect(values).toHaveProperty("WorldQueueName");
			expect(values.WorldQueueName).toEqual({
				"Fn::GetAtt": ["WorldQueue", "QueueName"]
			});

			expect(values).toHaveProperty("TopicArn");
			expect(values.TopicArn).toEqual({
				Ref: "MacroParamTopicArn"
			});
		};

		test("when there is no override config, it generates one alarm for each queue", async () => {
			const nestedStack = await sqs.createAlarms(fragment, defaultConfig);
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
			const expectedLogicalIds = ["HelloQueueMessageAgeAlarm", "WorldQueueMessageAgeAlarm"];
			expect(logicalIds).toEqual(expect.arrayContaining(expectedLogicalIds));

			Object.values(Resources).forEach(resource => {
				expect(resource.Type).toBe("AWS::CloudWatch::Alarm");
				expect(resource).toHaveProperty("Properties.AlarmName");
				expect(resource).toHaveProperty("Properties.Period", 60);
				expect(resource).toHaveProperty("Properties.EvaluationPeriods");
				expect(resource).toHaveProperty("Properties.Threshold");
				expect(resource).toHaveProperty("Properties.AlarmActions", [{ Ref: "TopicArn" }]);
				expect(resource).toHaveProperty("Properties.Statistic", "Maximum");
			});
		});

		test("when the override config disables an alarm, no alarm is generated", async () => {
			const overrideConfig = {
				sqsQueues: [
					{
						// HelloQueue should not generate any alarms
						logicalId: "HelloQueue",
						messageAge: { enabled: false }
					}
				]
			};

			const nestedStack = await sqs.createAlarms(fragment, defaultConfig, overrideConfig);
			expect(nestedStack).not.toBeNull();
			expect(mockPutObject).toBeCalled();
			expect(mockGetSignedUrl).toBeCalled();

			const [{ Body, Bucket }] = mockPutObject.mock.calls[0];
			expect(Bucket).toBe(process.env.BUCKET);
			const { Resources } = JSON.parse(Body);

			const logicalIds = Object.keys(Resources);
			expect(logicalIds).toHaveLength(1);
			const expectedLogicalIds = ["WorldQueueMessageAgeAlarm"];
			expect(logicalIds).toEqual(expect.arrayContaining(expectedLogicalIds));
		});
	});
});
