// Copyright (c) 2019 SafetyCulture Pty Ltd. All Rights Reserved.

import { translate } from '../i18n';
import { buildAuditReport } from '../utils/auditReport';
import { downloadTextFile } from '../utils/download';
import { selectLocale } from './localization';
import { flushPendingNetworkLog } from './network';
import { getNetworkEntry } from './networkCache';
import { showToast } from './toast';

const scheduleNextTask = callback => setTimeout(callback, 0);

export const downloadAuditReport = (options = {}) => async (dispatch, getState) => {
  try {
    // Capture events still inside the 100 ms render batch before taking the
    // report snapshot. Redux dispatch is synchronous, so the state below is current.
    dispatch(flushPendingNetworkLog());
    const state = getState();
    const allEntries = state.network._allLog.slice();
    const filteredEntries = state.network.log.slice();
    const filterValue = state.toolbar.filterValue;
    const locale = selectLocale(state);
    const now = options.now instanceof Date ? new Date(options.now.getTime()) : new Date(options.now ?? Date.now());
    const schedule = options.scheduleTask || scheduleNextTask;

    // Yield once so the toolbar can paint its preparing state. The bounded
    // formatter then visits only the lightweight snapshot and selected payloads.
    await new Promise(resolve => schedule(resolve));
    const report = buildAuditReport({
      allEntries,
      filteredEntries,
      filterValue,
      getEntry: options.getEntry || getNetworkEntry,
      now,
      version: options.version,
      locale,
      sourceUrl: options.sourceUrl,
      reportId: options.reportId,
    });
    const download = options.downloadFile || downloadTextFile;
    await download(report.text, {
      filename: report.filename,
      mimeType: 'text/markdown;charset=utf-8',
      ...(options.downloadOptions || {}),
    });
    dispatch(showToast({
      message: translate(locale, 'audit.success', { count: report.stats.included }),
      type: 'success',
      autoDismiss: 3500,
    }));
    return report;
  } catch (error) {
    const state = getState();
    dispatch(showToast({
      message: translate(selectLocale(state), 'audit.failure'),
      type: 'error',
      autoDismiss: 4500,
    }));
    throw error;
  }
};

