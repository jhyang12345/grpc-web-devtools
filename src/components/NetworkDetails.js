// Copyright (c) 2019 SafetyCulture Pty Ltd. All Rights Reserved.

import React, { Component, PureComponent } from "react";
import ReactJson from "react-json-view";
import Split from "react-split";
import { connect } from "react-redux";
import { getNetworkEntry } from "../state/networkCache";
import { showToast } from "../state/toast";
import { sendReplayRequest, validateReplayRequest } from "../replayBridge";
import { getStorageItem, setStorageItem } from "../utils/localStorage";
import { writeTextToClipboard } from "../utils/clipboard";
import {
  buildDebugReport,
  formatDebugReportJson,
  formatDebugReportMarkdown,
} from "../utils/debugReport";
import { translate } from "../i18n";
import MethodHeader from "./MethodHeader";
import DebugReportCopy from "./DebugReportCopy";
import SearchBar from "./SearchBar";
import "./NetworkDetails.css";

// Isolated so it never re-renders when parent search state changes.
class ResponseJsonContent extends PureComponent {
  state = { source: null, hasError: false };

  static getDerivedStateFromProps({ responseSource }, state) {
    if (responseSource !== state.source) {
      return { source: responseSource, hasError: false };
    }
    return null;
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  render() {
    const { isRendering, responseSource, responseText, responseCollapsed, theme, locale = "en" } = this.props;
    if (!isRendering) {
      return <div className="payload-warning">{translate(locale, "details.loadingPayload")}</div>;
    }
    // Some valid JSON keys break the third-party tree renderer. Preserve the
    // complete payload as React text without taking down the rest of the panel.
    if (this.state.hasError) {
      return <pre className="response-json-fallback">{responseText}</pre>;
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
const REQUEST_EDITOR_PANE_SIZES = [70, 30];
const PANE_SIZE_STORAGE_KEY = "detailsPaneSizes";
const METADATA_EXPANDED_STORAGE_KEY = "detailsMetadataExpanded";

export function getRequestEditorPaneSizes(paneSizes) {
  if (!Array.isArray(paneSizes) || paneSizes.length !== 2) {
    return [...REQUEST_EDITOR_PANE_SIZES];
  }

  const requestSize = Number(paneSizes[0]);
  const responseSize = Number(paneSizes[1]);
  const totalSize = requestSize + responseSize;
  if (!Number.isFinite(requestSize) || !Number.isFinite(responseSize) || totalSize <= 0) {
    return [...REQUEST_EDITOR_PANE_SIZES];
  }

  if ((requestSize / totalSize) * 100 >= REQUEST_EDITOR_PANE_SIZES[0]) {
    return [...paneSizes];
  }

  return REQUEST_EDITOR_PANE_SIZES.map(size => (size / 100) * totalSize);
}

export function getBackendRequestUrl(entry) {
  const explicitUrl = typeof entry?.backendUrl === "string" ? entry.backendUrl.trim() : "";
  if (explicitUrl) return explicitUrl;

  const method = typeof entry?.method === "string" ? entry.method.trim() : "";
  return /^(https?:\/\/|\/)/i.test(method) ? method : "";
}

function formatBytes(value) {
  if (!Number.isFinite(value)) return "";
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function padTimePart(value, size = 2) {
  return String(value).padStart(size, "0");
}

export function formatTimestamp(timestamp) {
  if (!Number.isFinite(timestamp)) {
    return "";
  }

  const date = new Date(timestamp);
  return `${date.getFullYear()}-${padTimePart(date.getMonth() + 1)}-${padTimePart(date.getDate())} ${padTimePart(date.getHours())}:${padTimePart(date.getMinutes())}:${padTimePart(date.getSeconds())}.${padTimePart(date.getMilliseconds(), 3)}`;
}

export function formatDuration(duration) {
  if (!Number.isFinite(duration)) return "";
  const value = Math.max(0, duration);
  return value < 1000 ? `${Math.round(value)} ms` : `${(value / 1000).toFixed(2)} s`;
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

export function getJsonViewerTheme(matchesDarkMode) {
  return matchesDarkMode ? "twilight" : "rjv-default";
}

function getPreferredJsonViewerTheme() {
  const matchesDarkMode = typeof window !== "undefined"
    && typeof window.matchMedia === "function"
    && window.matchMedia("(prefers-color-scheme: dark)").matches;
  return getJsonViewerTheme(matchesDarkMode);
}

export function getReplayDisabledReason(entry, requestPayloadMissing, locale = "en") {
  if (requestPayloadMissing) return translate(locale, "replay.requestMissing");
  if (!entry?.request || entry.request.__truncated) return translate(locale, "replay.requestTruncated");
  if (!entry?.replay?.available) return entry?.replay?.reason || translate(locale, "replay.unavailable");
  if (!entry.replay.token) return translate(locale, "replay.handleMissing");
  if (!entry.captureId) return translate(locale, "replay.frameMissing");
  if (!entry.transport) return translate(locale, "replay.transportMissing");
  return null;
}

const REPLAY_VALIDATION_KEYS = {
  "Request body must be a JSON object.": "replay.jsonObject",
  "Request body could not be serialized.": "replay.serializeFailed",
  "Request body exceeds the 5 MiB replay limit.": "replay.sizeLimit",
};

const REPLAY_RUNTIME_KEYS = {
  "A valid originating frame is required for replay.": "replay.routeFrame",
  "A valid replay handle is required.": "replay.routeHandle",
  "A valid replay transport is required.": "replay.routeTransport",
  "Replay connection was replaced.": "replay.connectionReplaced",
  "Replay connection is unavailable.": "replay.connectionUnavailable",
  "Too many replay requests are awaiting acknowledgement.": "replay.tooManyPending",
  "Unable to allocate a replay attempt ID.": "replay.attemptId",
  "Replay acknowledgement timed out; the originating frame may no longer be available.": "replay.timeout",
  "Replay was rejected by the originating frame.": "replay.rejectedByFrame",
  "Replay connection was closed.": "replay.connectionClosed",
  "Replay connection was disconnected.": "replay.connectionDisconnected",
};

function localizeReplayValidationError(message, locale) {
  const key = REPLAY_VALIDATION_KEYS[message];
  return key ? translate(locale, key) : message;
}

function localizeReplayRuntimeError(message, locale) {
  const key = REPLAY_RUNTIME_KEYS[message];
  return key ? translate(locale, key) : message;
}

export function parseEditedRequest(text, locale = "en") {
  let request;
  try { request = JSON.parse(text); } catch (_) { return { error: translate(locale, "replay.invalidJson") }; }
  const validationError = validateReplayRequest(request);
  return validationError ? { error: localizeReplayValidationError(validationError, locale) } : { request };
}

export function formatEditedRequest(text, locale = "en") {
  const parsed = parseEditedRequest(text, locale);
  return parsed.error ? parsed : { request: parsed.request, text: JSON.stringify(parsed.request, null, 2) };
}

export function formatReplayProvenance(replayedFrom, locale = "en") {
  if (!replayedFrom?.transport || !Number.isFinite(replayedFrom.requestId)) {
    return translate(locale, "network.replayEarlier");
  }
  return translate(locale, "network.replayFrom", {
    transport: replayedFrom.transport,
    requestId: replayedFrom.requestId,
  });
}

export function buildResponseSource(response, error, messages, status, isMissingPayload, locale = "en") {
  if (isMissingPayload) {
    return {
      message: translate(locale, "details.fullResponseUnavailable"),
    };
  }

  if ((messages && messages.length) || (response != null && error != null) || status != null) {
    return {
      ...(messages && messages.length ? { messages } : {}),
      ...(response != null ? { response } : {}),
      ...(error != null ? { error } : {}),
      ...(status != null ? { status } : {}),
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
    message: translate(locale, "details.noResponse"),
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

export class NetworkDetails extends Component {
  requestPaneRef = React.createRef();

  requestEditorRef = React.createRef();

  requestEditorInputRef = React.createRef();

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
    isEditingRequest: false,
    requestEditorError: null,
    isReplaySending: false,
    isMetadataExpanded: getStorageItem(METADATA_EXPANDED_STORAGE_KEY, true) !== false,
    jsonViewerTheme: getPreferredJsonViewerTheme(),
  };

  _isReplaySubmitting = false;

  _replayGeneration = 0;

  _activeReplaySubmission = null;

  _paneSizesBeforeRequestEdit = null;

  _isMounted = false;

  _requestSearchMatches = [];

  _responseSearchMatches = [];

  _requestSearchDebounceTimer = null;

  _responseSearchDebounceTimer = null;

  componentDidMount() {
    this._isMounted = true;
    document.addEventListener("keydown", this._handleKeydown, true);
    if (typeof window.matchMedia === "function") {
      this._themeMediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
      if (typeof this._themeMediaQuery.addEventListener === "function") {
        this._themeMediaQuery.addEventListener("change", this._handleThemeChange);
      } else if (typeof this._themeMediaQuery.addListener === "function") {
        this._themeMediaQuery.addListener(this._handleThemeChange);
      }
    }

    // componentDidUpdate doesn't fire on initial mount. If the component mounts with an entry
    // already selected (MainLayout only renders us when hasSelectedEntry=true), we need to
    // kick off the isRendering transition here — otherwise isRendering stays false forever.
    const nextEntryId = this.props.entry?.entryId ?? null;
    if (nextEntryId !== null) {
      const { cachedEntry, entryToRender } = getRenderableEntry(this.props.entry);
      const requestPayloadMissing = !!this.props.entry?.entryId && !cachedEntry && this.props.entry.request === true;
      this._currentRequestText = requestPayloadMissing ? "" : stringifyJson(entryToRender?.request);
      this.setState({ lastEntryId: nextEntryId });
      setTimeout(() => {
        this._safeSetState({ isRendering: true });
      }, 0);
    }
  }

  componentWillUnmount() {
    this._isMounted = false;
    this._invalidateReplaySubmission();
    document.removeEventListener("keydown", this._handleKeydown, true);
    if (this._themeMediaQuery) {
      if (typeof this._themeMediaQuery.removeEventListener === "function") {
        this._themeMediaQuery.removeEventListener("change", this._handleThemeChange);
      } else if (typeof this._themeMediaQuery.removeListener === "function") {
        this._themeMediaQuery.removeListener(this._handleThemeChange);
      }
      this._themeMediaQuery = null;
    }
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
      this._invalidateReplaySubmission();
      const paneSizes = this._paneSizesBeforeRequestEdit || this.state.paneSizes;
      this._paneSizesBeforeRequestEdit = null;
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
        isEditingRequest: false,
        requestEditorError: null,
        isReplaySending: false,
        paneSizes,
      });
      setTimeout(() => {
        this._safeSetState({ isRendering: true });
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
    if (!entry) {
      return null;
    }

    const { cachedEntry, entryToRender } = getRenderableEntry(entry);
    const {
      response,
      error,
      messages,
      status,
    } = entryToRender;

    const requestPayloadMissing = !!entry.entryId && !cachedEntry && entry.request === true;
    const responsePayloadMissing = !!entry.entryId && !cachedEntry && (entry.response === true || entry.error === true || entry.messages === true || entry.status === true);
    const requestText = requestPayloadMissing ? "" : stringifyJson(entryToRender?.request);
    const { locale = "en" } = this.props;
    const responseSource = buildResponseSource(response, error, messages, status, responsePayloadMissing, locale);
    const hasResponsePayload = !responsePayloadMissing && (response != null || error != null || messages?.length || status != null);
    const responseText = stringifyJson(responseSource);

    return (
      <>
        <MethodHeader method={entryToRender?.method || entry.method}>
          <DebugReportCopy
            locale={locale}
            onCopy={format => this._copyDebugReport(format, entryToRender, {
              requestPayloadMissing,
              responsePayloadMissing,
            })}
          />
        </MethodHeader>
        <div className="details-main">
          <Split
            className="details-pane-split vbox flex-auto"
            direction="vertical"
            sizes={this.state.paneSizes}
            minSize={this.state.isEditingRequest ? [240, 160] : [180, 220]}
            gutterSize={6}
            onDragEnd={this._onPaneResize}
          >
            {this._renderRequestPane(requestText, requestPayloadMissing, entryToRender)}
            {this._renderResponsePane(
              responseSource,
              responseText,
              responsePayloadMissing,
              !!response?.__truncated || !!error?.__truncated,
              hasResponsePayload
            )}
          </Split>
        </div>
        {this._renderMetadata(entryToRender)}
      </>
    );
  };

  _renderMetadata = (entry) => {
    const { isMetadataExpanded } = this.state;
    const { locale = "en" } = this.props;
    const {
      timing,
      payloadBytes,
      transport,
      status,
      location: requestLocation,
    } = entry;
    const backendUrl = getBackendRequestUrl(entry);

    return (
      <section className={`payload-metadata ${isMetadataExpanded ? "is-expanded" : "is-collapsed"}`}>
        <button
          className="payload-metadata-toggle"
          type="button"
          aria-expanded={isMetadataExpanded}
          aria-controls="request-metadata-content"
          onClick={this._toggleMetadata}
          title={isMetadataExpanded
            ? translate(locale, "details.hideMetadataTitle")
            : translate(locale, "details.showMetadataTitle")}
        >
          <span className="payload-metadata-toggle-label">
            <span className="payload-metadata-chevron" aria-hidden="true">{isMetadataExpanded ? "▾" : "▸"}</span>
            <span>{translate(locale, "details.metadata")}</span>
          </span>
          <span className="payload-metadata-toggle-hint">
            {isMetadataExpanded ? translate(locale, "details.hide") : translate(locale, "details.showDetails")}
          </span>
        </button>
        {isMetadataExpanded && (
          <div className="payload-metadata-content" id="request-metadata-content">
            <div className="payload-metadata-row payload-metadata-row--url">
              <span>{translate(locale, "details.frameUrl")}</span>
              <span title={requestLocation}>{requestLocation || translate(locale, "details.frameUrlMissing")}</span>
            </div>
            <div className="payload-metadata-row payload-metadata-row--url">
              <span>{translate(locale, "details.backendUrl")}</span>
              <span title={backendUrl}>{backendUrl || translate(locale, "details.backendUrlMissing")}</span>
            </div>
            {timing?.requestTimestamp != null && (
              <div className="payload-metadata-row">
                <span>{translate(locale, "details.started")}</span>
                <span title={formatTimestamp(timing.requestTimestamp)}>{formatTimestamp(timing.requestTimestamp)}</span>
              </div>
            )}
            <div className="payload-metadata-row">
              <span>{translate(locale, "details.completed")}</span>
              <span>{timing?.completionTimestamp != null
                ? formatTimestamp(timing.completionTimestamp)
                : translate(locale, "network.pending")}</span>
            </div>
            {timing?.duration != null && (
              <div className="payload-metadata-row">
                <span>{translate(locale, "details.duration")}</span>
                <span>{formatDuration(timing.duration)}</span>
              </div>
            )}
            {timing?.timeToFirstMessage != null && (
              <div className="payload-metadata-row">
                <span>{translate(locale, "details.ttfm")}</span>
                <span>{formatDuration(timing.timeToFirstMessage)}</span>
              </div>
            )}
            {(entry.messageCount != null || timing?.messageCount != null) && (
              <div className="payload-metadata-row">
                <span>{translate(locale, "details.messages")}</span>
                <span>{entry.messageCount || timing.messageCount}{entry.droppedMessageCount
                  ? ` (${translate(locale, "details.olderMessagesDropped", { count: entry.droppedMessageCount })})`
                  : ""}</span>
              </div>
            )}
            {status != null && (
              <div className="payload-metadata-row">
                <span>{translate(locale, "details.status")}</span>
                <span>{status.code != null ? `${status.code}${status.details ? `: ${status.details}` : ""}` : JSON.stringify(status)}</span>
              </div>
            )}
            {transport && (
              <div className="payload-metadata-row">
                <span>{translate(locale, "details.transport")}</span>
                <span>{transport}</span>
              </div>
            )}
            {entry.replayedFrom && (
              <div className="payload-metadata-row replay-provenance">
                <span>{translate(locale, "details.replay")}</span>
                <span>{formatReplayProvenance(entry.replayedFrom, locale)}</span>
              </div>
            )}
            <div className="payload-metadata-row">
              <span>{translate(locale, "details.payloadSize")}</span>
              <span>{payloadBytes ? formatBytes(payloadBytes) : translate(locale, "details.unknown")}</span>
            </div>
          </div>
        )}
      </section>
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

  _renderRequestPane(requestText, requestPayloadMissing, entryToRender) {
    const { requestSearch, isEditingRequest, requestEditorError, isReplaySending } = this.state;
    const { locale = "en" } = this.props;
    const replayDisabledReason = getReplayDisabledReason(entryToRender, requestPayloadMissing, locale);
    const canCopyRequest = !requestPayloadMissing && !!requestText;
    const canSearchRequest = !isEditingRequest && !!requestText;
    this._activeRequestText = requestText;
    this._activeReplayEntry = entryToRender;

    return (
      <div className={`details-pane request-pane ${isEditingRequest ? "is-editing" : ""}`} ref={this.requestPaneRef}>
        <div className="details-pane-header">
          <div className="details-pane-title-group">
            <div className="details-pane-title">
              {isEditingRequest ? translate(locale, "details.editRequest") : translate(locale, "details.request")}
            </div>
            <div
              className="details-pane-subtitle"
              title={isEditingRequest ? translate(locale, "details.reviewJson") : undefined}
            >
              {isEditingRequest
                ? translate(locale, "details.reviewJson")
                : translate(locale, "details.capturedRequest")}
            </div>
          </div>
          <div
            className={`details-pane-actions ${isEditingRequest ? "replay-editor-actions" : ""}`}
            role={isEditingRequest ? "toolbar" : undefined}
            aria-label={isEditingRequest ? translate(locale, "details.requestEditorActions") : undefined}
          >
            {isEditingRequest ? (
              <>
                <button className="json-action-button" type="button" onClick={this._formatRequestEditor} disabled={isReplaySending}>{translate(locale, "details.format")}</button>
                <button className="json-action-button" type="button" onClick={this._resetRequestEditor} disabled={isReplaySending}>{translate(locale, "details.reset")}</button>
                <button className="json-action-button" type="button" onClick={this._cancelRequestEditor} disabled={isReplaySending}>{translate(locale, "details.cancel")}</button>
                <button className="json-action-button replay-send-button" type="button" onClick={this._sendEditedRequest} disabled={isReplaySending}>
                  {isReplaySending ? translate(locale, "details.sending") : translate(locale, "details.sendRequest")}
                </button>
              </>
            ) : (
              <>
                <button
                  className="json-action-button"
                  type="button"
                  onClick={() => this._copyText("request", requestText)}
                  disabled={!canCopyRequest}
                >
                  {translate(locale, "details.copy")}
                </button>
                <button
                  className={`json-action-button ${requestSearch.isOpen ? "is-active" : ""}`}
                  type="button"
                  onClick={() => this._openRequestSearch()}
                  disabled={!canSearchRequest}
                >
                  {translate(locale, "details.search")}
                </button>
                <button
                  className="json-action-button replay-edit-button"
                  type="button"
                  title={replayDisabledReason || translate(locale, "details.editReplayTitle")}
                  onClick={this._openRequestEditor}
                  disabled={!!replayDisabledReason}
                >
                  {translate(locale, "details.edit")}
                </button>
              </>
            )}
          </div>
        </div>
        {requestSearch.isOpen && !isEditingRequest && (
          <SearchBar
            compact
            locale={locale}
            placeholder={translate(locale, "search.requestPlaceholder")}
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
            {translate(locale, "details.requestEvicted")}
          </div>
        )}
        <div className={`details-pane-body request-pane-body ${isEditingRequest ? "is-editing" : ""}`}>
          {/* Plain text only — highlights applied via CSS Highlight API, no React re-renders */}
          {isEditingRequest ? (
            <div className="replay-editor-shell">
              <div className="replay-safety-note" role="note">{translate(locale, "details.replaySafety")}</div>
              <textarea ref={this.requestEditorInputRef} className="request-editor-input" aria-label={translate(locale, "details.editableRequestJson")}
                aria-describedby={requestEditorError ? "request-editor-error" : undefined} defaultValue={requestText} spellCheck="false" />
              {requestEditorError && <div id="request-editor-error" className="payload-warning pane-error" role="alert">{requestEditorError}</div>}
            </div>
          ) : (
            <pre ref={this.requestEditorRef} className="request-viewer">
              {requestText || <span className="request-viewer-placeholder">{translate(locale, "details.noRequest")}</span>}
            </pre>
          )}
        </div>
      </div>
    );
  }

  _renderResponsePane(responseSource, responseText, responsePayloadMissing, isResponseTruncated, hasResponsePayload) {
    const { responseSearch, responseCollapsed, isRendering, jsonViewerTheme } = this.state;
    const { locale = "en" } = this.props;
    const canCopyResponse = hasResponsePayload && !!responseText;
    const canSearchResponse = hasResponsePayload && !!responseText;
    const expandLabel = responseCollapsed === false
      ? translate(locale, "details.collapse")
      : translate(locale, "details.expand");

    return (
      <div className="details-pane response-pane" ref={this.responsePaneRef}>
        <div className="details-pane-header">
          <div className="details-pane-title-group">
            <div className="details-pane-title">{translate(locale, "details.response")}</div>
            <div className="details-pane-subtitle">{translate(locale, "details.capturedResponse")}</div>
          </div>
          <div className="details-pane-actions">
            <button
              className="json-action-button"
              type="button"
              onClick={() => this._copyText("response", responseText)}
              disabled={!canCopyResponse}
            >
              {translate(locale, "details.copy")}
            </button>
            <button
              className={`json-action-button ${responseSearch.isOpen ? "is-active" : ""}`}
              type="button"
              onClick={() => this._openResponseSearch()}
              disabled={!canSearchResponse}
            >
              {translate(locale, "details.search")}
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
            locale={locale}
            placeholder={translate(locale, "search.responsePlaceholder")}
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
            {translate(locale, "details.responseEvicted")}
          </div>
        )}
        {!responsePayloadMissing && isResponseTruncated && (
          <div className="payload-warning pane-warning">
            {translate(locale, "details.responseTruncated")}
          </div>
        )}
        <div className="details-pane-body details-pane-json" ref={this.responseBodyRef}>
          <ResponseJsonContent
            isRendering={isRendering}
            responseSource={responseSource}
            responseText={responseText}
            responseCollapsed={responseCollapsed}
            theme={jsonViewerTheme}
            locale={locale}
          />
        </div>
      </div>
    );
  }

  _onPaneResize = (sizes) => {
    this._paneSizesBeforeRequestEdit = null;
    this.setState({ paneSizes: sizes });
    setStorageItem(PANE_SIZE_STORAGE_KEY, sizes);
  };

  _toggleResponseCollapse = () => {
    this.setState((prevState) => ({
      responseCollapsed: prevState.responseCollapsed === false ? 1 : false,
    }));
  };

  _toggleMetadata = () => {
    const isMetadataExpanded = !this.state.isMetadataExpanded;
    this.setState({ isMetadataExpanded });
    setStorageItem(METADATA_EXPANDED_STORAGE_KEY, isMetadataExpanded);
  };

  _handleKeydown = (event) => {
    const isCmdF = (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "f";

    if (event.key === "Escape" && this.state.isEditingRequest) {
      event.preventDefault();
      this._cancelRequestEditor();
      return;
    }

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

    if (isInRequestPane && this.state.isEditingRequest) return;

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

  _copyDebugReport = async (format, entry, payloadState) => {
    const kind = format === "json" ? "jsonReport" : "markdownReport";
    try {
      const report = buildDebugReport(entry, payloadState);
      const text = format === "json"
        ? formatDebugReportJson(report)
        : formatDebugReportMarkdown(report);
      await this._copyText(kind, text);
    } catch (_) {
      this._showCopyFailure(kind);
    }
  };

  _getCopyLabel = kind => translate(this.props.locale || "en", `copy.${kind}Label`);

  _showCopyFailure = kind => {
    const locale = this.props.locale || "en";
    this.props.showToast({
      message: translate(locale, "copy.failure", { label: this._getCopyLabel(kind) }),
      type: "error",
      autoDismiss: 4000,
    });
  };

  async _copyText(kind, text) {
    if (!text) {
      return;
    }

    try {
      await writeTextToClipboard(text);

      const { locale = "en" } = this.props;
      this.props.showToast({
        message: translate(locale, "copy.success", { label: this._getCopyLabel(kind) }),
        type: "success",
        autoDismiss: 2000,
      });
    } catch (error) {
      this._showCopyFailure(kind);
    }
  }

  _showReplayError = (message) => {
    this._safeSetState({ requestEditorError: message });
    this.props.showToast({ message, type: "error", autoDismiss: 4000 });
  };

  _handleThemeChange = (event) => {
    this._safeSetState({ jsonViewerTheme: getJsonViewerTheme(event.matches) });
  };

  _safeSetState = (nextState, callback) => {
    if (this._isMounted) this.setState(nextState, callback);
  };

  _invalidateReplaySubmission = () => {
    this._replayGeneration += 1;
    this._activeReplaySubmission = null;
    this._isReplaySubmitting = false;
  };

  _isCurrentReplaySubmission = (submission) => (
    this._isMounted && this._activeReplaySubmission === submission
  );

  _openRequestEditor = () => {
    if (this.state.isEditingRequest) return;
    this._closeRequestSearch();
    this._paneSizesBeforeRequestEdit = this.state.paneSizes;
    this._safeSetState({
      isEditingRequest: true,
      requestEditorError: null,
      paneSizes: getRequestEditorPaneSizes(this.state.paneSizes),
    }, () => {
      this.requestEditorInputRef.current?.focus();
    });
  };

  _cancelRequestEditor = () => {
    if (this.state.isReplaySending) return;
    this._clearRequestHighlights();
    const paneSizes = this._paneSizesBeforeRequestEdit;
    this._paneSizesBeforeRequestEdit = null;
    this._safeSetState({
      isEditingRequest: false,
      requestEditorError: null,
      ...(paneSizes ? { paneSizes } : {}),
    });
  };

  _resetRequestEditor = () => {
    if (this.requestEditorInputRef.current) this.requestEditorInputRef.current.value = this._activeRequestText || "";
    this._safeSetState({ requestEditorError: null });
    this.requestEditorInputRef.current?.focus();
  };

  _formatRequestEditor = () => {
    const editor = this.requestEditorInputRef.current;
    const formatted = formatEditedRequest(editor?.value || "", this.props.locale || "en");
    if (formatted.error) {
      this._showReplayError(formatted.error);
      return;
    }
    editor.value = formatted.text;
    this._safeSetState({ requestEditorError: null });
  };

  _sendEditedRequest = async () => {
    if (this._isReplaySubmitting || this.state.isReplaySending) return;
    const locale = this.props.locale || "en";
    const parsed = parseEditedRequest(this.requestEditorInputRef.current?.value || "", locale);
    if (parsed.error) {
      this._showReplayError(parsed.error);
      return;
    }
    const entry = this._activeReplayEntry;
    const replayDisabledReason = getReplayDisabledReason(entry, false, locale);
    if (replayDisabledReason) {
      this._showReplayError(replayDisabledReason);
      return;
    }
    const submission = { generation: ++this._replayGeneration, entryId: entry.entryId };
    this._activeReplaySubmission = submission;
    this._isReplaySubmitting = true;
    this._safeSetState({ isReplaySending: true, requestEditorError: null });
    try {
      await sendReplayRequest({
        captureId: entry.captureId,
        replayToken: entry.replay.token,
        sourceEntryId: entry.entryId,
        transport: entry.transport,
        request: parsed.request,
      });
      if (this._isCurrentReplaySubmission(submission)) {
        this.props.showToast({ message: translate(locale, "replay.accepted"), type: "info", autoDismiss: 3500 });
      }
    } catch (error) {
      if (this._isCurrentReplaySubmission(submission)) {
        const message = error?.message
          ? localizeReplayRuntimeError(error.message, locale)
          : translate(locale, "replay.notAccepted");
        this._safeSetState({ requestEditorError: message });
        this.props.showToast({ message, type: "error", autoDismiss: 4000 });
      }
    } finally {
      if (this._isCurrentReplaySubmission(submission)) {
        this._activeReplaySubmission = null;
        this._isReplaySubmitting = false;
        this._safeSetState({ isReplaySending: false });
      }
    }
  };

  _openRequestSearch = () => {
    if (this.state.isEditingRequest) return;
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
