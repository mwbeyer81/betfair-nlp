import { config } from "../config";

interface ChatResponse {
  reply: string;
  success?: boolean;
  data?: any;
  error?: string;
}

class ChatApi {
  private baseUrl = config.baseUrl;
  private credentials = btoa("matthew:beyer"); // Base64 encoded credentials

  async sendMessage(message: string): Promise<ChatResponse> {
    try {
      const response = await fetch(`${this.baseUrl}/api/query`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Basic ${this.credentials}`,
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

        // Add natural language interpretation if available
        if (data.naturalLanguageInterpretation) {
          reply += `**How I interpreted your query:**\n${data.naturalLanguageInterpretation}\n\n`;
        }

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
            reply += this.formatPriceUpdates(data.mongoResults, data.query);
          } else if (
            data.mongoQuery &&
            data.mongoQuery.includes("market_statuses")
          ) {
            reply += this.formatMarketStatuses(data.mongoResults);
          } else {
            reply += JSON.stringify(data.mongoResults, null, 2);
          }
        } else if (data.noResultsMessage) {
          // Use the backend's custom message instead of hardcoded text
          reply += data.noResultsMessage;
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
        formatted += `   - Runners:\n`;
        market.runners.forEach((runner: any, runnerIndex: number) => {
          const status = runner.status || "UNKNOWN";
          const statusColor =
            status === "ACTIVE" ? "🟢" : status === "REMOVED" ? "🔴" : "🟡";
          formatted += `     ${runnerIndex + 1}. ${statusColor} ${runner.name} (${status})\n`;
        });

        // Add status key/legend
        formatted += `\n   **Status Key:**\n`;
        formatted += `   🟢 = ACTIVE runners\n`;
        formatted += `   🔴 = REMOVED runners\n`;
        formatted += `   🟡 = WINNER/LOSER runners\n`;
      }
      formatted += "\n";
    });
    return formatted;
  }

  private formatPriceUpdates(results: any[], query?: string): string {
    let formatted = "";

    // Debug: Log the structure of the first result
    if (results.length > 0) {
      console.log("🔍 Price update result structure:", {
        keys: Object.keys(results[0]),
        sample: results[0],
        isSingleFieldDisplay:
          results[0]._id === undefined && Object.keys(results[0]).length === 1,
        fieldName: Object.keys(results[0])[0],
      });
    }

    // Check if this is a simplified single-field display
    // When projection is used, only the specified fields exist and _id is excluded
    const isSingleFieldDisplay =
      results.length > 0 &&
      results[0]._id === undefined && // _id should be excluded in projection
      Object.keys(results[0]).length === 1; // Only one field exists

    // Get the field name for display
    const fieldName = isSingleFieldDisplay ? Object.keys(results[0])[0] : null;

    // Check if this is a price analysis query that should use enhanced formatting
    const isPriceAnalysisQuery =
      query &&
      (query.toLowerCase().includes("price movement analysis") ||
        query.toLowerCase().includes("price trend analysis") ||
        query.toLowerCase().includes("price volatility analysis") ||
        query.toLowerCase().includes("volatility analysis") ||
        query.toLowerCase().includes("trend analysis") ||
        query.toLowerCase().includes("price analysis") ||
        query.toLowerCase().includes("analyze price") ||
        query.toLowerCase().includes("show me price movement") ||
        query.toLowerCase().includes("analyze price volatility") ||
        query.toLowerCase().includes("largest volatility") ||
        query.toLowerCase().includes("most volatile horses") ||
        query.toLowerCase().includes("biggest price swings") ||
        query.toLowerCase().includes("compare volatility across") ||
        query.toLowerCase().includes("volatility across all horses") ||
        query.toLowerCase().includes("horses with largest volatility") ||
        query.toLowerCase().includes("horses largest volatility") ||
        (query.toLowerCase().includes("show me horses") &&
          query.toLowerCase().includes("volatility")) ||
        query.toLowerCase().includes("find most volatile") ||
        query.toLowerCase().includes("volatility ranking") ||
        query.toLowerCase().includes("volatility leaderboard")) &&
      results.length > 0 &&
      results[0].lastTradedPrice !== undefined &&
      results[0].timestamp !== undefined;

    // Fallback: Check if user specifically requested prices only
    const userWantsPricesOnly =
      query &&
      (query.toLowerCase().includes("prices only") ||
        query.toLowerCase().includes("just the prices") ||
        query.toLowerCase().includes("simple list") ||
        query.toLowerCase().includes("numbers only") ||
        query.toLowerCase().includes("i want to see prices only"));

    if (isPriceAnalysisQuery) {
      console.log("📊 Detected price analysis query, showing enhanced format");
      return this.formatPriceAnalysis(results, query);
    } else if (isSingleFieldDisplay || userWantsPricesOnly) {
      if (fieldName) {
        console.log(`✅ Detected single-field display for: ${fieldName}`);
        // Simple single-field list format
        results.forEach((update, index) => {
          formatted += `${update[fieldName]}\n`;
        });
      } else {
        console.log("❌ Field name not detected, falling back to full format");
        // Fallback to full format if field name detection fails
        results.forEach((update, index) => {
          formatted += `${index + 1}. **${update.runnerName}**\n`;
          formatted += `   - Market: ${update.marketId}\n`;
          formatted += `   - Last Traded Price: ${update.lastTradedPrice}\n`;
          formatted += `   - Event: ${update.eventName}\n`;
          formatted += `   - Timestamp: ${new Date(update.timestamp).toLocaleString()}\n\n`;
        });
      }
    } else {
      console.log("📋 Showing full details format");
      // Full details format
      results.forEach((update, index) => {
        formatted += `${index + 1}. **${update.runnerName}**\n`;
        formatted += `   - Market: ${update.marketId}\n`;
        formatted += `   - Last Traded Price: ${update.lastTradedPrice}\n`;
        formatted += `   - Event: ${update.eventName}\n`;
        formatted += `   - Timestamp: ${new Date(update.timestamp).toLocaleString()}\n\n`;
      });
    }

    return formatted;
  }

  private formatPriceAnalysis(results: any[], query: string): string {
    let formatted = "";

    // Check if this is a cross-market volatility analysis query
    const isCrossMarketVolatilityQuery =
      query &&
      (query.toLowerCase().includes("largest volatility") ||
        query.toLowerCase().includes("most volatile horses") ||
        query.toLowerCase().includes("biggest price swings") ||
        query.toLowerCase().includes("compare volatility across") ||
        query.toLowerCase().includes("volatility across all horses") ||
        query.toLowerCase().includes("horses with largest volatility") ||
        query.toLowerCase().includes("horses largest volatility") ||
        (query.toLowerCase().includes("show me horses") &&
          query.toLowerCase().includes("volatility")) ||
        query.toLowerCase().includes("find most volatile") ||
        query.toLowerCase().includes("volatility ranking") ||
        query.toLowerCase().includes("volatility leaderboard"));

    console.log("🔍 Cross-market volatility detection:", {
      query: query,
      queryLower: query?.toLowerCase(),
      isCrossMarketVolatilityQuery: isCrossMarketVolatilityQuery,
      includesLargestVolatility: query
        ?.toLowerCase()
        .includes("largest volatility"),
      includesHorsesLargestVolatility: query
        ?.toLowerCase()
        .includes("horses largest volatility"),
      includesShowMeHorses: query?.toLowerCase().includes("show me horses"),
      includesVolatility: query?.toLowerCase().includes("volatility"),
      showMeHorsesAndVolatility:
        query?.toLowerCase().includes("show me horses") &&
        query?.toLowerCase().includes("volatility"),
    });

    // Group results by runner if multiple runners exist
    const runners = new Map<string, any[]>();

    results.forEach(update => {
      const runnerName = update.runnerName || "Unknown Runner";
      if (!runners.has(runnerName)) {
        runners.set(runnerName, []);
      }
      runners.get(runnerName)!.push(update);
    });

    if (isCrossMarketVolatilityQuery) {
      console.log(
        "🌍 Detected cross-market volatility query, showing leaderboard"
      );
      return this.formatVolatilityLeaderboard(runners);
    }

    // Format each runner's price analysis
    runners.forEach((updates, runnerName) => {
      // Sort updates by timestamp (most recent first)
      updates.sort(
        (a, b) =>
          new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
      );

      formatted += `**${runnerName}** - Price Movement Analysis:\n`;

      // Calculate volatility metrics
      const prices = updates.map(u => u.lastTradedPrice);
      const volatility = this.calculateVolatility(prices);

      // Show recent price changes with trend arrows and percentages
      const recentUpdates = updates.slice(0, 10); // Show last 10 updates

      recentUpdates.forEach((update, index) => {
        const timestamp = new Date(update.timestamp).toLocaleTimeString(
          "en-GB",
          {
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
          }
        );

        let trendInfo = "";
        if (index < recentUpdates.length - 1) {
          const currentPrice = update.lastTradedPrice;
          const previousPrice = recentUpdates[index + 1].lastTradedPrice;
          const change = currentPrice - previousPrice;
          const percentageChange = ((change / previousPrice) * 100).toFixed(1);

          if (change > 0) {
            trendInfo = ` ⬆️ +${percentageChange}%`;
          } else if (change < 0) {
            trendInfo = ` ⬇️ ${percentageChange}%`;
          } else {
            trendInfo = ` ➡️ 0%`;
          }
        }

        formatted += `${timestamp} → ${update.lastTradedPrice}${trendInfo}\n`;
      });

      // Add volatility assessment
      formatted += `\n**Volatility Assessment:** ${volatility.rating} (${volatility.description})\n`;
      formatted += `- Price Range: ${volatility.minPrice} - ${volatility.maxPrice}\n`;
      formatted += `- Average Price: ${volatility.averagePrice.toFixed(1)}\n`;
      formatted += `- Total Changes: ${updates.length}\n\n`;
    });

    return formatted;
  }

  private formatVolatilityLeaderboard(runners: Map<string, any[]>): string {
    let formatted = "🏆 **Volatility Leaderboard - All Horses**\n\n";

    // Calculate volatility for each runner
    const volatilityScores: Array<{
      runnerName: string;
      volatility: any;
      updates: any[];
    }> = [];

    runners.forEach((updates, runnerName) => {
      const prices = updates.map(u => u.lastTradedPrice);
      const volatility = this.calculateVolatility(prices);
      volatilityScores.push({ runnerName, volatility, updates });
    });

    // Sort by volatility (highest first)
    volatilityScores.sort((a, b) => {
      const aScore = this.getVolatilityScore(a.volatility.rating);
      const bScore = this.getVolatilityScore(b.volatility.rating);
      if (aScore !== bScore) {
        return bScore - aScore; // Higher score first
      }
      // If same rating, sort by price range percentage
      return (
        b.volatility.averagePricePercent - a.volatility.averagePricePercent
      );
    });

    // Show top 10 most volatile horses
    const topVolatile = volatilityScores.slice(0, 10);

    formatted += `**Top ${topVolatile.length} Most Volatile Horses:**\n\n`;

    topVolatile.forEach((score, index) => {
      const medal =
        index === 0
          ? "🥇"
          : index === 1
            ? "🥈"
            : index === 2
              ? "🥉"
              : `${index + 1}.`;
      formatted += `${medal} **${score.runnerName}**\n`;
      formatted += `   - Volatility: ${score.volatility.rating} (${score.volatility.description})\n`;
      formatted += `   - Price Range: ${score.volatility.minPrice} - ${score.volatility.maxPrice}\n`;
      formatted += `   - Average Price: ${score.volatility.averagePrice.toFixed(1)}\n`;
      formatted += `   - Price Swing: ${(((score.volatility.maxPrice - score.volatility.minPrice) / score.volatility.averagePrice) * 100).toFixed(1)}%\n`;
      formatted += `   - Total Changes: ${score.updates.length}\n\n`;
    });

    // Add summary statistics
    const totalHorses = volatilityScores.length;
    const extremeCount = volatilityScores.filter(
      s => s.volatility.rating === "Extreme"
    ).length;
    const highCount = volatilityScores.filter(
      s => s.volatility.rating === "High"
    ).length;
    const mediumCount = volatilityScores.filter(
      s => s.volatility.rating === "Medium"
    ).length;
    const lowCount = volatilityScores.filter(
      s => s.volatility.rating === "Low" || s.volatility.rating === "Very Low"
    ).length;

    formatted += `**📊 Market Volatility Summary:**\n`;
    formatted += `- Total Horses Analyzed: ${totalHorses}\n`;
    formatted += `- Extreme Volatility: ${extremeCount} (${((extremeCount / totalHorses) * 100).toFixed(1)}%)\n`;
    formatted += `- High Volatility: ${highCount} (${((highCount / totalHorses) * 100).toFixed(1)}%)\n`;
    formatted += `- Medium Volatility: ${mediumCount} (${((mediumCount / totalHorses) * 100).toFixed(1)}%)\n`;
    formatted += `- Low/Very Low Volatility: ${lowCount} (${((lowCount / totalHorses) * 100).toFixed(1)}%)\n\n`;

    return formatted;
  }

  private getVolatilityScore(rating: string): number {
    switch (rating) {
      case "Extreme":
        return 5;
      case "High":
        return 4;
      case "Medium":
        return 3;
      case "Low":
        return 2;
      case "Very Low":
        return 1;
      default:
        return 0;
    }
  }

  private calculateVolatility(prices: number[]): {
    rating: string;
    description: string;
    minPrice: number;
    maxPrice: number;
    averagePrice: number;
    averagePricePercent: number;
  } {
    if (prices.length < 2) {
      return {
        rating: "Low",
        description: "Insufficient data for volatility analysis",
        minPrice: prices[0] || 0,
        maxPrice: prices[0] || 0,
        averagePrice: prices[0] || 0,
        averagePricePercent: 0,
      };
    }

    const minPrice = Math.min(...prices);
    const maxPrice = Math.max(...prices);
    const averagePrice =
      prices.reduce((sum, price) => sum + price, 0) / prices.length;

    // Calculate price swings
    const priceRange = maxPrice - minPrice;
    const averagePricePercent = (priceRange / averagePrice) * 100;

    let rating: string;
    let description: string;

    if (averagePricePercent > 100) {
      rating = "Extreme";
      description = "Massive price swings with high volatility";
    } else if (averagePricePercent > 50) {
      rating = "High";
      description = "Significant price movements and volatility";
    } else if (averagePricePercent > 20) {
      rating = "Medium";
      description = "Moderate price changes with some volatility";
    } else if (averagePricePercent > 10) {
      rating = "Low";
      description = "Relatively stable prices with low volatility";
    } else {
      rating = "Very Low";
      description = "Very stable prices with minimal volatility";
    }

    return {
      rating,
      description,
      minPrice,
      maxPrice,
      averagePrice,
      averagePricePercent,
    };
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
