import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { SettingsPopover } from '../components/SettingsPopover';

test('settings popover exposes accessible persisted language choices', () => {
  const component = new SettingsPopover({
    locale: 'ko',
    preference: 'ko',
    version: '1.6.0',
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
  expect(markup).toContain('class="settings-version-label">v1.6.0</span>');
});

test('settings popover reports language changes without rewriting values', () => {
  const onLanguageChange = jest.fn();
  const component = new SettingsPopover({ locale: 'en', onLanguageChange });
  component._selectLanguage({ target: { value: 'ko' } });
  expect(onLanguageChange).toHaveBeenCalledWith('ko');
});

test('settings popover links to the Buy Me a Coffee page in a new tab with the matcha icon', () => {
  const component = new SettingsPopover({ locale: 'en', onLanguageChange: jest.fn() });
  component.state = { isOpen: true };
  const markup = renderToStaticMarkup(component.render());
  expect(markup).toContain('href="https://buymeacoffee.com/jhyang12345"');
  expect(markup).toContain('target="_blank"');
  expect(markup).toContain('rel="noopener noreferrer"');
  expect(markup).toContain('Matcha Crème Frappuccino');
  expect(markup).toContain('class="settings-support-icon"');

  const korean = new SettingsPopover({ locale: 'ko', onLanguageChange: jest.fn() });
  korean.state = { isOpen: true };
  expect(renderToStaticMarkup(korean.render())).toContain('제주 말차 크림 프라푸치노');
});
