# Query History Feature

## Overview
The query history feature allows users to navigate through their previous queries using arrow keys, similar to a Linux terminal.

## Implementation

### State Management
- `queryHistory`: Array storing all previous queries
- `historyIndex`: Tracks current position in history (-1 = current input)

### Keyboard Navigation
- **↑ Arrow Up**: Cycles backward through query history
- **↓ Arrow Down**: Cycles forward through history, back to current input

### Logic Flow
1. User sends a query → Added to `queryHistory`, `historyIndex` reset to -1
2. User presses ↑ → `historyIndex` increases, shows previous query
3. User presses ↓ → `historyIndex` decreases, shows newer query
4. At `historyIndex` 0 → Returns to current input (empty)

## Testing

### Storybook Stories
- `WithQueryHistory`: Basic history display
- `InteractiveTest`: Full interactive testing with controls

### Console Test
Run `node test-query-history.js` to verify the logic works correctly.

## Potential Issues

### React Native Limitations
1. **Arrow Key Events**: React Native `TextInput` may not handle arrow key events the same way as web browsers
2. **Event Handling**: `onKeyPress` might not capture arrow keys consistently
3. **Platform Differences**: iOS vs Android might behave differently

### Debugging
- Check console logs for key press events
- Verify `onHistoryChange` is being called
- Test in actual React Native app, not just Storybook

## Troubleshooting

### If Arrow Keys Don't Work:
1. **Check Console**: Look for "🔼 ArrowUp pressed" or "🔽 ArrowDown pressed" logs
2. **Verify Props**: Ensure `queryHistory` and `historyIndex` are being passed correctly
3. **Test Logic**: Run the Node.js test script to verify the logic works
4. **Platform Test**: Test on actual device/simulator, not just Storybook

### Alternative Solutions:
1. **Touch Controls**: Add up/down buttons for mobile
2. **Swipe Gestures**: Implement swipe up/down for history navigation
3. **Dropdown Menu**: Show history in a dropdown below input

## Expected Behavior
```
Initial: historyIndex = -1, input = ""
Press ↑: historyIndex = 0, input = "most recent query"
Press ↑: historyIndex = 1, input = "second most recent query"
Press ↓: historyIndex = 0, input = "most recent query"
Press ↓: historyIndex = -1, input = ""
```

## Files Modified
- `ChatScreen.tsx`: Added history state management
- `ChatInput.tsx`: Added keyboard navigation logic
- `ChatInput.stories.tsx`: Added Storybook stories for testing
- `test-query-history.js`: Logic verification script
