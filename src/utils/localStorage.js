// Copyright (c) 2019 SafetyCulture Pty Ltd. All Rights Reserved.

const STORAGE_KEY_PREFIX = 'grpc-devtools-';

/**
 * Get a value from localStorage with type-safe parsing
 */
export function getStorageItem(key, defaultValue) {
  try {
    const fullKey = STORAGE_KEY_PREFIX + key;
    const item = localStorage.getItem(fullKey);

    if (item === null) {
      return defaultValue;
    }

    return JSON.parse(item);
  } catch (error) {
    console.error(`[gRPC DevTools] Failed to read from localStorage:`, error);
    return defaultValue;
  }
}

/**
 * Set a value in localStorage with JSON serialization
 */
export function setStorageItem(key, value) {
  try {
    const fullKey = STORAGE_KEY_PREFIX + key;
    localStorage.setItem(fullKey, JSON.stringify(value));
  } catch (error) {
    console.error(`[gRPC DevTools] Failed to write to localStorage:`, error);
  }
}
