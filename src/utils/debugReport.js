// Copyright (c) 2019 SafetyCulture Pty Ltd. All Rights Reserved.

function nullable(value) {
  return value === undefined ? null : value;
}

function methodPath(method) {
  if (typeof method !== 'string' || !method.trim()) return '';

  const trimmed = method.trim();
  if (/^https?:\/\//i.test(trimmed)) {
    try {
      const parsed = new URL(trimmed);
      return parsed.pathname || '';
    } catch (_) {
      return '';
    }
  }

  return `/${trimmed.replace(/^\/+/, '')}`;
}

function appendMethodToUrl(url, method) {
  const path = methodPath(method);
  if (!path) return url || null;
  if (!url) return /^(https?:\/\/|\/)/i.test(method.trim()) ? method.trim() : path;

  const suffixIndex = [url.indexOf('?'), url.indexOf('#')]
    .filter(index => index >= 0)
    .reduce((earliest, index) => Math.min(earliest, index), url.length);
  const base = url.slice(0, suffixIndex);
  const suffix = url.slice(suffixIndex);

  if (base.endsWith(path)) return url;
  return `${base.replace(/\/+$/, '')}${path}${suffix}`;
}

function getReportUrl(entry, options) {
  const explicitUrl = typeof options.backendUrl === 'string'
    ? options.backendUrl.trim()
    : '';
  const capturedUrl = explicitUrl || (
    typeof entry?.backendUrl === 'string' ? entry.backendUrl.trim() : ''
  );
  const method = typeof entry?.method === 'string' ? entry.method : '';

  if (capturedUrl) return appendMethodToUrl(capturedUrl, method);
  if (/^https?:\/\//i.test(method.trim())) return method.trim();
  return appendMethodToUrl('', method);
}

function getReportResponse(entry, responsePayloadMissing) {
  if (responsePayloadMissing) return null;
  const hasResponse = entry?.response !== undefined;
  const hasMessages = Array.isArray(entry?.messages) && entry.messages.length > 0;
  const hasError = entry?.error !== undefined;

  if (hasError) {
    return {
      ...(hasResponse ? { response: nullable(entry.response) } : {}),
      ...(hasMessages ? { messages: entry.messages } : {}),
      error: nullable(entry.error),
    };
  }

  if (hasResponse) return nullable(entry.response);
  if (hasMessages) return entry.messages;
  return null;
}

export function buildDebugReport(entry = {}, options = {}) {
  return {
    url: getReportUrl(entry, options),
    request: options.requestPayloadMissing === true ? null : nullable(entry.request),
    response: getReportResponse(entry, options.responsePayloadMissing === true),
  };
}

export function formatDebugReportJson(report) {
  return `${JSON.stringify(report, null, 2)}\n`;
}

function codeFence(value, language) {
  const content = language === 'json' ? JSON.stringify(value, null, 2) : String(value ?? '');
  const longestRun = (content.match(/`+/g) || [])
    .reduce((longest, run) => Math.max(longest, run.length), 0);
  const fence = '`'.repeat(Math.max(3, longestRun + 1));
  return `${fence}${language}\n${content}\n${fence}`;
}

export function formatDebugReportMarkdown(report) {
  return [
    '## URL',
    '',
    codeFence(report.url, 'text'),
    '',
    '## Request',
    '',
    codeFence(report.request, 'json'),
    '',
    '## Response',
    '',
    codeFence(report.response, 'json'),
    '',
  ].join('\n');
}
