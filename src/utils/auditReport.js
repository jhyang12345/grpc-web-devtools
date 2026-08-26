// Copyright (c) 2019 SafetyCulture Pty Ltd. All Rights Reserved.

import packageInfo from '../../package.json';
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

const CODE_CLUES = {
  NETWORK_ERROR: 'Check browser CORS policy, DNS, TLS, proxy or ingress reachability, and whether the request reached the backend; no gRPC status was captured.',
  CANCELLED: 'Check client cancellation, page navigation, or a request that was superseded before completion.',
  UNKNOWN: 'Check server and proxy logs for the original error that could not be mapped to a more specific gRPC code.',
  INVALID_ARGUMENT: 'Compare the captured request with the current protobuf schema and server-side validation rules.',
  DEADLINE_EXCEEDED: 'Compare the client deadline with backend latency and downstream dependency timing.',
  NOT_FOUND: 'Check the resource identifier, environment, and route used by the request.',
  ALREADY_EXISTS: 'Check whether a create or registration operation was retried with an existing identifier.',
  PERMISSION_DENIED: 'Check authorization policy, roles, and resource ownership for the authenticated caller.',
  RESOURCE_EXHAUSTED: 'Check service quotas, rate limits, concurrency, and request or response size limits.',
  FAILED_PRECONDITION: 'Check required resource state and operation ordering before this RPC runs.',
  ABORTED: 'Check concurrency conflicts, optimistic locking, and whether retry guidance is available from the backend.',
  OUT_OF_RANGE: 'Check numeric ranges, pagination bounds, offsets, and server-side limits.',
  UNIMPLEMENTED: 'Check deployed service versions, RPC routing, and whether this method is enabled in the target environment.',
  INTERNAL: 'Check server logs and downstream failures around this timestamp; the client only captured a generic internal failure.',
  UNAVAILABLE: 'Check backend health, ingress or proxy routing, DNS/network reachability, and retry behavior.',
  DATA_LOSS: 'Check serialization, storage integrity, and server logs before retrying or mutating more data.',
  UNAUTHENTICATED: 'Check credential presence, expiry, audience, and the authentication handoff to the backend.',
};

const SIGNAL_LABELS = {
  network_error: 'network-level failures',
  rpc_error: 'RPC errors',
  partial_stream: 'partial stream failures',
  replay_failure: 'failed replays',
  slow: 'slow requests',
  pending: 'long-running or incomplete requests',
  messages_dropped: 'streams with dropped inspector history',
  payload_truncated: 'truncated payloads',
  large_payload: 'large retained payloads',
  payload_evicted: 'requests with evicted payload details',
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

const REPORT_TRUNCATED = '[truncated for audit report]';
const REPORT_REDACTED = '[redacted]';

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

function redactMethod(value, maximum = 500) {
  const raw = redactTextSecrets(value || '(unknown method)');
  const redacted = /[?#]/.test(raw) ? redactReportUrl(raw) : raw;
  return clipText(redacted, maximum);
}

function isTruncatedDescriptor(value) {
  return !!value && typeof value === 'object' && value.__truncated === true;
}

function createBoundedSnapshot(value, maximumBytes) {
  const state = {
    remainingCharacters: Math.max(256, Math.floor(maximumBytes / 2)),
    nodes: 0,
    seen: new WeakSet(),
  };

  const visit = (current, key, depth) => {
    if (isSensitiveKey(key)) return REPORT_REDACTED;
    if (state.remainingCharacters <= 0) return REPORT_TRUNCATED;
    if (current === null) return null;

    const type = typeof current;
    if (type === 'string') {
      const sourceLimit = Math.min(current.length, state.remainingCharacters + 256, 8000);
      const redacted = redactTextSecrets(current.slice(0, sourceLimit));
      const retainedLength = Math.min(redacted.length, state.remainingCharacters, 2000);
      state.remainingCharacters -= retainedLength;
      const retained = redacted.slice(0, retainedLength);
      return current.length > retainedLength ? `${retained}… ${REPORT_TRUNCATED}` : retained;
    }
    if (type === 'number') return Number.isFinite(current) ? current : String(current);
    if (type === 'boolean') return current;
    if (type === 'bigint') return `${current}n`;
    if (type === 'undefined' || type === 'function' || type === 'symbol') return `[${type}]`;

    if (isTruncatedDescriptor(current)) {
      return {
        __truncated: true,
        __originalSizeBytes: asFiniteNumber(current.__originalSizeBytes),
        preview: '[omitted from redacted audit report]',
      };
    }
    if (state.seen.has(current)) return '[circular reference]';
    if (depth >= 8) return '[maximum depth omitted]';
    if (state.nodes >= 400) return '[node limit reached]';

    state.seen.add(current);
    state.nodes += 1;

    if (Array.isArray(current)) {
      const result = [];
      const retainedItems = Math.min(current.length, 50);
      for (let index = 0; index < retainedItems && state.remainingCharacters > 0; index += 1) {
        result.push(visit(current[index], String(index), depth + 1));
      }
      if (current.length > result.length) result.push(`[${current.length - result.length} more items omitted]`);
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
          result[safeKey] = '[property could not be read]';
        }
        retainedKeys += 1;
      }
    } catch (_) {
      return '[object could not be inspected]';
    }
    if (omittedKeys) result.__auditReportNotice = 'Additional keys omitted';
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

export function formatBoundedJson(value, maximumBytes = MAX_AUDIT_PAYLOAD_BYTES) {
  let serialized;
  try {
    serialized = JSON.stringify(createBoundedSnapshot(value, maximumBytes), null, 2);
  } catch (_) {
    serialized = JSON.stringify({ __auditReportError: 'Value could not be serialized' }, null, 2);
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

export function getDiagnosticClue(code, errorMessage = '') {
  const normalizedCode = normalizeGrpcCode(code);
  if (normalizedCode && CODE_CLUES[normalizedCode]) return CODE_CLUES[normalizedCode];

  const normalizedMessage = clipText(errorMessage || '', 2000).toLowerCase();
  if (/deadline|timed?\s*out|timeout/.test(normalizedMessage)) return CODE_CLUES.DEADLINE_EXCEEDED;
  if (/unauthenticated|expired token|invalid token|credential/.test(normalizedMessage)) return CODE_CLUES.UNAUTHENTICATED;
  if (/permission|forbidden|not authorized/.test(normalizedMessage)) return CODE_CLUES.PERMISSION_DENIED;
  if (/unavailable|failed to fetch|network|cors|connection/.test(normalizedMessage)) return CODE_CLUES.UNAVAILABLE;
  return 'Correlate this timestamp, method, and request ID with backend and proxy logs for the original failure.';
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
        label: 'Network failure (no gRPC status captured)',
        clue: CODE_CLUES.NETWORK_ERROR,
      });
    } else {
      signals.push({
        id: 'rpc_error',
        severity: 'error',
        label: `RPC error${code ? ` (${code})` : ''}`,
        clue: getDiagnosticClue(code, errorMessage),
      });
    }
  }
  if (isPartialStreamFailure) signals.push({
    id: 'partial_stream', severity: 'warning', label: 'Stream failed after delivering data',
    clue: 'The failure happened mid-stream; compare the last retained message and server stream logs around the terminal timestamp.',
  });
  if (isReplayFailure) signals.push({
    id: 'replay_failure', severity: 'warning', label: 'Replayed request also failed',
    clue: 'Compare this replay with its source request to separate request-data problems from a persistent backend or route failure.',
  });
  if (duration != null && duration >= SLOW_REQUEST_MS) signals.push({
    id: 'slow', severity: 'warning', label: `Slow request (${formatDuration(duration)})`,
    clue: 'Compare backend processing, network/proxy latency, serialization cost, and downstream dependency timing.',
  });
  if (isPending) signals.push({
    id: 'pending', severity: 'warning', label: 'No terminal event captured',
    clue: 'Check whether the RPC is still streaming, was cancelled during navigation, or lost its completion event during a connection change.',
  });
  if (droppedMessageCount > 0) signals.push({
    id: 'messages_dropped', severity: 'warning', label: `${droppedMessageCount} older stream messages dropped`,
    clue: 'The inspector bounded its stream history; use server logs or a shorter reproduction for the omitted messages.',
  });
  if (payloadWasTruncated) signals.push({
    id: 'payload_truncated', severity: 'warning', label: 'Captured payload was truncated',
    clue: 'The payload exceeded a capture limit; reproduce with narrower data or use server-side logging for the missing portion.',
  });
  if (payloadBytes >= LARGE_PAYLOAD_BYTES) signals.push({
    id: 'large_payload', severity: 'warning', label: `Large retained payload (${formatBytes(payloadBytes)})`,
    clue: 'Large payloads can increase transfer, serialization, rendering, and DevTools memory costs.',
  });
  if (payloadWasEvicted) signals.push({
    id: 'payload_evicted', severity: 'info', label: 'Full payload no longer retained',
    clue: 'The inspector cache is bounded; reproduce and export sooner if full request or outcome bodies are required.',
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

function buildFailureClusters(analyses) {
  const clusters = new Map();
  analyses.filter(analysis => analysis.isError).forEach(analysis => {
    const method = redactMethod(analysis.entry?.method, 300);
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

function buildSharedBackendObservations(analyses) {
  const backends = new Map();
  analyses.filter(analysis => analysis.isError).forEach(analysis => {
    const origin = getBackendOrigin(analysis);
    if (!origin) return;
    const existing = backends.get(origin) || { count: 0, methods: new Set() };
    existing.count += 1;
    existing.methods.add(redactMethod(analysis.entry?.method, 300));
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
  const captureTimestamps = analyses
    .map(analysis => analysis.requestTimestamp)
    .filter(timestamp => timestamp != null);

  return {
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
    failureClusters: buildFailureClusters(issueCandidates),
    sharedBackends: buildSharedBackendObservations(issueCandidates),
    signalCounts,
    capture: {
      retained: allEntries.length,
      reviewed: scannedEntries.length,
      matching: matching.size,
      selected: selectedAnalyses.length,
      earliest: captureTimestamps.length ? Math.min(...captureTimestamps) : null,
      latest: captureTimestamps.length ? Math.max(...captureTimestamps) : null,
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

function formatTimestamp(value) {
  const number = asFiniteNumber(value);
  if (number == null) return 'not captured';
  try { return new Date(number).toISOString(); } catch (_) { return 'invalid timestamp'; }
}

function formatDuration(value) {
  const number = asFiniteNumber(value);
  if (number == null) return 'not captured';
  if (number < 1000) return `${Math.max(0, Math.round(number))} ms`;
  return `${(Math.max(0, number) / 1000).toFixed(2)} s`;
}

function formatBytes(value) {
  const number = asFiniteNumber(value);
  if (number == null) return 'not captured';
  if (number < 1024) return `${number} B`;
  if (number < 1024 * 1024) return `${(number / 1024).toFixed(1)} KiB`;
  return `${(number / (1024 * 1024)).toFixed(1)} MiB`;
}

function formatReportHeader(model, includedCount, omittedForBytes) {
  const selection = model.filterActive
    ? 'Detected issues plus recent requests matching the active filter (filter text omitted from this shareable file)'
    : 'Detected issues (errors, slow or incomplete calls, and capture limits)';
  const omitted = Math.max(0, model.capture.matching - includedCount);
  return [
    '# gRPC-Web Audit Report',
    '',
    '> Investigation aid, not a root-cause determination. Correlate timestamps and request IDs with backend and proxy logs.',
    '>',
    '> Common credential fields, URL query values, fragments, and token-shaped text are redacted. Other sensitive or personal data may remain; review before sharing.',
    '',
    '## Scope',
    '',
    `- Generated (UTC): ${inlineCode(model.generatedAt)}`,
    `- Extension version: ${inlineCode(model.version)}`,
    `- Source page: ${model.sourceUrl ? inlineCode(redactReportUrl(model.sourceUrl)) : 'not captured'}`,
    `- Selection: ${selection}`,
    `- Retained requests: ${model.capture.retained}; reviewed: ${model.capture.reviewed}; matched: ${model.capture.matching}; included: ${includedCount}; omitted: ${omitted}`,
    `- Capture window: ${inlineCode(formatTimestamp(model.capture.earliest))} to ${inlineCode(formatTimestamp(model.capture.latest))}`,
    `- Limits: newest ${MAX_AUDIT_REQUESTS} detailed matches, ${MAX_AUDIT_TIMELINE_ENTRIES}-request timeline, ${formatBytes(MAX_AUDIT_PAYLOAD_BYTES)} per payload snapshot, ${formatBytes(MAX_AUDIT_REPORT_BYTES)} total file`,
    ...(omittedForBytes > 0 ? [`- ${omittedForBytes} otherwise-selected request(s) were omitted to keep the file within its byte budget.`] : []),
    '',
  ].join('\n');
}

function formatObservations(model) {
  const lines = ['## Observed clues', ''];
  const signalEntries = Object.entries(model.signalCounts)
    .filter(([, count]) => count > 0)
    .sort((left, right) => right[1] - left[1]);
  if (!signalEntries.length) {
    lines.push('- No noteworthy signals were detected in the retained capture.');
  } else {
    signalEntries.forEach(([id, count]) => lines.push(`- ${count} ${SIGNAL_LABELS[id] || id}.`));
  }
  model.failureClusters.forEach(cluster => {
    lines.push(`- Repeated failure: ${cluster.count} × ${inlineCode(cluster.code)} on ${inlineCode(cluster.method)}. ${getDiagnosticClue(cluster.code)}`);
  });
  model.sharedBackends.forEach(observation => {
    lines.push(`- Shared route clue: ${observation.count} failures across ${observation.methodCount} methods used ${inlineCode(observation.origin)}. Check common backend health and ingress/proxy routing.`);
  });
  lines.push('');
  return lines.join('\n');
}

function timelineState(analysis) {
  if (analysis.isError) return 'ERROR';
  if (analysis.isPending) return 'PENDING';
  if (analysis.signals.some(signal => signal.severity === 'warning')) return 'FLAGGED';
  if (analysis.entry?.terminalPhase === 'complete' || analysis.completionTimestamp != null) return 'COMPLETE';
  return 'ACTIVE';
}

function formatTimeline(model) {
  const lines = [
    `## Recent activity (${model.timeline.length} retained request${model.timeline.length === 1 ? '' : 's'})`,
    '',
  ];
  if (!model.timeline.length) {
    lines.push('_No requests were retained._', '');
    return lines.join('\n');
  }
  model.timeline.forEach(analysis => {
    const entry = analysis.entry || {};
    lines.push(`- ${inlineCode(formatTimestamp(analysis.requestTimestamp))} — **${timelineState(analysis)}** · ${formatDuration(analysis.duration)} · ${inlineCode(entry.transport || 'unknown transport')} · ${inlineCode(redactMethod(entry.method, 500))}`);
  });
  lines.push('');
  return lines.join('\n');
}

function formatRequestSection(analysis) {
  const entry = analysis.fullEntry || analysis.summary || {};
  const reportEntry = {
    method: redactMethod(entry.method, 1000),
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
  const headingState = timelineState(analysis);
  const status = analysis.fullEntry?.status;
  const statusDetails = status?.details || status?.detail || '';
  const statusLabel = analysis.isNetworkError
    ? 'NETWORK_ERROR (no gRPC status captured)'
    : (analysis.code || status?.code || 'not captured');
  const backendUrl = redactReportUrl(debugReport.url || entry.backendUrl || entry.method || '');
  const frameUrl = redactReportUrl(entry.location || '');
  const lines = [
    `### ${formatTimestamp(analysis.eventTimestamp)} · ${headingState} · ${inlineCode(redactMethod(entry.method, 500))}`,
    '',
    `- Request ID: ${inlineCode(entry.requestId ?? 'not captured')}`,
    `- Transport / type: ${inlineCode(entry.transport || 'not captured')} / ${inlineCode(entry.methodType || 'not captured')}`,
    `- Started / completed: ${inlineCode(formatTimestamp(analysis.requestTimestamp))} / ${inlineCode(formatTimestamp(analysis.completionTimestamp))}`,
    `- Duration: ${formatDuration(analysis.duration)}`,
    `- Backend URL: ${backendUrl ? inlineCode(backendUrl) : 'not captured'}`,
    `- Frame URL: ${frameUrl ? inlineCode(frameUrl) : 'not captured'}`,
    `- Status: ${inlineCode(statusLabel)}${statusDetails ? ` — ${inlineCode(clipText(redactTextSecrets(clipText(statusDetails, 2000)), 1000))}` : ''}`,
    `- Stream messages: ${analysis.observedMessageCount} observed; ${analysis.retainedMessageCount} retained; ${analysis.droppedMessageCount} dropped from inspector history`,
    `- Retained payload size: ${formatBytes(analysis.payloadBytes)}`,
  ];
  if (entry.replayedFrom) {
    lines.push(`- Replay source: ${inlineCode(entry.replayedFrom.transport || 'unknown transport')} request ${inlineCode(entry.replayedFrom.requestId ?? 'unknown')}`);
  }
  lines.push('', '**Signals and areas to investigate**', '');
  if (!analysis.signals.length) {
    lines.push('- No automatic issue signal; included because it matched the active filter.');
  } else {
    analysis.signals.forEach(signal => lines.push(`- **${signal.label}.** ${signal.clue}`));
  }
  lines.push('', '**Request payload**', '');
  if (analysis.payloadWasEvicted && analysis.summary?.request === true) {
    lines.push('_Full request payload was evicted from the bounded inspector cache._');
  } else {
    lines.push(codeFence(formatBoundedJson(debugReport.request)));
  }
  lines.push('', '**Outcome**', '');
  if (analysis.payloadWasEvicted && (analysis.summary?.response || analysis.summary?.error || analysis.summary?.messages)) {
    lines.push('_Full response, stream, or error payload was evicted from the bounded inspector cache._');
  } else {
    lines.push(codeFence(formatBoundedJson(debugReport.response)));
  }
  lines.push('');
  return lines.join('\n');
}

function renderAuditReport(model) {
  const requestSections = model.selectedAnalyses.map(formatRequestSection);
  const observations = formatObservations(model);
  const timeline = formatTimeline(model);
  let retainedSections = requestSections.slice();
  let omittedForBytes = 0;

  while (true) {
    const header = formatReportHeader(model, retainedSections.length, omittedForBytes);
    const details = retainedSections.length
      ? `## Detailed requests (chronological)\n\n${retainedSections.join('\n')}`
      : '## Detailed requests\n\n_No matching request details were selected._\n';
    const text = `${header}${observations}${timeline}${details}`;
    if (utf8ByteLength(text) <= MAX_AUDIT_REPORT_BYTES) {
      return { text, includedCount: retainedSections.length, omittedForBytes };
    }
    if (retainedSections.length === 0) {
      const suffix = '\n\n> Report body truncated to the advertised UTF-8 byte limit.\n';
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
