import { writeTextToClipboard } from '../utils/clipboard';

test('uses the asynchronous Clipboard API when available', async () => {
  const writeText = jest.fn().mockResolvedValue(undefined);
  await writeTextToClipboard('payload', {
    navigatorObject: { clipboard: { writeText } },
    documentObject: null,
  });
  expect(writeText).toHaveBeenCalledWith('payload');
});

test('falls back to a temporary textarea and always removes it', async () => {
  const execCommand = jest.fn().mockReturnValue(true);
  const documentObject = {
    body: {
      appendChild: jest.fn(),
      removeChild: jest.fn(),
    },
    createElement: jest.fn(() => ({
      value: '',
      style: {},
      setAttribute: jest.fn(),
      select: jest.fn(),
    })),
    execCommand,
  };

  await writeTextToClipboard('fallback', { navigatorObject: {}, documentObject });
  expect(execCommand).toHaveBeenCalledWith('copy');
  expect(documentObject.body.removeChild).toHaveBeenCalledTimes(1);
});

test('reports fallback failures after cleaning up the textarea', async () => {
  const textArea = { value: '', style: {}, setAttribute: jest.fn(), select: jest.fn() };
  const documentObject = {
    body: { appendChild: jest.fn(), removeChild: jest.fn() },
    createElement: jest.fn(() => textArea),
    execCommand: jest.fn().mockReturnValue(false),
  };

  await expect(writeTextToClipboard('failed', { navigatorObject: {}, documentObject })).rejects.toThrow();
  expect(documentObject.body.removeChild).toHaveBeenCalledWith(textArea);
});

