import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { SettingsPopover } from '../components/SettingsPopover';

test('settings popover exposes accessible persisted language choices', () => {
  const component = new SettingsPopover({
    locale: 'ko',
    preference: 'ko',
    onLanguageChange: jest.fn(),
  });
  component.state = { isOpen: true };
  const markup = renderToStaticMarkup(component.render());

  expect(markup).toContain('role="dialog"');
  expect(markup).toContain('role="radiogroup"');
  expect(markup).toContain('자동 (브라우저)');
  expect(markup).toContain('English');
  expect(markup).toContain('한국어');
  expect(markup).toContain('value="ko" checked=""');
});

test('settings popover reports language changes without rewriting values', () => {
  const onLanguageChange = jest.fn();
  const component = new SettingsPopover({ locale: 'en', onLanguageChange });
  component._selectLanguage({ target: { value: 'ko' } });
  expect(onLanguageChange).toHaveBeenCalledWith('ko');
});
