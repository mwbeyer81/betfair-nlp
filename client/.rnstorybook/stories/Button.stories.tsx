import React from 'react';
import type { Meta, StoryObj } from '@storybook/react';

import { View } from 'react-native';
import { fn } from 'storybook/test';
import { testLogger } from '../utils/testLogger';
import { loggedUserEvent, loggedWithin, loggedExpect, runLoggedTest } from '../utils/testHelpers';

import { Button } from './Button';

const meta = {
  title: 'Example/Button',
  component: Button,
  decorators: [
    (Story: React.ComponentType) => (
      <View style={{ flex: 1, alignItems: 'flex-start' }}>
        <Story />
      </View>
    ),
  ],
  // This component will have an automatically generated Autodocs entry: https://storybook.js.org/docs/writing-docs/autodocs
  tags: ['autodocs'],
  // Use `fn` to spy on the onPress arg, which will appear in the actions panel once invoked: https://storybook.js.org/docs/essentials/actions#action-args
  args: { onPress: fn() },
} satisfies Meta<typeof Button>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Primary: Story = {
  args: {
    primary: true,
    label: 'Button',
  },
};
Primary.play = async ({ canvasElement, args }) => {
  await runLoggedTest('Example/Button', 'Primary', canvasElement, args, async (context) => {
    const canvas = loggedWithin(canvasElement, context);
    
    // Test that primary button is rendered
    const button = canvas.getByRole('button', { name: 'Button' });
    loggedExpect(button, context).toBeInTheDocument();
    
    // Test button click
    await loggedUserEvent.click(button, context);
    loggedExpect(args.onPress, context).toHaveBeenCalled();
    
    testLogger.stateChange(context.storyName, context.testName, 'Button', 'clicked', {
      label: 'Button',
      primary: true
    });
  });
};

export const Secondary: Story = {
  args: {
    label: 'Button',
  },
};
Secondary.play = async ({ canvasElement, args }) => {
  await runLoggedTest('Example/Button', 'Secondary', canvasElement, args, async (context) => {
    const canvas = loggedWithin(canvasElement, context);
    
    // Test that secondary button is rendered
    const button = canvas.getByRole('button', { name: 'Button' });
    loggedExpect(button, context).toBeInTheDocument();
    
    // Test button click
    await loggedUserEvent.click(button, context);
    loggedExpect(args.onPress, context).toHaveBeenCalled();
    
    testLogger.stateChange(context.storyName, context.testName, 'Button', 'clicked', {
      label: 'Button',
      primary: false
    });
  });
};

export const Large: Story = {
  args: {
    size: 'large',
    label: 'Button',
  },
};
Large.play = async ({ canvasElement, args }) => {
  await runLoggedTest('Example/Button', 'Large', canvasElement, args, async (context) => {
    const canvas = loggedWithin(canvasElement, context);
    
    // Test that large button is rendered
    const button = canvas.getByRole('button', { name: 'Button' });
    loggedExpect(button, context).toBeInTheDocument();
    
    // Test button click
    await loggedUserEvent.click(button, context);
    loggedExpect(args.onPress, context).toHaveBeenCalled();
    
    testLogger.stateChange(context.storyName, context.testName, 'Button', 'clicked', {
      label: 'Button',
      size: 'large'
    });
  });
};

export const Small: Story = {
  args: {
    size: 'small',
    label: 'Button',
  },
};
Small.play = async ({ canvasElement, args }) => {
  await runLoggedTest('Example/Button', 'Small', canvasElement, args, async (context) => {
    const canvas = loggedWithin(canvasElement, context);
    
    // Test that small button is rendered
    const button = canvas.getByRole('button', { name: 'Button' });
    loggedExpect(button, context).toBeInTheDocument();
    
    // Test button click
    await loggedUserEvent.click(button, context);
    loggedExpect(args.onPress, context).toHaveBeenCalled();
    
    testLogger.stateChange(context.storyName, context.testName, 'Button', 'clicked', {
      label: 'Button',
      size: 'small'
    });
  });
};
