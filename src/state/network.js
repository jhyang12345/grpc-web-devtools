// Copyright (c) 2019 SafetyCulture Pty Ltd. All Rights Reserved.

import { createSlice } from "@reduxjs/toolkit";
import Fuse from 'fuse.js';
import { setFilterValue } from "./toolbar";
import { addNetworkEntry, clearNetworkCache } from "./networkCache";

var options = {
  shouldSort: false,
  threshold: 0.15, // Slightly less strict = faster search
  distance: 10000,
  keys: [
    'method',
  ]
};
const MAX_LOG_SIZE = 1000;
var fuse = new Fuse([], options);
var lastCollectionSize = 0;

const networkSlice = createSlice({
  name: 'network',
  initialState: {
    preserveLog: false,
    selectedIdx: null,
    selectedEntry: null,
    log: [
    ],
    _filterValue: '',
    _logBak: [],
  },
  reducers: {
    networkLogBatch(state, action) {
      const { log, _filterValue, _logBak } = state;
      const { payload: entries } = action;

      // Process all entries in the batch
      entries.forEach(payload => {
        if (payload.method) {
          const parts = payload.method.split('/')
          payload.endpoint = parts.pop() || parts.pop();
        }

        if (_filterValue.length > 0) {
          _logBak.push(payload);
        } else {
          log.push(payload);
        }
      });

      // Apply eviction and rebuild search index after batch
      if (_filterValue.length > 0) {
        let evicted = false;
        while (_logBak.length > MAX_LOG_SIZE) {
          _logBak.shift();
          evicted = true;
        }
        // Only rebuild collection if eviction occurred or size changed significantly
        if (evicted || Math.abs(_logBak.length - lastCollectionSize) > 0) {
          fuse.setCollection(_logBak);
          lastCollectionSize = _logBak.length;
        }
        state.log = fuse.search(_filterValue).map(result => result.item || result);
      } else {
        while (log.length > MAX_LOG_SIZE) {
          log.shift();
        }
      }
    },
    networkLog(state, action) {
      const { log, _filterValue, _logBak } = state;
      const { payload, } = action;
      if (payload.method) {
        const parts = payload.method.split('/')
        payload.endpoint = parts.pop() || parts.pop();
      }
      if (_filterValue.length > 0) {
        _logBak.push(payload);
        if (_logBak.length > MAX_LOG_SIZE) {
          _logBak.shift();
          // Only rebuild collection when eviction occurs
          fuse.setCollection(_logBak);
          lastCollectionSize = _logBak.length;
        } else {
          // Use incremental add when no eviction
          fuse.add(payload);
          lastCollectionSize = _logBak.length;
        }
        state.log = fuse.search(_filterValue).map(result => result.item || result);
      } else {
        log.push(payload);
        if (log.length > MAX_LOG_SIZE) {
          log.shift();
        }
      }
    },
    selectLogEntry(state, action) {
      const { payload: idx } = action;
      const entry = state.log[idx];
      if (entry) {
        state.selectedIdx = idx;
        state.selectedEntry = entry;
      }
    },
    clearLog(state, action) {
      const { payload: { force } = {} } = action;
      if (state.preserveLog && !force) {
        return;
      }
      state.selectedIdx = null;
      state.selectedEntry = null;
      state.log = [];
      state._logBak = [];
    },
    setPreserveLog(state, action) {
      const { payload } = action;
      state.preserveLog = payload;
    },
  },
  extraReducers: {
    [setFilterValue]: (state, action) => {

      const { payload: filterValue = '' } = action;
      state._filterValue = filterValue;
      if (filterValue.length === 0) {
        state.log = state._logBak;
        state._logBak = [];
        lastCollectionSize = 0;
        return;
      }

      if (state._logBak.length === 0 && state.log.length !== 0) {
        state._logBak = state.log;
      }
      // Only rebuild collection if size changed
      if (state._logBak.length !== lastCollectionSize) {
        fuse.setCollection(state._logBak);
        lastCollectionSize = state._logBak.length;
      }
      state.log = fuse.search(filterValue).map(result => result.item || result);
    },
  },
});

const { actions, reducer } = networkSlice;
export const { networkLog, networkLogBatch, selectLogEntry, clearLog, setPreserveLog } = actions;

function buildSummaryEntry(entry) {
  return {
    entryId: entry.entryId,
    method: entry.method,
    methodType: entry.methodType,
    request: !!entry.request,
    response: !!entry.response,
    error: entry.error,
    requestId: entry.requestId,
  };
}

// Batching state
let pendingBatch = [];
let batchTimeout = null;
const BATCH_DELAY_MS = 100;
const BATCH_SIZE_LIMIT = 20;

function flushBatch(dispatch) {
  if (pendingBatch.length === 0) return;

  const batch = pendingBatch;
  pendingBatch = [];
  batchTimeout = null;

  dispatch(networkLogBatch(batch));
}

export const logNetworkEntry = (data) => (dispatch) => {
  const fullEntry = addNetworkEntry(data);
  const summaryEntry = buildSummaryEntry(fullEntry);

  pendingBatch.push(summaryEntry);

  // Flush immediately if batch size limit reached
  if (pendingBatch.length >= BATCH_SIZE_LIMIT) {
    if (batchTimeout) {
      clearTimeout(batchTimeout);
    }
    flushBatch(dispatch);
    return;
  }

  // Schedule flush if not already scheduled
  if (!batchTimeout) {
    batchTimeout = setTimeout(() => {
      flushBatch(dispatch);
    }, BATCH_DELAY_MS);
  }
};

export const clearLogAndCache = (payload) => (dispatch, getState) => {
  const { preserveLog } = getState().network;
  const { force } = payload || {};
  if (!preserveLog || force) {
    clearNetworkCache();
  }
  dispatch(clearLog(payload));
};

export default reducer
