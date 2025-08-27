const { exec } = require("child_process");

const url = "http://localhost:6006/?path=/story/components-chatinput--default";

console.log("🚀 Opening ChatInput story in your default browser...");
console.log(`📱 URL: ${url}`);

// Use the 'open' command on macOS to open the URL in the default browser
exec(`open "${url}"`, (error, stdout, stderr) => {
  if (error) {
    console.error("❌ Error opening browser:", error.message);
    console.log("💡 Try manually opening this URL in your browser:");
    console.log(`   ${url}`);
    return;
  }

  if (stderr) {
    console.error("⚠️ Warning:", stderr);
  }

  console.log("✅ Browser opened successfully!");
  console.log("🔍 Check if the ChatInput component renders properly now.");
});
