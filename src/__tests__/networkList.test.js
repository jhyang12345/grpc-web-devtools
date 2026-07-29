import React from 'react';
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
