// Copyright (c) 2019 SafetyCulture Pty Ltd. All Rights Reserved.

import { createSlice } from "@reduxjs/toolkit";

const toolbarSlice = createSlice({
  name: 'toolbar',
  initialState: {
    filterIsOpen: true,
    filterIsEnabled: false,
    filterValue: "",
    isConnected: true, // Port connection status
    defaultCollapsed: true, // Default collapsed state for JSON details
  },
  reducers: {
    toggleFilter(state) {
      state.filterIsOpen = !state.filterIsOpen;
    },
    setFilterValue(state, action) {
      const { payload } = action;
      state.filterValue = payload;
      state.filterIsEnabled = !!(state.filterValue && state.filterValue.length > 0);
    },
    setConnectionStatus(state, action) {
      const { payload } = action;
      state.isConnected = payload;
    },
    setDefaultCollapsed(state, action) {
      const { payload } = action;
      state.defaultCollapsed = payload;
    }
  },

});

const { actions, reducer } = toolbarSlice;
export const { toggleFilter, setFilterValue, setConnectionStatus, setDefaultCollapsed } = actions;

// Debouncing for filter search
let filterDebounceTimeout = null;
const FILTER_DEBOUNCE_MS = 150;

export const setFilterValueDebounced = (value) => (dispatch) => {
  // Clear any pending debounce
  if (filterDebounceTimeout) {
    clearTimeout(filterDebounceTimeout);
  }

  // For empty values (clearing filter), dispatch immediately
  if (!value || value.length === 0) {
    dispatch(setFilterValue(value));
    return;
  }

  // Debounce non-empty values
  filterDebounceTimeout = setTimeout(() => {
    dispatch(setFilterValue(value));
    filterDebounceTimeout = null;
  }, FILTER_DEBOUNCE_MS);
};

export default reducer
