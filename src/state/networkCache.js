// Copyright (c) 2019 SafetyCulture Pty Ltd. All Rights Reserved.

const MAX_CACHE_ENTRIES = 200;

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
  const fullEntry = { ...entry, entryId };
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
