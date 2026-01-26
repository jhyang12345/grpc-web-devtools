// Copyright (c) 2019 SafetyCulture Pty Ltd. All Rights Reserved.

import React, { Component } from 'react';
import ReactJson from 'react-json-view';
import { connect } from 'react-redux';
import { getNetworkEntry } from '../state/networkCache';
import './NetworkDetails.css';

const LARGE_PAYLOAD_BYTES = 1024 * 1024;

function formatBytes(value) {
  if (!Number.isFinite(value)) return '';
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function formatTimestamp(value) {
  if (!Number.isFinite(value)) return '—';
  const date = new Date(value);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const seconds = String(date.getSeconds()).padStart(2, '0');
  return `${year}/${month}/${day} ${hours}:${minutes}:${seconds}`;
}

function formatDuration(value) {
  if (!Number.isFinite(value)) return '—';
  if (value < 1000) return `${value} ms`;
  return `${(value / 1000).toFixed(2)} s`;
}

function formatOffset(value, origin) {
  if (!Number.isFinite(value) || !Number.isFinite(origin)) return '—';
  const delta = value - origin;
  if (delta < 1000) return `+${delta} ms`;
  return `+${(delta / 1000).toFixed(2)} s`;
}

function formatEventType(value) {
  switch (value) {
    case 'request':
      return 'Request created';
    case 'response':
      return 'Response received';
    case 'stream-data':
      return 'Stream message';
    case 'stream-end':
      return 'Stream ended';
    case 'error':
      return 'Error';
    default:
      return 'Event';
  }
}

class NetworkDetails extends Component {
  render() {
    const { entry } = this.props;
    return (
      <div className="widget vbox details-data">
        {this._renderContent(entry)}
      </div>
    );
  }
  _renderContent = (entry) => {
    if (entry) {
      const { clipboardIsEnabled } = this.props;
      const cachedEntry = entry.entryId ? getNetworkEntry(entry.entryId) : null;
      const entryToRender = cachedEntry || entry;
      const { method, request, response, error } = entryToRender;
      const isMissingPayload = !cachedEntry && (entry.request || entry.response);
      const payloadBytes = cachedEntry?.payloadBytes;
      const showLargePayloadWarning = payloadBytes && payloadBytes >= LARGE_PAYLOAD_BYTES;
      const timingSource = cachedEntry || entry;
      const timelineEvents = cachedEntry?.events
        ? [...cachedEntry.events].sort((a, b) => a.at - b.at)
        : [];
      const theme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'twilight' : 'rjv-default';
      var src = { method };
      if (request) src.request = request;
      if (response) src.response = response;
      if (isMissingPayload) {
        src.payload = "Full payload not available (evicted from cache).";
      }
      if (error) src.error = error;
      return (
        <>
          {showLargePayloadWarning && (
            <div className="payload-warning">
              Large payload (~{formatBytes(payloadBytes)}). Rendering may be slow.
            </div>
          )}
          {isMissingPayload && (
            <div className="payload-warning">
              Full payload is no longer available (evicted from cache).
            </div>
          )}
          <ReactJson
            name="grpc"
            theme={theme}
            style={{backgroundColor:'transparent'}}
            enableClipboard={clipboardIsEnabled}
            collapsed={1}
            collapseStringsAfterLength={200}
            src={src}
          />
          <div className="payload-timing">
            <div className="payload-timing-title">Timing</div>
            <div className="payload-timing-row">
              <span>Request ID</span>
              <span>{timingSource.requestId ?? '—'}</span>
            </div>
            <div className="payload-timing-row">
              <span>Sent at</span>
              <span>{formatTimestamp(timingSource.startedAt)}</span>
            </div>
            <div className="payload-timing-row">
              <span>Response at</span>
              <span>{formatTimestamp(timingSource.responseAt)}</span>
            </div>
            <div className="payload-timing-row">
              <span>Duration</span>
              <span>{formatDuration(timingSource.durationMs)}</span>
            </div>
            <div className="payload-timing-row">
              <span>Payload size (approx)</span>
              <span>{payloadBytes ? formatBytes(payloadBytes) : '—'}</span>
            </div>
          </div>
          <div className="payload-timeline">
            <div className="payload-timing-title">Timeline</div>
            {timelineEvents.length === 0 && (
              <div className="payload-timeline-empty">No events recorded.</div>
            )}
            {timelineEvents.map((timelineEvent, index) => (
              <div className="payload-timeline-row" key={`${timelineEvent.type}-${timelineEvent.at}-${index}`}>
                <span>{formatEventType(timelineEvent.type)}</span>
                <span>{formatTimestamp(timelineEvent.at)}</span>
                <span>{formatOffset(timelineEvent.at, timingSource.startedAt)}</span>
              </div>
            ))}
          </div>
        </>
      )
    }
  }
}

const mapStateToProps = state => ({ entry: state.network.selectedEntry, clipboardIsEnabled: state.clipboard.clipboardIsEnabled });
export default connect(mapStateToProps)(NetworkDetails);
