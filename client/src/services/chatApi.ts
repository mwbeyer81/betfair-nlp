interface ChatResponse {
  reply: string;
  success?: boolean;
  data?: any;
  error?: string;
}

class ChatApi {
  private baseUrl = "http://localhost:3000"; // Points to the local server

  async sendMessage(message: string): Promise<ChatResponse> {
    try {
      const response = await fetch(`${this.baseUrl}/api/query`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ query: message }),
      });

      const result = await response.json();

      if (!response.ok) {
        return {
          reply: `Error: ${result.error || "Failed to process query"}`,
          success: false,
          error: result.error,
        };
      }

      if (result.success && result.data) {
        // Format the MongoDB results into a readable response
        const data = result.data;
        let reply = `Query: "${data.query}"\n\n`;

        if (data.mongoResults && data.mongoResults.length > 0) {
          reply += `Found ${data.mongoResults.length} result(s):\n\n`;

          // Format the results based on the collection type
          if (
            data.mongoQuery &&
            data.mongoQuery.includes("market_definitions")
          ) {
            reply += this.formatMarketDefinitions(data.mongoResults);
          } else if (
            data.mongoQuery &&
            data.mongoQuery.includes("price_updates")
          ) {
            reply += this.formatPriceUpdates(data.mongoResults);
          } else if (
            data.mongoQuery &&
            data.mongoQuery.includes("market_statuses")
          ) {
            reply += this.formatMarketStatuses(data.mongoResults);
          } else {
            reply += JSON.stringify(data.mongoResults, null, 2);
          }
        } else {
          reply += "No results found for your query.";
        }

        return {
          reply,
          success: true,
          data: result.data,
        };
      } else {
        return {
          reply: "Received an unexpected response from the server.",
          success: false,
        };
      }
    } catch (error) {
      console.error("Error calling chat API:", error);
      return {
        reply: `Connection error: Unable to reach the server. Please make sure the server is running on ${this.baseUrl}`,
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  private formatMarketDefinitions(results: any[]): string {
    let formatted = "";
    results.forEach((market, index) => {
      formatted += `${index + 1}. **${market.name}** (${market.eventName})\n`;
      formatted += `   - Market ID: ${market.marketId}\n`;
      formatted += `   - Status: ${market.status}\n`;
      formatted += `   - Active Runners: ${market.numberOfActiveRunners}\n`;
      if (market.runners && market.runners.length > 0) {
        formatted += `   - Runners: ${market.runners
          .slice(0, 5)
          .map((r: any) => r.name)
          .join(", ")}`;
        if (market.runners.length > 5) {
          formatted += ` (+${market.runners.length - 5} more)`;
        }
        formatted += "\n";
      }
      formatted += "\n";
    });
    return formatted;
  }

  private formatPriceUpdates(results: any[]): string {
    let formatted = "";
    results.forEach((update, index) => {
      formatted += `${index + 1}. **${update.runnerName}**\n`;
      formatted += `   - Market: ${update.marketId}\n`;
      formatted += `   - Last Traded Price: ${update.lastTradedPrice}\n`;
      formatted += `   - Event: ${update.eventName}\n`;
      formatted += `   - Timestamp: ${new Date(update.timestamp).toLocaleString()}\n\n`;
    });
    return formatted;
  }

  private formatMarketStatuses(results: any[]): string {
    let formatted = "";
    results.forEach((status, index) => {
      formatted += `${index + 1}. **${status.eventName}**\n`;
      formatted += `   - Market ID: ${status.marketId}\n`;
      formatted += `   - Status: ${status.status}\n`;
      formatted += `   - Active Runners: ${status.numberOfActiveRunners}\n`;
      formatted += `   - Timestamp: ${new Date(status.timestamp).toLocaleString()}\n\n`;
    });
    return formatted;
  }
}

export const chatApi = new ChatApi();
