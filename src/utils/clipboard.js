// Copyright (c) 2019 SafetyCulture Pty Ltd. All Rights Reserved.

export async function writeTextToClipboard(text, environment = {}) {
  const navigatorObject = environment.navigatorObject
    || (typeof navigator !== 'undefined' ? navigator : null);
  const documentObject = environment.documentObject
    || (typeof document !== 'undefined' ? document : null);

  if (navigatorObject?.clipboard?.writeText) {
    await navigatorObject.clipboard.writeText(text);
    return;
  }

  if (!documentObject?.body || typeof documentObject.execCommand !== 'function') {
    throw new Error('Clipboard API is unavailable.');
  }

  const textArea = documentObject.createElement('textarea');
  textArea.value = text;
  textArea.setAttribute('readonly', '');
  textArea.style.position = 'fixed';
  textArea.style.opacity = '0';
  documentObject.body.appendChild(textArea);

  try {
    textArea.select();
    const copied = documentObject.execCommand('copy');
    if (copied === false) throw new Error('Clipboard copy command failed.');
  } finally {
    documentObject.body.removeChild(textArea);
  }
}

