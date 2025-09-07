// Simple test script to verify query history logic
// Run this with: node test-query-history.js

console.log("🧪 Testing Query History Logic...\n");

// Simulate the query history logic
class QueryHistoryTester {
  constructor() {
    this.queryHistory = [
      "list all races",
      "show runners for race X",
      "price updates for horse Y",
      "second most recent race",
    ];
    this.historyIndex = -1;
    this.currentInput = "";
  }

  // Simulate pressing ↑ (arrow up)
  arrowUp() {
    console.log("⬆️  Arrow Up pressed");
    if (
      this.queryHistory.length > 0 &&
      this.historyIndex < this.queryHistory.length - 1
    ) {
      this.historyIndex++;
      this.currentInput =
        this.queryHistory[this.queryHistory.length - 1 - this.historyIndex];
      console.log(
        `✅ History index: ${this.historyIndex}, Input: "${this.currentInput}"`
      );
    } else {
      console.log("❌ Cannot go further back in history");
    }
    this.printState();
  }

  // Simulate pressing ↓ (arrow down)
  arrowDown() {
    console.log("⬇️  Arrow Down pressed");
    if (this.historyIndex > 0) {
      this.historyIndex--;
      this.currentInput =
        this.queryHistory[this.queryHistory.length - 1 - this.historyIndex];
      console.log(
        `✅ History index: ${this.historyIndex}, Input: "${this.currentInput}"`
      );
    } else if (this.historyIndex === 0) {
      this.historyIndex = -1;
      this.currentInput = "";
      console.log("✅ Back to current input (empty)");
    } else {
      console.log("❌ Already at current input");
    }
    this.printState();
  }

  // Simulate sending a message
  sendMessage(message) {
    console.log(`📤 Sending message: "${message}"`);
    this.queryHistory.push(message);
    this.historyIndex = -1;
    this.currentInput = "";
    console.log("✅ Message added to history, index reset to -1");
    this.printState();
  }

  printState() {
    console.log(`\n📊 Current State:`);
    console.log(`   History Index: ${this.historyIndex}`);
    console.log(`   Current Input: "${this.currentInput}"`);
    console.log(`   History Length: ${this.queryHistory.length}`);
    console.log(`   History: [${this.queryHistory.join(", ")}]`);
    console.log("");
  }
}

// Run the test
const tester = new QueryHistoryTester();

console.log("🎯 Initial State:");
tester.printState();

console.log("🔄 Testing Arrow Up (should go back in history):");
tester.arrowUp();
tester.arrowUp();
tester.arrowUp();

console.log("🔄 Testing Arrow Down (should go forward in history):");
tester.arrowDown();
tester.arrowDown();
tester.arrowDown();

console.log("🔄 Testing sending a new message:");
tester.sendMessage("new test query");

console.log("🔄 Testing Arrow Up after new message:");
tester.arrowUp();
tester.arrowUp();

console.log("🎉 Test completed! Check the logic above.");
console.log("\n💡 Expected behavior:");
console.log("   • Arrow Up: cycles backward through history");
console.log("   • Arrow Down: cycles forward through history");
console.log("   • Send Message: adds to history and resets index");
console.log("   • History index -1 = current input (empty)");
console.log("   • History index 0 = most recent query");
console.log("   • History index 1 = second most recent query");
console.log("   • etc.");
