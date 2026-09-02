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
