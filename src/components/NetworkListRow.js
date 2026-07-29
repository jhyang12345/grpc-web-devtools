// Copyright (c) 2019 SafetyCulture Pty Ltd. All Rights Reserved.

import React, { PureComponent } from 'react';
import { connect } from 'react-redux';
import { selectLogEntry } from '../state/network';
import { getNetworkEntry } from '../state/networkCache';
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

export function formatFrameUrl(location) {
  if (!location) return 'Frame URL unavailable';
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

export function formatReplayProvenance(replayedFrom) {
  if (!replayedFrom?.transport || !Number.isFinite(replayedFrom.requestId)) return 'Retry of an earlier request';
  return `Retry of ${replayedFrom.transport} request ${replayedFrom.requestId}`;
}

export function formatReplayTiming(timestampLabel, elapsedLabel, replayedFrom) {
  const timing = `${timestampLabel || 'Waiting for timing...'} | ${elapsedLabel}`;
  return replayedFrom ? `Edited replay | ${timing}` : timing;
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
    const log = data[index];
    const cachedTiming = getNetworkEntry(log.entryId)?.timing;
    const timing = cachedTiming || log.timing;
    const timestampLabel = formatListTimestamp(timing?.requestTimestamp);
    const completed = Number.isFinite(timing?.completionTimestamp);
    const elapsedLabel = completed ? formatElapsed(timing?.duration) : 'Pending';
    const frameUrl = formatFrameUrl(log.location);
    const replayProvenance = log.replayedFrom ? formatReplayProvenance(log.replayedFrom) : null;
    const timingLabel = formatReplayTiming(timestampLabel, elapsedLabel, log.replayedFrom);

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
            {replayProvenance && (
              <span className="data-row-edited-badge" title={replayProvenance}>Edited</span>
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
