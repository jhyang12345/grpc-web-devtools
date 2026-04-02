// Copyright (c) 2019 SafetyCulture Pty Ltd. All Rights Reserved.

import React, { PureComponent } from 'react';
import { connect } from 'react-redux';
import { selectLogEntry } from '../state/network';
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

function formatListDuration(duration) {
  if (!Number.isFinite(duration)) {
    return 'Pending';
  }

  if (duration < 1) {
    return `${(duration * 1000).toFixed(0)} us`;
  }

  if (duration < 1000) {
    return `${duration.toFixed(0)} ms`;
  }

  return `${(duration / 1000).toFixed(2)} s`;
}

class NetworkListRow extends PureComponent {
  render() {
    const { index, data, style, selectLogEntry, selectedIdx } = this.props;
    const log = data[index];
    const timestampLabel = formatListTimestamp(log.timing?.requestTimestamp);
    const durationLabel = formatListDuration(log.timing?.duration);
    const metaLabel = [timestampLabel, durationLabel].filter(Boolean).join(' · ');

    return (
      <div
        className={`data-row ${(index + 1) % 2 === 0 ? "" : "odd"} ${index === selectedIdx ? "selected" : ""} ${log.error ? "error" : ""} `}
        style={style}
        onClick={() => selectLogEntry(index)
        }
      >
        <div className="data-row-main">
          <MethodIcon methodType={log.methodType} isRequest={!!log.request} />
          <span className="data-row-title">{log.endpoint}</span>
        </div>
        <div className="data-row-meta">{metaLabel || 'Waiting for timing...'}</div>
      </div >
    );
  }
}

const mapStateToProps = state => ({ selectedIdx: state.network.selectedIdx });
const mapDispatchToProps = { selectLogEntry };
export default connect(mapStateToProps, mapDispatchToProps)(NetworkListRow);
