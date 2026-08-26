// Copyright (c) 2019 SafetyCulture Pty Ltd. All Rights Reserved.

import packageInfo from '../../package.json';
import { translate } from '../i18n';
import { buildDebugReport } from './debugReport';

export const MAX_AUDIT_SCAN_ENTRIES = 1000;
export const MAX_AUDIT_REQUESTS = 25;
export const MAX_AUDIT_TIMELINE_ENTRIES = 50;
export const MAX_AUDIT_REPORT_BYTES = 512 * 1024;
export const MAX_AUDIT_PAYLOAD_BYTES = 6 * 1024;
export const SLOW_REQUEST_MS = 2000;
export const PENDING_REQUEST_MS = 30000;
export const LARGE_PAYLOAD_BYTES = 1024 * 1024;

const MAX_AUDIT_FILENAME_SOURCE_CHARS = 60;
const MAX_AUDIT_REPORT_ID_CHARS = 64;
let fallbackReportIdSequence = 0;

const GRPC_CODE_NAMES = [
  'OK',
  'CANCELLED',
  'UNKNOWN',
  'INVALID_ARGUMENT',
  'DEADLINE_EXCEEDED',
  'NOT_FOUND',
  'ALREADY_EXISTS',
  'PERMISSION_DENIED',
  'RESOURCE_EXHAUSTED',
  'FAILED_PRECONDITION',
  'ABORTED',
  'OUT_OF_RANGE',
  'UNIMPLEMENTED',
  'INTERNAL',
  'UNAVAILABLE',
  'DATA_LOSS',
  'UNAUTHENTICATED',
];

const CODE_CLUE_KEYS = {
  NETWORK_ERROR: 'clue.code.NETWORK_ERROR',
  CANCELLED: 'clue.code.CANCELLED',
  UNKNOWN: 'clue.code.UNKNOWN',
  INVALID_ARGUMENT: 'clue.code.INVALID_ARGUMENT',
  DEADLINE_EXCEEDED: 'clue.code.DEADLINE_EXCEEDED',
  NOT_FOUND: 'clue.code.NOT_FOUND',
  ALREADY_EXISTS: 'clue.code.ALREADY_EXISTS',
  PERMISSION_DENIED: 'clue.code.PERMISSION_DENIED',
  RESOURCE_EXHAUSTED: 'clue.code.RESOURCE_EXHAUSTED',
  FAILED_PRECONDITION: 'clue.code.FAILED_PRECONDITION',
  ABORTED: 'clue.code.ABORTED',
  OUT_OF_RANGE: 'clue.code.OUT_OF_RANGE',
  UNIMPLEMENTED: 'clue.code.UNIMPLEMENTED',
  INTERNAL: 'clue.code.INTERNAL',
  UNAVAILABLE: 'clue.code.UNAVAILABLE',
  DATA_LOSS: 'clue.code.DATA_LOSS',
  UNAUTHENTICATED: 'clue.code.UNAUTHENTICATED',
};

const SIGNAL_COUNT_KEYS = {
  network_error: 'signalCount.networkError',
  rpc_error: 'signalCount.rpcError',
  partial_stream: 'signalCount.partialStream',
  replay_failure: 'signalCount.replayFailure',
  slow: 'signalCount.slow',
  pending: 'signalCount.pending',
  messages_dropped: 'signalCount.messagesDropped',
  payload_truncated: 'signalCount.payloadTruncated',
  large_payload: 'signalCount.largePayload',
  payload_evicted: 'signalCount.payloadEvicted',
};

const SIGNAL_LABEL_KEYS = {
  network_error: 'signal.networkError.label',
  rpc_error: 'signal.rpcError.label',
  partial_stream: 'signal.partialStream.label',
  replay_failure: 'signal.replayFailure.label',
  slow: 'signal.slow.label',
  pending: 'signal.pending.label',
  messages_dropped: 'signal.messagesDropped.label',
  payload_truncated: 'signal.payloadTruncated.label',
  large_payload: 'signal.largePayload.label',
  payload_evicted: 'signal.payloadEvicted.label',
};

const SIGNAL_CLUE_KEYS = {
  partial_stream: 'signal.partialStream.clue',
  replay_failure: 'signal.replayFailure.clue',
  slow: 'signal.slow.clue',
  pending: 'signal.pending.clue',
  messages_dropped: 'signal.messagesDropped.clue',
  payload_truncated: 'signal.payloadTruncated.clue',
  large_payload: 'signal.largePayload.clue',
  payload_evicted: 'signal.payloadEvicted.clue',
};

const SENSITIVE_KEYS = new Set([
  'authorization',
  'auth',
  'authorizationtoken',
  'authtoken',
  'proxyauthorization',
  'cookie',
  'setcookie',
  'token',
  'apitoken',
  'accesstoken',
  'refreshtoken',
  'idtoken',
  'apikey',
  'xapikey',
  'accesskey',
  'accesskeyid',
  'secretaccesskey',
  'privatekey',
  'secretkey',
  'password',
  'passwd',
  'passphrase',
  'secret',
  'clientsecret',
  'credential',
  'credentials',
  'session',
  'sessionid',
]);

const REPORT_REDACTED = '[redacted]';

function normalizeReportLocale(locale) {
  return locale === 'ko' ? 'ko' : 'en';
}

function reportText(locale, key, values = {}) {
  return translate(normalizeReportLocale(locale), `audit.report.${key}`, values);
}

export function utf8ByteLength(value) {
  const text = String(value ?? '');
  if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(text).length;
  return unescape(encodeURIComponent(text)).length;
}

function fitUtf8Text(value, maximumBytes, suffix = '') {
  const text = String(value ?? '');
  if (utf8ByteLength(text) <= maximumBytes) return text;

  const ending = utf8ByteLength(suffix) <= maximumBytes ? suffix : '';
  const contentBudget = maximumBytes - utf8ByteLength(ending);
  let low = 0;
  let high = text.length;
  let bestEnd = 0;

  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    let safeEnd = middle;
    if (safeEnd > 0 && safeEnd < text.length) {
      const previous = text.charCodeAt(safeEnd - 1);
      const next = text.charCodeAt(safeEnd);
      if (previous >= 0xd800 && previous <= 0xdbff && next >= 0xdc00 && next <= 0xdfff) safeEnd -= 1;
    }
    if (utf8ByteLength(text.slice(0, safeEnd)) <= contentBudget) {
      bestEnd = safeEnd;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }

  return `${text.slice(0, bestEnd)}${ending}`;
}

function asFiniteNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function clipText(value, maximum = 2000) {
  const text = String(value ?? '');
  return text.length <= maximum ? text : `${text.slice(0, maximum)}…`;
}

function redactTokenSecrets(value) {
  return String(value ?? '')
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [redacted]')
    .replace(/\bBasic\s+[A-Za-z0-9+/=]+/gi, 'Basic [redacted]')
    .replace(/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, '[redacted JWT]');
}

function isSensitiveKey(key) {
  const normalized = String(key || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  return SENSITIVE_KEYS.has(normalized)
    || /(?:token|password|passwd|passphrase|secret|secretkey|credential|privatekey)$/.test(normalized)
    || /^(?:authorization|proxyauthorization|cookie|setcookie)/.test(normalized);
}

export function redactReportUrl(value) {
  const raw = clipText(redactTokenSecrets(value), 4000).trim();
  if (!raw) return '';

  try {
    const isAbsolute = /^[a-z][a-z\d+.-]*:\/\//i.test(raw);
    const isSchemeRelative = /^\/\//.test(raw);
    const parsed = new URL(raw, 'https://audit.invalid');
    if (parsed.username) parsed.username = REPORT_REDACTED;
    if (parsed.password) parsed.password = REPORT_REDACTED;
    Array.from(parsed.searchParams.keys()).forEach(key => parsed.searchParams.set(key, REPORT_REDACTED));
    parsed.hash = '';
    if (isAbsolute) return parsed.toString();
    if (isSchemeRelative) return `//${parsed.host}${parsed.pathname}${parsed.search}`;
    return `${parsed.pathname}${parsed.search}`;
  } catch (_) {
    return raw.replace(/([?&][^=&#]+)=([^&#]*)/g, `$1=${REPORT_REDACTED}`).replace(/#.*$/, '');
  }
}

function redactTextSecrets(value) {
  const withAbsoluteUrlsRedacted = redactTokenSecrets(value).replace(
    /\b[a-z][a-z\d+.-]*:\/\/[^\s<>"'`]+/gi,
    matchedUrl => redactReportUrl(matchedUrl),
  );
  return withAbsoluteUrlsRedacted.replace(
    /(^|[\s([{"'`])((?:\/\/|\/|\.\.?\/|[A-Za-z0-9._~-]+\/|[A-Za-z0-9._~-]+(?=\?[^\s<>"'`]*=)|(?=\?[^\s<>"'`]*=))[^\s<>"'`]*[?#][^\s<>"'`]*)/g,
    (_, prefix, matchedUrl) => `${prefix}${redactReportUrl(matchedUrl)}`,
  );
}

function redactMethod(value, maximum = 500, locale = 'en') {
  const raw = redactTextSecrets(value || reportText(locale, 'value.unknownMethod'));
  const redacted = /[?#]/.test(raw) ? redactReportUrl(raw) : raw;
  return clipText(redacted, maximum);
}

function isTruncatedDescriptor(value) {
  return !!value && typeof value === 'object' && value.__truncated === true;
}

function createBoundedSnapshot(value, maximumBytes, locale) {
  const reportTruncated = reportText(locale, 'snapshot.truncated');
  const state = {
    remainingCharacters: Math.max(256, Math.floor(maximumBytes / 2)),
    nodes: 0,
    seen: new WeakSet(),
  };

  const visit = (current, key, depth) => {
    if (isSensitiveKey(key)) return REPORT_REDACTED;
    if (state.remainingCharacters <= 0) return reportTruncated;
    if (current === null) return null;

    const type = typeof current;
    if (type === 'string') {
      const sourceLimit = Math.min(current.length, state.remainingCharacters + 256, 8000);
      const redacted = redactTextSecrets(current.slice(0, sourceLimit));
      const retainedLength = Math.min(redacted.length, state.remainingCharacters, 2000);
      state.remainingCharacters -= retainedLength;
      const retained = redacted.slice(0, retainedLength);
      return current.length > retainedLength ? `${retained}… ${reportTruncated}` : retained;
    }
    if (type === 'number') return Number.isFinite(current) ? current : String(current);
    if (type === 'boolean') return current;
    if (type === 'bigint') return `${current}n`;
    if (type === 'undefined' || type === 'function' || type === 'symbol') return `[${type}]`;

    if (isTruncatedDescriptor(current)) {
      return {
        __truncated: true,
        __originalSizeBytes: asFiniteNumber(current.__originalSizeBytes),
        preview: reportText(locale, 'snapshot.omitted'),
      };
    }
    if (state.seen.has(current)) return reportText(locale, 'snapshot.circular');
    if (depth >= 8) return reportText(locale, 'snapshot.maxDepth');
    if (state.nodes >= 400) return reportText(locale, 'snapshot.nodeLimit');

    state.seen.add(current);
    state.nodes += 1;

    if (Array.isArray(current)) {
      const result = [];
      const retainedItems = Math.min(current.length, 50);
      for (let index = 0; index < retainedItems && state.remainingCharacters > 0; index += 1) {
        result.push(visit(current[index], String(index), depth + 1));
      }
      if (current.length > result.length) {
        result.push(reportText(locale, 'snapshot.moreItems', { count: current.length - result.length }));
      }
      return result;
    }

    const result = {};
    let retainedKeys = 0;
    let omittedKeys = false;
    try {
      for (const rawKey in current) {
        if (!Object.prototype.hasOwnProperty.call(current, rawKey)) continue;
        if (retainedKeys >= 50 || state.remainingCharacters <= 0) {
          omittedKeys = true;
          break;
        }
        const safeKey = clipText(rawKey, 200);
        state.remainingCharacters -= Math.min(safeKey.length, state.remainingCharacters);
        try {
          result[safeKey] = visit(current[rawKey], rawKey, depth + 1);
        } catch (_) {
          result[safeKey] = reportText(locale, 'snapshot.propertyUnreadable');
        }
        retainedKeys += 1;
      }
    } catch (_) {
      return reportText(locale, 'snapshot.objectUnreadable');
    }
    if (omittedKeys) result.__auditReportNotice = reportText(locale, 'snapshot.additionalKeys');
    return result;
  };

  return visit(value, '', 0);
}

function fitJsonPreview(serialized, maximumBytes) {
  let low = 0;
  let high = serialized.length;
  let best = JSON.stringify({ __auditReportTruncated: true }, null, 2);

  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const candidate = JSON.stringify({
      __auditReportTruncated: true,
      preview: serialized.slice(0, middle),
    }, null, 2);
    if (utf8ByteLength(candidate) <= maximumBytes) {
      best = candidate;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }

  return best;
}

export function formatBoundedJson(value, maximumBytes = MAX_AUDIT_PAYLOAD_BYTES, locale = 'en') {
  let serialized;
  try {
    serialized = JSON.stringify(createBoundedSnapshot(value, maximumBytes, locale), null, 2);
  } catch (_) {
    serialized = JSON.stringify({
      __auditReportError: reportText(locale, 'snapshot.serializationFailed'),
    }, null, 2);
  }
  if (typeof serialized !== 'string') serialized = 'null';
  return utf8ByteLength(serialized) <= maximumBytes
    ? serialized
    : fitJsonPreview(serialized, maximumBytes);
}

export function normalizeGrpcCode(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const scalar = typeof value === 'string' ? clipText(value, 128) : value;
  const numeric = Number(scalar);
  if (Number.isInteger(numeric) && numeric >= 0 && numeric < GRPC_CODE_NAMES.length) {
    return GRPC_CODE_NAMES[numeric];
  }

  let normalized = String(scalar).trim().toUpperCase().replace(/[\s-]+/g, '_');
  normalized = normalized.replace(/^GRPC_/, '').replace(/^CODE_/, '');
  if (normalized === 'CANCELED') normalized = 'CANCELLED';
  return normalized.replace(/[^A-Z0-9_./]+/g, '_') || null;
}

export function getDiagnosticClue(code, errorMessage = '', locale = 'en') {
  const normalizedCode = normalizeGrpcCode(code);
  if (normalizedCode && CODE_CLUE_KEYS[normalizedCode]) {
    return reportText(locale, CODE_CLUE_KEYS[normalizedCode]);
  }

  const normalizedMessage = clipText(errorMessage || '', 2000).toLowerCase();
  if (/deadline|timed?\s*out|timeout/.test(normalizedMessage)) return reportText(locale, CODE_CLUE_KEYS.DEADLINE_EXCEEDED);
  if (/unauthenticated|expired token|invalid token|credential/.test(normalizedMessage)) return reportText(locale, CODE_CLUE_KEYS.UNAUTHENTICATED);
  if (/permission|forbidden|not authorized/.test(normalizedMessage)) return reportText(locale, CODE_CLUE_KEYS.PERMISSION_DENIED);
  if (/unavailable|failed to fetch|network|cors|connection/.test(normalizedMessage)) return reportText(locale, CODE_CLUE_KEYS.UNAVAILABLE);
  return reportText(locale, 'clue.default');
}

function getErrorCode(entry, summary) {
  return entry?.error?.code ?? entry?.status?.code ?? summary?.errorCode ?? summary?.statusCode ?? null;
}

function getErrorMessage(entry) {
  if (typeof entry?.error === 'string') return entry.error;
  return entry?.error?.message || entry?.status?.details || entry?.status?.detail || '';
}

function hasTruncatedPayload(entry, summary) {
  if (summary?.payloadTruncated === true) return true;
  if (!entry) return false;
  return [entry.request, entry.response, entry.error, entry.status, ...(entry.messages || [])]
    .some(isTruncatedDescriptor);
}

function getEventTimestamp(entry) {
  return asFiniteNumber(entry?.timing?.completionTimestamp)
    ?? asFiniteNumber(entry?.timing?.requestTimestamp)
    ?? 0;
}

function resolveFullEntry(summary, getEntry) {
  if (!summary?.entryId || typeof getEntry !== 'function') return null;
  try { return getEntry(summary.entryId) || null; } catch (_) { return null; }
}

export function analyzeAuditEntry(summary = {}, options = {}) {
  const nowMs = asFiniteNumber(options.now) ?? Date.now();
  const fullEntry = options.fullEntry === undefined
    ? resolveFullEntry(summary, options.getEntry)
    : options.fullEntry;
  const entry = fullEntry || summary;
  const rawCode = getErrorCode(fullEntry, summary);
  const code = normalizeGrpcCode(rawCode);
  const taggedNetworkError = fullEntry?.error?.isNetworkError === true || summary.isNetworkError === true;
  const isNetworkError = taggedNetworkError && (rawCode == null || rawCode === '');
  const errorMessage = clipText(getErrorMessage(fullEntry), 2000);
  const terminalPhase = fullEntry?.terminalPhase || summary.terminalPhase;
  const hasErrorPayload = fullEntry ? fullEntry.error != null : summary.error === true;
  const nonOkStatus = code != null && code !== 'OK';
  const isError = terminalPhase === 'error' || hasErrorPayload || nonOkStatus || isNetworkError;
  const duration = asFiniteNumber(entry?.timing?.duration);
  const requestTimestamp = asFiniteNumber(entry?.timing?.requestTimestamp);
  const completionTimestamp = asFiniteNumber(entry?.timing?.completionTimestamp);
  const hasTerminalEvidence = terminalPhase === 'complete'
    || terminalPhase === 'error'
    || completionTimestamp != null
    || (fullEntry
      ? fullEntry.response !== undefined || fullEntry.error !== undefined || fullEntry.status !== undefined
      : summary.response === true || summary.error === true || summary.status === true);
  const isPending = !hasTerminalEvidence
    && requestTimestamp != null
    && nowMs - requestTimestamp >= PENDING_REQUEST_MS;
  const droppedMessageCount = asFiniteNumber(entry?.droppedMessageCount) || 0;
  const retainedMessageCount = Array.isArray(fullEntry?.messages) ? fullEntry.messages.length : 0;
  const observedMessageCount = asFiniteNumber(entry?.messageCount)
    ?? asFiniteNumber(entry?.timing?.messageCount)
    ?? retainedMessageCount;
  const payloadBytes = asFiniteNumber(entry?.payloadBytes) ?? asFiniteNumber(summary.payloadBytes) ?? 0;
  const payloadWasEvicted = !fullEntry && !!(
    summary.request || summary.response || summary.error || summary.status || summary.messages
  );
  const payloadWasTruncated = hasTruncatedPayload(fullEntry, summary);
  const isPartialStreamFailure = isError && observedMessageCount > 0;
  const isReplayFailure = isError && !!entry?.replayedFrom;
  const signals = [];

  if (isError) {
    if (isNetworkError) {
      signals.push({
        id: 'network_error',
        severity: 'error',
      });
    } else {
      signals.push({
        id: 'rpc_error',
        severity: 'error',
        code,
        errorMessage,
      });
    }
  }
  if (isPartialStreamFailure) signals.push({
    id: 'partial_stream', severity: 'warning',
  });
  if (isReplayFailure) signals.push({
    id: 'replay_failure', severity: 'warning',
  });
  if (duration != null && duration >= SLOW_REQUEST_MS) signals.push({
    id: 'slow', severity: 'warning', duration,
  });
  if (isPending) signals.push({
    id: 'pending', severity: 'warning',
  });
  if (droppedMessageCount > 0) signals.push({
    id: 'messages_dropped', severity: 'warning', count: droppedMessageCount,
  });
  if (payloadWasTruncated) signals.push({
    id: 'payload_truncated', severity: 'warning',
  });
  if (payloadBytes >= LARGE_PAYLOAD_BYTES) signals.push({
    id: 'large_payload', severity: 'warning', bytes: payloadBytes,
  });
  if (payloadWasEvicted) signals.push({
    id: 'payload_evicted', severity: 'info',
  });

  return {
    key: summary.entryId != null ? `entry:${summary.entryId}` : options.key,
    summary,
    fullEntry,
    entry,
    code,
    errorMessage,
    isError,
    isNetworkError,
    isPending,
    isNoteworthy: signals.some(signal => signal.id !== 'payload_evicted'),
    signals,
    eventTimestamp: getEventTimestamp(entry),
    requestTimestamp,
    completionTimestamp,
    duration,
    payloadBytes,
    payloadWasEvicted,
    payloadWasTruncated,
    retainedMessageCount,
    observedMessageCount,
    droppedMessageCount,
  };
}

function compareNewestFirst(left, right) {
  return right.eventTimestamp - left.eventTimestamp;
}

function compareIssuePriority(left, right) {
  if (left.isError !== right.isError) return left.isError ? -1 : 1;
  return compareNewestFirst(left, right);
}

function buildFailureClusters(analyses, locale) {
  const clusters = new Map();
  analyses.filter(analysis => analysis.isError).forEach(analysis => {
    const method = redactMethod(analysis.entry?.method, 300, locale);
    const code = analysis.isNetworkError ? 'NETWORK_ERROR' : (analysis.code || 'UNMAPPED_ERROR');
    const key = `${method}\u0000${code}`;
    const existing = clusters.get(key) || { method, code, count: 0 };
    existing.count += 1;
    clusters.set(key, existing);
  });
  return Array.from(clusters.values())
    .filter(cluster => cluster.count > 1)
    .sort((left, right) => right.count - left.count)
    .slice(0, 5);
}

function getBackendOrigin(analysis) {
  const value = analysis.entry?.backendUrl;
  if (typeof value !== 'string' || !value.trim()) return '';
  try { return new URL(value).origin; } catch (_) { return ''; }
}

function buildSharedBackendObservations(analyses, locale) {
  const backends = new Map();
  analyses.filter(analysis => analysis.isError).forEach(analysis => {
    const origin = getBackendOrigin(analysis);
    if (!origin) return;
    const existing = backends.get(origin) || { count: 0, methods: new Set() };
    existing.count += 1;
    existing.methods.add(redactMethod(analysis.entry?.method, 300, locale));
    backends.set(origin, existing);
  });
  return Array.from(backends.entries())
    .filter(([, value]) => value.count > 1 && value.methods.size > 1)
    .sort((left, right) => right[1].count - left[1].count)
    .slice(0, 3)
    .map(([origin, value]) => ({ origin, count: value.count, methodCount: value.methods.size }));
}

function resolveSourceUrl(options, analyses) {
  if (typeof options.sourceUrl === 'string' && options.sourceUrl.trim()) {
    return clipText(options.sourceUrl.trim(), 4000);
  }

  let sourceUrl = '';
  let sourceTimestamp = -Infinity;
  analyses.forEach(analysis => {
    const candidate = analysis.entry?.location;
    if (typeof candidate !== 'string' || !candidate.trim()) return;
    const timestamp = analysis.requestTimestamp ?? analysis.eventTimestamp ?? 0;
    if (timestamp >= sourceTimestamp) {
      sourceUrl = clipText(candidate.trim(), 4000);
      sourceTimestamp = timestamp;
    }
  });
  return sourceUrl;
}

function buildReportModel(options) {
  const locale = normalizeReportLocale(options.locale);
  const allEntries = Array.isArray(options.allEntries) ? options.allEntries : [];
  const scannedEntries = allEntries.slice(-MAX_AUDIT_SCAN_ENTRIES);
  const nowDate = options.now instanceof Date ? new Date(options.now.getTime()) : new Date(options.now ?? Date.now());
  const nowMs = Number.isFinite(nowDate.getTime()) ? nowDate.getTime() : Date.now();
  const analyses = scannedEntries.map((summary, index) => analyzeAuditEntry(summary, {
    now: nowMs,
    getEntry: options.getEntry,
    key: `index:${index}`,
  }));
  const issueCandidates = analyses.filter(analysis => analysis.isNoteworthy).sort(compareIssuePriority);
  const filterValue = typeof options.filterValue === 'string' ? options.filterValue.trim() : '';
  const filterActive = !!filterValue;
  const filteredIds = new Set((Array.isArray(options.filteredEntries) ? options.filteredEntries : [])
    .map(entry => entry?.entryId)
    .filter(entryId => entryId != null));
  const filterCandidates = filterActive
    ? analyses.filter(analysis => filteredIds.has(analysis.summary?.entryId)).sort(compareNewestFirst)
    : [];
  const matching = new Map();
  issueCandidates.forEach(analysis => matching.set(analysis.key, analysis));
  filterCandidates.forEach(analysis => matching.set(analysis.key, analysis));

  const selected = new Map();
  const reservedFilterSlots = filterActive ? Math.min(5, filterCandidates.length) : 0;
  for (const analysis of filterCandidates.slice(0, reservedFilterSlots)) {
    selected.set(analysis.key, analysis);
  }
  for (const analysis of issueCandidates) {
    if (selected.size >= MAX_AUDIT_REQUESTS) break;
    selected.set(analysis.key, analysis);
  }
  for (const analysis of filterCandidates) {
    if (selected.size >= MAX_AUDIT_REQUESTS) break;
    selected.set(analysis.key, analysis);
  }

  const selectedAnalyses = Array.from(selected.values())
    .sort((left, right) => left.eventTimestamp - right.eventTimestamp);
  const signalCounts = {};
  analyses.forEach(analysis => analysis.signals.forEach(signal => {
    signalCounts[signal.id] = (signalCounts[signal.id] || 0) + 1;
  }));
  const activityStartTimestamps = analyses
    .map(analysis => analysis.requestTimestamp ?? analysis.completionTimestamp)
    .filter(timestamp => timestamp != null);
  const activityEndTimestamps = analyses
    .map(analysis => analysis.completionTimestamp ?? analysis.requestTimestamp)
    .filter(timestamp => timestamp != null);
  const earliestActivity = activityStartTimestamps.length ? Math.min(...activityStartTimestamps) : null;
  const latestActivity = activityEndTimestamps.length ? Math.max(...activityEndTimestamps) : null;

  return {
    locale,
    generatedAt: new Date(nowMs).toISOString(),
    version: clipText(options.version || packageInfo.version || 'unknown', 100),
    sourceUrl: resolveSourceUrl(options, analyses),
    filterValue,
    filterActive,
    analyses,
    issueCandidates,
    selectedAnalyses,
    timeline: analyses.slice()
      .sort((left, right) => (
        (left.requestTimestamp ?? left.eventTimestamp) - (right.requestTimestamp ?? right.eventTimestamp)
      ))
      .slice(-MAX_AUDIT_TIMELINE_ENTRIES),
    failureClusters: buildFailureClusters(issueCandidates, locale),
    sharedBackends: buildSharedBackendObservations(issueCandidates, locale),
    signalCounts,
    capture: {
      retained: allEntries.length,
      reviewed: scannedEntries.length,
      matching: matching.size,
      selected: selectedAnalyses.length,
      earliest: earliestActivity,
      latest: earliestActivity == null || latestActivity == null
        ? null
        : Math.max(earliestActivity, latestActivity),
    },
  };
}

function inlineCode(value) {
  const content = clipText(redactTextSecrets(value), 4000).replace(/[\r\n]+/g, ' ');
  const longestRun = (content.match(/`+/g) || []).reduce((longest, run) => Math.max(longest, run.length), 0);
  const fence = '`'.repeat(Math.max(1, longestRun + 1));
  return `${fence}${content}${fence}`;
}

function codeFence(content, language = 'json') {
  const text = String(content ?? '');
  const longestRun = (text.match(/`+/g) || []).reduce((longest, run) => Math.max(longest, run.length), 0);
  const fence = '`'.repeat(Math.max(3, longestRun + 1));
  return `${fence}${language}\n${text}\n${fence}`;
}

function formatTimestamp(value, locale = 'en') {
  const number = asFiniteNumber(value);
  if (number == null) return reportText(locale, 'value.notCaptured');
  try { return new Date(number).toISOString(); } catch (_) { return reportText(locale, 'value.invalidTimestamp'); }
}

function formatDuration(value, locale = 'en') {
  const number = asFiniteNumber(value);
  if (number == null) return reportText(locale, 'value.notCaptured');
  if (number < 1000) {
    return reportText(locale, 'duration.milliseconds', { value: Math.max(0, Math.round(number)) });
  }
  return reportText(locale, 'duration.seconds', { value: (Math.max(0, number) / 1000).toFixed(2) });
}

function formatBytes(value, locale = 'en') {
  const number = asFiniteNumber(value);
  if (number == null) return reportText(locale, 'value.notCaptured');
  if (number < 1024) return `${number} B`;
  if (number < 1024 * 1024) return `${(number / 1024).toFixed(1)} KiB`;
  return `${(number / (1024 * 1024)).toFixed(1)} MiB`;
}

function formatSignalLabel(signal, locale) {
  const key = SIGNAL_LABEL_KEYS[signal.id];
  if (!key) return signal.id;
  return reportText(locale, key, {
    code: signal.code ? ` (${signal.code})` : '',
    duration: formatDuration(signal.duration, locale),
    count: signal.count,
    bytes: formatBytes(signal.bytes, locale),
  });
}

function formatSignalClue(signal, locale) {
  if (signal.id === 'network_error') return getDiagnosticClue('NETWORK_ERROR', '', locale);
  if (signal.id === 'rpc_error') return getDiagnosticClue(signal.code, signal.errorMessage, locale);
  const key = SIGNAL_CLUE_KEYS[signal.id];
  return key ? reportText(locale, key) : reportText(locale, 'clue.default');
}

function formatActivitySpan(value, locale) {
  const milliseconds = Math.max(0, asFiniteNumber(value) ?? 0);
  if (milliseconds < 60000) return formatDuration(milliseconds, locale);

  const hours = Math.floor(milliseconds / 3600000);
  const minutes = Math.floor((milliseconds % 3600000) / 60000);
  const seconds = ((milliseconds % 60000) / 1000).toFixed(2);
  return hours > 0
    ? reportText(locale, 'duration.hoursMinutesSeconds', { hours, minutes, seconds })
    : reportText(locale, 'duration.minutesSeconds', { minutes, seconds });
}

function formatReviewedActivityWindow(model) {
  const { earliest, latest } = model.capture;
  const { locale } = model;
  if (earliest == null || latest == null) return reportText(locale, 'value.notCaptured');

  const start = inlineCode(formatTimestamp(earliest, locale));
  if (earliest === latest) return start;

  const end = inlineCode(formatTimestamp(latest, locale));
  const span = reportText(locale, 'scope.windowSpan', {
    duration: formatActivitySpan(latest - earliest, locale),
  });
  return `${start} → ${end} (${span})`;
}

function formatReportHeader(model, includedCount, omittedForBytes) {
  const { locale } = model;
  const selection = model.filterActive
    ? reportText(locale, 'scope.selectionFiltered')
    : reportText(locale, 'scope.selectionIssues');
  const omitted = Math.max(0, model.capture.matching - includedCount);
  return [
    `# ${reportText(locale, 'title')}`,
    '',
    `> ${reportText(locale, 'notice.investigation')}`,
    '>',
    `> ${reportText(locale, 'notice.privacy')}`,
    '',
    `## ${reportText(locale, 'section.scope')}`,
    '',
    `- ${reportText(locale, 'scope.generatedUtc')}: ${inlineCode(model.generatedAt)}`,
    `- ${reportText(locale, 'scope.extensionVersion')}: ${inlineCode(model.version)}`,
    `- ${reportText(locale, 'scope.sourcePage')}: ${model.sourceUrl ? inlineCode(redactReportUrl(model.sourceUrl)) : reportText(locale, 'value.notCaptured')}`,
    `- ${reportText(locale, 'scope.selection')}: ${selection}`,
    `- ${reportText(locale, 'scope.counts', {
      retained: model.capture.retained,
      reviewed: model.capture.reviewed,
      matched: model.capture.matching,
      included: includedCount,
      omitted,
    })}`,
    `- ${reportText(locale, 'scope.reviewedActivityWindow')}: ${formatReviewedActivityWindow(model)}`,
    `- ${reportText(locale, 'scope.limits', {
      requests: MAX_AUDIT_REQUESTS,
      timeline: MAX_AUDIT_TIMELINE_ENTRIES,
      payload: formatBytes(MAX_AUDIT_PAYLOAD_BYTES, locale),
      report: formatBytes(MAX_AUDIT_REPORT_BYTES, locale),
    })}`,
    ...(omittedForBytes > 0 ? [`- ${reportText(locale, 'scope.omittedForBytes', { count: omittedForBytes })}`] : []),
    '',
  ].join('\n');
}

function formatObservations(model) {
  const { locale } = model;
  const lines = [`## ${reportText(locale, 'section.observedClues')}`, ''];
  const signalEntries = Object.entries(model.signalCounts)
    .filter(([, count]) => count > 0)
    .sort((left, right) => right[1] - left[1]);
  if (!signalEntries.length) {
    lines.push(`- ${reportText(locale, 'clues.none')}`);
  } else {
    signalEntries.forEach(([id, count]) => {
      const key = SIGNAL_COUNT_KEYS[id];
      lines.push(`- ${key ? reportText(locale, key, { count }) : `${count} ${id}.`}`);
    });
  }
  model.failureClusters.forEach(cluster => {
    lines.push(`- ${reportText(locale, 'clues.repeatedFailure', {
      count: cluster.count,
      code: inlineCode(cluster.code),
      method: inlineCode(cluster.method),
      clue: getDiagnosticClue(cluster.code, '', locale),
    })}`);
  });
  model.sharedBackends.forEach(observation => {
    lines.push(`- ${reportText(locale, 'clues.sharedRoute', {
      count: observation.count,
      methodCount: observation.methodCount,
      origin: inlineCode(observation.origin),
    })}`);
  });
  lines.push('');
  return lines.join('\n');
}

function timelineState(analysis, locale) {
  let state = 'active';
  if (analysis.isError) state = 'error';
  else if (analysis.isPending) state = 'pending';
  else if (analysis.signals.some(signal => signal.severity === 'warning')) state = 'flagged';
  else if (analysis.entry?.terminalPhase === 'complete' || analysis.completionTimestamp != null) state = 'complete';
  return reportText(locale, `timeline.state.${state}`);
}

function formatTimeline(model) {
  const { locale } = model;
  const countKey = model.timeline.length === 1
    ? 'section.recentActivity.one'
    : 'section.recentActivity.other';
  const lines = [
    `## ${reportText(locale, countKey, { count: model.timeline.length })}`,
    '',
  ];
  if (!model.timeline.length) {
    lines.push(`_${reportText(locale, 'timeline.none')}_`, '');
    return lines.join('\n');
  }
  model.timeline.forEach(analysis => {
    const entry = analysis.entry || {};
    lines.push(`- ${inlineCode(formatTimestamp(analysis.requestTimestamp, locale))} — **${timelineState(analysis, locale)}** · ${formatDuration(analysis.duration, locale)} · ${inlineCode(entry.transport || reportText(locale, 'value.unknownTransport'))} · ${inlineCode(redactMethod(entry.method, 500, locale))}`);
  });
  lines.push('');
  return lines.join('\n');
}

function formatRequestSection(analysis, locale) {
  const entry = analysis.fullEntry || analysis.summary || {};
  const reportEntry = {
    method: redactMethod(entry.method, 1000, locale),
    backendUrl: entry.backendUrl,
    request: analysis.fullEntry?.request,
    response: analysis.fullEntry?.response,
    messages: analysis.fullEntry?.messages,
    error: analysis.fullEntry?.error,
  };
  const debugReport = buildDebugReport(reportEntry, {
    requestPayloadMissing: analysis.payloadWasEvicted && analysis.summary?.request === true,
    responsePayloadMissing: analysis.payloadWasEvicted && !!(
      analysis.summary?.response || analysis.summary?.error || analysis.summary?.messages
    ),
  });
  const headingState = timelineState(analysis, locale);
  const status = analysis.fullEntry?.status;
  const statusDetails = status?.details || status?.detail || '';
  const statusLabel = analysis.isNetworkError
    ? reportText(locale, 'detail.networkStatus')
    : (analysis.code || status?.code || reportText(locale, 'value.notCaptured'));
  const backendUrl = redactReportUrl(debugReport.url || entry.backendUrl || entry.method || '');
  const frameUrl = redactReportUrl(entry.location || '');
  const lines = [
    `### ${formatTimestamp(analysis.eventTimestamp, locale)} · ${headingState} · ${inlineCode(redactMethod(entry.method, 500, locale))}`,
    '',
    `- ${reportText(locale, 'detail.requestId')}: ${inlineCode(entry.requestId ?? reportText(locale, 'value.notCaptured'))}`,
    `- ${reportText(locale, 'detail.transportType')}: ${inlineCode(entry.transport || reportText(locale, 'value.notCaptured'))} / ${inlineCode(entry.methodType || reportText(locale, 'value.notCaptured'))}`,
    `- ${reportText(locale, 'detail.startedCompleted')}: ${inlineCode(formatTimestamp(analysis.requestTimestamp, locale))} / ${inlineCode(formatTimestamp(analysis.completionTimestamp, locale))}`,
    `- ${reportText(locale, 'detail.duration')}: ${formatDuration(analysis.duration, locale)}`,
    `- ${reportText(locale, 'detail.backendUrl')}: ${backendUrl ? inlineCode(backendUrl) : reportText(locale, 'value.notCaptured')}`,
    `- ${reportText(locale, 'detail.frameUrl')}: ${frameUrl ? inlineCode(frameUrl) : reportText(locale, 'value.notCaptured')}`,
    `- ${reportText(locale, 'detail.status')}: ${inlineCode(statusLabel)}${statusDetails ? ` — ${inlineCode(clipText(redactTextSecrets(clipText(statusDetails, 2000)), 1000))}` : ''}`,
    `- ${reportText(locale, 'detail.streamMessages', {
      observed: analysis.observedMessageCount,
      retained: analysis.retainedMessageCount,
      dropped: analysis.droppedMessageCount,
    })}`,
    `- ${reportText(locale, 'detail.retainedPayloadSize')}: ${formatBytes(analysis.payloadBytes, locale)}`,
  ];
  if (entry.replayedFrom) {
    lines.push(`- ${reportText(locale, 'detail.replaySource', {
      transport: inlineCode(entry.replayedFrom.transport || reportText(locale, 'value.unknownTransport')),
      requestId: inlineCode(entry.replayedFrom.requestId ?? reportText(locale, 'value.unknown')),
    })}`);
  }
  lines.push('', `**${reportText(locale, 'section.signals')}**`, '');
  if (!analysis.signals.length) {
    lines.push(`- ${reportText(locale, 'signals.noneFiltered')}`);
  } else {
    analysis.signals.forEach(signal => {
      lines.push(`- **${formatSignalLabel(signal, locale)}.** ${formatSignalClue(signal, locale)}`);
    });
  }
  lines.push('', `**${reportText(locale, 'section.requestPayload')}**`, '');
  if (analysis.payloadWasEvicted && analysis.summary?.request === true) {
    lines.push(`_${reportText(locale, 'notice.requestEvicted')}_`);
  } else {
    lines.push(codeFence(formatBoundedJson(debugReport.request, MAX_AUDIT_PAYLOAD_BYTES, locale)));
  }
  lines.push('', `**${reportText(locale, 'section.outcome')}**`, '');
  if (analysis.payloadWasEvicted && (analysis.summary?.response || analysis.summary?.error || analysis.summary?.messages)) {
    lines.push(`_${reportText(locale, 'notice.outcomeEvicted')}_`);
  } else {
    lines.push(codeFence(formatBoundedJson(debugReport.response, MAX_AUDIT_PAYLOAD_BYTES, locale)));
  }
  lines.push('');
  return lines.join('\n');
}

function renderAuditReport(model) {
  const requestSections = model.selectedAnalyses.map(analysis => formatRequestSection(analysis, model.locale));
  const observations = formatObservations(model);
  const timeline = formatTimeline(model);
  let retainedSections = requestSections.slice();
  let omittedForBytes = 0;

  while (true) {
    const header = formatReportHeader(model, retainedSections.length, omittedForBytes);
    const details = retainedSections.length
      ? `## ${reportText(model.locale, 'section.detailedChronological')}\n\n${retainedSections.join('\n')}`
      : `## ${reportText(model.locale, 'section.detailed')}\n\n_${reportText(model.locale, 'details.none')}_\n`;
    const text = `${header}${observations}${timeline}${details}`;
    if (utf8ByteLength(text) <= MAX_AUDIT_REPORT_BYTES) {
      return { text, includedCount: retainedSections.length, omittedForBytes };
    }
    if (retainedSections.length === 0) {
      const suffix = `\n\n> ${reportText(model.locale, 'notice.bodyTruncated')}\n`;
      return {
        text: fitUtf8Text(text, MAX_AUDIT_REPORT_BYTES, suffix),
        includedCount: 0,
        omittedForBytes,
      };
    }
    // Preserve the newest evidence when the byte budget forces a choice.
    retainedSections.shift();
    omittedForBytes += 1;
  }
}

function getFilenameSourceSlug(sourceUrl) {
  let context = '';
  try {
    const parsed = new URL(String(sourceUrl || '').trim());
    context = parsed.hostname
      ? `${parsed.hostname}${parsed.port ? `-${parsed.port}` : ''}`
      : parsed.protocol.replace(/:$/, '');
  } catch (_) {
    return 'unknown-source';
  }

  const slug = context
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_AUDIT_FILENAME_SOURCE_CHARS)
    .replace(/-+$/g, '');
  return slug || 'unknown-source';
}

function randomReportId() {
  try {
    const cryptoObject = typeof window !== 'undefined' ? window.crypto : null;
    if (typeof cryptoObject?.randomUUID === 'function') return cryptoObject.randomUUID();
    if (typeof cryptoObject?.getRandomValues === 'function') {
      const bytes = cryptoObject.getRandomValues(new Uint8Array(16));
      bytes[6] = (bytes[6] & 0x0f) | 0x40;
      bytes[8] = (bytes[8] & 0x3f) | 0x80;
      const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
      return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
    }
  } catch (_) {
    // The monotonic fallback below still prevents duplicate names in this panel.
  }
  fallbackReportIdSequence += 1;
  return `fallback-${Date.now().toString(36)}-${fallbackReportIdSequence.toString(36)}`;
}

function normalizeReportId(value) {
  const candidate = String(value || randomReportId())
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_AUDIT_REPORT_ID_CHARS)
    .replace(/-+$/g, '');
  return candidate || randomReportId();
}

export function getAuditReportFilename(value = new Date(), sourceUrl = '', reportId) {
  const date = value instanceof Date ? value : new Date(value);
  const safeDate = Number.isFinite(date.getTime()) ? date : new Date();
  const timestamp = safeDate.toISOString().replace(/[:.]/g, '-');
  return `grpc-web-audit-${getFilenameSourceSlug(sourceUrl)}-${timestamp}-${normalizeReportId(reportId)}.md`;
}

export function buildAuditReport(options = {}) {
  const model = buildReportModel(options);
  const rendered = renderAuditReport(model);
  return {
    text: rendered.text,
    filename: getAuditReportFilename(model.generatedAt, model.sourceUrl, options.reportId),
    bytes: utf8ByteLength(rendered.text),
    stats: {
      retained: model.capture.retained,
      reviewed: model.capture.reviewed,
      matched: model.capture.matching,
      included: rendered.includedCount,
      omitted: Math.max(0, model.capture.matching - rendered.includedCount),
      omittedForBytes: rendered.omittedForBytes,
    },
  };
}
