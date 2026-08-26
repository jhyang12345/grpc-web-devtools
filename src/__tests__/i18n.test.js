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
  expect(MESSAGES.ko['audit.download']).toContain('Audit Report');
  expect(MESSAGES.ko['audit.downloadTitle']).toContain('Markdown');
});

test('keeps English and Korean Audit Report catalogs in sync', () => {
  const reportKeys = locale => Object.keys(MESSAGES[locale])
    .filter(key => key.startsWith('audit.report.'))
    .sort();

  expect(reportKeys('ko')).toEqual(reportKeys('en'));
  expect(MESSAGES.ko['audit.report.detail.backendUrl']).toBe('Backend URL');
  expect(MESSAGES.ko['audit.report.detail.frameUrl']).toBe('Frame URL');
  expect(MESSAGES.ko['audit.report.section.requestPayload']).toContain('Request Payload');
  expect(MESSAGES.ko['audit.report.notice.requestEvicted']).toContain('Cache');
});
