// Copyright (c) 2019 SafetyCulture Pty Ltd. All Rights Reserved.

const MAX_CACHE_ENTRIES = 500;
export const MAX_ENTRY_BYTES = 5 * 1024 * 1024;
export const MAX_STREAM_MESSAGES = 100;

function safeStringify(value) {
  try { return JSON.stringify(value); } catch (_) { return '"[unserializable]"'; }
}

function byteLength(json) {
  if (typeof TextEncoder !== "undefined") return new TextEncoder().encode(json).length;
  return unescape(encodeURIComponent(json)).length;
}

export function payloadDescriptor(value) {
  const serialized = safeStringify(value);
  const originalSizeBytes = byteLength(serialized);
  return {
    __truncated: true,
    __originalSizeBytes: originalSizeBytes,
    preview: serialized.slice(0, 2000),
  };
}

export function limitPayload(value) {
  if (value == null) return value;
  return byteLength(safeStringify(value)) > MAX_ENTRY_BYTES ? payloadDescriptor(value) : value;
}

function compositeKey(entry) {
  return [entry.captureId || "legacy", entry.transport || "unknown", entry.requestId].join(":");
}

function estimatePayloadBytes(entry) {
  return [entry.request, entry.response, entry.error, entry.status, ...(entry.messages || [])]
    .filter(value => value != null)
    .reduce((total, value) => total + byteLength(safeStringify(value)), 0);
}

function applyIndividualLimits(entry) {
  const limited = { ...entry };
  ["request", "response", "error", "status"].forEach(field => {
    if (limited[field] != null) limited[field] = limitPayload(limited[field]);
  });
  return limited;
}

function enforceAggregateLimit(entry) {
  entry.messages = entry.messages || [];
  entry.droppedMessageCount = entry.droppedMessageCount || 0;
  while (entry.messages.length > MAX_STREAM_MESSAGES || (estimatePayloadBytes(entry) > MAX_ENTRY_BYTES && entry.messages.length)) {
    entry.messages.shift();
    entry.droppedMessageCount += 1;
  }
  // If protected fields alone exceed the aggregate budget, retain their
  // existence as descriptors rather than allowing a single entry to grow.
  ["response", "request", "error", "status"].forEach(field => {
    if (estimatePayloadBytes(entry) > MAX_ENTRY_BYTES && entry[field] != null && !entry[field].__truncated) {
      entry[field] = payloadDescriptor(entry[field]);
    }
  });
  entry.payloadBytes = estimatePayloadBytes(entry);
}

const cache = new Map();
const order = [];
const requestKeyToEntryId = new Map();
let nextEntryId = 1;

function evictIfNeeded() {
  while (order.length > MAX_CACHE_ENTRIES) {
    const oldestId = order.shift();
    const entry = cache.get(oldestId);
    if (!entry) continue;
    const key = compositeKey(entry);
    if (requestKeyToEntryId.get(key) === oldestId) requestKeyToEntryId.delete(key);
    cache.delete(oldestId);
  }
}

function mergeEntry(existing, incoming) {
  ["method", "methodType", "transport", "captureId", "requestId", "location"].forEach(field => {
    if (incoming[field] != null && (existing[field] == null || field !== "location")) existing[field] = incoming[field];
  });
  if (incoming.request != null) existing.request = incoming.request;
  if (incoming.timing != null) existing.timing = { ...existing.timing, ...incoming.timing };
  if (incoming.phase === "message") {
    if (incoming.response != null) existing.messages.push(incoming.response);
  } else if (incoming.phase === "complete") {
    existing.terminalPhase = "complete";
    if (incoming.response != null) existing.response = incoming.response;
    if (incoming.status != null) existing.status = incoming.status;
  } else if (incoming.phase === "error") {
    existing.terminalPhase = "error";
    if (incoming.error != null) existing.error = incoming.error;
    if (incoming.status != null) existing.status = incoming.status;
  } else {
    if (incoming.response != null) existing.response = incoming.response;
    if (incoming.error != null) existing.error = incoming.error;
  }
  // The protocol's messageCount is the total observed on the wire, including
  // messages no longer retained in the bounded in-memory history.
  if (incoming.timing && incoming.timing.messageCount != null) existing.messageCount = incoming.timing.messageCount;
  enforceAggregateLimit(existing);
  return existing;
}

export function addNetworkEntry(entry) {
  const limitedEntry = applyIndividualLimits(entry);
  const key = limitedEntry.requestId == null ? null : compositeKey(limitedEntry);
  const existingEntryId = key == null ? null : requestKeyToEntryId.get(key);
  const existingEntry = existingEntryId == null ? null : cache.get(existingEntryId);
  if (existingEntry) return mergeEntry(existingEntry, limitedEntry);

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
  enforceAggregateLimit(fullEntry);
  cache.set(fullEntry.entryId, fullEntry);
  order.push(fullEntry.entryId);
  if (key != null) requestKeyToEntryId.set(key, fullEntry.entryId);
  evictIfNeeded();
  return fullEntry;
}

export function getNetworkEntry(entryId) { return cache.get(entryId); }

export function clearNetworkCache() {
  cache.clear();
  order.length = 0;
  requestKeyToEntryId.clear();
}

export function getCacheDebugState() {
  return { size: cache.size, mappings: requestKeyToEntryId.size };
}
