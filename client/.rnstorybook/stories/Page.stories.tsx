import type { Meta } from '@storybook/react';
import { expect } from '@storybook/test';
import { within, userEvent } from '@storybook/testing-library';

import { Page } from './Page';

export default {
  title: 'Example/Page',
  component: Page,
} as Meta<typeof Page>;

export const Default = {};
Default.play = async ({ canvasElement }) => {
  const canvas = within(canvasElement);
  
  // Test that the page title is displayed
  const title = canvas.getByText(/welcome to storybook/i);
  expect(title).toBeInTheDocument();
  
  // Test that the page content is rendered
  const content = canvas.getByText(/edit the files and save to reload/i);
  expect(content).toBeInTheDocument();
  
  // Test that interactive elements are present
  const buttons = canvas.getAllByRole('button');
  expect(buttons.length).toBeGreaterThan(0);
};
