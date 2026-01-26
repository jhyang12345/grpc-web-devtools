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
  const entryId = nextEntryId++;
  const fullEntry = {
    ...entry,
    entryId,
    payloadBytes: estimatePayloadBytes(entry),
  };
  cache.set(entryId, fullEntry);
  order.push(entryId);
  evictIfNeeded();
  return fullEntry;
}

export function getNetworkEntry(entryId) {
  return cache.get(entryId);
}

export function clearNetworkCache() {
  cache.clear();
  order.length = 0;
}
