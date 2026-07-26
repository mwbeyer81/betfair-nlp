import OpenAI from "openai";
import config from "config";
import { readFileSync } from "fs";
import { join } from "path";
import { CodebaseFileAccess } from "./codebase-file-access";

export interface ChatHistoryTurn {
  role: "user" | "assistant";
  text: string;
}

const MAX_ITERATIONS = 8;

const TOOLS: OpenAI.Chat.Completions.ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "list_directory",
      description:
        "List files and subdirectories under a path within the app's allowlisted source tree. Use this to discover what's available before reading files.",
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: 'Relative path from the codebase root, e.g. "src/lib/dao" or "" for the root.',
          },
        },
        required: ["path"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search_code",
      description:
        "Search for a literal string or short phrase across all allowlisted source files. Returns matching file paths with the matching line and a few lines of context. Use this to find where something is implemented before reading the whole file.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "Text to search for (case-insensitive, literal substring).",
          },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "read_file",
      description:
        "Read the contents of a single allowlisted source file (optionally a line range) to see the real implementation.",
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: 'Relative path from the codebase root, e.g. "src/lib/dao/price-update-dao.ts".',
          },
          startLine: { type: "number", description: "1-based inclusive start line (optional)." },
          endLine: { type: "number", description: "1-based inclusive end line (optional)." },
        },
        required: ["path"],
      },
    },
  },
];

export class CodebaseSearchService {
  private readonly client: OpenAI;
  private readonly systemPrompt: string;
  private readonly fileAccess: CodebaseFileAccess;

  constructor() {
    const apiKey = config.get<string>("openai.apiKey");
    if (!apiKey) {
      throw new Error("OpenAI API key not found in configuration");
    }
    this.client = new OpenAI({ apiKey });

    try {
      const promptPath = join(__dirname, "prompts", "chat-system-prompt.md");
      this.systemPrompt = readFileSync(promptPath, "utf-8");
    } catch (error) {
      console.error("Failed to load chat system prompt:", error);
      throw new Error("Could not load chat system prompt");
    }

    this.fileAccess = new CodebaseFileAccess();
  }

  async chat(query: string, history: ChatHistoryTurn[] = []): Promise<string> {
    const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
      { role: "system", content: this.systemPrompt },
      ...history.map(
        (h): OpenAI.Chat.Completions.ChatCompletionMessageParam => ({
          role: h.role,
          content: h.text,
        })
      ),
      { role: "user", content: query },
    ];

    for (let i = 0; i < MAX_ITERATIONS; i++) {
      const response = await this.client.chat.completions.create({
        model: "gpt-4o-mini",
        messages,
        tools: TOOLS,
        tool_choice: "auto",
        temperature: 0.2,
      });

      const choice = response.choices[0];
      const toolCalls = choice.message.tool_calls;

      if (!toolCalls || toolCalls.length === 0) {
        return choice.message.content?.trim() || "I couldn't come up with an answer to that.";
      }

      messages.push(choice.message);

      for (const call of toolCalls) {
        if (call.type !== "function") continue;
        messages.push({
          role: "tool",
          tool_call_id: call.id,
          content: this.executeTool(call.function.name, call.function.arguments),
        });
      }
    }

    console.warn(`CodebaseSearchService: hit the ${MAX_ITERATIONS}-iteration tool-call cap for query: "${query}"`);
    // tool_choice is only a valid param when tools is also present, even
    // when forcing "none" — omitting tools here caused a live 400
    // ("Invalid value for 'tool_choice': ... only allowed when 'tools' are
    // specified") the first time a real conversation actually hit this cap.
    const finalResponse = await this.client.chat.completions.create({
      model: "gpt-4o-mini",
      messages,
      tools: TOOLS,
      tool_choice: "none",
      temperature: 0.2,
    });
    return (
      finalResponse.choices[0].message.content?.trim() ||
      "I looked through the codebase but couldn't finish forming an answer — could you narrow your question?"
    );
  }

  private executeTool(name: string, rawArguments: string): string {
    try {
      const args = JSON.parse(rawArguments);
      switch (name) {
        case "list_directory":
          return this.fileAccess.listDirectory(args.path ?? "");
        case "search_code":
          return this.fileAccess.searchCode(args.query ?? "");
        case "read_file":
          return this.fileAccess.readFile(args.path, args.startLine, args.endLine);
        default:
          return `Error: unknown tool "${name}"`;
      }
    } catch (error) {
      // Fed back to the model as tool content, not thrown — lets it retry
      // with a corrected path/query instead of the whole turn failing.
      return `Error: ${error instanceof Error ? error.message : String(error)}`;
    }
  }
}
