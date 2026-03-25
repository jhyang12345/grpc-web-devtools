// Copyright (c) 2019 SafetyCulture Pty Ltd. All Rights Reserved.

import React, { Component, PureComponent } from "react";
import ReactJson from "react-json-view";
import Split from "react-split";
import { connect } from "react-redux";
import { getNetworkEntry } from "../state/networkCache";
import { showToast } from "../state/toast";
import { getStorageItem, setStorageItem } from "../utils/localStorage";
import MethodHeader from "./MethodHeader";
import SearchBar from "./SearchBar";
import "./NetworkDetails.css";

// Isolated so it never re-renders when parent search state changes.
class ResponseJsonContent extends PureComponent {
  render() {
    const { isRendering, responseSource, responseCollapsed, theme } = this.props;
    if (!isRendering) {
      return <div className="payload-warning">Loading payload...</div>;
    }
    return (
      <ReactJson
        name={false}
        theme={theme}
        style={{ backgroundColor: "transparent" }}
        enableClipboard={false}
        collapsed={responseCollapsed}
        collapseStringsAfterLength={200}
        src={responseSource}
      />
    );
  }
}

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

  // Cached request text for search, updated when entry changes
  _currentRequestText = "";

  state = {
    lastEntryId: null,
    isRendering: false,
    paneSizes: getStorageItem(PANE_SIZE_STORAGE_KEY, DEFAULT_PANE_SIZES),
    responseCollapsed: this.props.defaultCollapsed ? 1 : false,
    responseCollapseBeforeSearch: null,
    requestSearch: createSearchState(),
    responseSearch: createSearchState(),
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
    this._clearRequestHighlights();
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
      this._clearRequestHighlights();
      this._currentRequestText = requestPayloadMissing ? "" : stringifyJson(entryToRender?.request);

      this.setState({
        lastEntryId: nextEntryId,
        isRendering: false,
        responseCollapsed: this.props.defaultCollapsed ? 1 : false,
        responseCollapseBeforeSearch: null,
        requestSearch: createSearchState(),
        responseSearch: createSearchState(),
      });

      setTimeout(() => {
        this.setState({ isRendering: true });
      }, 0);
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
      response,
      error,
      timing,
      payloadBytes,
      transport,
      replayedFromRequestId,
    } = entryToRender;

    const requestPayloadMissing = !!entry.entryId && !cachedEntry && entry.request === true;
    const responsePayloadMissing = !!entry.entryId && !cachedEntry && entry.response === true;
    const requestText = requestPayloadMissing ? "" : stringifyJson(entryToRender?.request);
    const responseSource = buildResponseSource(response, error, responsePayloadMissing);
    const hasResponsePayload = !responsePayloadMissing && (response != null || error != null);
    const responseText = stringifyJson(responseSource);

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
            {this._renderRequestPane(requestText, requestPayloadMissing)}
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

  _applyRequestHighlights = () => {
    if (!CSS?.highlights) return;

    CSS.highlights.delete("request-search");
    CSS.highlights.delete("request-search-active");

    const matches = this._requestSearchMatches;
    if (!matches || matches.length === 0) return;

    const container = this.requestEditorRef.current;
    if (!container) return;

    const textNode = container.firstChild;
    if (!textNode || textNode.nodeType !== Node.TEXT_NODE) return;

    const { currentIndex } = this.state.requestSearch;
    const regular = [];
    const active = [];

    matches.forEach((match, idx) => {
      const range = new Range();
      range.setStart(textNode, Math.min(match.start, textNode.length));
      range.setEnd(textNode, Math.min(match.end, textNode.length));
      (idx === currentIndex ? active : regular).push(range);
    });

    if (regular.length > 0) CSS.highlights.set("request-search", new window.Highlight(...regular));
    if (active.length > 0)  CSS.highlights.set("request-search-active", new window.Highlight(...active));
  };

  _clearRequestHighlights = () => {
    if (CSS?.highlights) {
      CSS.highlights.delete("request-search");
      CSS.highlights.delete("request-search-active");
    }
  };

  _renderRequestPane(requestText, requestPayloadMissing) {
    const { requestSearch } = this.state;
    const canCopyRequest = !requestPayloadMissing && !!requestText;
    const canSearchRequest = !!requestText;

    return (
      <div className="details-pane request-pane" ref={this.requestPaneRef}>
        <div className="details-pane-header">
          <div className="details-pane-title-group">
            <div className="details-pane-title">Request</div>
            <div className="details-pane-subtitle">Captured request payload</div>
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
          </div>
        </div>
        {requestSearch.isOpen && (
          <SearchBar
            compact
            placeholder="Search request"
            matchCount={requestSearch.matchCount}
            currentIndex={requestSearch.currentIndex}
            onChange={this._onRequestSearchChange}
            onNext={this._navigateToNextRequestMatch}
            onPrev={this._navigateToPrevRequestMatch}
            onClose={this._closeRequestSearch}
          />
        )}
        {requestPayloadMissing && (
          <div className="payload-warning pane-warning">
            Full request payload is no longer available (evicted from cache).
          </div>
        )}
        <div className="details-pane-body">
          {/* Plain text only — highlights applied via CSS Highlight API, no React re-renders */}
          <pre ref={this.requestEditorRef} className="request-viewer">
            {requestText || <span className="request-viewer-placeholder">No request payload captured.</span>}
          </pre>
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
          <ResponseJsonContent
            isRendering={isRendering}
            responseSource={responseSource}
            responseCollapsed={responseCollapsed}
            theme={theme}
          />
        </div>
      </div>
    );
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
    this._clearRequestHighlights();
    this.setState({
      requestSearch: createSearchState(),
    });
  };

  _onRequestSearchChange = (value) => {
    if (this._requestSearchDebounceTimer) {
      clearTimeout(this._requestSearchDebounceTimer);
    }
    this._requestSearchDebounceTimer = setTimeout(() => {
      this._performRequestSearch(value);
    }, 150);
  };

  _performRequestSearch = (query) => {
    const matches = findAllMatches(this._currentRequestText, query);
    this._requestSearchMatches = matches;

    this.setState((prevState) => ({
      requestSearch: {
        ...prevState.requestSearch,
        matchCount: matches.length,
        currentIndex: matches.length > 0 ? 0 : -1,
      },
    }), () => {
      this._applyRequestHighlights();
      if (matches.length > 0) {
        this._scrollRequestEditorToMatch(0);
      }
    });
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
      this._applyRequestHighlights();
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
      this._applyRequestHighlights();
      this._scrollRequestEditorToMatch(prevIndex);
    });
  };

  _scrollRequestEditorToMatch = (index) => {
    const container = this.requestEditorRef.current;
    const match = this._requestSearchMatches[index];
    if (!container || !match) return;

    const textNode = container.firstChild;
    if (!textNode || textNode.nodeType !== Node.TEXT_NODE) return;

    try {
      const range = new Range();
      range.setStart(textNode, Math.min(match.start, textNode.length));
      range.setEnd(textNode, Math.min(match.end, textNode.length));

      const rangeRect = range.getBoundingClientRect();
      const scrollParent = container.parentElement;
      const parentRect = scrollParent.getBoundingClientRect();
      const targetTop = scrollParent.scrollTop + rangeRect.top - parentRect.top - scrollParent.clientHeight / 2;
      scrollParent.scrollTo({ top: Math.max(0, targetTop), behavior: "smooth" });
    } catch (_) {
      // Ignore if range is invalid
    }
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
    }));
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
});

const mapDispatchToProps = {
  showToast,
};

export default connect(mapStateToProps, mapDispatchToProps)(NetworkDetails);
