// Copyright (c) 2019 SafetyCulture Pty Ltd. All Rights Reserved.

import { createSlice } from "@reduxjs/toolkit";

const toastSlice = createSlice({
  name: 'toast',
  initialState: {
    visible: false,
    message: '',
    type: 'success', // 'success', 'error', 'info', 'warning'
    autoDismiss: 3000, // milliseconds, or false to disable
  },
  reducers: {
    showToast(state, action) {
      const { message, type = 'success', autoDismiss = 3000 } = action.payload;
      state.visible = true;
      state.message = message;
      state.type = type;
      state.autoDismiss = autoDismiss;
    },
    hideToast(state) {
      state.visible = false;
    },
  },
});

const { actions, reducer } = toastSlice;
export const { showToast, hideToast } = actions;

export default reducer;
