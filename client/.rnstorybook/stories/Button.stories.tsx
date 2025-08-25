import type { Meta, StoryObj } from '@storybook/react';

import { View } from 'react-native';
import { fn } from 'storybook/test';
import { expect } from '@storybook/test';
import { within, userEvent } from '@storybook/testing-library';

import { Button } from './Button';

const meta = {
  title: 'Example/Button',
  component: Button,
  decorators: [
    (Story) => (
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
  const canvas = within(canvasElement);
  
  // Test that primary button is rendered
  const button = canvas.getByRole('button', { name: 'Button' });
  expect(button).toBeInTheDocument();
  
  // Test button click
  await userEvent.click(button);
  expect(args.onPress).toHaveBeenCalled();
};

export const Secondary: Story = {
  args: {
    label: 'Button',
  },
};
Secondary.play = async ({ canvasElement, args }) => {
  const canvas = within(canvasElement);
  
  // Test that secondary button is rendered
  const button = canvas.getByRole('button', { name: 'Button' });
  expect(button).toBeInTheDocument();
  
  // Test button click
  await userEvent.click(button);
  expect(args.onPress).toHaveBeenCalled();
};

export const Large: Story = {
  args: {
    size: 'large',
    label: 'Button',
  },
};
Large.play = async ({ canvasElement, args }) => {
  const canvas = within(canvasElement);
  
  // Test that large button is rendered
  const button = canvas.getByRole('button', { name: 'Button' });
  expect(button).toBeInTheDocument();
  
  // Test button click
  await userEvent.click(button);
  expect(args.onPress).toHaveBeenCalled();
};

export const Small: Story = {
  args: {
    size: 'small',
    label: 'Button',
  },
};
Small.play = async ({ canvasElement, args }) => {
  const canvas = within(canvasElement);
  
  // Test that small button is rendered
  const button = canvas.getByRole('button', { name: 'Button' });
  expect(button).toBeInTheDocument();
  
  // Test button click
  await userEvent.click(button);
  expect(args.onPress).toHaveBeenCalled();
};
