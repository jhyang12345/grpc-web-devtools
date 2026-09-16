import React from 'react';
import { formatElapsed, formatFrameUrl, formatReplayProvenance, formatReplayTiming, getNetworkRowClassName, NetworkListRow } from '../components/NetworkListRow';

function findByClassName(node, className) {
  if (!node || typeof node !== 'object') return null;
  if (node.props?.className === className) return node;
  return React.Children.toArray(node.props?.children)
    .map(child => findByClassName(child, className))
    .find(Boolean) || null;
}

test('formats a compact frame URL while retaining a safe fallback for malformed values', () => {
  expect(formatFrameUrl('https://iframe.example.test:8443/api/v1/rpc?debug=1')).toBe('iframe.example.test:8443/api/v1/rpc?debug=1');
  expect(formatFrameUrl('not a URL')).toBe('not a URL');
  expect(formatFrameUrl()).toBe('Frame URL unavailable');
});

test('formats pending-completion elapsed values compactly', () => {
  expect(formatElapsed(42.2)).toBe('42 ms');
  expect(formatElapsed(1250)).toBe('1.25 s');
  expect(formatElapsed(-1)).toBe('0 ms');
});

test('formats replay provenance as a label rather than an entry link', () => {
  expect(formatReplayProvenance({ transport: 'grpc-web', requestId: 9 })).toBe('Retry of grpc-web request 9');
  expect(formatReplayProvenance({})).toBe('Retry of an earlier request');
});

test('keeps start time and duration alongside the compact replay marker', () => {
  expect(formatReplayTiming('12:34:56.789', '42 ms', { transport: 'grpc-web', requestId: 9 }))
    .toBe('Edited replay | 12:34:56.789 | 42 ms');
  expect(formatReplayTiming('12:34:56.789', 'Pending')).toBe('12:34:56.789 | Pending');
});

test('gives edited replay rows an explicit presentation class in every row state', () => {
  expect(getNetworkRowClassName(0, null, { replayedFrom: { requestId: 1 } }))
    .toBe('data-row odd edited-request');
  expect(getNetworkRowClassName(1, 1, { replayedFrom: { requestId: 1 }, error: true }))
    .toBe('data-row selected error edited-request');
});

test('shows a Network Error badge for network failures and a generic Error badge for other RPC errors', () => {
  const blockedTree = new NetworkListRow({
    index: 0,
    data: [{ entryId: 9, method: 'Demo/Blocked', isNetworkError: true }],
    style: {},
    selectLogEntry: jest.fn(),
    selectedIdx: null,
  }).render();
  expect(findByClassName(blockedTree, 'data-row-error-badge').props.children).toBe('Network Error');

  const serverErrorTree = new NetworkListRow({
    index: 0,
    data: [{ entryId: 10, method: 'Demo/ServerError', error: true, isNetworkError: false }],
    style: {},
    selectLogEntry: jest.fn(),
    selectedIdx: null,
  }).render();
  expect(findByClassName(serverErrorTree, 'data-row-error-badge').props.children).toBe('Error');

  const healthyTree = new NetworkListRow({
    index: 0,
    data: [{ entryId: 11, method: 'Demo/Healthy' }],
    style: {},
    selectLogEntry: jest.fn(),
    selectedIdx: null,
  }).render();
  expect(findByClassName(healthyTree, 'data-row-error-badge')).toBeNull();
});

test('maps a reversed (newest-first) display index back to the canonical log index for selection and highlighting', () => {
  const selectLogEntry = jest.fn();
  // Newest-first display: index 0 is entryId 3, which is canonical index 2.
  const displayEntries = [{ entryId: 3 }, { entryId: 2 }, { entryId: 1 }];
  const tree = new NetworkListRow({
    index: 0,
    data: { entries: displayEntries, locale: 'en', newestFirst: true, totalCount: 3 },
    style: {},
    selectLogEntry,
    selectedIdx: 2,
  }).render();

  expect(findByClassName(tree, 'data-row odd selected')).not.toBeNull();
  tree.props.onMouseDown({ button: 0 });
  expect(selectLogEntry).toHaveBeenCalledWith(2);
});

test('ignores non-primary mouse buttons so right-click keeps the context menu instead of selecting', () => {
  const selectLogEntry = jest.fn();
  const tree = new NetworkListRow({
    index: 0,
    data: [{ entryId: 1 }],
    style: {},
    selectLogEntry,
    selectedIdx: null,
  }).render();

  tree.props.onMouseDown({ button: 2 });
  expect(selectLogEntry).not.toHaveBeenCalled();
});

test('flags an entry present in recentlyAddedIds with the new-request highlight class, regardless of display order', () => {
  const displayEntries = [{ entryId: 3 }, { entryId: 2 }];
  const tree = new NetworkListRow({
    index: 0,
    data: {
      entries: displayEntries,
      locale: 'en',
      newestFirst: true,
      totalCount: 2,
      recentlyAddedIds: new Set([3]),
    },
    style: {},
    selectLogEntry: jest.fn(),
    selectedIdx: null,
  }).render();

  expect(tree.props.className).toContain('is-new-request');
});

test('renders a visible Edited badge with replay provenance', () => {
  const replayedFrom = { transport: 'connect-web', requestId: 8 };
  const tree = new NetworkListRow({
    index: 0,
    data: [{ entryId: 9, method: 'Demo/Call', replayedFrom }],
    style: {},
    selectLogEntry: jest.fn(),
    selectedIdx: null,
  }).render();
  const badge = findByClassName(tree, 'data-row-edited-badge');
  expect(badge.props.children).toBe('Edited');
  expect(badge.props.title).toBe('Retry of connect-web request 8');
});
