const { OpenAI } = require("openai");
const config = require("config");
const fs = require("fs");
const path = require("path");

async function debugComplexQuery() {
  try {
    const openai = new OpenAI({
      apiKey: config.get("openai.apiKey"),
    });

    // Load the same instructions as the API
    const instructionsPath = path.join(
      __dirname,
      "src/lib/service/prompts/horse-racing-assistant.md"
    );
    const instructions = fs.readFileSync(instructionsPath, "utf-8");
    const combinedInstructions = instructions.replace(
      "${query}",
      "list all races"
    );

    console.log(
      "🤖 Testing OpenAI response for 'list all races' with actual API instructions...\n"
    );

    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "user",
          content: combinedInstructions,
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
      console.log("Raw value:", JSON.stringify(parsed.mongoScript));
      console.log("Type:", typeof parsed.mongoScript);
      console.log("Length:", parsed.mongoScript.length);
      console.log("First 100 chars:", parsed.mongoScript.substring(0, 100));
      console.log(
        "Last 100 chars:",
        parsed.mongoScript.substring(parsed.mongoScript.length - 100)
      );
    } catch (parseError) {
      console.log("\n❌ Failed to parse JSON:");
      console.log(parseError.message);
    }
  } catch (error) {
    console.error("❌ Error:", error.message);
  }
}

debugComplexQuery();
