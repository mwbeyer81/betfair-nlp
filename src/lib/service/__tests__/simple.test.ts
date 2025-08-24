import { BetfairService } from "../betfair-service";
import {
  MarketDefinitionDAO,
  PriceUpdateDAO,
  MarketStatusDAO,
} from "../../dao";
import { TestUtils } from "./test-utils";

jest.mock("../../dao");

describe("BetfairService - Simple Tests", () => {
  let service: BetfairService;
  let mockMarketDefinitionDAO: jest.Mocked<MarketDefinitionDAO>;
  let mockPriceUpdateDAO: jest.Mocked<PriceUpdateDAO>;
  let mockMarketStatusDAO: jest.Mocked<MarketStatusDAO>;

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

    mockMarketStatusDAO = {
      insert: jest.fn(),
      getByMarketId: jest.fn(),
      getByStatus: jest.fn(),
      getByEventId: jest.fn(),
      getLatestStatusByMarketId: jest.fn(),
      getStatusTransitions: jest.fn(),
      getByActiveRunnerCount: jest.fn(),
      createIndexes: jest.fn(),
    } as any;

    // Create service instance with mocked DAOs
    service = new BetfairService(
      mockMarketDefinitionDAO,
      mockPriceUpdateDAO,
      mockMarketStatusDAO
    );
  });

  it("should create service instance successfully", () => {
    expect(service).toBeInstanceOf(BetfairService);
  });

  it("should create indexes for all DAOs", async () => {
    await service.createIndexes();
    expect(mockMarketDefinitionDAO.createIndexes).toHaveBeenCalled();
    expect(mockPriceUpdateDAO.createIndexes).toHaveBeenCalled();
    expect(mockMarketStatusDAO.createIndexes).toHaveBeenCalled();
  });

  it("should handle empty price updates gracefully", async () => {
    const mockRunnerChanges: any[] = [];
    const processPriceUpdatesSpy = jest.spyOn(
      service as any,
      "processPriceUpdates"
    );
    processPriceUpdatesSpy.mockResolvedValue(undefined);

    await (service as any).processPriceUpdates(
      mockRunnerChanges,
      "1.237066150",
      new Date(),
      "123"
    );
    expect(mockPriceUpdateDAO.insertMany).not.toHaveBeenCalled();
  });

  it("should process market definition successfully", async () => {
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
    expect(mockMarketStatusDAO.insert).toHaveBeenCalledWith(
      mockMarketDef,
      "1.237066150",
      expect.any(Date),
      "123"
    );
  });
});
