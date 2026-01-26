// Copyright (c) 2019 SafetyCulture Pty Ltd. All Rights Reserved.

import React, { Component } from 'react';
import ReactJson from 'react-json-view';
import { connect } from 'react-redux';
import { getNetworkEntry } from '../state/networkCache';
import UpDownIcon from '../icons/UpDown';
import './NetworkDetails.css';

const LARGE_PAYLOAD_BYTES = 1024 * 1024;

function formatBytes(value) {
  if (!Number.isFinite(value)) return '';
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

class NetworkDetails extends Component {
  state = {
    jsonCollapsed: 1,
    lastEntryId: null,
  };

  componentDidUpdate(prevProps) {
    const prevEntryId = prevProps.entry?.entryId ?? null;
    const nextEntryId = this.props.entry?.entryId ?? null;
    if (prevEntryId !== nextEntryId && this.state.lastEntryId !== nextEntryId) {
      this.setState({ jsonCollapsed: 1, lastEntryId: nextEntryId });
    }
  }

  render() {
    const { entry } = this.props;
    return (
      <div className="widget vbox details-container">
        {this._renderContent(entry)}
      </div>
    );
  }
  _renderContent = (entry) => {
    if (entry) {
      const cachedEntry = entry.entryId ? getNetworkEntry(entry.entryId) : null;
      const entryToRender = cachedEntry || entry;
      const { method, request, response, error } = entryToRender;
      const isMissingPayload = !cachedEntry && (entry.request || entry.response);
      const payloadBytes = cachedEntry?.payloadBytes;
      const showLargePayloadWarning = payloadBytes && payloadBytes >= LARGE_PAYLOAD_BYTES;
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
          <div className="details-scroll-area">
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
            <div className="json-actions">
              <button
                className="json-action-button"
                type="button"
                title="Expand all"
                onClick={this._expandAll}
              >
                <UpDownIcon />
                <span>Expand all</span>
              </button>
            </div>
            <ReactJson
              name="grpc"
              theme={theme}
              style={{backgroundColor:'transparent'}}
              enableClipboard={true}
              collapsed={this.state.jsonCollapsed}
              collapseStringsAfterLength={200}
              src={src}
            />
          </div>
          <div className="payload-metadata">
            <div className="payload-metadata-title">Metadata</div>
            <div className="payload-metadata-row">
              <span>Request ID</span>
              <span>{entry.requestId ?? '—'}</span>
            </div>
            <div className="payload-metadata-row">
              <span>Payload size (approx)</span>
              <span>{payloadBytes ? formatBytes(payloadBytes) : '—'}</span>
            </div>
          </div>
        </>
      )
    }
  }

  _expandAll = () => {
    this.setState({ jsonCollapsed: false });
  }
}

const mapStateToProps = state => ({ entry: state.network.selectedEntry });
export default connect(mapStateToProps)(NetworkDetails);
