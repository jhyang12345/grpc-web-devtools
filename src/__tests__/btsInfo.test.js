import {
  buildBtsInfoText,
  classifyEnvironment,
  findLatestBuildVersion,
  findLatestOpUserInfo,
  findLatestPageUrl,
  formatLocalTimestamp,
  getChromeVersion,
} from '../utils/btsInfo';

test('formatLocalTimestamp renders local wall-clock time as YYYY-MM-DD HH:mm', () => {
  expect(formatLocalTimestamp(new Date(2026, 8, 9, 9, 5))).toBe('2026-09-09 09:05');
  expect(formatLocalTimestamp(new Date(2026, 0, 1, 23, 59))).toBe('2026-01-01 23:59');
  expect(formatLocalTimestamp('not a date')).toBe('');
});

test('getChromeVersion extracts the Chrome build from a real user agent string and ignores unrelated ones', () => {
  expect(getChromeVersion('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.6668.100 Safari/537.36'))
    .toBe('129.0.6668.100');
  expect(getChromeVersion('Mozilla/5.0 (compatible)')).toBeNull();
  expect(getChromeVersion(undefined)).toBeNull();
});

function opUserEntry(entryId, method, response) {
  return { entryId, method, response, terminalPhase: 'complete' };
}

test('findLatestOpUserInfo scans newest-first for a GetOpUser call and extracts email/company/role', () => {
  const allEntries = [
    { entryId: 1, method: '/opgwv1.OpGw/ListZones' },
    opUserEntry(2, 'https://api.dev2.example.test/opgwv1.OpGw/GetOpUser', {
      email: 'tester@example.test',
      operatorInfo: { fullName: 'Example Corp' },
      role: 'ADMIN',
    }),
    { entryId: 3, method: '/opgwv1.OpGw/ListDemands' },
  ];
  const getEntry = entryId => allEntries.find(entry => entry.entryId === entryId);

  expect(findLatestOpUserInfo(allEntries, getEntry)).toEqual({
    email: 'tester@example.test',
    company: 'Example Corp',
    role: 'ADMIN',
  });
});

test('findLatestOpUserInfo prefers the most recent of multiple GetOpUser calls', () => {
  const allEntries = [
    opUserEntry(1, '/opgwv1.OpGw/GetOpUser', { email: 'stale@example.test', role: 'MEMBER' }),
    opUserEntry(2, '/opgwv1.OpGw/GetOpUser', { email: 'fresh@example.test', role: 'ADMIN' }),
  ];
  const getEntry = entryId => allEntries.find(entry => entry.entryId === entryId);

  expect(findLatestOpUserInfo(allEntries, getEntry).email).toBe('fresh@example.test');
});

test('findLatestOpUserInfo returns null when GetOpUser was never captured or its payload was evicted', () => {
  const getEntry = jest.fn();
  expect(findLatestOpUserInfo([], getEntry)).toBeNull();
  expect(findLatestOpUserInfo([{ entryId: 1, method: '/demo/Other' }], getEntry)).toBeNull();

  const evicted = [opUserEntry(1, '/opgwv1.OpGw/GetOpUser', { __truncated: true })];
  expect(findLatestOpUserInfo(evicted, entryId => evicted.find(e => e.entryId === entryId))).toBeNull();
});

test('findLatestPageUrl reads the most recent entry location, unmodified (no redaction)', () => {
  const allEntries = [
    { entryId: 1, location: 'https://app.qa2.example.test/zone/detail/1' },
    { entryId: 2, location: 'https://app.qa2.example.test/zone/detail/419#12.504,126.602,37.351' },
  ];
  expect(findLatestPageUrl(allEntries)).toBe('https://app.qa2.example.test/zone/detail/419#12.504,126.602,37.351');
  expect(findLatestPageUrl([])).toBeNull();
});

test('buildBtsInfoText matches the BTS template shape with every field filled in, including build version and environment', () => {
  const text = buildBtsInfoText({
    url: 'https://app.qa2.example.test/zone/detail/419#12.504',
    chromeVersion: '129.0.6668.100',
    timestamp: '2026-09-09 14:32',
    opUserInfo: { email: 'tester@example.test', company: 'Example Corp', role: 'ADMIN' },
    buildVersion: 'qa-af32a43',
    environment: 'QA',
  });

  expect(text).toBe([
    '[빌드 버전]',
    '- qa-af32a43',
    '',
    '[테스트 환경 정보]',
    '- 환경 : QA',
    '- OS 버전 : 129.0.6668.100',
    '- 발생 시간: 2026-09-09 14:32',
    '- 테스트 계정 : tester@example.test Example Corp (ADMIN)',
    '- 이슈 발생 URL : https://app.qa2.example.test/zone/detail/419#12.504',
    '- rpc 호출기록 : (Audit Report를 다운로드하여 첨부해 주세요)',
  ].join('\n'));
});

test('buildBtsInfoText degrades every field to blank instead of "undefined" when nothing is available', () => {
  const text = buildBtsInfoText({});
  expect(text).not.toContain('undefined');
  expect(text).not.toContain('null');
  expect(text).toContain('[빌드 버전]\n- \n');
  expect(text).toContain('- 환경 : ');
  expect(text).toContain('- 테스트 계정 : ');
  expect(text).toContain('- OS 버전 : ');
  expect(text).toContain('- 이슈 발생 URL : ');
});

test('classifyEnvironment matches dev/QA/Stage/Real domains by substring, across differently shaped hostnames', () => {
  expect(classifyEnvironment('https://operation.dev2.example.test/x')).toBe('dev');
  expect(classifyEnvironment('https://qa.example.test:15449/x')).toBe('QA');
  expect(classifyEnvironment('https://stage.example.test:15449/x')).toBe('Stage');
  expect(classifyEnvironment('https://operation.example.test/x')).toBe('Real');

  expect(classifyEnvironment('https://app.dev2.example.test/x')).toBe('dev');
  expect(classifyEnvironment('https://qaapp.example.test/x')).toBe('QA');
  expect(classifyEnvironment('https://stageapp.example.test/x')).toBe('Stage');
  expect(classifyEnvironment('https://app.example.test/x')).toBe('Real');

  expect(classifyEnvironment('https://insight-dev.example.test/x')).toBe('dev');
  expect(classifyEnvironment('https://insight-qa.example.test/x')).toBe('QA');
  expect(classifyEnvironment('https://insight.example.test/x')).toBe('Real');

  expect(classifyEnvironment('https://kiosk.dev2.example.test/x')).toBe('dev');
  expect(classifyEnvironment('https://qa-kiosk.example.test:15449/x')).toBe('QA');
  expect(classifyEnvironment('https://stage-kiosk.example.test:15449/x')).toBe('Stage');
  expect(classifyEnvironment('https://kiosk.example.test/x')).toBe('Real');

  expect(classifyEnvironment('https://support.dev2.example.test/x')).toBe('dev');
  expect(classifyEnvironment('https://support-qa.example.test/x')).toBe('QA');
  expect(classifyEnvironment('https://support.example.test/x')).toBe('Real');
});

test('classifyEnvironment returns null only for unparseable or empty input, not for an ordinary hostname', () => {
  expect(classifyEnvironment('https://example.test/x')).toBe('Real');
  expect(classifyEnvironment('not a url')).toBeNull();
  expect(classifyEnvironment('')).toBeNull();
  expect(classifyEnvironment(null)).toBeNull();
  expect(classifyEnvironment(undefined)).toBeNull();
});

function metaEntry(entryId, appVersion) {
  return { entryId, meta: appVersion ? { 'app-version': appVersion } : undefined, terminalPhase: 'complete' };
}

test('findLatestBuildVersion scans newest-first across any method for the app-version header', () => {
  const allEntries = [
    metaEntry(1, 'qa-af32a43'),
    { entryId: 2 },
    metaEntry(3, 'qa-b91c2d0'),
  ];
  const getEntry = entryId => allEntries.find(entry => entry.entryId === entryId);

  expect(findLatestBuildVersion(allEntries, getEntry)).toBe('qa-b91c2d0');
});

test('findLatestBuildVersion returns null when no captured entry carries an app-version header', () => {
  const getEntry = jest.fn();
  expect(findLatestBuildVersion([], getEntry)).toBeNull();

  const noMeta = [{ entryId: 1 }];
  expect(findLatestBuildVersion(noMeta, entryId => noMeta.find(e => e.entryId === entryId))).toBeNull();
});
