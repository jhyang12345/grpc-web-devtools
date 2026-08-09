import {
  KOREAN_TECHNICAL_TERMS,
  MESSAGES,
  PROTECTED_ENGLISH_TERMS,
  getEffectiveLocale,
  normalizeLanguagePreference,
  resolveBrowserLocale,
  translate,
} from '../i18n';

test('resolves Korean browser variants and falls back to English', () => {
  expect(resolveBrowserLocale('ko-KR')).toBe('ko');
  expect(resolveBrowserLocale(['en-US', 'ko'])).toBe('ko');
  expect(resolveBrowserLocale('en-US')).toBe('en');
  expect(resolveBrowserLocale('ja-JP')).toBe('en');
});

test('normalizes persisted preferences and applies auto browser selection', () => {
  expect(normalizeLanguagePreference('ko')).toBe('ko');
  expect(normalizeLanguagePreference('invalid')).toBe('auto');
  expect(getEffectiveLocale('auto', 'ko')).toBe('ko');
  expect(getEffectiveLocale('en', 'ko')).toBe('en');
});

test('interpolates translated values and falls back to English keys', () => {
  expect(translate('ko', 'network.replayFrom', { transport: 'grpc-web', requestId: 7 }))
    .toBe('grpc-web Request 7의 Replay');
  expect(translate('unsupported', 'toolbar.connected')).toBe('Connected');
});

test('keeps every protected Korean technical term exactly in English', () => {
  PROTECTED_ENGLISH_TERMS.forEach(term => {
    expect(KOREAN_TECHNICAL_TERMS[term]).toBe(term);
  });

  expect(MESSAGES.ko['details.editRequest']).toContain('Request');
  expect(MESSAGES.ko['details.capturedResponse']).toContain('Response');
  expect(MESSAGES.ko['details.metadata']).toBe('Metadata');
  expect(MESSAGES.ko['copy.success']).toContain('Clipboard');
  expect(MESSAGES.ko['toolbar.pendingTitle']).toContain('Content Script');
  expect(MESSAGES.ko['settings.version']).toBe('Version');
});
