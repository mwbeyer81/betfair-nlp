import { BetfairService } from "../betfair-service";
import { MarketDefinitionDAO, PriceUpdateDAO } from "../../dao";
import {
  BetfairMessage,
  MarketChange,
  MarketDefinition,
  RunnerChange,
  MarketDefinitionDocument,
  PriceUpdateDocument,
} from "../../../types/betfair";
import { TestUtils } from "./test-utils";

// Mock the DAOs
jest.mock("../../dao");

// Mock the fs module
jest.mock("fs", () => ({
  readFileSync: jest.fn(),
}));

// Import fs after mocking
import { readFileSync } from "fs";

describe("BetfairService", () => {
  let service: BetfairService;
  let mockMarketDefinitionDAO: jest.Mocked<MarketDefinitionDAO>;
  let mockPriceUpdateDAO: jest.Mocked<PriceUpdateDAO>;

  beforeEach(() => {
    // Clear all mocks
    jest.clearAllMocks();

    // Create mock instances
    mockMarketDefinitionDAO = {
      insert: jest.fn(),
      getByMarketId: jest.fn(),
      getByEventId: jest.fn(),
      getLatestByMarketId: jest.fn(),
      getByStatus: jest.fn(),
      createIndexes: jest.fn(),
    } as any;

    mockPriceUpdateDAO = {
      insertMany: jest.fn(),
      insert: jest.fn(),
      getByRunnerId: jest.fn(),
      getByMarketId: jest.fn(),
      getByEventId: jest.fn(),
      getByTimeRange: jest.fn(),
      getLatestPriceByRunnerId: jest.fn(),
      createIndexes: jest.fn(),
    } as any;

    // Create service instance with mocked DAOs
    service = new BetfairService(mockMarketDefinitionDAO, mockPriceUpdateDAO);
  });

  describe("processDataFile", () => {
    const mockFilePath = "test/path/file.txt";
    const mockFileContent = `{"op":"mcm","clk":"123","pt":1733842450728,"mc":[{"id":"1.237066150","marketDefinition":{"bspMarket":false,"eventId":"33858191","status":"OPEN","runners":[]}}]}
{"op":"mcm","clk":"124","pt":1733842450729,"mc":[{"id":"1.237066150","rc":[{"ltp":21.0,"id":26600965}]}]}`;

    beforeEach(() => {
      // Mock fs.readFileSync for each test
      (
        readFileSync as jest.MockedFunction<typeof readFileSync>
      ).mockReturnValue(mockFileContent);
    });

    it("should process a valid data file successfully", async () => {
      // Mock the processBetfairMessage method
      const processMessageSpy = jest.spyOn(
        service as any,
        "processBetfairMessage"
      );
      processMessageSpy.mockResolvedValue(undefined);

      await service.processDataFile(mockFilePath);

      expect(processMessageSpy).toHaveBeenCalledTimes(2);
      expect(processMessageSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          op: "mcm",
          clk: "123",
          pt: 1733842450728,
        })
      );
      expect(processMessageSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          op: "mcm",
          clk: "124",
          pt: 1733842450729,
        })
      );
    });

    it("should handle empty lines gracefully", async () => {
      const emptyFileContent = "\n\n\n";
      (
        readFileSync as jest.MockedFunction<typeof readFileSync>
      ).mockReturnValue(emptyFileContent);

      const processMessageSpy = jest.spyOn(
        service as any,
        "processBetfairMessage"
      );
      processMessageSpy.mockResolvedValue(undefined);

      await service.processDataFile(mockFilePath);

      expect(processMessageSpy).not.toHaveBeenCalled();
    });

    it("should handle JSON parsing errors gracefully", async () => {
      const invalidFileContent = '{"invalid": json}\n{"valid": "json"}';
      (
        readFileSync as jest.MockedFunction<typeof readFileSync>
      ).mockReturnValue(invalidFileContent);

      const processMessageSpy = jest.spyOn(
        service as any,
        "processBetfairMessage"
      );
      processMessageSpy.mockResolvedValue(undefined);

      const consoleSpy = jest.spyOn(console, "error").mockImplementation();

      await service.processDataFile(mockFilePath);

      expect(consoleSpy).toHaveBeenCalledWith(
        'Failed to process line: {"invalid": json}...',
        expect.any(Error)
      );
      expect(processMessageSpy).toHaveBeenCalledTimes(1);
    });

    it("should throw error when file cannot be read", async () => {
      (
        readFileSync as jest.MockedFunction<typeof readFileSync>
      ).mockImplementation(() => {
        throw new Error(
          "ENOENT: no such file or directory, open 'test/path/file.txt'"
        );
      });

      await expect(service.processDataFile(mockFilePath)).rejects.toThrow(
        "ENOENT: no such file or directory, open 'test/path/file.txt'"
      );
    });
  });

  describe("processBetfairMessage", () => {
    it("should process market changes correctly", async () => {
      const mockMessage: BetfairMessage = TestUtils.createMockBetfairMessage({
        mc: [
          {
            id: "1.237066150",
            marketDefinition: TestUtils.createMockMarketDefinition(),
          },
        ],
      });

      const processMarketChangeSpy = jest.spyOn(
        service as any,
        "processMarketChange"
      );
      processMarketChangeSpy.mockResolvedValue(undefined);

      await service.processBetfairMessage(mockMessage);

      expect(processMarketChangeSpy).toHaveBeenCalledWith(
        mockMessage.mc[0],
        expect.any(Date),
        "123"
      );
    });

    it("should handle multiple market changes", async () => {
      const mockMessage: BetfairMessage = TestUtils.createMockBetfairMessage({
        mc: [
          {
            id: "1.237066150",
            marketDefinition: TestUtils.createMockMarketDefinition(),
          },
          {
            id: "1.237066151",
            marketDefinition: TestUtils.createMockMarketDefinition(),
          },
        ],
      });

      const processMarketChangeSpy = jest.spyOn(
        service as any,
        "processMarketChange"
      );
      processMarketChangeSpy.mockResolvedValue(undefined);

      await service.processBetfairMessage(mockMessage);

      expect(processMarketChangeSpy).toHaveBeenCalledTimes(2);
    });
  });

  describe("processMarketChange", () => {
    it("should process market definition updates", async () => {
      const mockMarketChange: MarketChange = TestUtils.createMockMarketChange({
        marketDefinition: TestUtils.createMockMarketDefinition(),
      });

      const processMarketDefinitionSpy = jest.spyOn(
        service as any,
        "processMarketDefinition"
      );
      const processPriceUpdatesSpy = jest.spyOn(
        service as any,
        "processPriceUpdates"
      );

      processMarketDefinitionSpy.mockResolvedValue(undefined);
      processPriceUpdatesSpy.mockResolvedValue(undefined);

      await (service as any).processMarketChange(
        mockMarketChange,
        new Date(),
        "123"
      );

      expect(processMarketDefinitionSpy).toHaveBeenCalledWith(
        mockMarketChange.marketDefinition,
        "1.237066150",
        expect.any(Date),
        "123"
      );
      expect(processPriceUpdatesSpy).not.toHaveBeenCalled();
    });

    it("should process price updates", async () => {
      const mockMarketChange: MarketChange = TestUtils.createMockMarketChange({
        rc: [
          TestUtils.createMockRunnerChange({ ltp: 21.0, id: 26600965 }),
          TestUtils.createMockRunnerChange({ ltp: 15.5, id: 48945543 }),
        ],
      });

      const processMarketDefinitionSpy = jest.spyOn(
        service as any,
        "processMarketDefinition"
      );
      const processPriceUpdatesSpy = jest.spyOn(
        service as any,
        "processPriceUpdates"
      );

      processMarketDefinitionSpy.mockResolvedValue(undefined);
      processPriceUpdatesSpy.mockResolvedValue(undefined);

      await (service as any).processMarketChange(
        mockMarketChange,
        new Date(),
        "123"
      );

      expect(processPriceUpdatesSpy).toHaveBeenCalledWith(
        mockMarketChange.rc,
        "1.237066150",
        expect.any(Date),
        "123"
      );
      expect(processMarketDefinitionSpy).not.toHaveBeenCalled();
    });

    it("should process both market definition and price updates", async () => {
      const mockMarketChange: MarketChange = TestUtils.createMockMarketChange({
        marketDefinition: TestUtils.createMockMarketDefinition(),
        rc: [TestUtils.createMockRunnerChange()],
      });

      const processMarketDefinitionSpy = jest.spyOn(
        service as any,
        "processMarketDefinition"
      );
      const processPriceUpdatesSpy = jest.spyOn(
        service as any,
        "processPriceUpdates"
      );

      processMarketDefinitionSpy.mockResolvedValue(undefined);
      processPriceUpdatesSpy.mockResolvedValue(undefined);

      await (service as any).processMarketChange(
        mockMarketChange,
        new Date(),
        "123"
      );

      expect(processMarketDefinitionSpy).toHaveBeenCalled();
      expect(processPriceUpdatesSpy).toHaveBeenCalled();
    });
  });

  describe("processMarketDefinition", () => {
    it("should insert market definition and create status document", async () => {
      const mockMarketDef = TestUtils.createMockMarketDefinition();

      await (service as any).processMarketDefinition(
        mockMarketDef,
        "1.237066150",
        new Date(),
        "123"
      );

      expect(mockMarketDefinitionDAO.insert).toHaveBeenCalledWith(
        mockMarketDef,
        "1.237066150",
        expect.any(Date),
        "123"
      );
      // Market status is now handled within market definition
      // No separate market status DAO calls expected
    });
  });

  describe("processPriceUpdates", () => {
    it("should process price updates with market context", async () => {
      const mockRunnerChanges: RunnerChange[] = [
        TestUtils.createMockRunnerChange({ ltp: 21.0, id: 26600965 }),
        TestUtils.createMockRunnerChange({ ltp: 15.5, id: 48945543 }),
      ];

      const mockMarketInfo = TestUtils.createMockMarketDefinitionDocument({
        runners: [
          TestUtils.createMockRunner({ id: 26600965, name: "Runner 1" }),
          TestUtils.createMockRunner({ id: 48945543, name: "Runner 2" }),
        ],
      });

      mockMarketDefinitionDAO.getLatestByMarketId.mockResolvedValue(
        mockMarketInfo
      );

      await (service as any).processPriceUpdates(
        mockRunnerChanges,
        "1.237066150",
        new Date(),
        "123"
      );

      expect(mockPriceUpdateDAO.insertMany).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            marketId: "1.237066150",
            runnerId: 26600965,
            runnerName: "Runner 1",
            lastTradedPrice: 21.0,
            eventId: "33858191",
            eventName: "Test Event",
          }),
          expect.objectContaining({
            marketId: "1.237066150",
            runnerId: 48945543,
            runnerName: "Runner 2",
            lastTradedPrice: 15.5,
            eventId: "33858191",
            eventName: "Test Event",
          }),
        ])
      );
    });

    it("should handle missing market info gracefully", async () => {
      const mockRunnerChanges: RunnerChange[] = [
        TestUtils.createMockRunnerChange(),
      ];

      mockMarketDefinitionDAO.getLatestByMarketId.mockResolvedValue(null);

      await (service as any).processPriceUpdates(
        mockRunnerChanges,
        "1.237066150",
        new Date(),
        "123"
      );

      expect(mockPriceUpdateDAO.insertMany).toHaveBeenCalledWith([
        expect.objectContaining({
          marketId: "1.237066150",
          runnerId: 26600965,
          runnerName: "Runner_26600965",
          lastTradedPrice: 21.0,
          eventId: "",
          eventName: "",
        }),
      ]);
    });
  });

  describe("createIndexes", () => {
    it("should create indexes for all DAOs", async () => {
      await service.createIndexes();

      expect(mockMarketDefinitionDAO.createIndexes).toHaveBeenCalled();
      expect(mockPriceUpdateDAO.createIndexes).toHaveBeenCalled();
    });
  });

  describe("getMarketAnalysis", () => {
    it("should return comprehensive market analysis", async () => {
      const mockMarketDefinition =
        TestUtils.createMockMarketDefinitionDocument();
      const mockPriceHistory = [
        TestUtils.createMockPriceUpdateDocument({
          _id: "1",
          lastTradedPrice: 21.0,
        }),
        TestUtils.createMockPriceUpdateDocument({
          _id: "2",
          lastTradedPrice: 15.5,
        }),
      ];
      const mockMarketDefinitions = [
        TestUtils.createMockMarketDefinitionDocument({ status: "OPEN" }),
        TestUtils.createMockMarketDefinitionDocument({ status: "SUSPENDED" }),
        TestUtils.createMockMarketDefinitionDocument({ status: "CLOSED" }),
      ];

      mockMarketDefinitionDAO.getLatestByMarketId.mockResolvedValue(
        mockMarketDefinition
      );
      mockMarketDefinitionDAO.getByMarketId.mockResolvedValue(
        mockMarketDefinitions
      );
      mockPriceUpdateDAO.getByMarketId.mockResolvedValue(mockPriceHistory);

      const result = await service.getMarketAnalysis("1.237066150");

      expect(result.marketDefinition).toEqual(mockMarketDefinition);
      expect(result.priceHistory).toEqual(mockPriceHistory);
      expect(result.summary.totalPriceUpdates).toBe(2);
      expect(result.summary.priceRange.min).toBe(15.5);
      expect(result.summary.priceRange.max).toBe(21.0);
      expect(result.summary.statusTransitions).toEqual([
        "OPEN",
        "SUSPENDED",
        "CLOSED",
      ]);
    });
  });

  describe("getEventSummary", () => {
    it("should return event summary across markets", async () => {
      const mockMarketDefinitions: MarketDefinitionDocument[] = [
        TestUtils.createMockMarketDefinitionDocument({
          _id: "1",
          marketId: "1.237066150",
          runners: [TestUtils.createMockRunner({ id: 1, name: "Runner 1" })],
        }),
        TestUtils.createMockMarketDefinitionDocument({
          _id: "2",
          marketId: "1.237066151",
          status: "CLOSED",
          runners: [TestUtils.createMockRunner({ id: 2, name: "Runner 2" })],
        }),
      ];

      mockMarketDefinitionDAO.getByEventId.mockResolvedValue(
        mockMarketDefinitions
      );

      const result = await service.getEventSummary("33858191");

      expect(result.eventId).toBe("33858191");
      expect(result.eventName).toBe("Test Event");
      expect(result.markets).toEqual(["1.237066150", "1.237066151"]);
      expect(result.totalRunners).toBe(2);
      expect(result.activeMarkets).toBe(1);
      expect(result.suspendedMarkets).toBe(0);
      expect(result.closedMarkets).toBe(1);
    });
  });
});
