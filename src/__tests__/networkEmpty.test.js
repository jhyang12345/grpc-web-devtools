import { getEmptyStateContent } from '../components/NetworkEmpty';

test('empty-state copy directs users to select captured requests for replay', () => {
  expect(getEmptyStateContent('no-selection').title).toMatch(/edit, or replay/i);
  expect(getEmptyStateContent('empty').detail).toMatch(/inspect or replay/i);
});
