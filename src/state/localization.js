// Copyright (c) 2019 SafetyCulture Pty Ltd. All Rights Reserved.

import { createSlice } from '@reduxjs/toolkit';
import {
  detectBrowserLocale,
  getEffectiveLocale,
  normalizeLanguagePreference,
} from '../i18n';
import { getStorageItem, setStorageItem } from '../utils/localStorage';

export const LANGUAGE_STORAGE_KEY = 'language';

const localizationSlice = createSlice({
  name: 'localization',
  initialState: {
    preference: normalizeLanguagePreference(getStorageItem(LANGUAGE_STORAGE_KEY, 'auto')),
    browserLocale: detectBrowserLocale(),
  },
  reducers: {
    setLanguagePreference(state, action) {
      state.preference = normalizeLanguagePreference(action.payload);
    },
    setBrowserLocale(state, action) {
      state.browserLocale = action.payload === 'ko' ? 'ko' : 'en';
    },
  },
});

const { actions, reducer } = localizationSlice;
export const { setLanguagePreference, setBrowserLocale } = actions;

export const selectLocale = state => getEffectiveLocale(
  state.localization.preference,
  state.localization.browserLocale
);

export const setLanguagePreferenceAndPersist = preference => dispatch => {
  const normalizedPreference = normalizeLanguagePreference(preference);
  setStorageItem(LANGUAGE_STORAGE_KEY, normalizedPreference);
  dispatch(setLanguagePreference(normalizedPreference));
};

export default reducer;

