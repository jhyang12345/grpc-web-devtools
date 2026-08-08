import { NetworkDetails } from '../components/NetworkDetails';
import { writeTextToClipboard } from '../utils/clipboard';

jest.mock('../utils/clipboard', () => ({
  writeTextToClipboard: jest.fn().mockResolvedValue(undefined),
}));

const entry = {
  entryId: 1,
  captureId: 'frame-a',
  requestId: 2,
  method: '/demo.Service/GetThing',
  transport: 'grpc-web',
  request: { id: 7 },
  response: { ok: true },
  messages: [],
  timing: { requestTimestamp: 1000, completionTimestamp: 1025, duration: 25 },
};

beforeEach(() => {
  writeTextToClipboard.mockClear();
});

test('debug report bytes do not change with the panel locale', async () => {
  const english = new NetworkDetails({ defaultCollapsed: false, locale: 'en', showToast: jest.fn() });
  const korean = new NetworkDetails({ defaultCollapsed: false, locale: 'ko', showToast: jest.fn() });

  await english._copyDebugReport('markdown', entry, {});
  await korean._copyDebugReport('markdown', entry, {});

  expect(writeTextToClipboard).toHaveBeenCalledTimes(2);
  expect(writeTextToClipboard.mock.calls[0][0]).toBe(writeTextToClipboard.mock.calls[1][0]);
  expect(writeTextToClipboard.mock.calls[0][0]).toContain('# gRPC Debug Report');
});

test('raw and formatted copies share the clipboard helper and localize only the toast', async () => {
  const showToast = jest.fn();
  const component = new NetworkDetails({ defaultCollapsed: false, locale: 'ko', showToast });

  await component._copyText('request', '{"id":7}');
  await component._copyDebugReport('json', entry, {});

  expect(writeTextToClipboard.mock.calls[0][0]).toBe('{"id":7}');
  expect(writeTextToClipboard.mock.calls[1][0]).toContain('"url": "/demo.Service/GetThing"');
  expect(writeTextToClipboard.mock.calls[1][0]).not.toContain('"schema"');
  expect(showToast.mock.calls[0][0].message).toContain('Request');
  expect(showToast.mock.calls[1][0].message).toContain('JSON Debug Report');
  expect(showToast.mock.calls[1][0].message).toContain('Clipboard');
});
