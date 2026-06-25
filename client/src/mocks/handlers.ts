import { http, HttpResponse } from "msw";

const BASE = "http://localhost:3000";

export const handlers = [
  http.get(`${BASE}/api/stats`, () =>
    HttpResponse.json({ success: true, data: { totalRaces: 8, totalRunners: 109 } })
  ),

  http.get(`${BASE}/api/events/grouped`, () =>
    HttpResponse.json({
      success: true,
      data: [
        {
          eventId: "33858191",
          eventName: "Cheltenham 1st Jan",
          marketIds: ["1.237066150"],
          count: 1,
        },
        {
          eventId: "33988522",
          eventName: "Leopardstown 1st Feb",
          marketIds: ["1.238923739", "1.238923745"],
          count: 2,
        },
      ],
    })
  ),

  http.get(`${BASE}/api/events/:eventId/runners`, () =>
    HttpResponse.json({
      success: true,
      data: [
        {
          marketId: "1.237066150",
          marketTime: "2025-01-01T14:01:00.000Z",
          marketType: "ANTEPOST_WIN",
          marketName: "Cheltenham Chase",
          runners: [
            { id: 12345, name: "Springwell Bay", status: "ACTIVE", sortPriority: 1, bsp: 4.5 },
            { id: 12346, name: "Gaelic Warrior", status: "ACTIVE", sortPriority: 2, bsp: 9.2 },
            { id: 12347, name: "Fact To File", status: "WINNER", sortPriority: 3, bsp: 2.1 },
          ],
        },
      ],
      count: 1,
    })
  ),

  http.get(`${BASE}/api/events/:eventId/definitions`, () =>
    HttpResponse.json({
      success: true,
      data: [
        {
          marketId: "1.237066150",
          marketType: "ANTEPOST_WIN",
          marketTime: "2025-01-01T14:01:00.000Z",
          status: "CLOSED",
          eventId: "33858191",
          eventName: "Cheltenham 1st Jan",
          runners: [],
        },
      ],
      count: 1,
    })
  ),

  http.get(`${BASE}/api/runners`, () =>
    HttpResponse.json({
      success: true,
      count: 1,
      totalRunners: 3,
      data: [
        {
          marketId: "1.237066150",
          marketTime: "2025-01-01T14:01:00.000Z",
          marketType: "ANTEPOST_WIN",
          marketName: "Cheltenham Chase",
          eventId: "33858191",
          eventName: "Cheltenham 1st Jan",
          runners: [
            { id: 12345, name: "Springwell Bay", status: "ACTIVE", sortPriority: 1, bsp: 4.5 },
            { id: 12346, name: "Gaelic Warrior", status: "ACTIVE", sortPriority: 2, bsp: 9.2 },
            { id: 12347, name: "Fact To File", status: "WINNER", sortPriority: 3, bsp: 2.1 },
          ],
        },
      ],
    })
  ),

  http.get(`${BASE}/health`, () =>
    HttpResponse.json({ status: "OK", service: "Betfair NLP API", database: "connected" })
  ),
];
