# Storybook Interaction Tests

Write Storybook stories with `play` interaction tests for a component in this project.

## Instructions

Given a component name or path, create or update `client/src/components/<Component>.stories.tsx` with:

### Meta block
```tsx
const meta: Meta<typeof <Component>> = {
  title: "Components/<Component>",
  component: <Component>,
  parameters: { layout: "centered" },
  tags: ["autodocs"],
  decorators: [Story => <div style={{ width: "400px" }}><Story /></div>],
  args: {
    // All callback props use fn() from @storybook/test
    onClose: fn(),
  },
};
```

### Required stories (all with `play` functions)
1. **PanelVisible** — assert root testID and list testID are in DOM
2. **ItemsRendered** — loop over mock items, assert each by testID
3. **CloseButton** — click the close button, assert callback called once
4. **LoadingState** — assert loading indicator visible, list absent
5. **ErrorState** — assert error message visible, list absent
6. **EmptyState** — assert empty-state text visible

### Interaction pattern
```tsx
play: async ({ canvasElement, args }) => {
  const canvas = within(canvasElement);
  await expect(canvas.getByTestId("...")).toBeInTheDocument();
  await userEvent.click(canvas.getByTestId("..."));
  await expect(args.onCallback).toHaveBeenCalledTimes(1);
},
```

### Imports
```tsx
import { within, userEvent, expect, fn } from "@storybook/test";
```

### testID conventions in this project
- `<thing>-panel` — root view
- `<thing>-loading` — ActivityIndicator wrapper
- `<thing>-error` — error view
- `<thing>-list` — ScrollView
- `<thing>-panel-close` or `<thing>-close` — close button
- `<thing>-item-{id}` — per-item views (or `<thing>-item-{index}`)

### Running tests

Storybook must be running at `localhost:6007` before executing the test runner:

```bash
# Terminal 1 — start Storybook
cd client && yarn storybook

# Terminal 2 — run all interaction tests
cd client && yarn storybook:test-runner
```

All play-function tests must pass before committing (required by CLAUDE.md). Use the `/dev-workflow` skill if you need to start multiple services at once.
