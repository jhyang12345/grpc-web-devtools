/* global chrome */

// Copyright (c) 2019 SafetyCulture Pty Ltd. All Rights Reserved.

export const DEBUG_REPORT_SCHEMA = 'grpc-web-debug-report/v1';

function nullable(value) {
  return value === undefined ? null : value;
}

function finiteOrNull(value) {
  return Number.isFinite(value) ? value : null;
}

function toIsoTimestamp(value) {
  if (!Number.isFinite(value)) return null;
  try {
    return new Date(value).toISOString();
  } catch (_) {
    return null;
  }
}

function getInspectorVersion() {
  try {
    if (typeof chrome !== 'undefined' && chrome.runtime?.getManifest) {
      return chrome.runtime.getManifest().version || null;
    }
  } catch (_) {}
  return null;
}

function getUserAgent() {
  return typeof navigator !== 'undefined' && navigator.userAgent
    ? navigator.userAgent
    : null;
}

function getBackendUrl(entry) {
  if (typeof entry?.backendUrl === 'string' && entry.backendUrl.trim()) return entry.backendUrl;
  if (typeof entry?.method === 'string' && /^(https?:\/\/|\/)/i.test(entry.method)) return entry.method;
  return null;
}

function hasTruncatedValue(value) {
  return !!value && typeof value === 'object' && value.__truncated === true;
}

function getRequestPayloadState(entry, requestPayloadMissing) {
  if (requestPayloadMissing) return 'evicted';
  if (hasTruncatedValue(entry?.request)) return 'truncated';
  return entry?.request == null ? 'missing' : 'available';
}

function getResponsePayloadState(entry, responsePayloadMissing) {
  if (responsePayloadMissing) return 'evicted';
  const values = [entry?.response, entry?.error, entry?.status, ...(entry?.messages || [])];
  if (values.some(hasTruncatedValue)) return 'truncated';
  return values.some(value => value != null) ? 'available' : 'missing';
}

function buildReplayProvenance(replayedFrom) {
  if (!replayedFrom) return null;
  return {
    capture_id: nullable(replayedFrom.captureId),
    transport: nullable(replayedFrom.transport),
    request_id: finiteOrNull(replayedFrom.requestId),
  };
}

export function buildDebugReport(entry = {}, options = {}) {
  const requestPayloadMissing = options.requestPayloadMissing === true;
  const responsePayloadMissing = options.responsePayloadMissing === true;
  const timing = entry.timing || {};
  const messages = responsePayloadMissing
    ? []
    : (Array.isArray(entry.messages) ? entry.messages : []);
  const messageCount = Number.isFinite(entry.messageCount)
    ? entry.messageCount
    : (Number.isFinite(timing.messageCount) ? timing.messageCount : null);

  return {
    schema: DEBUG_REPORT_SCHEMA,
    environment: {
      inspector_version: options.inspectorVersion ?? getInspectorVersion(),
      user_agent: options.userAgent ?? getUserAgent(),
    },
    rpc: {
      entry_id: finiteOrNull(entry.entryId),
      capture_id: nullable(entry.captureId),
      request_id: finiteOrNull(entry.requestId),
      method: nullable(entry.method),
      method_type: nullable(entry.methodType),
      transport: nullable(entry.transport),
      frame_url: nullable(entry.location),
      backend_url: options.backendUrl ?? getBackendUrl(entry),
    },
    timing: {
      started_at: toIsoTimestamp(timing.requestTimestamp),
      completed_at: toIsoTimestamp(timing.completionTimestamp),
      duration_ms: finiteOrNull(timing.duration),
      time_to_first_message_ms: finiteOrNull(timing.timeToFirstMessage),
    },
    result: {
      terminal_phase: nullable(entry.terminalPhase),
      status: responsePayloadMissing ? null : nullable(entry.status),
      message_count: messageCount,
      retained_message_count: responsePayloadMissing ? null : messages.length,
      dropped_message_count: finiteOrNull(entry.droppedMessageCount),
    },
    capture_state: {
      payload_bytes: finiteOrNull(entry.payloadBytes),
      request_payload: getRequestPayloadState(entry, requestPayloadMissing),
      response_payload: getResponsePayloadState(entry, responsePayloadMissing),
    },
    replayed_from: buildReplayProvenance(entry.replayedFrom),
    request: requestPayloadMissing ? null : nullable(entry.request),
    response: responsePayloadMissing ? null : nullable(entry.response),
    messages,
    error: responsePayloadMissing ? null : nullable(entry.error),
  };
}

export function formatDebugReportJson(report) {
  return `${JSON.stringify(report, null, 2)}\n`;
}

function escapeTableValue(value) {
  if (value == null) return 'null';
  return String(value).replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}

function jsonFence(value) {
  const json = JSON.stringify(value, null, 2);
  const longestRun = (json.match(/`+/g) || []).reduce((longest, run) => Math.max(longest, run.length), 0);
  const fence = '`'.repeat(Math.max(3, longestRun + 1));
  return `${fence}json\n${json}\n${fence}`;
}

export function formatDebugReportMarkdown(report) {
  const summary = [
    ['schema', report.schema],
    ['method', report.rpc.method],
    ['transport', report.rpc.transport],
    ['status', report.result.status?.code ?? report.result.terminal_phase],
    ['duration_ms', report.timing.duration_ms],
    ['started_at', report.timing.started_at],
    ['backend_url', report.rpc.backend_url],
    ['frame_url', report.rpc.frame_url],
  ];

  const lines = [
    '# gRPC Debug Report',
    '',
    '| field | value |',
    '| --- | --- |',
    ...summary.map(([field, value]) => `| ${field} | ${escapeTableValue(value)} |`),
  ];

  [
    ['environment', report.environment],
    ['rpc', report.rpc],
    ['timing', report.timing],
    ['result', report.result],
    ['capture_state', report.capture_state],
    ['replayed_from', report.replayed_from],
    ['request', report.request],
    ['response', report.response],
    ['messages', report.messages],
    ['error', report.error],
  ].forEach(([heading, value]) => {
    lines.push('', `## ${heading}`, '', jsonFence(value));
  });

  return `${lines.join('\n')}\n`;
}
