import { ErrorBoundary } from '../components/ErrorBoundary';
import { Toast } from '../components/Toast';

test.each([
  ['success', 'status', 'polite'],
  ['info', 'status', 'polite'],
  ['warning', 'alert', 'assertive'],
  ['error', 'alert', 'assertive'],
])('toast %s state exposes its themed variant and announcement priority', (type, role, live) => {
  const tree = new Toast({ visible: true, message: 'Visible message', type }).render();
  expect(tree.props.className).toContain(`toast-${type}`);
  expect(tree.props.role).toBe(role);
  expect(tree.props['aria-live']).toBe(live);
});

test('error recovery uses theme classes instead of a hard-coded light surface', () => {
  const boundary = new ErrorBoundary({ clearLogAndCache: jest.fn() });
  boundary.state = { hasError: true, error: new Error('broken payload') };
  const tree = boundary.render();
  expect(tree.props.className).toContain('error-boundary');
  expect(tree.props.style).toBeUndefined();
  expect(tree.props.children[0].props.className).toBe('error-boundary-title');
});
