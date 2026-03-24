// Copyright (c) 2019 SafetyCulture Pty Ltd. All Rights Reserved.

/* global chrome */

import React, { Component } from "react";
import ReactJson from "react-json-view";
import Split from "react-split";
import { connect } from "react-redux";
import { getNetworkEntry } from "../state/networkCache";
import { showToast } from "../state/toast";
import { getStorageItem, setStorageItem } from "../utils/localStorage";
import MethodHeader from "./MethodHeader";
import SearchBar from "./SearchBar";
import "./NetworkDetails.css";

const DEFAULT_PANE_SIZES = [33, 67];
const PANE_SIZE_STORAGE_KEY = "detailsPaneSizes";

function formatBytes(value) {
  if (!Number.isFinite(value)) return "";
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDuration(ms) {
  if (!Number.isFinite(ms)) return "";
  if (ms < 1) return `${(ms * 1000).toFixed(0)} us`;
  if (ms < 1000) return `${ms.toFixed(0)} ms`;
  return `${(ms / 1000).toFixed(2)} s`;
}

function createSearchState() {
  return {
    isOpen: false,
    query: "",
    matchCount: 0,
    currentIndex: -1,
  };
}

function getRenderableEntry(entry) {
  if (!entry) {
    return { cachedEntry: null, entryToRender: null };
  }

  const cachedEntry = entry.entryId ? getNetworkEntry(entry.entryId) : null;
  return {
    cachedEntry,
    entryToRender: cachedEntry || entry,
  };
}

function stringifyJson(value) {
  if (value == null) {
    return "";
  }

  try {
    return JSON.stringify(value, null, 2);
  } catch (error) {
    return "";
  }
}

function getRequestEditorValue(entry, isMissingPayload) {
  if (isMissingPayload) {
    return "";
  }

  return stringifyJson(entry?.request);
}

function buildResponseSource(response, error, isMissingPayload) {
  if (isMissingPayload) {
    return {
      message: "Full response payload is no longer available.",
    };
  }

  if (response != null) {
    if (typeof response === "object") {
      return response;
    }
    return { value: response };
  }

  if (error != null) {
    return { error };
  }

  return {
    message: "No response captured.",
  };
}

function findAllMatches(text, query) {
  if (!text || !query) {
    return [];
  }

  const normalizedText = text.toLowerCase();
  const normalizedQuery = query.toLowerCase();
  const matches = [];
  let startIndex = 0;

  while (startIndex < normalizedText.length) {
    const matchIndex = normalizedText.indexOf(normalizedQuery, startIndex);
    if (matchIndex === -1) {
      break;
    }

    matches.push({
      start: matchIndex,
      end: matchIndex + normalizedQuery.length,
    });
    startIndex = matchIndex + Math.max(normalizedQuery.length, 1);
  }

  return matches;
}

class NetworkDetails extends Component {
  requestPaneRef = React.createRef();

  requestEditorRef = React.createRef();

  responsePaneRef = React.createRef();

  responseBodyRef = React.createRef();

  _pendingReplayRequestId = null;

  _replayTimeoutId = null;

  state = {
    lastEntryId: null,
    isRendering: false,
    paneSizes: getStorageItem(PANE_SIZE_STORAGE_KEY, DEFAULT_PANE_SIZES),
    responseCollapsed: this.props.defaultCollapsed ? 1 : false,
    responseCollapseBeforeSearch: null,
    requestSearch: createSearchState(),
    responseSearch: createSearchState(),
    replayRequestValue: "",
    replayRequestError: "",
    isSubmittingReplay: false,
  };

  _requestSearchMatches = [];

  _responseSearchMatches = [];

  _requestSearchDebounceTimer = null;

  _responseSearchDebounceTimer = null;

  componentDidMount() {
    document.addEventListener("keydown", this._handleKeydown, true);
  }

  componentWillUnmount() {
    document.removeEventListener("keydown", this._handleKeydown, true);
    if (this._requestSearchDebounceTimer) {
      clearTimeout(this._requestSearchDebounceTimer);
    }
    if (this._responseSearchDebounceTimer) {
      clearTimeout(this._responseSearchDebounceTimer);
    }
    if (this._replayTimeoutId) {
      clearTimeout(this._replayTimeoutId);
    }
    this._clearResponseHighlights();
  }

  componentDidUpdate(prevProps) {
    const prevEntryId = prevProps.entry?.entryId ?? null;
    const nextEntryId = this.props.entry?.entryId ?? null;

    if (prevEntryId !== nextEntryId && this.state.lastEntryId !== nextEntryId) {
      const { cachedEntry, entryToRender } = getRenderableEntry(this.props.entry);
      const requestPayloadMissing = !!this.props.entry?.entryId && !cachedEntry && this.props.entry.request === true;

      this._requestSearchMatches = [];
      this._responseSearchMatches = [];
      this._clearResponseHighlights();

      this._pendingReplayRequestId = null;
      if (this._replayTimeoutId) {
        clearTimeout(this._replayTimeoutId);
        this._replayTimeoutId = null;
      }

      this.setState({
        lastEntryId: nextEntryId,
        isRendering: false,
        responseCollapsed: this.props.defaultCollapsed ? 1 : false,
        responseCollapseBeforeSearch: null,
        requestSearch: createSearchState(),
        responseSearch: createSearchState(),
        replayRequestValue: getRequestEditorValue(entryToRender, requestPayloadMissing),
        replayRequestError: "",
        isSubmittingReplay: false,
      });

      setTimeout(() => {
        this.setState({ isRendering: true });
      }, 0);
    }

    if (
      this._pendingReplayRequestId != null &&
      this.props.lastReplayResult !== prevProps.lastReplayResult &&
      this.props.lastReplayResult?.requestId === this._pendingReplayRequestId
    ) {
      this._pendingReplayRequestId = null;
      if (this._replayTimeoutId) {
        clearTimeout(this._replayTimeoutId);
        this._replayTimeoutId = null;
      }

      const newState = { isSubmittingReplay: false };
      if (!this.props.lastReplayResult.ok) {
        newState.replayRequestError = this.props.lastReplayResult.message || "Replay failed.";
      }
      this.setState(newState);
    }
  }

  render() {
    const { entry } = this.props;

    return (
      <div className="widget vbox details-container">
        {entry?.method && <MethodHeader method={entry.method} />}
        {this._renderContent(entry)}
      </div>
    );
  }

  _renderContent = (entry) => {
    if (!entry) {
      return null;
    }

    const { cachedEntry, entryToRender } = getRenderableEntry(entry);
    const {
      request,
      response,
      error,
      timing,
      payloadBytes,
      requestId,
      transport,
      replayedFromRequestId,
    } = entryToRender;

    const requestPayloadMissing = !!entry.entryId && !cachedEntry && entry.request === true;
    const responsePayloadMissing = !!entry.entryId && !cachedEntry && entry.response === true;
    const requestUnavailableReason = this._getReplayUnavailableReason(entryToRender, {
      isMissingPayload: requestPayloadMissing,
      isRequestTruncated: !!request?.__truncated,
      requestId,
    });
    const responseSource = buildResponseSource(response, error, responsePayloadMissing);
    const hasResponsePayload = !responsePayloadMissing && (response != null || error != null);
    const responseText = stringifyJson(responseSource);
    const requestText = this.state.replayRequestValue;

    return (
      <>
        <div className="details-main">
          <Split
            className="details-pane-split vbox flex-auto"
            direction="vertical"
            sizes={this.state.paneSizes}
            minSize={[180, 220]}
            gutterSize={6}
            onDragEnd={this._onPaneResize}
          >
            {this._renderRequestPane(entryToRender, requestText, requestUnavailableReason, requestPayloadMissing)}
            {this._renderResponsePane(
              responseSource,
              responseText,
              responsePayloadMissing,
              !!response?.__truncated || !!error?.__truncated,
              hasResponsePayload
            )}
          </Split>
        </div>
        <div className="payload-metadata">
          {timing && <div className="payload-metadata-title">Metadata</div>}
          {timing?.duration != null && (
            <div className="payload-metadata-row">
              <span>Duration</span>
              <span>{formatDuration(timing.duration)}</span>
            </div>
          )}
          {timing?.messageCount != null && (
            <>
              <div className="payload-metadata-row">
                <span>Messages</span>
                <span>{timing.messageCount}</span>
              </div>
              {timing.firstMessageTime != null && (
                <div className="payload-metadata-row">
                  <span>Time to first message</span>
                  <span>{formatDuration(timing.firstMessageTime - timing.startTime)}</span>
                </div>
              )}
            </>
          )}
          {transport && (
            <div className="payload-metadata-row">
              <span>Transport</span>
              <span>{transport}</span>
            </div>
          )}
          {replayedFromRequestId != null && (
            <div className="payload-metadata-row">
              <span>Replay of</span>
              <span>Request #{replayedFromRequestId}</span>
            </div>
          )}
          <div className="payload-metadata-row">
            <span>Payload size (approx)</span>
            <span>{payloadBytes ? formatBytes(payloadBytes) : "Unknown"}</span>
          </div>
        </div>
      </>
    );
  };

  _renderRequestPane(entry, requestText, requestUnavailableReason, requestPayloadMissing) {
    const { requestSearch, replayRequestError, isSubmittingReplay } = this.state;
    const canCopyRequest = !requestPayloadMissing && !!requestText;
    const canSearchRequest = !!requestText;

    return (
      <div className="details-pane request-pane" ref={this.requestPaneRef}>
        <div className="details-pane-header">
          <div className="details-pane-title-group">
            <div className="details-pane-title">Request</div>
            <div className="details-pane-subtitle">
              {requestUnavailableReason ? "Read only" : "Editable before retry"}
            </div>
          </div>
          <div className="details-pane-actions">
            <button
              className="json-action-button"
              type="button"
              onClick={() => this._copyText("Request", requestText)}
              disabled={!canCopyRequest}
            >
              Copy
            </button>
            <button
              className={`json-action-button ${requestSearch.isOpen ? "is-active" : ""}`}
              type="button"
              onClick={() => this._openRequestSearch()}
              disabled={!canSearchRequest}
            >
              Search
            </button>
            <button
              className="json-action-button"
              type="button"
              onClick={this._formatReplayRequest}
              disabled={!requestText}
            >
              Format
            </button>
            <button
              className="json-action-button"
              type="button"
              onClick={() => this._resetReplayRequest(entry, requestPayloadMissing)}
              disabled={!entry?.request || requestPayloadMissing}
            >
              Reset
            </button>
            <button
              className="json-action-button replay-submit-button"
              type="button"
              onClick={this._retryRequest}
              disabled={!!requestUnavailableReason || isSubmittingReplay}
            >
              {isSubmittingReplay ? "Retrying..." : "Retry call"}
            </button>
          </div>
        </div>
        {requestSearch.isOpen && (
          <SearchBar
            compact
            placeholder="Search request"
            query={requestSearch.query}
            matchCount={requestSearch.matchCount}
            currentIndex={requestSearch.currentIndex}
            onChange={this._onRequestSearchChange}
            onNext={this._navigateToNextRequestMatch}
            onPrev={this._navigateToPrevRequestMatch}
            onClose={this._closeRequestSearch}
          />
        )}
        {requestUnavailableReason && (
          <div className="payload-warning pane-warning">{requestUnavailableReason}</div>
        )}
        <div className="details-pane-body">
          <textarea
            ref={this.requestEditorRef}
            className="request-editor"
            value={requestText}
            onChange={this._onReplayRequestChange}
            readOnly={!!requestUnavailableReason}
            spellCheck={false}
            placeholder="No request payload captured."
          />
          {replayRequestError && (
            <div className="payload-warning pane-warning pane-error">
              {replayRequestError}
            </div>
          )}
        </div>
      </div>
    );
  }

  _renderResponsePane(responseSource, responseText, responsePayloadMissing, isResponseTruncated, hasResponsePayload) {
    const { responseSearch, responseCollapsed, isRendering } = this.state;
    const theme = window.matchMedia("(prefers-color-scheme: dark)").matches ? "twilight" : "rjv-default";
    const canCopyResponse = hasResponsePayload && !!responseText;
    const canSearchResponse = hasResponsePayload && !!responseText;
    const expandLabel = responseCollapsed === false ? "Collapse" : "Expand";

    return (
      <div className="details-pane response-pane" ref={this.responsePaneRef}>
        <div className="details-pane-header">
          <div className="details-pane-title-group">
            <div className="details-pane-title">Response</div>
            <div className="details-pane-subtitle">Captured response payload</div>
          </div>
          <div className="details-pane-actions">
            <button
              className="json-action-button"
              type="button"
              onClick={() => this._copyText("Response", responseText)}
              disabled={!canCopyResponse}
            >
              Copy
            </button>
            <button
              className={`json-action-button ${responseSearch.isOpen ? "is-active" : ""}`}
              type="button"
              onClick={() => this._openResponseSearch()}
              disabled={!canSearchResponse}
            >
              Search
            </button>
            <button
              className="json-action-button"
              type="button"
              onClick={this._toggleResponseCollapse}
              disabled={!isRendering}
            >
              {expandLabel}
            </button>
          </div>
        </div>
        {responseSearch.isOpen && (
          <SearchBar
            compact
            placeholder="Search response"
            query={responseSearch.query}
            matchCount={responseSearch.matchCount}
            currentIndex={responseSearch.currentIndex}
            onChange={this._onResponseSearchChange}
            onNext={this._navigateToNextResponseMatch}
            onPrev={this._navigateToPrevResponseMatch}
            onClose={this._closeResponseSearch}
          />
        )}
        {responsePayloadMissing && (
          <div className="payload-warning pane-warning">
            Full response payload is no longer available (evicted from cache).
          </div>
        )}
        {!responsePayloadMissing && isResponseTruncated && (
          <div className="payload-warning pane-warning">
            Response payload was truncated in cache.
          </div>
        )}
        <div className="details-pane-body details-pane-json" ref={this.responseBodyRef}>
          {isRendering ? (
            <ReactJson
              name={false}
              theme={theme}
              style={{ backgroundColor: "transparent" }}
              enableClipboard={false}
              collapsed={responseCollapsed}
              collapseStringsAfterLength={200}
              src={responseSource}
            />
          ) : (
            <div className="payload-warning">Loading payload...</div>
          )}
        </div>
      </div>
    );
  }

  _getReplayUnavailableReason(entry, { isMissingPayload, isRequestTruncated, requestId }) {
    if (!entry?.request) {
      return "This entry does not include a request payload.";
    }

    if (isMissingPayload) {
      return "Replay is unavailable because the request payload has been evicted from cache.";
    }

    if (isRequestTruncated) {
      return "Replay is unavailable because the request payload was truncated.";
    }

    if (!requestId) {
      return "Replay is unavailable because this call is missing its request identifier.";
    }

    return "";
  }

  _onPaneResize = (sizes) => {
    this.setState({ paneSizes: sizes });
    setStorageItem(PANE_SIZE_STORAGE_KEY, sizes);
  };

  _toggleResponseCollapse = () => {
    this.setState((prevState) => ({
      responseCollapsed: prevState.responseCollapsed === false ? 1 : false,
    }));
  };

  _handleKeydown = (event) => {
    const isCmdF = (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "f";

    if (!isCmdF || !this.props.entry) {
      if (event.key === "Escape" && this.state.requestSearch.isOpen) {
        event.preventDefault();
        this._closeRequestSearch();
      }

      if (event.key === "Escape" && this.state.responseSearch.isOpen) {
        event.preventDefault();
        this._closeResponseSearch();
      }

      return;
    }

    const activeElement = document.activeElement;
    const isInRequestPane = this.requestPaneRef.current?.contains(activeElement);
    const isInResponsePane = this.responsePaneRef.current?.contains(activeElement);

    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();

    if (isInRequestPane) {
      this._openRequestSearch();
      return;
    }

    if (isInResponsePane || !isInRequestPane) {
      this._openResponseSearch();
    }
  };

  async _copyText(label, text) {
    if (!text) {
      return;
    }

    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        const tempTextArea = document.createElement("textarea");
        tempTextArea.value = text;
        document.body.appendChild(tempTextArea);
        tempTextArea.select();
        document.execCommand("copy");
        document.body.removeChild(tempTextArea);
      }

      this.props.showToast({
        message: `${label} copied to clipboard`,
        type: "success",
        autoDismiss: 2000,
      });
    } catch (error) {
      this.props.showToast({
        message: `Failed to copy ${label.toLowerCase()}`,
        type: "error",
        autoDismiss: 4000,
      });
    }
  }

  _resetReplayRequest = (entry, isMissingPayload) => {
    this.setState({
      replayRequestValue: getRequestEditorValue(entry, isMissingPayload),
      replayRequestError: "",
    }, () => {
      if (this.state.requestSearch.isOpen && this.state.requestSearch.query) {
        this._performRequestSearch(this.state.requestSearch.query);
      }
    });
  };

  _onReplayRequestChange = (event) => {
    const replayRequestValue = event.target.value;

    this.setState({
      replayRequestValue,
      replayRequestError: "",
    }, () => {
      if (this.state.requestSearch.isOpen && this.state.requestSearch.query) {
        this._performRequestSearch(this.state.requestSearch.query);
      }
    });
  };

  _formatReplayRequest = () => {
    try {
      const parsed = JSON.parse(this.state.replayRequestValue);
      this.setState({
        replayRequestValue: JSON.stringify(parsed, null, 2),
        replayRequestError: "",
      }, () => {
        if (this.state.requestSearch.isOpen && this.state.requestSearch.query) {
          this._performRequestSearch(this.state.requestSearch.query);
        }
      });
    } catch (error) {
      this.setState({
        replayRequestError: `Invalid JSON: ${error.message}`,
      });
    }
  };

  _retryRequest = () => {
    const { entryToRender } = getRenderableEntry(this.props.entry);
    const unavailableReason = this._getReplayUnavailableReason(entryToRender, {
      isMissingPayload: !!this.props.entry?.entryId && !getNetworkEntry(this.props.entry.entryId) && this.props.entry.request === true,
      isRequestTruncated: !!entryToRender?.request?.__truncated,
      requestId: entryToRender?.requestId,
    });

    if (unavailableReason) {
      this.setState({ replayRequestError: unavailableReason });
      return;
    }

    let parsedRequest;
    try {
      parsedRequest = JSON.parse(this.state.replayRequestValue);
    } catch (error) {
      this.setState({
        replayRequestError: `Invalid JSON: ${error.message}`,
      });
      return;
    }

    if (!chrome?.devtools?.inspectedWindow?.eval) {
      this.props.showToast({
        message: "Unable to send replay command to the inspected tab.",
        type: "error",
        autoDismiss: 5000,
      });
      return;
    }

    this.setState({
      isSubmittingReplay: true,
      replayRequestError: "",
    });

    this._pendingReplayRequestId = entryToRender.requestId;

    if (this._replayTimeoutId) {
      clearTimeout(this._replayTimeoutId);
    }
    this._replayTimeoutId = setTimeout(() => {
      this._pendingReplayRequestId = null;
      this._replayTimeoutId = null;
      if (this.state.isSubmittingReplay) {
        this.setState({ isSubmittingReplay: false });
      }
    }, 15000);

    const replayCommand = JSON.stringify({
      type: "__GRPCWEB_DEVTOOLS_REPLAY__",
      requestId: entryToRender.requestId,
      transport: entryToRender.transport,
      request: parsedRequest,
    });

    chrome.devtools.inspectedWindow.eval(
      `(function () { window.postMessage(${replayCommand}, "*"); return true; })()`,
      (_, exceptionInfo) => {
        if (exceptionInfo?.isException) {
          this._pendingReplayRequestId = null;
          if (this._replayTimeoutId) {
            clearTimeout(this._replayTimeoutId);
            this._replayTimeoutId = null;
          }
          this.setState({ isSubmittingReplay: false });
          this.props.showToast({
            message: exceptionInfo.value || "Replay request was rejected.",
            type: "error",
            autoDismiss: 5000,
          });
        }
      }
    );
  };

  _openRequestSearch = () => {
    this.setState((prevState) => ({
      requestSearch: {
        ...prevState.requestSearch,
        isOpen: true,
      },
    }));
  };

  _closeRequestSearch = () => {
    this._requestSearchMatches = [];
    this.setState({
      requestSearch: createSearchState(),
    });
  };

  _onRequestSearchChange = (value) => {
    this.setState((prevState) => ({
      requestSearch: {
        ...prevState.requestSearch,
        query: value,
      },
    }));

    if (this._requestSearchDebounceTimer) {
      clearTimeout(this._requestSearchDebounceTimer);
    }

    this._requestSearchDebounceTimer = setTimeout(() => {
      this._performRequestSearch(value);
    }, 150);
  };

  _performRequestSearch = (query) => {
    const matches = findAllMatches(this.state.replayRequestValue, query);
    this._requestSearchMatches = matches;

    this.setState((prevState) => ({
      requestSearch: {
        ...prevState.requestSearch,
        matchCount: matches.length,
        currentIndex: matches.length > 0 ? 0 : -1,
      },
    }));

    if (matches.length > 0) {
      this._scrollRequestEditorToMatch(0);
    }
  };

  _navigateToNextRequestMatch = () => {
    const { matchCount, currentIndex } = this.state.requestSearch;
    if (matchCount === 0) {
      return;
    }

    const nextIndex = (currentIndex + 1) % matchCount;
    this.setState((prevState) => ({
      requestSearch: {
        ...prevState.requestSearch,
        currentIndex: nextIndex,
      },
    }), () => {
      this._scrollRequestEditorToMatch(nextIndex);
    });
  };

  _navigateToPrevRequestMatch = () => {
    const { matchCount, currentIndex } = this.state.requestSearch;
    if (matchCount === 0) {
      return;
    }

    const prevIndex = currentIndex === 0 ? matchCount - 1 : currentIndex - 1;
    this.setState((prevState) => ({
      requestSearch: {
        ...prevState.requestSearch,
        currentIndex: prevIndex,
      },
    }), () => {
      this._scrollRequestEditorToMatch(prevIndex);
    });
  };

  _scrollRequestEditorToMatch = (index) => {
    const editor = this.requestEditorRef.current;
    const match = this._requestSearchMatches[index];

    if (!editor || !match) {
      return;
    }

    editor.setSelectionRange(match.start, match.end);

    const lineHeight = parseFloat(window.getComputedStyle(editor).lineHeight) || 18;
    const lineNumber = this.state.replayRequestValue.slice(0, match.start).split("\n").length - 1;
    const targetTop = Math.max((lineNumber * lineHeight) - (editor.clientHeight / 2), 0);
    editor.scrollTop = targetTop;
  };

  _openResponseSearch = () => {
    this.setState((prevState) => ({
      responseSearch: {
        ...prevState.responseSearch,
        isOpen: true,
      },
      responseCollapseBeforeSearch: prevState.responseCollapseBeforeSearch == null
        ? prevState.responseCollapsed
        : prevState.responseCollapseBeforeSearch,
      responseCollapsed: false,
    }), () => {
      if (this.state.responseSearch.query) {
        this._performResponseSearch(this.state.responseSearch.query);
      }
    });
  };

  _closeResponseSearch = () => {
    this._responseSearchMatches = [];
    this._clearResponseHighlights();
    this.setState((prevState) => ({
      responseSearch: createSearchState(),
      responseCollapsed: prevState.responseCollapseBeforeSearch != null
        ? prevState.responseCollapseBeforeSearch
        : prevState.responseCollapsed,
      responseCollapseBeforeSearch: null,
    }));
  };

  _onResponseSearchChange = (value) => {
    this.setState((prevState) => ({
      responseSearch: {
        ...prevState.responseSearch,
        query: value,
      },
    }));

    if (this._responseSearchDebounceTimer) {
      clearTimeout(this._responseSearchDebounceTimer);
    }

    this._responseSearchDebounceTimer = setTimeout(() => {
      this._performResponseSearch(value);
    }, 150);
  };

  _performResponseSearch = (query) => {
    this._clearResponseHighlights();

    if (!query || !query.trim()) {
      this._responseSearchMatches = [];
      this.setState((prevState) => ({
        responseSearch: {
          ...prevState.responseSearch,
          matchCount: 0,
          currentIndex: -1,
        },
      }));
      return;
    }

    const container = this.responseBodyRef.current;
    if (!container) {
      return;
    }

    const matches = [];
    const queryLower = query.toLowerCase();
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, null, false);

    let node;
    while ((node = walker.nextNode())) {
      const text = node.textContent.toLowerCase();
      if (text.includes(queryLower) && node.parentElement) {
        matches.push(node.parentElement);
      }
    }

    this._responseSearchMatches = matches;
    this.setState((prevState) => ({
      responseSearch: {
        ...prevState.responseSearch,
        matchCount: matches.length,
        currentIndex: matches.length > 0 ? 0 : -1,
      },
    }), () => {
      this._highlightResponseMatches();
      if (matches.length > 0) {
        this._scrollToResponseMatch(0);
      }
    });
  };

  _navigateToNextResponseMatch = () => {
    const { matchCount, currentIndex } = this.state.responseSearch;
    if (matchCount === 0) {
      return;
    }

    const nextIndex = (currentIndex + 1) % matchCount;
    this.setState((prevState) => ({
      responseSearch: {
        ...prevState.responseSearch,
        currentIndex: nextIndex,
      },
    }), () => {
      this._highlightResponseMatches();
      this._scrollToResponseMatch(nextIndex);
    });
  };

  _navigateToPrevResponseMatch = () => {
    const { matchCount, currentIndex } = this.state.responseSearch;
    if (matchCount === 0) {
      return;
    }

    const prevIndex = currentIndex === 0 ? matchCount - 1 : currentIndex - 1;
    this.setState((prevState) => ({
      responseSearch: {
        ...prevState.responseSearch,
        currentIndex: prevIndex,
      },
    }), () => {
      this._highlightResponseMatches();
      this._scrollToResponseMatch(prevIndex);
    });
  };

  _highlightResponseMatches = () => {
    this._clearResponseHighlights();

    this._responseSearchMatches.forEach((element, index) => {
      element.classList.add(index === this.state.responseSearch.currentIndex ? "search-match-active" : "search-match");
    });
  };

  _clearResponseHighlights = () => {
    const container = this.responseBodyRef.current;
    if (!container) {
      return;
    }

    container.querySelectorAll(".search-match, .search-match-active").forEach((element) => {
      element.classList.remove("search-match", "search-match-active");
    });
  };

  _scrollToResponseMatch = (index) => {
    const element = this._responseSearchMatches[index];
    if (!element) {
      return;
    }

    element.scrollIntoView({
      behavior: "smooth",
      block: "center",
      inline: "nearest",
    });
  };
}

const mapStateToProps = (state) => ({
  entry: state.network.selectedEntry,
  defaultCollapsed: state.toolbar.defaultCollapsed,
  lastReplayResult: state.network.lastReplayResult,
});

const mapDispatchToProps = {
  showToast,
};

export default connect(mapStateToProps, mapDispatchToProps)(NetworkDetails);
