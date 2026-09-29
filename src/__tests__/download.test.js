import { downloadTextFile } from '../utils/download';

test('downloads through a temporary Blob URL and revokes it after the click', () => {
  const anchor = {
    style: {},
    click: jest.fn(),
    parentNode: null,
  };
  const body = {
    appendChild: jest.fn(node => { node.parentNode = body; }),
    removeChild: jest.fn(node => { node.parentNode = null; }),
  };
  const documentObject = { body, createElement: jest.fn(() => anchor) };
  const urlObject = {
    createObjectURL: jest.fn(() => 'blob:audit-report'),
    revokeObjectURL: jest.fn(),
  };
  class FakeBlob {
    constructor(parts, options) {
      this.parts = parts;
      this.type = options.type;
      this.size = parts.join('').length;
    }
  }
  const scheduled = [];

  const result = downloadTextFile('# report\n', {
    filename: 'audit.md',
    mimeType: 'text/markdown;charset=utf-8',
    documentObject,
    urlObject,
    BlobConstructor: FakeBlob,
    schedule: callback => scheduled.push(callback),
  });

  expect(anchor).toEqual(expect.objectContaining({ href: 'blob:audit-report', download: 'audit.md' }));
  expect(anchor.click).toHaveBeenCalledTimes(1);
  expect(body.appendChild).toHaveBeenCalledWith(anchor);
  expect(body.removeChild).toHaveBeenCalledWith(anchor);
  expect(urlObject.revokeObjectURL).not.toHaveBeenCalled();
  scheduled[0]();
  expect(urlObject.revokeObjectURL).toHaveBeenCalledWith('blob:audit-report');
  expect(result).toEqual({ filename: 'audit.md', bytes: 9, mimeType: 'text/markdown;charset=utf-8' });
});

test('fails clearly when browser download APIs are unavailable', () => {
  expect(() => downloadTextFile('report', { documentObject: null, urlObject: null, BlobConstructor: null }))
    .toThrow('Document download API is unavailable');
});

