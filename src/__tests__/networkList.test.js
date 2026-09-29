import React from 'react';
import fs from 'fs';
import path from 'path';
import { NetworkList } from '../components/NetworkList';

function findByClassName(node, className) {
  if (!node || typeof node !== 'object') return null;
  if (node.props?.className === className) return node;
  return React.Children.toArray(node.props?.children)
    .map(child => findByClassName(child, className))
    .find(Boolean) || null;
}

test('request list uses the full height without a redundant Name header', () => {
  const component = new NetworkList({
    filterIsOpen: false,
    filterValue: '',
    network: { log: [] },
  });
  const tree = component.render();

  expect(findByClassName(tree, 'header-container')).toBeNull();
  expect(findByClassName(tree, 'data-container')).not.toBeNull();
  expect(findByClassName(tree, 'data-grid').props['aria-label']).toBe('Captured requests');
});

test('delegates vertical scrolling to the virtualized request list', () => {
  const css = fs.readFileSync(
    path.join(__dirname, '../components/NetworkList.css'),
    'utf8'
  );
  const containerRule = css.match(/\.data-grid \.data-container\s*\{([^}]*)\}/);

  expect(containerRule).not.toBeNull();
  expect(containerRule[1]).toMatch(/overflow:\s*hidden/);
  expect(containerRule[1]).not.toMatch(/overflow-y:\s*(auto|scroll|overlay)/);
});

function stubbedNetworkList(props) {
  const component = new NetworkList(props);
  component.setState = update => {
    component.state = { ...component.state, ...(typeof update === 'function' ? update(component.state) : update) };
  };
  return component;
}

test('defaults to newest-first and reverses the list handed to the virtualized rows', () => {
  const log = [
    { entryId: 1, method: '/demo/First' },
    { entryId: 2, method: '/demo/Second' },
    { entryId: 3, method: '/demo/Third' },
  ];
  const component = new NetworkList({ filterIsOpen: false, filterValue: '', network: { log } });
  const tree = component.render();
  const list = findByClassName(tree, 'data-container').props.children.props.children({ height: 400 });

  expect(list.props.itemData.newestFirst).toBe(true);
  expect(list.props.itemData.entries.map(entry => entry.entryId)).toEqual([3, 2, 1]);
  expect(list.props.itemData.totalCount).toBe(3);
});

test('keeps oldest-first append order when newestFirst is explicitly off', () => {
  const log = [{ entryId: 1 }, { entryId: 2 }];
  const component = new NetworkList({ filterIsOpen: false, filterValue: '', network: { log }, newestFirst: false });
  const tree = component.render();
  const list = findByClassName(tree, 'data-container').props.children.props.children({ height: 400 });

  expect(list.props.itemData.entries.map(entry => entry.entryId)).toEqual([1, 2]);
});

test('keys virtualized rows by entry id so react-window cannot recycle a row DOM node across two different requests when the list reorders', () => {
  // react-window defaults to keying rows by their positional index. When two
  // requests arrive close together, the newest entry keeps shifting which
  // entryId sits at index 0, and without an explicit itemKey react-window
  // reuses the same row instance for whatever entry now occupies that index.
  // That silently carries the CSS "is-new-request" animation class onto the
  // wrong row instead of restarting it on the actual new arrival, which is
  // what makes near-simultaneous requests appear to animate in reverse order.
  const log = [
    { entryId: 1, method: '/demo/First' },
    { entryId: 2, method: '/demo/Second' },
  ];
  const component = new NetworkList({ filterIsOpen: false, filterValue: '', network: { log } });
  const tree = component.render();
  const list = findByClassName(tree, 'data-container').props.children.props.children({ height: 400 });

  expect(typeof list.props.itemKey).toBe('function');
  expect(list.props.itemKey(0, list.props.itemData)).toBe(2);
  expect(list.props.itemKey(1, list.props.itemData)).toBe(1);
});

test('marks a genuinely new entry as recently-added but not an in-place update to an existing one', () => {
  const existing = { entryId: 1, method: '/demo/Existing' };
  const component = stubbedNetworkList({
    filterIsOpen: false,
    filterValue: '',
    network: { log: [{ ...existing, terminalPhase: 'complete' }] },
  });

  component.componentDidUpdate({ network: { log: [existing] }, filterValue: '' });
  expect(component.state.recentlyAddedIds.has(1)).toBe(false);

  const withNewEntry = { entryId: 2, method: '/demo/New' };
  component.props = { ...component.props, network: { log: [existing, withNewEntry] } };
  component.componentDidUpdate({ network: { log: [existing] }, filterValue: '' });
  expect(component.state.recentlyAddedIds.has(2)).toBe(true);
  expect(component.state.recentlyAddedIds.has(1)).toBe(false);

  component.componentWillUnmount();
});
