// Copyright (c) 2019 SafetyCulture Pty Ltd. All Rights Reserved.

const MAX_CACHE_ENTRIES = 200;

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
  const existingEntryId = entry.requestId ? requestIdToEntryId.get(entry.requestId) : null;
  const existingEntry = existingEntryId ? cache.get(existingEntryId) : null;
  if (existingEntry) {
    if (entry.method && !existingEntry.method) existingEntry.method = entry.method;
    if (entry.methodType && !existingEntry.methodType) existingEntry.methodType = entry.methodType;
    if (entry.request != null) existingEntry.request = entry.request;
    if (entry.response != null) existingEntry.response = entry.response;
    if (entry.error != null) existingEntry.error = entry.error;
    if (entry.requestId != null) existingEntry.requestId = entry.requestId;
    if (Number.isFinite(entry.startedAt)) {
      existingEntry.startedAt = Number.isFinite(existingEntry.startedAt)
        ? Math.min(existingEntry.startedAt, entry.startedAt)
        : entry.startedAt;
    }
    if (Number.isFinite(entry.responseAt)) {
      existingEntry.responseAt = Number.isFinite(existingEntry.responseAt)
        ? Math.max(existingEntry.responseAt, entry.responseAt)
        : entry.responseAt;
    }
    if (Number.isFinite(existingEntry.startedAt) && Number.isFinite(existingEntry.responseAt)) {
      existingEntry.durationMs = existingEntry.responseAt - existingEntry.startedAt;
    } else if (Number.isFinite(entry.durationMs)) {
      existingEntry.durationMs = entry.durationMs;
    }
    if (!existingEntry.events) {
      existingEntry.events = [];
    }
    const eventAt = entry.eventAt ?? entry.responseAt ?? entry.startedAt;
    if (Number.isFinite(eventAt)) {
      if (!existingEntry.events.some((item) => item.type === 'request') && Number.isFinite(existingEntry.startedAt)) {
        existingEntry.events.push({
          type: 'request',
          at: existingEntry.startedAt,
        });
      }
      existingEntry.events.push({
        type: entry.eventType || (entry.error ? 'error' : entry.response ? 'response' : entry.request ? 'request' : 'event'),
        at: eventAt,
      });
    }
    existingEntry.payloadBytes = estimatePayloadBytes(existingEntry);
    return existingEntry;
  }

  const entryId = nextEntryId++;
  const eventAt = entry.eventAt ?? entry.responseAt ?? entry.startedAt;
  const events = [];
  if (Number.isFinite(entry.startedAt)) {
    events.push({
      type: 'request',
      at: entry.startedAt,
    });
  }
  if (Number.isFinite(eventAt)) {
    events.push({
      type: entry.eventType || (entry.error ? 'error' : entry.response ? 'response' : entry.request ? 'request' : 'event'),
      at: eventAt,
    });
  }
  const fullEntry = {
    ...entry,
    entryId,
    payloadBytes: estimatePayloadBytes(entry),
    events,
  };
  cache.set(entryId, fullEntry);
  order.push(entryId);
  if (entry.requestId) {
    requestIdToEntryId.set(entry.requestId, entryId);
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
