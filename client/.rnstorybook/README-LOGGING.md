# Storybook Interaction Test Logging

This document explains how to use the enhanced logging system for Storybook interaction tests that provides detailed output in the terminal when running in headless mode.

## Overview

The logging system provides comprehensive visibility into interaction tests by:
- Logging all test steps with timestamps
- Color-coded output for different log levels
- Detailed information about element interactions
- Assertion results with pass/fail status
- Component state changes
- User actions

## Quick Start

### 1. Import the logging utilities

```typescript
import { testLogger } from '../utils/testLogger';
import { loggedUserEvent, loggedWithin, loggedExpect, runLoggedTest } from '../utils/testHelpers';
```

### 2. Wrap your test with runLoggedTest

```typescript
export const MyStory = Template.bind({});
MyStory.play = async ({ canvasElement, args }) => {
  await runLoggedTest('StoryName', 'TestName', canvasElement, args, async (context) => {
    // Your test code here
  });
};
```

### 3. Use the logged utilities

```typescript
const canvas = loggedWithin(canvasElement, context);
const button = canvas.getByRole('button', { name: 'Submit' });
await loggedUserEvent.click(button, context);
loggedExpect(args.onClick, context).toHaveBeenCalled();
```

## Available Utilities

### testLogger

Direct logging functions for custom messages:

```typescript
// Basic logging
testLogger.info(storyName, testName, 'Custom message');
testLogger.warn(storyName, testName, 'Warning message');
testLogger.error(storyName, testName, 'Error message');
testLogger.success(storyName, testName, 'Success message');

// Specialized logging
testLogger.testStart(storyName, testName);
testLogger.testComplete(storyName, testName);
testLogger.elementInteraction(storyName, testName, 'button', 'click', { data: 'value' });
testLogger.assertion(storyName, testName, 'element to be visible', true);
testLogger.userAction(storyName, testName, 'typing text');
testLogger.stateChange(storyName, testName, 'Component', 'new state', { data: 'value' });
```

### loggedUserEvent

Enhanced user interaction functions with logging:

```typescript
// All functions take a context parameter for logging
await loggedUserEvent.click(element, context);
await loggedUserEvent.type(element, 'text', context);
await loggedUserEvent.hover(element, context);
await loggedUserEvent.unhover(element, context);
await loggedUserEvent.tab(context);
await loggedUserEvent.keyboard('text', context);
```

### loggedWithin

Enhanced element querying with logging:

```typescript
const canvas = loggedWithin(canvasElement, context);

// All standard within methods with added logging
const element = canvas.getByRole('button', { name: 'Submit' });
const text = canvas.getByText('Hello World');
const input = canvas.getByPlaceholderText('Enter text...');
const testId = canvas.getByTestId('my-element');

// Query methods (won't throw if not found)
const maybeElement = canvas.queryByRole('button');
const maybeText = canvas.queryByText('Optional text');
```

### loggedExpect

Enhanced assertions with logging:

```typescript
loggedExpect(element, context).toBeInTheDocument();
loggedExpect(input, context).toHaveValue('expected text');
loggedExpect(button, context).toBeDisabled();
loggedExpect(button, context).toBeEnabled();
loggedExpect(mockFunction, context).toHaveBeenCalled();
loggedExpect(mockFunction, context).toHaveBeenCalledWith('arg1', 'arg2');
```

## Running Tests in Headless Mode

### Using npm scripts

```bash
# Run Storybook in headless mode with logging
npm run storybook:headless

# Or with CI flag
STORYBOOK_HEADLESS=true npm run storybook:headless
```

### Environment Variables

The logging system automatically detects headless mode when:
- `CI=true` environment variable is set
- `STORYBOOK_HEADLESS=true` environment variable is set
- `--ci` flag is passed to the Storybook command

## Example Output

When running in headless mode, you'll see output like this:

```
[2024-01-15T10:30:00.000Z] [INFO] [Example/Button] [Primary]: 🧪 Test started
[2024-01-15T10:30:00.100Z] [INFO] [Example/Button] [Primary]: Found element by role: button
[2024-01-15T10:30:00.200Z] [SUCCESS] [Example/Button] [Primary]: 🔍 Assertion: element to be in document - ✅ PASS
[2024-01-15T10:30:00.300Z] [INFO] [Example/Button] [Primary]: 🖱️ button interaction: click
[2024-01-15T10:30:00.400Z] [SUCCESS] [Example/Button] [Primary]: 🔍 Assertion: function to have been called - ✅ PASS
[2024-01-15T10:30:00.500Z] [INFO] [Example/Button] [Primary]: 🔄 Button state changed to: clicked
[2024-01-15T10:30:00.600Z] [SUCCESS] [Example/Button] [Primary]: ✅ Test completed successfully
```

## Color Coding

- 🔵 **Cyan**: Info messages
- 🟡 **Yellow**: Warning messages  
- 🔴 **Red**: Error messages
- 🟢 **Green**: Success messages
- ⚪ **Gray**: Additional data/JSON output

## Best Practices

### 1. Use descriptive test names

```typescript
await runLoggedTest('Components/Button', 'PrimaryButtonClick', canvasElement, args, async (context) => {
  // Test implementation
});
```

### 2. Log important state changes

```typescript
testLogger.stateChange(context.storyName, context.testName, 'Form', 'submitted', {
  fieldCount: 3,
  hasErrors: false
});
```

### 3. Use context for all logged operations

```typescript
// ✅ Good
await loggedUserEvent.click(button, context);
loggedExpect(result, context).toBeInTheDocument();

// ❌ Bad
await userEvent.click(button);
expect(result).toBeInTheDocument();
```

### 4. Add custom logging for complex scenarios

```typescript
testLogger.info(context.storyName, context.testName, 'Starting multi-step form test');
// ... test steps ...
testLogger.success(context.storyName, context.testName, 'Multi-step form completed successfully');
```

## Troubleshooting

### Logs not appearing in terminal

1. Ensure you're running in headless mode:
   ```bash
   STORYBOOK_HEADLESS=true npm run storybook:headless
   ```

2. Check that the CI environment is detected:
   ```bash
   CI=true npm run storybook:headless
   ```

### Test failures with logging

The logging system will show detailed information about failures:

```
[2024-01-15T10:30:00.000Z] [ERROR] [Example/Button] [Primary]: 🔍 Assertion: element to be in document - ❌ FAIL
{
  "element": null,
  "text": null
}
```

### Performance considerations

- Logging only occurs in headless mode to avoid performance impact in development
- Large data objects are automatically truncated in logs
- Use `testLogger.clear()` to clear logs if needed

## Migration Guide

### From standard testing to logged testing

**Before:**
```typescript
export const MyStory = Template.bind({});
MyStory.play = async ({ canvasElement, args }) => {
  const canvas = within(canvasElement);
  const button = canvas.getByRole('button');
  await userEvent.click(button);
  expect(args.onClick).toHaveBeenCalled();
};
```

**After:**
```typescript
export const MyStory = Template.bind({});
MyStory.play = async ({ canvasElement, args }) => {
  await runLoggedTest('StoryName', 'TestName', canvasElement, args, async (context) => {
    const canvas = loggedWithin(canvasElement, context);
    const button = canvas.getByRole('button');
    await loggedUserEvent.click(button, context);
    loggedExpect(args.onClick, context).toHaveBeenCalled();
  });
};
```

This logging system provides comprehensive visibility into your interaction tests, making debugging and monitoring much easier in CI/CD environments.
