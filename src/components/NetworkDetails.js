// Copyright (c) 2019 SafetyCulture Pty Ltd. All Rights Reserved.

import React, { Component } from "react";
import ReactJson from "react-json-view";
import { connect } from "react-redux";
import { getNetworkEntry } from "../state/networkCache";
import UpDownIcon from "../icons/UpDown";
import SearchBar from "./SearchBar";
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
    // Search state
    searchActive: false,
    searchQuery: '',
    searchResults: [],
    currentMatchIndex: 0,
    // Store collapse state before search to restore it when search closes
    collapseStateBeforeSearch: null,
  };

  _searchDebounceTimer = null;

  componentDidMount() {
    // Use capture phase to intercept before DevTools' native search
    document.addEventListener('keydown', this._handleKeydown, true);
  }

  componentWillUnmount() {
    document.removeEventListener('keydown', this._handleKeydown, true);
    if (this._searchDebounceTimer) {
      clearTimeout(this._searchDebounceTimer);
    }
  }

  componentDidUpdate(prevProps) {
    const prevEntryId = prevProps.entry?.entryId ?? null;
    const nextEntryId = this.props.entry?.entryId ?? null;
    if (prevEntryId !== nextEntryId && this.state.lastEntryId !== nextEntryId) {
      // New entry selected - use defaultCollapsed preference from Redux
      const initialCollapsedState = this.props.defaultCollapsed ? 1 : false;

      // Clear search when switching entries
      this._clearHighlights();

      this.setState({
        jsonCollapsed: initialCollapsedState,
        lastEntryId: nextEntryId,
        isRendering: false,
        searchQuery: '',
        searchResults: [],
        currentMatchIndex: 0,
        // Reset collapse state tracking when entry changes
        collapseStateBeforeSearch: null,
      });

      // Schedule render on next frame to allow UI to update
      setTimeout(() => {
        this.setState({ isRendering: true });
      }, 0);
    }
  }

  render() {
    const { entry } = this.props;
    const { searchActive, searchQuery, searchResults, currentMatchIndex } = this.state;

    return (
      <div className="widget vbox details-container">
        {this._renderContent(entry)}
        {searchActive && (
          <SearchBar
            query={searchQuery}
            matchCount={searchResults.length}
            currentIndex={currentMatchIndex}
            onChange={this._onSearchQueryChange}
            onNext={this._navigateToNextMatch}
            onPrev={this._navigateToPrevMatch}
            onClose={this._closeSearch}
          />
        )}
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

  // Search functionality
  _handleKeydown = (e) => {
    const isCmdF = (e.metaKey || e.ctrlKey) && e.key === 'f';

    // Only activate if this component is rendered and has an entry
    if (isCmdF && this.props.entry) {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();

      // Save current collapse state and auto-expand JSON to make all content searchable
      this.setState({
        searchActive: true,
        collapseStateBeforeSearch: this.state.jsonCollapsed,
        jsonCollapsed: false, // Auto-expand all nodes
      });
      return false;
    }

    // Close search on Escape (if search is active)
    if (e.key === 'Escape' && this.state.searchActive) {
      e.preventDefault();
      e.stopPropagation();
      this._closeSearch();
    }
  };

  _onSearchQueryChange = (value) => {
    this.setState({ searchQuery: value }, () => {
      // Debounce search for performance
      if (this._searchDebounceTimer) {
        clearTimeout(this._searchDebounceTimer);
      }
      this._searchDebounceTimer = setTimeout(() => {
        this._performSearch(value);
      }, 150); // 150ms debounce
    });
  };

  _performSearch = (query) => {
    if (!query || query.trim() === '') {
      this._clearHighlights();
      this.setState({ searchResults: [], currentMatchIndex: 0 });
      return;
    }

    // Find all text nodes in the ReactJson rendered DOM
    const container = document.querySelector('.details-scroll-area');
    if (!container) return;

    const matches = [];
    const queryLower = query.toLowerCase();

    // Traverse all text nodes
    const walker = document.createTreeWalker(
      container,
      NodeFilter.SHOW_TEXT,
      null,
      false
    );

    let node;
    let index = 0;
    while ((node = walker.nextNode())) {
      const text = node.textContent.toLowerCase();
      if (text.includes(queryLower)) {
        matches.push({
          node: node,
          index: index++,
          parentElement: node.parentElement,
        });
      }
    }

    this.setState({
      searchResults: matches,
      currentMatchIndex: matches.length > 0 ? 0 : -1,
    }, () => {
      if (matches.length > 0) {
        this._highlightMatches();
        this._scrollToMatch(0);
      }
    });
  };

  _highlightMatches = () => {
    const { searchResults, currentMatchIndex } = this.state;

    // Clear previous highlights
    this._clearHighlights();

    if (searchResults.length === 0) return;

    searchResults.forEach((match, idx) => {
      const { parentElement } = match;

      // Add highlight class
      if (idx === currentMatchIndex) {
        parentElement.classList.add('search-match-active');
      } else {
        parentElement.classList.add('search-match');
      }
    });
  };

  _clearHighlights = () => {
    const container = document.querySelector('.details-scroll-area');
    if (!container) return;

    // Remove all highlight classes
    container.querySelectorAll('.search-match, .search-match-active').forEach(el => {
      el.classList.remove('search-match', 'search-match-active');
    });
  };

  _navigateToNextMatch = () => {
    const { searchResults, currentMatchIndex } = this.state;

    if (searchResults.length === 0) return;

    const nextIndex = (currentMatchIndex + 1) % searchResults.length;

    this.setState({ currentMatchIndex: nextIndex }, () => {
      this._highlightMatches();
      this._scrollToMatch(nextIndex);
    });
  };

  _navigateToPrevMatch = () => {
    const { searchResults, currentMatchIndex } = this.state;

    if (searchResults.length === 0) return;

    const prevIndex = currentMatchIndex === 0
      ? searchResults.length - 1
      : currentMatchIndex - 1;

    this.setState({ currentMatchIndex: prevIndex }, () => {
      this._highlightMatches();
      this._scrollToMatch(prevIndex);
    });
  };

  _scrollToMatch = (index) => {
    const { searchResults } = this.state;

    if (!searchResults[index]) return;

    const { parentElement } = searchResults[index];

    // Scroll to the element
    parentElement.scrollIntoView({
      behavior: 'smooth',
      block: 'center',
      inline: 'nearest'
    });
  };

  _closeSearch = () => {
    this._clearHighlights();

    this.setState((prevState) => ({
      searchActive: false,
      searchQuery: '',
      searchResults: [],
      currentMatchIndex: 0,
      // Restore previous collapse state
      jsonCollapsed: prevState.collapseStateBeforeSearch !== null
        ? prevState.collapseStateBeforeSearch
        : prevState.jsonCollapsed,
      collapseStateBeforeSearch: null,
    }));
  };
}

const mapStateToProps = (state) => ({
  entry: state.network.selectedEntry,
  defaultCollapsed: state.toolbar.defaultCollapsed,
});
export default connect(mapStateToProps)(NetworkDetails);
