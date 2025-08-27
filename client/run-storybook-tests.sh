#!/bin/bash

echo "🚀 Starting Storybook in headful mode..."
echo "📝 This will launch Storybook and then run Playwright tests to capture console output"
echo ""

# Start Storybook in the background
echo "Starting Storybook on port 6006..."
yarn storybook:headful &
STORYBOOK_PID=$!

# Wait for Storybook to start
echo "Waiting for Storybook to start..."
sleep 10

# Check if Storybook is running
if curl -s http://localhost:6006 > /dev/null; then
    echo "✅ Storybook is running on http://localhost:6006"
else
    echo "❌ Storybook failed to start"
    kill $STORYBOOK_PID 2>/dev/null
    exit 1
fi

echo ""
echo "🧪 Running Playwright tests to capture console output..."
echo ""

# Run Playwright tests
yarn test:playwright

echo ""
echo "📊 Test results saved to playwright-report/"
echo ""

# Stop Storybook
echo "🛑 Stopping Storybook..."
kill $STORYBOOK_PID 2>/dev/null

echo "✅ Done!"
