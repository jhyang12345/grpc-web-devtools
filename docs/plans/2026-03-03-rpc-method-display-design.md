# RPC Method Name Display Component

**Date:** 2026-03-03
**Status:** Approved

## Overview

Add a visual header component at the top of the JSON preview panel that displays the full RPC method path (e.g., `/grpc.health.v1.Health/Check`). This provides immediate context about which RPC method the user is viewing.

## User Requirements

- Display the full RPC method name at the top of the JSON preview area
- Position it as a separate component above the JSON content
- Make it visually distinct and easy to read

## Architecture

### Component Structure

Create a new presentational component `MethodHeader` at `src/components/MethodHeader.js`. This component:
- Accepts `method` as a prop (string containing the full RPC path)
- Renders a styled header bar with the method name
- Is a simple functional component (no state, no Redux connection)
- Is reusable and focused on single responsibility

### Integration Point

The component integrates into `NetworkDetails.js`:
- Position: Top of the details area, inside the `details-container` div
- Placed before the `details-scroll-area` div
- Conditionally rendered only when a method exists

### Visual Hierarchy

```
┌─────────────────────────────────────┐
│ MethodHeader (NEW)                  │
├─────────────────────────────────────┤
│ Payload warnings (existing)         │
│ JSON actions bar (existing)         │
│ ReactJson viewer (existing)         │
├─────────────────────────────────────┤
│ Payload metadata (existing)         │
└─────────────────────────────────────┘
```

## Component Design

### MethodHeader Component

**Props:**
- `method` (string, required): The full RPC method path

**Rendering:**
- Display the method string in monospace font
- Use a distinct background color (matching theme)
- Add padding for readability
- No interactive elements in initial version

**Example:**
```jsx
<MethodHeader method="/grpc.health.v1.Health/Check" />
```

### Styling Approach

Create `MethodHeader.css` with:
- Dark mode support using CSS variables or `prefers-color-scheme`
- Monospace font family (matching DevTools aesthetic)
- Subtle background color for distinction
- Padding: 8-12px for comfortable spacing
- Font size: slightly smaller than default (12-13px)
- Text color: high contrast for readability

Follow existing patterns from `NetworkDetails.css` and `Toolbar.css`.

## Data Flow

1. User selects a network entry in the list
2. `NetworkDetails` receives the selected entry from Redux state
3. Extract the `method` field from the entry
4. Pass `method` as prop to `<MethodHeader>`
5. Component renders the method name

No new state or Redux actions needed - uses existing data flow.

## Edge Cases

### Missing Method
If `entry.method` is null/undefined, don't render the MethodHeader component. This gracefully handles:
- Old cached entries without method data
- Malformed data

### Long Method Names
Method paths can be long (e.g., `/com.example.very.long.package.name.Service/VeryLongMethodName`). Handle with:
- Allow text wrapping if needed
- Use `word-break: break-all` or `overflow-wrap: break-word` CSS
- Consider horizontal scrolling if wrapping looks poor (evaluate during implementation)

### Theme Support
Support both light and dark modes:
- Use `window.matchMedia("(prefers-color-scheme: dark)")` pattern (already used in NetworkDetails)
- Or use CSS variables with `prefers-color-scheme` media queries

## Testing Approach

### Manual Testing
1. Load the extension in Chrome/Firefox
2. Trigger various gRPC calls (unary, streaming)
3. Verify method header displays correctly
4. Test with long method names
5. Test theme switching (light/dark mode)
6. Test with missing method data

### Visual Testing
- Compare with existing UI elements for consistency
- Verify alignment and spacing
- Check readability in both themes

## Implementation Steps

1. Create `src/components/MethodHeader.js`
   - Implement functional component
   - Accept `method` prop
   - Render method name in styled div

2. Create `src/components/MethodHeader.css`
   - Add background color
   - Set monospace font
   - Configure padding and spacing
   - Add dark mode support

3. Update `src/components/NetworkDetails.js`
   - Import MethodHeader component
   - Extract method from entry
   - Render MethodHeader conditionally before details-scroll-area

4. Manual testing with example app

## Future Enhancements (Out of Scope)

- Copy-to-clipboard button for method name
- Visual breakdown showing service vs method (e.g., highlight differently)
- Click to filter network list by service
- Method signature/type information

## Success Criteria

- Full RPC method path is visible at the top of the JSON preview
- Header is visually distinct from JSON content
- Works in both light and dark themes
- Handles missing method data gracefully
- Follows existing UI/UX patterns
