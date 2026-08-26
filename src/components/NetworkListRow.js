// Copyright (c) 2019 SafetyCulture Pty Ltd. All Rights Reserved.

import React, { PureComponent } from 'react';
import { connect } from 'react-redux';
import { selectLogEntry } from '../state/network';
import { getNetworkEntry } from '../state/networkCache';
import { translate } from '../i18n';
import MethodIcon from './MethodIcon';

function padTimePart(value, size = 2) {
  return String(value).padStart(size, '0');
}

function formatListTimestamp(timestamp) {
  if (!Number.isFinite(timestamp)) {
    return '';
  }

  const date = new Date(timestamp);
  return `${padTimePart(date.getHours())}:${padTimePart(date.getMinutes())}:${padTimePart(date.getSeconds())}.${padTimePart(date.getMilliseconds(), 3)}`;
}

export function formatFrameUrl(location, locale = 'en') {
  if (!location) return translate(locale, 'network.frameUrlUnavailable');
  try {
    const url = new URL(location);
    return `${url.host}${url.pathname}${url.search}${url.hash}`;
  } catch (_) {
    return String(location);
  }
}

export function formatElapsed(duration) {
  if (!Number.isFinite(duration)) return '';
  const value = Math.max(0, duration);
  return value < 1000 ? `${Math.round(value)} ms` : `${(value / 1000).toFixed(2)} s`;
}

export function formatReplayProvenance(replayedFrom, locale = 'en') {
  if (!replayedFrom?.transport || !Number.isFinite(replayedFrom.requestId)) {
    return translate(locale, 'network.replayEarlier');
  }
  return translate(locale, 'network.replayFrom', {
    transport: replayedFrom.transport,
    requestId: replayedFrom.requestId,
  });
}

export function formatReplayTiming(timestampLabel, elapsedLabel, replayedFrom, locale = 'en') {
  const timing = `${timestampLabel || translate(locale, 'network.waitingTiming')} | ${elapsedLabel}`;
  return replayedFrom ? translate(locale, 'network.editedReplayTiming', { timing }) : timing;
}

export function getNetworkRowClassName(index, selectedIdx, log) {
  return [
    'data-row',
    (index + 1) % 2 === 0 ? null : 'odd',
    index === selectedIdx ? 'selected' : null,
    log.error ? 'error' : null,
    log.replayedFrom ? 'edited-request' : null,
  ].filter(Boolean).join(' ');
}

export class NetworkListRow extends PureComponent {
  render() {
    const { index, data, style, selectLogEntry, selectedIdx } = this.props;
    const entries = Array.isArray(data) ? data : data.entries;
    const locale = Array.isArray(data) ? (this.props.locale || 'en') : (data.locale || 'en');
    const log = entries[index];
    const cachedTiming = getNetworkEntry(log.entryId)?.timing;
    const timing = cachedTiming || log.timing;
    const timestampLabel = formatListTimestamp(timing?.requestTimestamp);
    const completed = Number.isFinite(timing?.completionTimestamp);
    const elapsedLabel = completed ? formatElapsed(timing?.duration) : translate(locale, 'network.pending');
    const frameUrl = formatFrameUrl(log.location, locale);
    const replayProvenance = log.replayedFrom ? formatReplayProvenance(log.replayedFrom, locale) : null;
    const timingLabel = formatReplayTiming(timestampLabel, elapsedLabel, log.replayedFrom, locale);

    return (
      <div
        className={getNetworkRowClassName(index, selectedIdx, log)}
        style={style}
        onClick={() => selectLogEntry(index)}
      >
        <MethodIcon methodType={log.methodType} isRequest={!!log.request} />
        <div className="data-row-content">
          <div className="data-row-heading">
            <span className="data-row-title">{log.endpoint || log.method}</span>
            {log.isNetworkError && (
              <span className="data-row-network-error-badge">{translate(locale, 'network.networkError')}</span>
            )}
            {replayProvenance && (
              <span className="data-row-edited-badge" title={replayProvenance}>{translate(locale, 'network.edited')}</span>
            )}
          </div>
          <div className="data-row-meta" title={log.location || undefined}>{frameUrl}</div>
          <div className="data-row-timing" title={replayProvenance || undefined}>{timingLabel}</div>
        </div>
      </div>
    );
  }
}

const mapStateToProps = state => ({ selectedIdx: state.network.selectedIdx });
const mapDispatchToProps = { selectLogEntry };
export default connect(mapStateToProps, mapDispatchToProps)(NetworkListRow);
