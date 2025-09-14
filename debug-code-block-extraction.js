// Test the code block extraction logic
const codeBlockRegex = /```(?:json|javascript|js)?\s*\n([\s\S]*?)\n```/;

// Simulate the OpenAI response with code blocks
const response = `\`\`\`json
{
  "mongoScript": "db.market_definitions.aggregate([{ \\"$group\\": { \\"_id\\": { \\"marketId\\": \\"$marketId\\", \\"name\\": \\"$name\\" }, \\"eventName\\": { \\"$first\\": \\"$eventName\\" }, \\"status\\": { \\"$first\\": \\"$status\\" }, \\"numberOfActiveRunners\\": { \\"$first\\": \\"$numberOfActiveRunners\\" }, \\"marketTime\\": { \\"$first\\": \\"$marketTime\\" } } }, { \\"$project\\": { \\"marketId\\": \\"$_id.marketId\\", \\"name\\": \\"$_id.name\\", \\"eventName\\": 1, \\"status\\": 1, \\"numberOfActiveRunners\\": 1, \\"marketTime\\": 1, \\"_id\\": 0 } }, { \\"$sort\\": { \\"name\\": 1 } }])",
  "naturalLanguageInterpretation": "This script retrieves a list of all horse races from the database. It groups the races by their unique market ID and name to avoid duplicates, and it also includes the event name, status, number of active runners, and scheduled market time for each race. The results are sorted by the race name in alphabetical order."
}
\`\`\``;

console.log("🔍 Raw response:");
console.log(response);
console.log("\n" + "=".repeat(50) + "\n");

const match = response.match(codeBlockRegex);

if (match && match[1]) {
  console.log("🔍 Extracted from code block:");
  console.log(JSON.stringify(match[1]));
  console.log("\n🔍 Raw extracted:");
  console.log(match[1]);

  try {
    // Clean the JSON string before parsing
    let jsonString = match[1].trim();
    console.log("\n🔍 After trim:");
    console.log(JSON.stringify(jsonString));

    // Remove any extra quotes that might be wrapping the JSON
    if (jsonString.startsWith('"') && jsonString.endsWith('"')) {
      jsonString = jsonString.slice(1, -1);
      console.log("\n🔍 Removed outer quotes:");
      console.log(JSON.stringify(jsonString));
    }

    // Unescape any escaped quotes
    jsonString = jsonString.replace(/\\"/g, '"');
    console.log("\n🔍 After unescaping:");
    console.log(JSON.stringify(jsonString));

    const parsed = JSON.parse(jsonString);
    console.log("\n🔍 Parsed JSON:");
    console.log(JSON.stringify(parsed, null, 2));

    console.log("\n🔍 mongoScript value:");
    console.log(JSON.stringify(parsed.mongoScript));
    console.log("\n🔍 mongoScript raw:");
    console.log(parsed.mongoScript);
  } catch (parseError) {
    console.log("\n❌ Failed to parse JSON:");
    console.log(parseError.message);
  }
} else {
  console.log("❌ No code block found");
}
