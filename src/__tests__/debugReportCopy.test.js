import { renderToStaticMarkup } from 'react-dom/server';
import { DebugReportCopy } from '../components/DebugReportCopy';

beforeEach(() => {
  window.localStorage.clear();
});

function stubbedComponent(props) {
  const component = new DebugReportCopy(props);
  component.setState = update => {
    component.state = { ...component.state, ...(typeof update === 'function' ? update(component.state) : update) };
  };
  return component;
}

test('renders a Markdown-first split action with Korean technical terms preserved', () => {
  const component = new DebugReportCopy({ locale: 'ko', onCopy: jest.fn() });
  component.state = { isOpen: true };
  const markup = renderToStaticMarkup(component.render());

  expect(markup).toContain('전체 복사');
  expect(markup).toContain('Markdown으로 복사');
  expect(markup).toContain('JSON으로 복사');
  expect(markup).toContain('URL과 Payload');
  expect(markup).toContain('role="menu"');
});

test('main and menu actions forward stable report format identifiers', () => {
  const onCopy = jest.fn();
  const component = stubbedComponent({ locale: 'en', onCopy });

  component._copy('markdown');
  component._copy('json');
  expect(onCopy.mock.calls).toEqual([['markdown'], ['json']]);
});

test('defaults to Markdown, marks it as checked, and shows it on the main button', () => {
  const component = new DebugReportCopy({ locale: 'en', onCopy: jest.fn() });
  component.state = { ...component.state, isOpen: true };
  const markup = renderToStaticMarkup(component.render());

  expect(markup).toContain('aria-checked="true"');
  const markdownItemIndex = markup.indexOf('Copy as Markdown');
  const checkedIndex = markup.lastIndexOf('aria-checked="true"', markdownItemIndex);
  const uncheckedIndex = markup.lastIndexOf('aria-checked="false"', markdownItemIndex);
  expect(checkedIndex).toBeGreaterThan(uncheckedIndex);
  expect(markup).toContain('aria-hidden="true">Markdown</span>');
});

test('persists the chosen format to localStorage and reflects it as checked next time', () => {
  const onCopy = jest.fn();
  const component = stubbedComponent({ locale: 'en', onCopy });

  component._copy('json');
  expect(window.localStorage.getItem('grpc-devtools-debugReportFormat')).toBe('"json"');

  const reopened = new DebugReportCopy({ locale: 'en', onCopy: jest.fn() });
  reopened.state = { ...reopened.state, isOpen: true };
  expect(reopened.state.format).toBe('json');

  const markup = renderToStaticMarkup(reopened.render());
  expect(markup).toContain('aria-hidden="true">JSON</span>');
  const jsonItemIndex = markup.indexOf('Copy as JSON');
  const checkedIndex = markup.lastIndexOf('aria-checked="true"', jsonItemIndex);
  const uncheckedIndex = markup.lastIndexOf('aria-checked="false"', jsonItemIndex);
  expect(checkedIndex).toBeGreaterThan(uncheckedIndex);
});

test('clicking the main button re-copies in the persisted format instead of forcing Markdown', () => {
  const onCopy = jest.fn();
  const component = stubbedComponent({ locale: 'en', onCopy });
  component._copy('json');
  onCopy.mockClear();

  const markup = renderToStaticMarkup(component.render());
  expect(markup).toContain('aria-hidden="true">JSON</span>');

  component._copy(component.state.format);
  expect(onCopy).toHaveBeenCalledWith('json');
});
