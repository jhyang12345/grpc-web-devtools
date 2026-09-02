import { renderToStaticMarkup } from 'react-dom/server';
import { DebugReportCopy } from '../components/DebugReportCopy';

test('renders a Markdown-first split action with Korean technical terms preserved', () => {
  const component = new DebugReportCopy({ locale: 'ko', onCopy: jest.fn() });
  component.state = { isOpen: true };
  const markup = renderToStaticMarkup(component.render());

  expect(markup).toContain('Debug Report 복사');
  expect(markup).toContain('Markdown으로 복사');
  expect(markup).toContain('JSON으로 복사');
  expect(markup).toContain('URL과 Payload');
  expect(markup).toContain('role="menu"');
});

test('main and menu actions forward stable report format identifiers', () => {
  const onCopy = jest.fn();
  const component = new DebugReportCopy({ locale: 'en', onCopy });
  component.setState = update => {
    component.state = { ...component.state, ...(typeof update === 'function' ? update(component.state) : update) };
  };

  component._copy('markdown');
  component._copy('json');
  expect(onCopy.mock.calls).toEqual([['markdown'], ['json']]);
});
