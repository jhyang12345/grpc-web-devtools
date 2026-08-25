// Copyright (c) 2019 SafetyCulture Pty Ltd. All Rights Reserved.

const MAX_CACHE_ENTRIES = 500;
export const MAX_CACHE_BYTES = 32 * 1024 * 1024;
export const MAX_ENTRY_BYTES = 5 * 1024 * 1024;
export const MAX_STREAM_MESSAGES = 100;

function safeStringify(value) {
  try {
    const serialized = JSON.stringify(value);
    return typeof serialized === "string" ? serialized : '"[unserializable]"';
  } catch (_) {
    return '"[unserializable]"';
  }
}

function byteLength(json) {
  if (typeof TextEncoder !== "undefined") return new TextEncoder().encode(json).length;
  return unescape(encodeURIComponent(json)).length;
}

export function payloadDescriptor(value) {
  const serialized = safeStringify(value);
  const originalSizeBytes = byteLength(serialized);
  return payloadDescriptorFromSerialized(serialized, originalSizeBytes);
}

function payloadDescriptorFromSerialized(serialized, originalSizeBytes) {
  return {
    __truncated: true,
    __originalSizeBytes: originalSizeBytes,
    preview: serialized.slice(0, 2000),
  };
}

function limitPayloadWithBytes(value) {
  if (value == null) return { value, bytes: 0 };
  const serialized = safeStringify(value);
  const originalSizeBytes = byteLength(serialized);
  if (originalSizeBytes <= MAX_ENTRY_BYTES) {
    return { value, bytes: originalSizeBytes };
  }

  const descriptor = payloadDescriptorFromSerialized(serialized, originalSizeBytes);
  return { value: descriptor, bytes: byteLength(safeStringify(descriptor)) };
}

export function limitPayload(value) { return limitPayloadWithBytes(value).value; }

function compositeKey(entry) {
  return [entry.captureId || "legacy", entry.transport || "unknown", entry.requestId].join(":");
}

function setPayloadField(entry, accounting, field, value, bytes) {
  accounting.totalBytes -= accounting.fieldBytes[field] || 0;
  entry[field] = value;
  accounting.fieldBytes[field] = value == null ? 0 : bytes;
  accounting.totalBytes += accounting.fieldBytes[field];
}

function applyIndividualLimits(entry) {
  const limited = { ...entry };
  const payloadBytes = {};
  ["request", "response", "error", "status"].forEach(field => {
    if (limited[field] == null) return;
    const result = limitPayloadWithBytes(limited[field]);
    limited[field] = result.value;
    payloadBytes[field] = result.bytes;
  });
  if (limited.replay != null) {
    limited.replay = {
      available: limited.replay && limited.replay.available === true,
      token: typeof limited.replay?.token === 'string' ? limited.replay.token.slice(0, 512) : undefined,
      reason: typeof limited.replay?.reason === 'string' ? limited.replay.reason.slice(0, 512) : undefined,
    };
  }
  if (limited.replayedFrom != null) {
    limited.replayedFrom = {
      captureId: typeof limited.replayedFrom?.captureId === 'string' ? limited.replayedFrom.captureId.slice(0, 512) : undefined,
      transport: typeof limited.replayedFrom?.transport === 'string' ? limited.replayedFrom.transport.slice(0, 128) : undefined,
      requestId: Number.isFinite(limited.replayedFrom?.requestId) ? limited.replayedFrom.requestId : undefined,
    };
  }
  return { limited, payloadBytes };
}

function enforceAggregateLimit(entry, accounting) {
  entry.messages = entry.messages || [];
  entry.droppedMessageCount = entry.droppedMessageCount || 0;
  while (entry.messages.length > MAX_STREAM_MESSAGES || (accounting.totalBytes > MAX_ENTRY_BYTES && entry.messages.length)) {
    entry.messages.shift();
    accounting.totalBytes -= accounting.messageBytes.shift() || 0;
    entry.droppedMessageCount += 1;
  }
  // If protected fields alone exceed the aggregate budget, retain their
  // existence as descriptors rather than allowing a single entry to grow.
  ["response", "request", "error", "status"].forEach(field => {
    if (accounting.totalBytes > MAX_ENTRY_BYTES && entry[field] != null && !entry[field].__truncated) {
      const result = limitPayloadWithBytes(payloadDescriptor(entry[field]));
      setPayloadField(entry, accounting, field, result.value, result.bytes);
    }
  });
  entry.payloadBytes = accounting.totalBytes;
}

const cache = new Map();
const order = [];
const requestKeyToEntryId = new Map();
const payloadAccounting = new WeakMap();
let nextEntryId = 1;
let totalCachePayloadBytes = 0;

function evictIfNeeded() {
  while (order.length > MAX_CACHE_ENTRIES || totalCachePayloadBytes > MAX_CACHE_BYTES) {
    const oldestId = order.shift();
    const entry = cache.get(oldestId);
    if (!entry) continue;
    const key = compositeKey(entry);
    if (requestKeyToEntryId.get(key) === oldestId) requestKeyToEntryId.delete(key);
    totalCachePayloadBytes -= entry.payloadBytes || 0;
    cache.delete(oldestId);
  }
}

function mergeEntry(existing, incoming, incomingPayloadBytes) {
  const accounting = payloadAccounting.get(existing);
  ["method", "methodType", "transport", "captureId", "requestId", "location", "backendUrl", "replay", "replayedFrom"].forEach(field => {
    if (incoming[field] != null && (existing[field] == null || field !== "location")) existing[field] = incoming[field];
  });
  if (incoming.request != null) {
    setPayloadField(existing, accounting, "request", incoming.request, incomingPayloadBytes.request);
  }
  if (incoming.timing != null) existing.timing = { ...existing.timing, ...incoming.timing };
  if (incoming.phase === "message") {
    if (incoming.response != null) {
      existing.messages.push(incoming.response);
      accounting.messageBytes.push(incomingPayloadBytes.response);
      accounting.totalBytes += incomingPayloadBytes.response;
    }
  } else if (incoming.phase === "complete") {
    existing.terminalPhase = "complete";
    if (incoming.response != null) setPayloadField(existing, accounting, "response", incoming.response, incomingPayloadBytes.response);
    if (incoming.status != null) setPayloadField(existing, accounting, "status", incoming.status, incomingPayloadBytes.status);
  } else if (incoming.phase === "error") {
    existing.terminalPhase = "error";
    if (incoming.error != null) setPayloadField(existing, accounting, "error", incoming.error, incomingPayloadBytes.error);
    if (incoming.status != null) setPayloadField(existing, accounting, "status", incoming.status, incomingPayloadBytes.status);
  } else {
    if (incoming.response != null) setPayloadField(existing, accounting, "response", incoming.response, incomingPayloadBytes.response);
    if (incoming.error != null) setPayloadField(existing, accounting, "error", incoming.error, incomingPayloadBytes.error);
  }
  // The protocol's messageCount is the total observed on the wire, including
  // messages no longer retained in the bounded in-memory history.
  if (incoming.timing && incoming.timing.messageCount != null) existing.messageCount = incoming.timing.messageCount;
  enforceAggregateLimit(existing, accounting);
  return existing;
}

export function addNetworkEntry(entry) {
  const { limited: limitedEntry, payloadBytes: incomingPayloadBytes } = applyIndividualLimits(entry);
  const key = limitedEntry.requestId == null ? null : compositeKey(limitedEntry);
  const existingEntryId = key == null ? null : requestKeyToEntryId.get(key);
  const existingEntry = existingEntryId == null ? null : cache.get(existingEntryId);
  if (existingEntry) {
    const previousPayloadBytes = existingEntry.payloadBytes || 0;
    const mergedEntry = mergeEntry(existingEntry, limitedEntry, incomingPayloadBytes);
    totalCachePayloadBytes += mergedEntry.payloadBytes - previousPayloadBytes;
    evictIfNeeded();
    return mergedEntry;
  }

  const fullEntry = {
    ...limitedEntry,
    entryId: nextEntryId++,
    messages: limitedEntry.phase === "message" && limitedEntry.response != null ? [limitedEntry.response] : [],
    response: limitedEntry.phase === "message" ? undefined : limitedEntry.response,
    terminalPhase: limitedEntry.phase === "complete" || limitedEntry.phase === "error" ? limitedEntry.phase : undefined,
    timing: { requestTimestamp: Date.now(), ...limitedEntry.timing },
    messageCount: limitedEntry.timing && limitedEntry.timing.messageCount,
    droppedMessageCount: 0,
  };
  const accounting = {
    fieldBytes: {
      request: incomingPayloadBytes.request || 0,
      response: limitedEntry.phase === "message" ? 0 : incomingPayloadBytes.response || 0,
      error: incomingPayloadBytes.error || 0,
      status: incomingPayloadBytes.status || 0,
    },
    messageBytes: limitedEntry.phase === "message" && limitedEntry.response != null
      ? [incomingPayloadBytes.response || 0]
      : [],
    totalBytes: 0,
  };
  accounting.totalBytes = Object.values(accounting.fieldBytes).reduce((total, bytes) => total + bytes, 0)
    + accounting.messageBytes.reduce((total, bytes) => total + bytes, 0);
  payloadAccounting.set(fullEntry, accounting);
  enforceAggregateLimit(fullEntry, accounting);
  cache.set(fullEntry.entryId, fullEntry);
  order.push(fullEntry.entryId);
  totalCachePayloadBytes += fullEntry.payloadBytes;
  if (key != null) requestKeyToEntryId.set(key, fullEntry.entryId);
  evictIfNeeded();
  return fullEntry;
}

export function getNetworkEntry(entryId) { return cache.get(entryId); }

export function clearNetworkCache() {
  cache.clear();
  order.length = 0;
  requestKeyToEntryId.clear();
  totalCachePayloadBytes = 0;
}

export function getCacheDebugState() {
  return { size: cache.size, mappings: requestKeyToEntryId.size, payloadBytes: totalCachePayloadBytes };
}
