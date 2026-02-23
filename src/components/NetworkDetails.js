// Copyright (c) 2019 SafetyCulture Pty Ltd. All Rights Reserved.

import React, { Component } from "react";
import ReactJson from "react-json-view";
import { connect } from "react-redux";
import { getNetworkEntry } from "../state/networkCache";
import UpDownIcon from "../icons/UpDown";
import "./NetworkDetails.css";

const LARGE_PAYLOAD_BYTES = 1024 * 1024;

function formatBytes(value) {
  if (!Number.isFinite(value)) return "";
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

class NetworkDetails extends Component {
  state = {
    jsonCollapsed: 1,
    lastEntryId: null,
    isRendering: false,
  };

  componentDidUpdate(prevProps) {
    const prevEntryId = prevProps.entry?.entryId ?? null;
    const nextEntryId = this.props.entry?.entryId ?? null;
    if (prevEntryId !== nextEntryId && this.state.lastEntryId !== nextEntryId) {
      // New entry selected - defer rendering to next tick to avoid blocking UI
      this.setState({ jsonCollapsed: 1, lastEntryId: nextEntryId, isRendering: false });

      // Schedule render on next frame to allow UI to update
      setTimeout(() => {
        this.setState({ isRendering: true });
      }, 0);
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
      const isMissingPayload =
        !cachedEntry && (entry.request || entry.response);
      const payloadBytes = cachedEntry?.payloadBytes;
      const showLargePayloadWarning =
        payloadBytes && payloadBytes >= LARGE_PAYLOAD_BYTES;

      // Check if any payload is truncated
      const isRequestTruncated = request?.__truncated;
      const isResponseTruncated = response?.__truncated;
      const isTruncated = isRequestTruncated || isResponseTruncated;

      const theme = window.matchMedia("(prefers-color-scheme: dark)").matches
        ? "twilight"
        : "rjv-default";
      var src = { method };
      if (request) src.request = request;
      if (response) src.response = response;
      if (isMissingPayload) {
        src.payload = "Full payload not available (evicted from cache).";
      }
      if (error) src.error = error;

      const isExpanded = this.state.jsonCollapsed === false;
      const { isRendering } = this.state;

      return (
        <>
          <div className="details-scroll-area">
            {isTruncated && (
              <div className="payload-warning">
                Payload too large to display inline. The content has been truncated.
                <button
                  onClick={() => this._downloadPayload(src)}
                  style={{ marginLeft: '10px', padding: '4px 8px' }}
                >
                  Download as JSON
                </button>
              </div>
            )}
            {!isTruncated && showLargePayloadWarning && (
              <div className="payload-warning">
                Large payload (~{formatBytes(payloadBytes)}). Rendering may be
                slow.
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
                title={isExpanded ? "Collapse all" : "Expand all"}
                onClick={this._toggleExpandAll}
              >
                <span>{isExpanded ? "Collapse all" : "Expand all"}</span>
                <UpDownIcon />
              </button>
            </div>
            {isRendering ? (
              <ReactJson
                name="grpc"
                theme={theme}
                style={{ backgroundColor: "transparent" }}
                enableClipboard={true}
                collapsed={this.state.jsonCollapsed}
                collapseStringsAfterLength={200}
                src={src}
              />
            ) : (
              <div className="payload-warning">Loading payload...</div>
            )}
          </div>
          <div className="payload-metadata">
            <div className="payload-metadata-title">Metadata</div>
            <div className="payload-metadata-row">
              <span>Request ID</span>
              <span>{entry.requestId ?? "—"}</span>
            </div>
            <div className="payload-metadata-row">
              <span>Payload size (approx)</span>
              <span>{payloadBytes ? formatBytes(payloadBytes) : "—"}</span>
            </div>
          </div>
        </>
      );
    }
  };

  _toggleExpandAll = () => {
    this.setState((prevState) => ({
      jsonCollapsed: prevState.jsonCollapsed === false ? 1 : false,
    }));
  };

  _downloadPayload = (src) => {
    try {
      const jsonStr = JSON.stringify(src, null, 2);
      const blob = new Blob([jsonStr], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `grpc-payload-${Date.now()}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error('[gRPC DevTools] Failed to download payload:', error);
      alert('Failed to download payload. See console for details.');
    }
  };
}

const mapStateToProps = (state) => ({ entry: state.network.selectedEntry });
export default connect(mapStateToProps)(NetworkDetails);
