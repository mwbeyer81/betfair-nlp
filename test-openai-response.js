#!/usr/bin/env node

/**
 * Test script to see the raw OpenAI response for "show all races"
 */

const { OpenAI } = require("openai");
const config = require("config");

async function testOpenAIResponse() {
  try {
    const openai = new OpenAI({
      apiKey: config.get("openai.apiKey"),
    });

    console.log('🤖 Testing OpenAI response for "show all races"...\n');

    const response = await openai.chat.completions.create({
      model: "gpt-4",
      messages: [
        {
          role: "system",
          content: `You are a MongoDB expert. Generate a MongoDB query for horse racing data.

Available collections:
- market_definitions: Contains race information (marketId, name, eventName, status, numberOfActiveRunners, marketTime)
- price_updates: Contains horse price/odds information (lastTradedPrice, timestamp, selectionId)

Return ONLY a JSON object with this exact structure:
{
  "mongoScript": "your_mongodb_query_here",
  "naturalLanguageInterpretation": "explanation_of_what_the_query_does"
}

IMPORTANT: The mongoScript should be properly escaped for JSON. Use \\" for quotes inside the script.
For example: "db.collection.find({\\"field\\": \\"value\\"})"

Do not include any markdown code blocks or extra formatting.`,
        },
        {
          role: "user",
          content: "list all races",
        },
      ],
      temperature: 0.1,
    });

    const content = response.choices[0].message.content;
    console.log("📝 Raw OpenAI Response:");
    console.log("=".repeat(50));
    console.log(content);
    console.log("=".repeat(50));

    // Try to parse as JSON
    try {
      const parsed = JSON.parse(content);
      console.log("\n✅ Successfully parsed JSON:");
      console.log(JSON.stringify(parsed, null, 2));

      console.log("\n🔍 MongoDB Script:");
      console.log(parsed.mongoScript);

      console.log("\n📖 Interpretation:");
      console.log(parsed.naturalLanguageInterpretation);
    } catch (parseError) {
      console.log("\n❌ Failed to parse JSON:");
      console.log(parseError.message);

      // Try to extract JSON from markdown
      const codeBlockRegex = /```(?:json|javascript|js)?\s*\n([\s\S]*?)\n```/;
      const match = content.match(codeBlockRegex);

      if (match && match[1]) {
        console.log("\n🔍 Found code block:");
        console.log(match[1]);

        try {
          const parsed = JSON.parse(match[1]);
          console.log("\n✅ Successfully parsed code block JSON:");
          console.log(JSON.stringify(parsed, null, 2));
        } catch (codeBlockError) {
          console.log("\n❌ Failed to parse code block JSON:");
          console.log(codeBlockError.message);
        }
      }
    }
  } catch (error) {
    console.error("❌ Error:", error.message);
  }
}

testOpenAIResponse();
