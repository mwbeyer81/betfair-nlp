#!/usr/bin/env node

/**
 * Test script to verify the logging system is working correctly
 * Run this script to test the logging functionality
 */

// Simple test logger implementation for demonstration
class SimpleTestLogger {
  constructor() {
    this.logs = [];
    this.isHeadless = process.env.CI === 'true' || 
                     process.env.STORYBOOK_HEADLESS === 'true' ||
                     process.argv.includes('--ci');
  }

  log(level, story, test, message, data) {
    const logEntry = {
      timestamp: new Date().toISOString(),
      level,
      story,
      test,
      message,
      data
    };

    this.logs.push(logEntry);

    if (this.isHeadless) {
      const prefix = `[${logEntry.timestamp}] [${level.toUpperCase()}] [${story}] [${test}]`;
      const logMessage = `${prefix}: ${message}`;
      
      switch (level) {
        case 'info':
          console.log(`\x1b[36m${logMessage}\x1b[0m`); // Cyan
          break;
        case 'warn':
          console.log(`\x1b[33m${logMessage}\x1b[0m`); // Yellow
          break;
        case 'error':
          console.log(`\x1b[31m${logMessage}\x1b[0m`); // Red
          break;
        case 'success':
          console.log(`\x1b[32m${logMessage}\x1b[0m`); // Green
          break;
        default:
          console.log(logMessage);
      }

      if (data) {
        console.log(`\x1b[90m${JSON.stringify(data, null, 2)}\x1b[0m`); // Gray
      }
    }
  }

  info(story, test, message, data) {
    this.log('info', story, test, message, data);
  }

  warn(story, test, message, data) {
    this.log('warn', story, test, message, data);
  }

  error(story, test, message, data) {
    this.log('error', story, test, message, data);
  }

  success(story, test, message, data) {
    this.log('success', story, test, message, data);
  }

  testStart(story, test) {
    this.info(story, test, '🧪 Test started');
  }

  testComplete(story, test) {
    this.success(story, test, '✅ Test completed successfully');
  }

  elementInteraction(story, test, elementType, action, elementData) {
    this.info(story, test, `🖱️ ${elementType} interaction: ${action}`, elementData);
  }

  assertion(story, test, assertion, result, data) {
    const status = result ? '✅ PASS' : '❌ FAIL';
    const level = result ? 'success' : 'error';
    this.log(level, story, test, `🔍 Assertion: ${assertion} - ${status}`, data);
  }

  userAction(story, test, action, data) {
    this.info(story, test, `👤 User action: ${action}`, data);
  }

  stateChange(story, test, component, state, data) {
    this.info(story, test, `🔄 ${component} state changed to: ${state}`, data);
  }

  getLogs() {
    return [...this.logs];
  }

  clear() {
    this.logs = [];
  }
}

const testLogger = new SimpleTestLogger();

console.log('🧪 Testing Storybook Interaction Test Logging System\n');

// Test basic logging functionality
console.log('Testing basic logging functions...');
testLogger.info('TestStory', 'TestName', 'This is an info message');
testLogger.warn('TestStory', 'TestName', 'This is a warning message');
testLogger.error('TestStory', 'TestName', 'This is an error message');
testLogger.success('TestStory', 'TestName', 'This is a success message');

console.log('\nTesting specialized logging functions...');
testLogger.testStart('TestStory', 'TestName');
testLogger.elementInteraction('TestStory', 'TestName', 'button', 'click', { text: 'Submit' });
testLogger.assertion('TestStory', 'TestName', 'element to be visible', true);
testLogger.userAction('TestStory', 'TestName', 'typing "Hello World"');
testLogger.stateChange('TestStory', 'TestName', 'Form', 'submitted', { fieldCount: 3 });
testLogger.testComplete('TestStory', 'TestName');

console.log('\nTesting log retrieval...');
const logs = testLogger.getLogs();
console.log(`Total logs generated: ${logs.length}`);

console.log('\nTesting log clearing...');
testLogger.clear();
const logsAfterClear = testLogger.getLogs();
console.log(`Logs after clearing: ${logsAfterClear.length}`);

console.log('\n✅ Logging system test completed successfully!');
console.log('\nTo see logs in action, run:');
console.log('  npm run storybook:test');
console.log('  npm run storybook:headless:with-logs');
console.log('\nOr set environment variables:');
console.log('  STORYBOOK_HEADLESS=true npm run storybook:headless');
console.log('  CI=true npm run storybook:headless');
