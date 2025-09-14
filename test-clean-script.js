// Test the cleanScript method
function cleanScript(script) {
  // Remove markdown code blocks
  let cleaned = script.replace(/```javascript\n?/g, "").replace(/```\n?/g, "");

  // Remove outer quotes if present (handle both single and double quotes)
  // Keep removing quotes until none are left
  while (
    (cleaned.startsWith('"') && cleaned.endsWith('"')) ||
    (cleaned.startsWith("'") && cleaned.endsWith("'"))
  ) {
    cleaned = cleaned.slice(1, -1).trim();
  }

  // Unescape inner quotes
  cleaned = cleaned.replace(/\\"/g, '"');
  cleaned = cleaned.replace(/\\'/g, "'");

  return cleaned;
}

// Test with the problematic script
const problematicScript =
  '"db.market_definitions.aggregate([{ \\"$group\\": { \\"_id\\": { \\"marketId\\": \\"$marketId\\", \\"name\\": \\"$name\\" }, \\"eventName\\": { \\"$first\\": \\"$eventName\\" }, \\"status\\": { \\"$first\\": \\"$status\\" }, \\"numberOfActiveRunners\\": { \\"$first\\": \\"$numberOfActiveRunners\\" }, \\"marketTime\\": { \\"$first\\": \\"$marketTime\\" } } }, { \\"$project\\": { \\"marketId\\": \\"$_id.marketId\\", \\"name\\": \\"$_id.name\\", \\"eventName\\": 1, \\"status\\": 1, \\"numberOfActiveRunners\\": 1, \\"marketTime\\": 1, \\"_id\\": 0 } }, { \\"$sort\\": { \\"name\\": 1 } }])"';

console.log("🔍 Original script:");
console.log(JSON.stringify(problematicScript));
console.log("\n🔍 Cleaned script:");
const cleaned = cleanScript(problematicScript);
console.log(JSON.stringify(cleaned));
console.log("\n🔍 Cleaned script (raw):");
console.log(cleaned);
