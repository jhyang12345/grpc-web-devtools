jest.mock('../utils/clipboard', () => ({
  writeTextToClipboard: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../state/networkCache', () => ({
  getNetworkEntry: jest.fn(),
}));

import { BtsEasterEgg } from '../components/BtsEasterEgg';
import { writeTextToClipboard } from '../utils/clipboard';
import { getNetworkEntry } from '../state/networkCache';

function stubbedComponent(props) {
  const component = new BtsEasterEgg(props);
  component.setState = update => {
    component.state = { ...component.state, ...(typeof update === 'function' ? update(component.state) : update) };
  };
  return component;
}

function keyEvent(overrides) {
  return {
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    metaKey: false,
    code: '',
    preventDefault: jest.fn(),
    ...overrides,
  };
}

beforeEach(() => {
  writeTextToClipboard.mockClear();
  getNetworkEntry.mockReset();
  delete global.chrome;
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
});

test('ignores every key combination except the exact Ctrl+Alt+B chord', () => {
  const component = stubbedComponent({ allEntries: [] });
  component._trigger = jest.fn();

  component._onKeyDown(keyEvent({ ctrlKey: true, code: 'KeyB' })); // missing altKey
  component._onKeyDown(keyEvent({ altKey: true, code: 'KeyB' })); // missing ctrlKey
  component._onKeyDown(keyEvent({ ctrlKey: true, altKey: true, shiftKey: true, code: 'KeyB' })); // extra shift
  component._onKeyDown(keyEvent({ ctrlKey: true, altKey: true, metaKey: true, code: 'KeyB' })); // extra meta
  component._onKeyDown(keyEvent({ ctrlKey: true, altKey: true, code: 'KeyC' })); // wrong key
  expect(component._trigger).not.toHaveBeenCalled();

  const event = keyEvent({ ctrlKey: true, altKey: true, code: 'KeyB' });
  component._onKeyDown(event);
  expect(component._trigger).toHaveBeenCalledTimes(1);
  expect(event.preventDefault).toHaveBeenCalledTimes(1);
});

test('uses event.code rather than event.key, so it still fires when Option remaps the character (macOS)', () => {
  const component = stubbedComponent({ allEntries: [] });
  component._trigger = jest.fn();
  // On macOS, Option+B produces event.key === 'ß', not 'b' — only .code is reliable.
  component._onKeyDown(keyEvent({ ctrlKey: true, altKey: true, code: 'KeyB', key: 'ß' }));
  expect(component._trigger).toHaveBeenCalledTimes(1);
});

test('copies the assembled BTS block to the clipboard using locally captured GetOpUser data', async () => {
  const allEntries = [
    { entryId: 1, method: 'https://api.dev2.example.test/opgwv1.OpGw/GetOpUser', location: 'https://app.qa2.example.test/zone/detail/419' },
  ];
  getNetworkEntry.mockReturnValue({
    response: { email: 'tester@example.test', operatorInfo: { fullName: 'Example Corp' }, role: 'ADMIN' },
  });
  const component = stubbedComponent({ allEntries });

  await component._trigger();

  expect(writeTextToClipboard).toHaveBeenCalledTimes(1);
  const text = writeTextToClipboard.mock.calls[0][0];
  expect(text).toContain('- 테스트 계정 : tester@example.test Example Corp (ADMIN)');
  expect(text).toContain('- 이슈 발생 URL : https://app.qa2.example.test/zone/detail/419');
  expect(text).toContain('- 환경 : QA');
  expect(component.state.visible).toBe(true);
});

test('classifies the environment from the current page domain (dev/QA/Stage/Real)', async () => {
  getNetworkEntry.mockReturnValue({
    response: { email: 'tester@example.test', operatorInfo: { fullName: 'Example Corp' }, role: 'ADMIN' },
  });

  const component = stubbedComponent({ allEntries: [
    { entryId: 1, method: 'https://api.example.test/opgwv1.OpGw/GetOpUser', location: 'https://app.example.test/zone/detail/419' },
  ] });
  await component._trigger();
  expect(writeTextToClipboard.mock.calls[0][0]).toContain('- 환경 : Real');

  writeTextToClipboard.mockClear();
  const devComponent = stubbedComponent({ allEntries: [
    { entryId: 2, method: 'https://api.dev2.example.test/opgwv1.OpGw/GetOpUser', location: 'https://app.dev2.example.test/zone/detail/419' },
  ] });
  await devComponent._trigger();
  expect(writeTextToClipboard.mock.calls[0][0]).toContain('- 환경 : dev');
});

test('includes the app-version header captured on the most recent request as the build version', async () => {
  const allEntries = [
    { entryId: 1, method: 'https://api.dev2.example.test/opgwv1.OpGw/ListZones' },
    { entryId: 2, method: 'https://api.dev2.example.test/opgwv1.OpGw/GetOpUser', location: 'https://app.qa2.example.test/zone/detail/419' },
  ];
  getNetworkEntry.mockImplementation(entryId => {
    if (entryId === 1) return { meta: { 'app-version': 'qa-af32a43' } };
    if (entryId === 2) return { response: { email: 'tester@example.test', operatorInfo: { fullName: 'Example Corp' }, role: 'ADMIN' }, meta: { 'app-version': 'qa-b91c2d0' } };
    return undefined;
  });
  const component = stubbedComponent({ allEntries });

  await component._trigger();

  const text = writeTextToClipboard.mock.calls[0][0];
  expect(text).toContain('- qa-b91c2d0');
});

test('falls back to the raw gRPC-Web fetch when no GetOpUser call was captured locally', async () => {
  getNetworkEntry.mockReturnValue(undefined);
  const evalMock = jest.fn((expression, callback) => {
    callback({ email: 'fallback@example.test', operatorFullName: 'Example Corp', role: 'MEMBER' }, null);
  });
  global.chrome = { devtools: { inspectedWindow: { eval: evalMock } } };

  const allEntries = [{ entryId: 1, backendUrl: 'https://api.dev2.example.test/opgwv1.OpGw/ListZones' }];
  const component = stubbedComponent({ allEntries });

  await component._trigger();

  expect(evalMock).toHaveBeenCalledTimes(1);
  expect(evalMock.mock.calls[0][0]).toContain('"https://api.dev2.example.test"');
  const text = writeTextToClipboard.mock.calls[0][0];
  expect(text).toContain('- 테스트 계정 : fallback@example.test Example Corp (MEMBER)');
});

test('silently no-ops outside a real chrome.devtools context, with no clipboard write and no popup', async () => {
  getNetworkEntry.mockReturnValue(undefined);
  const component = stubbedComponent({ allEntries: [] });

  await component._trigger();

  expect(writeTextToClipboard).not.toHaveBeenCalled();
  expect(component.state.visible).toBe(false);
});

test('treats a raw-fetch exception as a graceful miss and silently no-ops, same as never having the handle', async () => {
  getNetworkEntry.mockReturnValue(undefined);
  global.chrome = {
    devtools: {
      inspectedWindow: {
        eval: jest.fn((expression, callback) => callback(null, { isException: true })),
      },
    },
  };
  const allEntries = [{ entryId: 1, backendUrl: 'https://api.dev2.example.test/opgwv1.OpGw/ListZones' }];
  const component = stubbedComponent({ allEntries });

  await expect(component._trigger()).resolves.toBeUndefined();
  expect(writeTextToClipboard).not.toHaveBeenCalled();
  expect(component.state.visible).toBe(false);
});

test('shows the popup and auto-hides it after the delay, cleaning up its timer on unmount', async () => {
  const allEntries = [
    { entryId: 1, method: 'https://api.dev2.example.test/opgwv1.OpGw/GetOpUser', location: 'https://app.qa2.example.test/zone/detail/419' },
  ];
  getNetworkEntry.mockReturnValue({
    response: { email: 'tester@example.test', operatorInfo: { fullName: 'Example Corp' }, role: 'ADMIN' },
  });
  const component = stubbedComponent({ allEntries });

  await component._trigger();
  expect(component.state.visible).toBe(true);

  jest.advanceTimersByTime(2500);
  expect(component.state.visible).toBe(false);

  const clearSpy = jest.spyOn(global, 'clearTimeout');
  component._showCat();
  component.componentWillUnmount();
  expect(clearSpy).toHaveBeenCalled();
  clearSpy.mockRestore();
});

test('removes its keydown listener on unmount', () => {
  const removeSpy = jest.spyOn(window, 'removeEventListener');
  const component = stubbedComponent({ allEntries: [] });
  component.componentDidMount();
  component.componentWillUnmount();
  expect(removeSpy).toHaveBeenCalledWith('keydown', component._onKeyDown);
  removeSpy.mockRestore();
});
