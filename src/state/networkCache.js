// Copyright (c) 2019 SafetyCulture Pty Ltd. All Rights Reserved.

const MAX_CACHE_ENTRIES = 500;
const MAX_PAYLOAD_BYTES = 5 * 1024 * 1024; // 5MB per entry

function safeStringify(value) {
  try {
    return JSON.stringify(value);
  } catch (error) {
    return '"[unserializable]"';
  }
}

function byteLength(json) {
  if (typeof TextEncoder !== 'undefined') {
    return new TextEncoder().encode(json).length;
  }
  return json.length;
}

function estimatePayloadBytes(entry) {
  let bytes = 0;
  if (entry.request != null) {
    bytes += byteLength(safeStringify(entry.request));
  }
  if (entry.response != null) {
    bytes += byteLength(safeStringify(entry.response));
  }
  if (entry.error != null) {
    bytes += byteLength(safeStringify(entry.error));
  }
  return bytes;
}

function truncateLargePayload(payload, fieldName) {
  const jsonStr = safeStringify(payload);
  const bytes = byteLength(jsonStr);

  if (bytes <= MAX_PAYLOAD_BYTES) {
    return { value: payload, truncated: false };
  }

  // Payload is too large - create a summary instead
  console.warn(`[gRPC DevTools] ${fieldName} payload truncated (${(bytes / 1024 / 1024).toFixed(2)}MB > ${MAX_PAYLOAD_BYTES / 1024 / 1024}MB limit)`);

  return {
    value: {
      __truncated: true,
      __originalSizeBytes: bytes,
      __message: `Payload too large to display (${(bytes / 1024 / 1024).toFixed(2)}MB). Download as JSON to view full content.`,
      __summary: typeof payload === 'object' ? Object.keys(payload).slice(0, 10) : 'N/A'
    },
    truncated: true
  };
}

function applyPayloadLimits(entry) {
  let modified = false;
  const result = { ...entry };

  if (entry.request != null) {
    const { value, truncated } = truncateLargePayload(entry.request, 'Request');
    if (truncated) {
      result.request = value;
      modified = true;
    }
  }

  if (entry.response != null) {
    const { value, truncated } = truncateLargePayload(entry.response, 'Response');
    if (truncated) {
      result.response = value;
      modified = true;
    }
  }

  if (entry.error != null) {
    const { value, truncated } = truncateLargePayload(entry.error, 'Error');
    if (truncated) {
      result.error = value;
      modified = true;
    }
  }

  return result;
}

const cache = new Map();
const order = [];
const requestIdToEntryId = new Map();
let nextEntryId = 1;

function evictIfNeeded() {
  while (order.length > MAX_CACHE_ENTRIES) {
    const oldestId = order.shift();
    if (oldestId != null) {
      cache.delete(oldestId);
    }
  }
}

export function addNetworkEntry(entry) {
  // Apply payload size limits to prevent OOM
  const limitedEntry = applyPayloadLimits(entry);

  const existingEntryId = limitedEntry.requestId ? requestIdToEntryId.get(limitedEntry.requestId) : null;
  const existingEntry = existingEntryId ? cache.get(existingEntryId) : null;
  if (existingEntry) {
    if (limitedEntry.method && !existingEntry.method) existingEntry.method = limitedEntry.method;
    if (limitedEntry.methodType && !existingEntry.methodType) existingEntry.methodType = limitedEntry.methodType;
    if (limitedEntry.request != null) existingEntry.request = limitedEntry.request;
    if (limitedEntry.response != null) existingEntry.response = limitedEntry.response;
    if (limitedEntry.error != null) existingEntry.error = limitedEntry.error;
    if (limitedEntry.requestId != null) existingEntry.requestId = limitedEntry.requestId;
    // Update timing - for streaming calls, newer timing has updated stats
    if (limitedEntry.timing != null) existingEntry.timing = limitedEntry.timing;
    existingEntry.payloadBytes = estimatePayloadBytes(existingEntry);
    return existingEntry;
  }

  const entryId = nextEntryId++;
  const fullEntry = {
    ...limitedEntry,
    entryId,
    payloadBytes: estimatePayloadBytes(limitedEntry),
  };
  cache.set(entryId, fullEntry);
  order.push(entryId);
  if (limitedEntry.requestId) {
    requestIdToEntryId.set(limitedEntry.requestId, entryId);
  }
  evictIfNeeded();
  return fullEntry;
}

export function getNetworkEntry(entryId) {
  return cache.get(entryId);
}

export function clearNetworkCache() {
  cache.clear();
  order.length = 0;
  requestIdToEntryId.clear();
}
