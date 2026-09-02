// Copyright (c) 2019 SafetyCulture Pty Ltd. All Rights Reserved.

export function downloadTextFile(text, options = {}) {
  const hasOption = key => Object.prototype.hasOwnProperty.call(options, key);
  const documentObject = hasOption('documentObject')
    ? options.documentObject
    : (typeof document !== 'undefined' ? document : null);
  const urlObject = hasOption('urlObject')
    ? options.urlObject
    : (typeof URL !== 'undefined' ? URL : null);
  const BlobConstructor = hasOption('BlobConstructor')
    ? options.BlobConstructor
    : (typeof Blob !== 'undefined' ? Blob : null);
  const schedule = options.schedule
    || (callback => setTimeout(callback, 0));
  const filename = options.filename || 'report.txt';
  const mimeType = options.mimeType || 'text/plain;charset=utf-8';

  if (!documentObject?.body || typeof documentObject.createElement !== 'function') {
    throw new Error('Document download API is unavailable.');
  }
  if (!urlObject || typeof urlObject.createObjectURL !== 'function' || typeof urlObject.revokeObjectURL !== 'function') {
    throw new Error('Object URL API is unavailable.');
  }
  if (typeof BlobConstructor !== 'function') {
    throw new Error('Blob API is unavailable.');
  }

  const blob = new BlobConstructor([String(text ?? '')], { type: mimeType });
  const objectUrl = urlObject.createObjectURL(blob);
  const anchor = documentObject.createElement('a');
  anchor.href = objectUrl;
  anchor.download = filename;
  anchor.style.display = 'none';

  try {
    documentObject.body.appendChild(anchor);
    anchor.click();
  } finally {
    if (anchor.parentNode) anchor.parentNode.removeChild(anchor);
    try {
      schedule(() => urlObject.revokeObjectURL(objectUrl));
    } catch (_) {
      urlObject.revokeObjectURL(objectUrl);
    }
  }

  return { filename, bytes: blob.size, mimeType };
}
