// Copyright (c) 2019 SafetyCulture Pty Ltd. All Rights Reserved.

import { createSlice } from "@reduxjs/toolkit";
import { setFilterValue } from "./toolbar";
import { addNetworkEntry, clearNetworkCache } from "./networkCache";

const MAX_LOG_SIZE = 1000;

function reconcileSelection(state) {
  if (state.selectedEntry == null) return;
  const updatedIdx = state.log.findIndex(entry => entry.entryId === state.selectedEntry.entryId);
  if (updatedIdx >= 0) {
    state.selectedIdx = updatedIdx;
    state.selectedEntry = state.log[updatedIdx];
  } else {
    state.selectedIdx = null;
    state.selectedEntry = null;
  }
}

function buildEndpoint(method) {
  if (!method) {
    return "";
  }

  const parts = method.split("/");
  return parts.pop() || parts.pop() || "";
}

function matchesFilter(entry, filterValue) {
  if (!filterValue) {
    return true;
  }

  const query = filterValue.trim().toLowerCase();
  if (!query) {
    return true;
  }

  return [entry.method, entry.endpoint, entry.methodType]
    .filter(Boolean)
    .some((value) => String(value).toLowerCase().includes(query));
}

function applyFilter(entries, filterValue) {
  if (!filterValue || !filterValue.trim()) {
    return entries.slice();
  }

  return entries.filter((entry) => matchesFilter(entry, filterValue));
}

const networkSlice = createSlice({
  name: "network",
  initialState: {
    preserveLog: false,
    selectedIdx: null,
    selectedEntry: null,
    log: [],
    _filterValue: "",
    _allLog: [],
  },
  reducers: {
    networkLogBatch(state, action) {
      const nextEntries = action.payload.map((payload) => ({
        ...payload,
        endpoint: buildEndpoint(payload.method),
      }));

      for (const entry of nextEntries) {
        const existingIdx = state._allLog.findIndex(e => e.entryId === entry.entryId);
        if (existingIdx >= 0) {
          state._allLog[existingIdx] = entry;
        } else {
          state._allLog.push(entry);
        }
      }
      while (state._allLog.length > MAX_LOG_SIZE) {
        state._allLog.shift();
      }

      state.log = applyFilter(state._allLog, state._filterValue);

      reconcileSelection(state);
    },
    networkLog(state, action) {
      const payload = {
        ...action.payload,
        endpoint: buildEndpoint(action.payload.method),
      };

      const existingIdx = state._allLog.findIndex(e => e.entryId === payload.entryId);
      if (existingIdx >= 0) {
        state._allLog[existingIdx] = payload;
      } else {
        state._allLog.push(payload);
      }
      while (state._allLog.length > MAX_LOG_SIZE) {
        state._allLog.shift();
      }

      state.log = applyFilter(state._allLog, state._filterValue);

      reconcileSelection(state);
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
      state._allLog = [];
    },
    setPreserveLog(state, action) {
      state.preserveLog = action.payload;
    },
  },
  extraReducers: {
    [setFilterValue]: (state, action) => {
      const filterValue = action.payload || "";
      state._filterValue = filterValue;
      state.log = applyFilter(state._allLog, filterValue);

      if (state.selectedIdx != null) {
        const selectedEntryId = state.selectedEntry?.entryId;
        const nextSelectedIdx = selectedEntryId == null
          ? null
          : state.log.findIndex((entry) => entry.entryId === selectedEntryId);

        if (nextSelectedIdx >= 0) {
          state.selectedIdx = nextSelectedIdx;
          state.selectedEntry = state.log[nextSelectedIdx];
        } else {
          state.selectedIdx = null;
          state.selectedEntry = null;
        }
      }
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
    transport: entry.transport,
    timing: entry.timing,
    location: entry.location,
    request: !!entry.request,
    response: !!entry.response || !!entry.messages?.length,
    error: !!entry.error,
    status: !!entry.status,
    messages: !!entry.messages?.length,
    requestId: entry.requestId,
  };
}

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

  if (pendingBatch.length >= BATCH_SIZE_LIMIT) {
    if (batchTimeout) {
      clearTimeout(batchTimeout);
    }
    flushBatch(dispatch);
    return;
  }

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
    // A real clear must invalidate scheduled batches, otherwise entries that
    // were queued before the clear can reappear after it.
    pendingBatch = [];
    if (batchTimeout) {
      clearTimeout(batchTimeout);
      batchTimeout = null;
    }
    clearNetworkCache();
  }
  dispatch(clearLog(payload));
};

export default reducer;
