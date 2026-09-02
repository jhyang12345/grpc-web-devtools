# RPC Method Name Display Header Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a visual header component displaying the full RPC method path at the top of the JSON preview panel.

**Architecture:** Create a presentational React component (MethodHeader) that displays the RPC method name in a styled header bar. Integrate it into NetworkDetails component above the JSON viewer. Use CSS variables for theming to support both light and dark modes.

**Tech Stack:** React (class components), CSS with CSS variables, existing DevTools theme system

---

## Task 1: Create MethodHeader Component

**Files:**
- Create: `src/components/MethodHeader.js`
- Create: `src/components/MethodHeader.css`

**Step 1: Create the basic MethodHeader component file**

Create `src/components/MethodHeader.js`:

```javascript
// Copyright (c) 2019 SafetyCulture Pty Ltd. All Rights Reserved.

import React from 'react';
import './MethodHeader.css';

const MethodHeader = ({ method }) => {
  if (!method) {
    return null;
  }

  return (
    <div className="method-header">
      <span className="method-header-text">{method}</span>
    </div>
  );
};

export default MethodHeader;
```

**Step 2: Create the CSS file for MethodHeader**

Create `src/components/MethodHeader.css`:

```css
.method-header {
  background-color: var(--toolbar-bg-color);
  border-bottom: 1px solid var(--divider-color);
  padding: 8px 12px;
  font-family: Menlo, Monaco, 'Courier New', monospace;
  font-size: 12px;
  color: var(--toolbar-color);
  flex-shrink: 0;
  word-break: break-all;
  overflow-wrap: break-word;
}

.method-header-text {
  font-weight: 500;
  line-height: 1.4;
}
```

**Step 3: Verify the component renders correctly in isolation**

Manual verification:
- Component accepts `method` prop
- Returns null when method is missing
- Renders method text in styled container
- Uses existing CSS variables for theming

**Step 4: Commit the component**

```bash
git add src/components/MethodHeader.js src/components/MethodHeader.css
git commit -m "feat: create MethodHeader component for displaying RPC method names

Add new presentational component that displays the full RPC method path
in a styled header bar. Supports dark mode via CSS variables.

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

---

## Task 2: Integrate MethodHeader into NetworkDetails

**Files:**
- Modify: `src/components/NetworkDetails.js:1-20` (imports)
- Modify: `src/components/NetworkDetails.js:95-115` (render method)

**Step 1: Import MethodHeader in NetworkDetails**

At the top of `src/components/NetworkDetails.js`, add the import after other component imports (around line 9):

```javascript
import MethodIcon from "./MethodIcon";
import MethodHeader from "./MethodHeader";
import SearchBar from "./SearchBar";
```

**Step 2: Add MethodHeader to the render method**

In the `render()` method of NetworkDetails (around line 99), add the MethodHeader component before the `details-scroll-area` div:

Modify the return statement from:
```javascript
return (
  <div className="widget vbox details-container">
    {this._renderContent(entry)}
    {searchActive && (
```

To:
```javascript
return (
  <div className="widget vbox details-container">
    {entry?.method && <MethodHeader method={entry.method} />}
    {this._renderContent(entry)}
    {searchActive && (
```

**Step 3: Verify integration by manual testing**

Test procedure:
1. Build the extension: `npm run build` or `make build`
2. Load the extension in Chrome (chrome://extensions)
3. Open the example app: `make example-up` then visit http://localhost:8080
4. Open DevTools → gRPC-Web tab
5. Trigger some RPC calls
6. Click on a network entry
7. Verify the method name appears at the top of the JSON preview

Expected behavior:
- Method header appears above payload warnings
- Shows full path like `/grpc.health.v1.Health/Check`
- Header has distinct background color
- Works in both light and dark themes

**Step 4: Test edge cases**

Test these scenarios:
1. **No method data:** Click on an old/cached entry without method - header should not appear
2. **Long method name:** Use a long method path like `/com.example.very.long.package.Service/VeryLongMethodNameHere` - text should wrap
3. **Theme switching:** Change system theme (light ↔ dark) - header colors should adapt

**Step 5: Commit the integration**

```bash
git add src/components/NetworkDetails.js
git commit -m "feat: integrate MethodHeader into NetworkDetails component

Display the full RPC method path at the top of the JSON preview panel.
Component renders conditionally when method data is available.

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

---

## Task 3: Visual Polish and Testing

**Files:**
- Modify: `src/components/MethodHeader.css` (if styling adjustments needed)

**Step 1: Visual review in both themes**

Check the following in Chrome DevTools:
1. Light mode appearance
2. Dark mode appearance
3. Spacing around the header
4. Font size and readability
5. Border visibility

If adjustments are needed, modify `MethodHeader.css`.

**Step 2: Test with various RPC methods**

Test with different method types:
1. Unary methods (single request/response)
2. Server streaming methods (multiple responses)
3. Methods with errors
4. Methods from different services

Verify header displays correctly in all cases.

**Step 3: Cross-browser testing (optional)**

If Firefox support is needed:
1. Build for Firefox: `make package`
2. Load in Firefox (about:debugging)
3. Test the same scenarios
4. Verify rendering is consistent

**Step 4: Performance check**

Verify performance with many network entries:
1. Trigger 50+ RPC calls
2. Click through various entries
3. Ensure no lag or rendering issues
4. Check that header updates quickly when switching entries

**Step 5: Final commit (if any changes)**

If any styling or minor adjustments were made:

```bash
git add src/components/MethodHeader.css
git commit -m "style: polish MethodHeader appearance and spacing

Fine-tune visual appearance, spacing, and cross-browser compatibility.

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

---

## Task 4: Documentation and Cleanup

**Files:**
- Modify: `docs/plans/2026-03-03-rpc-method-display-design.md`

**Step 1: Update design doc with implementation notes**

Add an "Implementation Notes" section at the end of the design doc:

```markdown
## Implementation Notes

**Completed:** 2026-03-03

### Implementation Details
- Component created as functional React component
- Integrated into NetworkDetails above the scroll area
- Uses existing CSS variable system for theming
- Renders conditionally based on method availability

### Testing Performed
- Manual testing in Chrome
- Dark and light theme verification
- Edge case testing (missing method, long names)
- Performance verified with 50+ entries

### Files Modified
- Created: `src/components/MethodHeader.js`
- Created: `src/components/MethodHeader.css`
- Modified: `src/components/NetworkDetails.js`
```

**Step 2: Verify all files are committed**

```bash
git status
```

Expected: Clean working tree with all changes committed.

**Step 3: Review commit history**

```bash
git log --oneline -5
```

Verify commits are clear and descriptive.

**Step 4: Final commit for documentation**

```bash
git add docs/plans/2026-03-03-rpc-method-display-design.md
git commit -m "docs: add implementation notes to RPC method display design

Document completion, testing performed, and files modified.

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

---

## Manual Testing Checklist

Before considering this feature complete, verify:

- [ ] Method header appears when entry has method data
- [ ] Method header does NOT appear when entry lacks method data
- [ ] Full method path is displayed (e.g., `/service.Package/Method`)
- [ ] Header has distinct background color
- [ ] Text is readable in light mode
- [ ] Text is readable in dark mode
- [ ] Long method names wrap properly
- [ ] Header updates when switching between entries
- [ ] No console errors
- [ ] No visual glitches or layout issues
- [ ] Performance is acceptable with many entries
- [ ] Works in Chrome
- [ ] (Optional) Works in Firefox

---

## Rollback Plan

If issues are found and need to revert:

```bash
# Find the commit before MethodHeader work
git log --oneline

# Reset to that commit (replace <commit-hash>)
git reset --hard <commit-hash>

# Or revert individual commits
git revert <commit-hash-1> <commit-hash-2> <commit-hash-3>
```

---

## Future Enhancements (Out of Scope)

- Copy-to-clipboard button for method name
- Visual breakdown of service vs method
- Click to filter by service
- Method signature/type information display
