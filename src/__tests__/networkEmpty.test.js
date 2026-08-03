import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import NetworkEmpty, {
  CLIENT_INTEGRATION_GUIDE_URL,
  getEmptyStateContent,
} from '../components/NetworkEmpty';

test('empty-state copy directs users to select captured requests for replay', () => {
  expect(getEmptyStateContent('no-selection').title).toMatch(/edit, or replay/i);
  expect(getEmptyStateContent('empty').detail).toMatch(/inspect or replay/i);
});

test('empty states expose dedicated wrapping containers for narrow detail panes', () => {
  const markup = renderToStaticMarkup(<NetworkEmpty mode="no-selection" />);
  expect(markup).toContain('class="network-empty-title"');
  expect(markup).toContain('class="network-empty-detail"');
});

test('the initial empty state links to the public web application setup guide', () => {
  const content = getEmptyStateContent('empty');
  expect(content.link).toEqual({
    href: CLIENT_INTEGRATION_GUIDE_URL,
    label: 'Set up your web application',
  });

  const markup = renderToStaticMarkup(<NetworkEmpty mode="empty" />);
  expect(markup).toContain(`href="${CLIENT_INTEGRATION_GUIDE_URL}"`);
  expect(markup).toContain('target="_blank"');
  expect(markup).toContain('rel="noopener noreferrer"');
});

test('contextual empty states do not show the setup guide', () => {
  expect(getEmptyStateContent('filtered-empty').link).toBeNull();
  expect(getEmptyStateContent('no-selection').link).toBeNull();
});
