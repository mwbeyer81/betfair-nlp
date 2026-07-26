import OpenAI from "openai";
import { readFileSync } from "fs";
import { CodebaseSearchService } from "../codebase-search-service";
import { CodebaseFileAccess } from "../codebase-file-access";

jest.mock("openai");
jest.mock("fs");
jest.mock("config", () => ({ get: jest.fn().mockReturnValue("test-api-key") }));
jest.mock("../codebase-file-access");

const MockedOpenAI = OpenAI as jest.MockedClass<typeof OpenAI>;
const MockedReadFileSync = readFileSync as jest.MockedFunction<typeof readFileSync>;
const MockedCodebaseFileAccess = CodebaseFileAccess as jest.MockedClass<typeof CodebaseFileAccess>;

function toolCallMessage(calls: { id: string; name: string; args: object }[]) {
  return {
    role: "assistant" as const,
    content: null,
    tool_calls: calls.map(c => ({
      id: c.id,
      type: "function" as const,
      function: { name: c.name, arguments: JSON.stringify(c.args) },
    })),
  };
}

function textMessage(content: string) {
  return { role: "assistant" as const, content, tool_calls: undefined };
}

describe("CodebaseSearchService", () => {
  let mockCreate: jest.Mock;
  let service: CodebaseSearchService;
  let mockFileAccessInstance: jest.Mocked<CodebaseFileAccess>;

  beforeEach(() => {
    jest.clearAllMocks();

    MockedReadFileSync.mockReturnValue("You are the app assistant. ${query} placeholder unused here.");

    mockCreate = jest.fn();
    MockedOpenAI.mockImplementation(
      () =>
        ({
          chat: { completions: { create: mockCreate } },
        }) as any
    );

    mockFileAccessInstance = {
      listDirectory: jest.fn().mockReturnValue("src/\nml/\nREADME.md"),
      searchCode: jest.fn().mockReturnValue("no matches"),
      readFile: jest.fn().mockReturnValue("file content"),
    } as any;
    MockedCodebaseFileAccess.mockImplementation(() => mockFileAccessInstance);

    service = new CodebaseSearchService();
  });

  describe("constructor", () => {
    it("throws if the OpenAI API key is missing", () => {
      const configModule = require("config");
      configModule.get.mockReturnValueOnce(undefined);
      expect(() => new CodebaseSearchService()).toThrow("OpenAI API key not found in configuration");
    });

    it("loads the system prompt from disk", () => {
      expect(MockedReadFileSync).toHaveBeenCalledWith(
        expect.stringContaining("chat-system-prompt.md"),
        "utf-8"
      );
    });
  });

  describe("chat — no tool calls needed", () => {
    it("returns the model's text directly when it makes no tool calls", async () => {
      mockCreate.mockResolvedValueOnce({
        choices: [{ message: textMessage("This app tracks horse races.") }],
      });

      const reply = await service.chat("What does this app do?", []);

      expect(reply).toBe("This app tracks horse races.");
      expect(mockCreate).toHaveBeenCalledTimes(1);
      const call = mockCreate.mock.calls[0][0];
      expect(call.messages[0]).toEqual({ role: "system", content: expect.any(String) });
      expect(call.messages[call.messages.length - 1]).toEqual({
        role: "user",
        content: "What does this app do?",
      });
    });

    it("includes prior conversation turns in the messages sent to OpenAI", async () => {
      mockCreate.mockResolvedValueOnce({ choices: [{ message: textMessage("Follow-up answer.") }] });

      await service.chat("How does it work?", [
        { role: "user", text: "What does this app do?" },
        { role: "assistant", text: "This app tracks horse races." },
      ]);

      const call = mockCreate.mock.calls[0][0];
      expect(call.messages).toEqual([
        { role: "system", content: expect.any(String) },
        { role: "user", content: "What does this app do?" },
        { role: "assistant", content: "This app tracks horse races." },
        { role: "user", content: "How does it work?" },
      ]);
    });

    it("returns a fallback message if the model returns empty content", async () => {
      mockCreate.mockResolvedValueOnce({ choices: [{ message: textMessage("") }] });
      const reply = await service.chat("hi", []);
      expect(reply).toBe("I couldn't come up with an answer to that.");
    });
  });

  describe("chat — single tool round-trip", () => {
    it("executes a tool call and feeds the result back with a matching tool_call_id", async () => {
      mockCreate
        .mockResolvedValueOnce({
          choices: [
            {
              message: toolCallMessage([
                { id: "call_1", name: "search_code", args: { query: "trainer form" } },
              ]),
            },
          ],
        })
        .mockResolvedValueOnce({
          choices: [{ message: textMessage("Trainer form is calculated from recent runs.") }],
        });

      mockFileAccessInstance.searchCode.mockReturnValueOnce("src/lib/service/trainer-form-service.ts:12\n...");

      const reply = await service.chat("How is trainer form calculated?", []);

      expect(reply).toBe("Trainer form is calculated from recent runs.");
      expect(mockFileAccessInstance.searchCode).toHaveBeenCalledWith("trainer form");
      expect(mockCreate).toHaveBeenCalledTimes(2);

      const secondCallMessages = mockCreate.mock.calls[1][0].messages;
      const toolResultMessage = secondCallMessages.find((m: any) => m.role === "tool");
      expect(toolResultMessage).toEqual({
        role: "tool",
        tool_call_id: "call_1",
        content: "src/lib/service/trainer-form-service.ts:12\n...",
      });
    });

    it("routes list_directory and read_file tool calls to the matching file-access method", async () => {
      mockCreate
        .mockResolvedValueOnce({
          choices: [
            {
              message: toolCallMessage([
                { id: "call_a", name: "list_directory", args: { path: "src/lib/dao" } },
              ]),
            },
          ],
        })
        .mockResolvedValueOnce({
          choices: [
            { message: toolCallMessage([{ id: "call_b", name: "read_file", args: { path: "src/lib/dao/foo.ts", startLine: 1, endLine: 5 } }]) },
          ],
        })
        .mockResolvedValueOnce({ choices: [{ message: textMessage("Done.") }] });

      const reply = await service.chat("What DAOs exist?", []);

      expect(mockFileAccessInstance.listDirectory).toHaveBeenCalledWith("src/lib/dao");
      expect(mockFileAccessInstance.readFile).toHaveBeenCalledWith("src/lib/dao/foo.ts", 1, 5);
      expect(reply).toBe("Done.");
      expect(mockCreate).toHaveBeenCalledTimes(3);
    });
  });

  describe("chat — error handling", () => {
    it("feeds a thrown file-access error back as tool content instead of throwing out of chat()", async () => {
      mockFileAccessInstance.readFile.mockImplementationOnce(() => {
        throw new Error("Path is not in the allowlisted set: \"../secret\"");
      });
      mockCreate
        .mockResolvedValueOnce({
          choices: [
            { message: toolCallMessage([{ id: "call_1", name: "read_file", args: { path: "../secret" } }]) },
          ],
        })
        .mockResolvedValueOnce({ choices: [{ message: textMessage("I can't read that file.") }] });

      const reply = await service.chat("read me a secret", []);

      expect(reply).toBe("I can't read that file.");
      const secondCallMessages = mockCreate.mock.calls[1][0].messages;
      const toolResultMessage = secondCallMessages.find((m: any) => m.role === "tool");
      expect(toolResultMessage.content).toContain("not in the allowlisted set");
    });

    it("returns an error string as tool content for an unrecognized tool name", async () => {
      mockCreate
        .mockResolvedValueOnce({
          choices: [{ message: toolCallMessage([{ id: "call_1", name: "delete_everything", args: {} }]) }],
        })
        .mockResolvedValueOnce({ choices: [{ message: textMessage("ok") }] });

      await service.chat("do something bad", []);

      const secondCallMessages = mockCreate.mock.calls[1][0].messages;
      const toolResultMessage = secondCallMessages.find((m: any) => m.role === "tool");
      expect(toolResultMessage.content).toMatch(/unknown tool/);
    });
  });

  describe("chat — iteration cap", () => {
    it("stops after MAX_ITERATIONS tool round-trips and makes one final tool_choice:none call", async () => {
      // Every call returns another tool call — the model "never" stops on its own.
      mockCreate.mockResolvedValue({
        choices: [
          { message: toolCallMessage([{ id: "call_x", name: "search_code", args: { query: "x" } }]) },
        ],
      });

      // The final forced call (tool_choice: "none") returns real text.
      const totalCallsBeforeFinal = 8; // MAX_ITERATIONS
      let callCount = 0;
      mockCreate.mockImplementation(async (params: any) => {
        callCount++;
        if (params.tool_choice === "none") {
          return { choices: [{ message: textMessage("Forced final answer.") }] };
        }
        return {
          choices: [
            { message: toolCallMessage([{ id: `call_${callCount}`, name: "search_code", args: { query: "x" } }]) },
          ],
        };
      });

      const reply = await service.chat("an unanswerable question", []);

      expect(reply).toBe("Forced final answer.");
      // MAX_ITERATIONS tool-call rounds + 1 forced final call.
      expect(mockCreate).toHaveBeenCalledTimes(totalCallsBeforeFinal + 1);
      const finalCallParams = mockCreate.mock.calls[totalCallsBeforeFinal][0];
      expect(finalCallParams.tool_choice).toBe("none");
    });
  });
});
