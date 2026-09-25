import reducer, {
  LANGUAGE_STORAGE_KEY,
  setBrowserLocale,
  setLanguagePreference,
  setLanguagePreferenceAndPersist,
} from '../state/localization';

test('localization state accepts supported preferences and browser locales', () => {
  let state = reducer({ preference: 'auto', browserLocale: 'en' }, setLanguagePreference('ko'));
  expect(state.preference).toBe('ko');
  state = reducer(state, setLanguagePreference('unsupported'));
  expect(state.preference).toBe('auto');
  state = reducer(state, setBrowserLocale('ko'));
  expect(state.browserLocale).toBe('ko');
  state = reducer(state, setBrowserLocale('ja'));
  expect(state.browserLocale).toBe('en');
});

test('language preference thunk persists the normalized value', () => {
  localStorage.clear();
  const dispatch = jest.fn();
  setLanguagePreferenceAndPersist('ko')(dispatch);
  expect(JSON.parse(localStorage.getItem(`grpc-devtools-${LANGUAGE_STORAGE_KEY}`))).toBe('ko');
  expect(dispatch).toHaveBeenCalledWith(setLanguagePreference('ko'));
});

