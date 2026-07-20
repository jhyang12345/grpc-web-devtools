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

class NetworkListRow extends PureComponent {
  render() {
    const { index, data, style, selectLogEntry, selectedIdx } = this.props;
    const log = data[index];
    const cachedTiming = getNetworkEntry(log.entryId)?.timing;
    const timing = cachedTiming || log.timing;
    const timestampLabel = formatListTimestamp(timing?.requestTimestamp);

    return (
      <div
        className={`data-row ${(index + 1) % 2 === 0 ? "" : "odd"} ${index === selectedIdx ? "selected" : ""} ${log.error ? "error" : ""} `}
        style={style}
        onClick={() => selectLogEntry(index)}
      >
        <MethodIcon methodType={log.methodType} isRequest={!!log.request} />
        <div className="data-row-content">
          <span className="data-row-title">{log.endpoint}</span>
          <div className="data-row-meta">{timestampLabel || 'Waiting for timing...'}</div>
        </div>
      </div>
    );
  }
}

const mapStateToProps = state => ({ selectedIdx: state.network.selectedIdx });
const mapDispatchToProps = { selectLogEntry };
export default connect(mapStateToProps, mapDispatchToProps)(NetworkListRow);
