import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import NetworkEmpty, { getEmptyStateContent } from '../components/NetworkEmpty';

test('empty-state copy directs users to select captured requests for replay', () => {
  expect(getEmptyStateContent('no-selection').title).toMatch(/edit, or replay/i);
  expect(getEmptyStateContent('empty').detail).toMatch(/inspect or replay/i);
});

test('empty states expose dedicated wrapping containers for narrow detail panes', () => {
  const markup = renderToStaticMarkup(<NetworkEmpty mode="no-selection" />);
  expect(markup).toContain('class="network-empty-title"');
  expect(markup).toContain('class="network-empty-detail"');
});
