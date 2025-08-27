import { within, userEvent } from '@storybook/testing-library';
import { testLogger } from './testLogger';

export interface TestContext {
  canvasElement: any;
  args: any;
  storyName: string;
  testName: string;
}

// Wrapper for userEvent with logging
export const loggedUserEvent = {
  click: async (element: any, context: TestContext) => {
    testLogger.elementInteraction(
      context.storyName,
      context.testName,
      element.tagName || element.role || 'element',
      'click',
      { text: element.textContent, role: element.role }
    );
    return userEvent.click(element);
  },

  type: async (element: any, text: string, context: TestContext) => {
    testLogger.userAction(
      context.storyName,
      context.testName,
      `typing "${text}"`,
      { element: element.tagName || element.role, placeholder: element.placeholder }
    );
    return userEvent.type(element, text);
  },

  hover: async (element: any, context: TestContext) => {
    testLogger.elementInteraction(
      context.storyName,
      context.testName,
      element.tagName || element.role || 'element',
      'hover',
      { text: element.textContent, role: element.role }
    );
    return userEvent.hover(element);
  },

  unhover: async (element: any, context: TestContext) => {
    testLogger.elementInteraction(
      context.storyName,
      context.testName,
      element.tagName || element.role || 'element',
      'unhover',
      { text: element.textContent, role: element.role }
    );
    return userEvent.unhover(element);
  },

  tab: async (context: TestContext) => {
    testLogger.userAction(context.storyName, context.testName, 'pressing Tab key');
    return userEvent.tab();
  },

  keyboard: async (text: string, context: TestContext) => {
    testLogger.userAction(context.storyName, context.testName, `keyboard input: ${text}`);
    return userEvent.keyboard(text);
  }
};

// Wrapper for within with logging
export const loggedWithin = (canvasElement: any, context: TestContext) => {
  const canvas = within(canvasElement);
  
  return {
    ...canvas,
    getByRole: (role: string, options?: any) => {
      const element = canvas.getByRole(role, options);
      testLogger.info(
        context.storyName,
        context.testName,
        `Found element by role: ${role}`,
        { name: options?.name, element: element.tagName }
      );
      return element;
    },
    
    getByText: (text: string | RegExp, options?: any) => {
      const element = canvas.getByText(text, options);
      testLogger.info(
        context.storyName,
        context.testName,
        `Found element by text: ${text}`,
        { element: element.tagName, role: element.role }
      );
      return element;
    },
    
    getByPlaceholderText: (text: string | RegExp, options?: any) => {
      const element = canvas.getByPlaceholderText(text, options);
      testLogger.info(
        context.storyName,
        context.testName,
        `Found input by placeholder: ${text}`,
        { element: element.tagName, type: element.type }
      );
      return element;
    },
    
    getByTestId: (testId: string) => {
      const element = canvas.getByTestId(testId);
      testLogger.info(
        context.storyName,
        context.testName,
        `Found element by test ID: ${testId}`,
        { element: element.tagName, role: element.role }
      );
      return element;
    },
    
    queryByRole: (role: string, options?: any) => {
      const element = canvas.queryByRole(role, options);
      if (element) {
        testLogger.info(
          context.storyName,
          context.testName,
          `Found element by role: ${role}`,
          { name: options?.name, element: element.tagName }
        );
      } else {
        testLogger.warn(
          context.storyName,
          context.testName,
          `Element not found by role: ${role}`,
          { name: options?.name }
        );
      }
      return element;
    },
    
    queryByText: (text: string | RegExp, options?: any) => {
      const element = canvas.queryByText(text, options);
      if (element) {
        testLogger.info(
          context.storyName,
          context.testName,
          `Found element by text: ${text}`,
          { element: element.tagName, role: element.role }
        );
      } else {
        testLogger.warn(
          context.storyName,
          context.testName,
          `Element not found by text: ${text}`
        );
      }
      return element;
    }
  };
};

// Enhanced expect wrapper with logging
export const loggedExpect = (actual: any, context: TestContext) => {
  return {
    toBeInTheDocument: () => {
      const result = actual !== null && actual !== undefined;
      testLogger.assertion(
        context.storyName,
        context.testName,
        'element to be in document',
        result,
        { element: actual?.tagName, text: actual?.textContent }
      );
      return expect(actual).toBeInTheDocument();
    },
    
    toHaveValue: (expectedValue: string) => {
      const actualValue = actual.value;
      const result = actualValue === expectedValue;
      testLogger.assertion(
        context.storyName,
        context.testName,
        `element to have value "${expectedValue}"`,
        result,
        { expected: expectedValue, actual: actualValue }
      );
      return expect(actual).toHaveValue(expectedValue);
    },
    
    toBeDisabled: () => {
      const result = actual.disabled === true;
      testLogger.assertion(
        context.storyName,
        context.testName,
        'element to be disabled',
        result,
        { element: actual.tagName, disabled: actual.disabled }
      );
      return expect(actual).toBeDisabled();
    },
    
    toBeEnabled: () => {
      const result = actual.disabled !== true;
      testLogger.assertion(
        context.storyName,
        context.testName,
        'element to be enabled',
        result,
        { element: actual.tagName, disabled: actual.disabled }
      );
      return expect(actual).toBeEnabled();
    },
    
    toHaveBeenCalled: () => {
      const result = actual.mock && actual.mock.calls.length > 0;
      testLogger.assertion(
        context.storyName,
        context.testName,
        'function to have been called',
        result,
        { callCount: actual.mock?.calls?.length || 0 }
      );
      return expect(actual).toHaveBeenCalled();
    },
    
    toHaveBeenCalledWith: (...args: any[]) => {
      const result = actual.mock && actual.mock.calls.some((call: any[]) => 
        JSON.stringify(call) === JSON.stringify(args)
      );
      testLogger.assertion(
        context.storyName,
        context.testName,
        `function to have been called with ${JSON.stringify(args)}`,
        result,
        { expectedArgs: args, actualCalls: actual.mock?.calls || [] }
      );
      return expect(actual).toHaveBeenCalledWith(...args);
    }
  };
};

// Helper function to create test context
export const createTestContext = (canvasElement: any, args: any, storyName: string, testName: string): TestContext => {
  return {
    canvasElement,
    args,
    storyName,
    testName
  };
};

// Helper function to run a complete test with logging
export const runLoggedTest = async (
  storyName: string,
  testName: string,
  canvasElement: any,
  args: any,
  testFunction: (context: TestContext) => Promise<void>
) => {
  const context = createTestContext(canvasElement, args, storyName, testName);
  
  testLogger.testStart(storyName, testName);
  
  try {
    await testFunction(context);
    testLogger.testComplete(storyName, testName);
  } catch (error) {
    testLogger.error(storyName, testName, `Test failed: ${error}`, { error: error.message });
    throw error;
  }
};
