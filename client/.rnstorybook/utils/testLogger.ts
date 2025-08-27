interface LogLevel {
  INFO: 'info';
  WARN: 'warn';
  ERROR: 'error';
  SUCCESS: 'success';
}

const LOG_LEVELS: LogLevel = {
  INFO: 'info',
  WARN: 'warn',
  ERROR: 'error',
  SUCCESS: 'success'
};

interface LogEntry {
  timestamp: string;
  level: string;
  story: string;
  test: string;
  message: string;
  data?: any;
}

class TestLogger {
  private logs: LogEntry[] = [];
  private isHeadless: boolean;

  constructor() {
    // Check if we're running in headless mode (CI environment)
    // Handle case where process is not defined (browser environment)
    this.isHeadless = (typeof process !== 'undefined' && process.env?.CI === 'true') || 
                     (typeof process !== 'undefined' && process.env?.STORYBOOK_HEADLESS === 'true') ||
                     (typeof process !== 'undefined' && process.argv?.includes('--ci')) ||
                     false;
  }

  private formatTimestamp(): string {
    return new Date().toISOString();
  }

  private log(level: string, story: string, test: string, message: string, data?: any) {
    const logEntry: LogEntry = {
      timestamp: this.formatTimestamp(),
      level,
      story,
      test,
      message,
      data
    };

    this.logs.push(logEntry);

    // In headless mode, output to console for terminal visibility
    if (this.isHeadless) {
      const prefix = `[${logEntry.timestamp}] [${level.toUpperCase()}] [${story}] [${test}]`;
      const logMessage = `${prefix}: ${message}`;
      
      switch (level) {
        case LOG_LEVELS.INFO:
          console.log(`\x1b[36m${logMessage}\x1b[0m`); // Cyan
          break;
        case LOG_LEVELS.WARN:
          console.log(`\x1b[33m${logMessage}\x1b[0m`); // Yellow
          break;
        case LOG_LEVELS.ERROR:
          console.log(`\x1b[31m${logMessage}\x1b[0m`); // Red
          break;
        case LOG_LEVELS.SUCCESS:
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

  info(story: string, test: string, message: string, data?: any) {
    this.log(LOG_LEVELS.INFO, story, test, message, data);
  }

  warn(story: string, test: string, message: string, data?: any) {
    this.log(LOG_LEVELS.WARN, story, test, message, data);
  }

  error(story: string, test: string, message: string, data?: any) {
    this.log(LOG_LEVELS.ERROR, story, test, message, data);
  }

  success(story: string, test: string, message: string, data?: any) {
    this.log(LOG_LEVELS.SUCCESS, story, test, message, data);
  }

  // Log test start
  testStart(story: string, test: string) {
    this.info(story, test, '🧪 Test started');
  }

  // Log test completion
  testComplete(story: string, test: string) {
    this.success(story, test, '✅ Test completed successfully');
  }

  // Log element interaction
  elementInteraction(story: string, test: string, elementType: string, action: string, elementData?: any) {
    this.info(story, test, `🖱️  ${elementType} interaction: ${action}`, elementData);
  }

  // Log assertion
  assertion(story: string, test: string, assertion: string, result: boolean, data?: any) {
    const status = result ? '✅ PASS' : '❌ FAIL';
    const level = result ? LOG_LEVELS.SUCCESS : LOG_LEVELS.ERROR;
    this.log(level, story, test, `🔍 Assertion: ${assertion} - ${status}`, data);
  }

  // Log user action
  userAction(story: string, test: string, action: string, data?: any) {
    this.info(story, test, `👤 User action: ${action}`, data);
  }

  // Log component state change
  stateChange(story: string, test: string, component: string, state: string, data?: any) {
    this.info(story, test, `🔄 ${component} state changed to: ${state}`, data);
  }

  // Get all logs (useful for debugging)
  getLogs(): LogEntry[] {
    return [...this.logs];
  }

  // Clear logs
  clear() {
    this.logs = [];
  }

  // Get logs as formatted string
  getLogsAsString(): string {
    return this.logs.map(log => 
      `[${log.timestamp}] [${log.level.toUpperCase()}] [${log.story}] [${log.test}]: ${log.message}`
    ).join('\n');
  }
}

// Export singleton instance
export const testLogger = new TestLogger();

// Export types for use in stories
export type { LogEntry };
export { LOG_LEVELS };
