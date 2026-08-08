/* global chrome */

// Copyright (c) 2019 SafetyCulture Pty Ltd. All Rights Reserved.

// Translator guidance: keep every token in this list exactly as written in
// Korean copy. Translate only the surrounding explanation or action.
export const PROTECTED_ENGLISH_TERMS = [
  'gRPC', 'gRPC-Web', 'Connect-Web', 'RPC', 'DevTools',
  'Request', 'Response', 'Replay', 'Metadata', 'Method', 'Transport',
  'Status', 'Payload', 'Stream', 'Error', 'JSON', 'Markdown', 'HTTP',
  'URL', 'Frame URL', 'Backend URL', 'TTFM', 'Debug Report', 'Log', 'Filter',
  'Content Script', 'Cache', 'Clipboard',
];

export const KOREAN_TECHNICAL_TERMS = Object.freeze(
  PROTECTED_ENGLISH_TERMS.reduce((terms, term) => ({ ...terms, [term]: term }), {})
);

export const LANGUAGE_PREFERENCES = ['auto', 'en', 'ko'];

export const MESSAGES = {
  en: {
    'app.title': 'gRPC-Web Dev Tools',

    'toolbar.clearLogTitle': 'Clear log history',
    'toolbar.filterTitle': 'Filter',
    'toolbar.preserveLogTitle': 'Do not clear log on page reload / navigation',
    'toolbar.preserveLog': 'Preserve log',
    'toolbar.collapsedTitle': 'Collapse JSON details by default when selecting entries',
    'toolbar.collapsed': 'Collapsed',
    'toolbar.connectedTitle': 'DevTools connected',
    'toolbar.pendingTitle': 'Waiting for Content Script registration; automatic recovery is active',
    'toolbar.disconnectedTitle': 'DevTools connection lost; automatic recovery is active',
    'toolbar.connected': 'Connected',
    'toolbar.connecting': 'Connecting...',
    'toolbar.disconnected': 'Disconnected',
    'toolbar.reconnectTitle': 'Restart the automatic connection recovery now',
    'toolbar.reconnect': 'Reconnect',
    'toolbar.settingsTitle': 'Settings',
    'settings.language': 'Language',
    'settings.auto': 'Auto (browser)',
    'settings.english': 'English',
    'settings.korean': '한국어',
    'settings.close': 'Close settings',

    'network.filterPlaceholder': 'Filter',
    'network.capturedRequests': 'Captured requests',
    'network.frameUrlUnavailable': 'Frame URL unavailable',
    'network.replayEarlier': 'Retry of an earlier request',
    'network.replayFrom': 'Retry of {transport} request {requestId}',
    'network.waitingTiming': 'Waiting for timing...',
    'network.editedReplayTiming': 'Edited replay | {timing}',
    'network.pending': 'Pending',
    'network.edited': 'Edited',
    'network.filteredEmptyTitle': 'No requests match the current filter.',
    'network.filteredEmptyDetailValue': 'Update or clear "{filterValue}" to show captured requests again.',
    'network.filteredEmptyDetail': 'Update or clear the current filter to show captured requests again.',
    'network.noSelectionTitle': 'Select a request to inspect, edit, or replay it.',
    'network.noSelectionDetail': 'Choose a captured request from the list to inspect its details or edit its JSON before replaying it.',
    'network.emptyTitle': 'Inspecting gRPC network activity...',
    'network.emptyDetail': 'Perform a request or reload with {modifier} R to capture it, then select it to inspect or replay it.',
    'network.setupGuide': 'Set up your web application',

    'search.defaultPlaceholder': 'Search JSON',
    'search.previousTitle': 'Previous match',
    'search.previous': 'Prev',
    'search.nextTitle': 'Next match',
    'search.next': 'Next',
    'search.closeTitle': 'Close search',
    'search.close': 'Close',
    'search.requestPlaceholder': 'Search request',
    'search.responsePlaceholder': 'Search response',

    'details.loadingPayload': 'Loading payload...',
    'details.fullResponseUnavailable': 'Full response payload is no longer available.',
    'details.noResponse': 'No response captured.',
    'details.metadata': 'Metadata',
    'details.hideMetadataTitle': 'Hide metadata details',
    'details.showMetadataTitle': 'Show metadata details',
    'details.hide': 'Hide',
    'details.showDetails': 'Show details',
    'details.frameUrl': 'Frame URL',
    'details.frameUrlMissing': '(not captured — reload page)',
    'details.backendUrl': 'Backend URL',
    'details.backendUrlMissing': 'Not available for this capture',
    'details.started': 'Started',
    'details.completed': 'Completed',
    'details.duration': 'Duration',
    'details.ttfm': 'TTFM',
    'details.messages': 'Stream messages',
    'details.olderMessagesDropped': '{count} older messages dropped',
    'details.status': 'Status',
    'details.transport': 'Transport',
    'details.replay': 'Replay',
    'details.payloadSize': 'Payload size (approx)',
    'details.unknown': 'Unknown',
    'details.request': 'Request',
    'details.editRequest': 'Edit request',
    'details.reviewJson': 'Review JSON before replay',
    'details.capturedRequest': 'Captured request payload',
    'details.requestEditorActions': 'Request editor actions',
    'details.format': 'Format',
    'details.reset': 'Reset',
    'details.cancel': 'Cancel',
    'details.sending': 'Sending...',
    'details.sendRequest': 'Send request',
    'details.copy': 'Copy',
    'details.search': 'Search',
    'details.edit': 'Edit',
    'details.editReplayTitle': 'Edit this captured request before sending a real backend replay.',
    'details.requestEvicted': 'Full request payload is no longer available (evicted from cache).',
    'details.replaySafety': 'Sends a real backend request and may reuse captured auth and metadata.',
    'details.editableRequestJson': 'Editable request JSON',
    'details.noRequest': 'No request payload captured.',
    'details.response': 'Response',
    'details.capturedResponse': 'Captured response payload',
    'details.collapse': 'Collapse',
    'details.expand': 'Expand',
    'details.responseEvicted': 'Full response payload is no longer available (evicted from cache).',
    'details.responseTruncated': 'Response payload was truncated in cache.',

    'copy.requestLabel': 'Request',
    'copy.responseLabel': 'Response',
    'copy.success': '{label} copied to clipboard',
    'copy.failure': 'Failed to copy {label}',
    'copy.report': 'Copy report',
    'copy.reportAria': 'Copy Debug Report',
    'copy.chooseFormat': 'Choose Debug Report format',
    'copy.asMarkdown': 'Copy as Markdown',
    'copy.asJson': 'Copy as JSON',
    'copy.reportSensitiveWarning': 'Includes captured URLs and Payload without redaction.',
    'copy.markdownReportLabel': 'Markdown Debug Report',
    'copy.jsonReportLabel': 'JSON Debug Report',

    'replay.requestMissing': 'Full request payload is no longer available.',
    'replay.requestTruncated': 'This request payload was truncated and cannot be replayed.',
    'replay.unavailable': 'Replay is unavailable for this captured request.',
    'replay.handleMissing': 'This replay handle is no longer available.',
    'replay.frameMissing': 'The originating frame is not available for replay.',
    'replay.transportMissing': 'The captured transport is not available for replay.',
    'replay.invalidJson': 'Request body must contain valid JSON.',
    'replay.jsonObject': 'Request body must be a JSON object.',
    'replay.serializeFailed': 'Request body could not be serialized.',
    'replay.sizeLimit': 'Request body exceeds the 5 MiB replay limit.',
    'replay.accepted': 'Replay accepted; watch the new request entry',
    'replay.notAccepted': 'Replay request was not accepted.',
    'replay.routeFrame': 'A valid originating frame is required for replay.',
    'replay.routeHandle': 'A valid replay handle is required.',
    'replay.routeTransport': 'A valid replay transport is required.',
    'replay.connectionReplaced': 'Replay connection was replaced.',
    'replay.connectionUnavailable': 'Replay connection is unavailable.',
    'replay.tooManyPending': 'Too many replay requests are awaiting acknowledgement.',
    'replay.attemptId': 'Unable to allocate a replay attempt ID.',
    'replay.timeout': 'Replay acknowledgement timed out; the originating frame may no longer be available.',
    'replay.rejectedByFrame': 'Replay was rejected by the originating frame.',
    'replay.connectionClosed': 'Replay connection was closed.',
    'replay.connectionDisconnected': 'Replay connection was disconnected.',

    'error.title': 'Something went wrong.',
    'error.detail': 'The application crashed while rendering. This might be due to a very large or malformed gRPC packet.',
    'error.recover': 'Clear Logs & Recover',
  },
  ko: {
    'app.title': 'gRPC-Web Dev Tools',

    'toolbar.clearLogTitle': 'Log 기록 지우기',
    'toolbar.filterTitle': 'Filter',
    'toolbar.preserveLogTitle': '페이지 새로고침/이동 시 Log를 지우지 않습니다',
    'toolbar.preserveLog': 'Log 유지',
    'toolbar.collapsedTitle': '항목 선택 시 JSON 세부 내용을 기본으로 접습니다',
    'toolbar.collapsed': '기본 접기',
    'toolbar.connectedTitle': 'DevTools 연결됨',
    'toolbar.pendingTitle': 'Content Script 등록 대기 중; 자동 복구가 활성화되어 있습니다',
    'toolbar.disconnectedTitle': 'DevTools 연결 끊김; 자동 복구가 활성화되어 있습니다',
    'toolbar.connected': '연결됨',
    'toolbar.connecting': '연결 중...',
    'toolbar.disconnected': '연결 끊김',
    'toolbar.reconnectTitle': '자동 연결 복구를 지금 다시 시작합니다',
    'toolbar.reconnect': '다시 연결',
    'toolbar.settingsTitle': '설정',
    'settings.language': '언어',
    'settings.auto': '자동 (브라우저)',
    'settings.english': 'English',
    'settings.korean': '한국어',
    'settings.close': '설정 닫기',

    'network.filterPlaceholder': 'Filter',
    'network.capturedRequests': '캡처된 Request 목록',
    'network.frameUrlUnavailable': 'Frame URL을 사용할 수 없음',
    'network.replayEarlier': '이전 Request의 Replay',
    'network.replayFrom': '{transport} Request {requestId}의 Replay',
    'network.waitingTiming': '타이밍 대기 중...',
    'network.editedReplayTiming': '편집된 Replay | {timing}',
    'network.pending': '대기 중',
    'network.edited': '편집됨',
    'network.filteredEmptyTitle': '현재 Filter와 일치하는 Request가 없습니다.',
    'network.filteredEmptyDetailValue': '"{filterValue}"을(를) 수정하거나 지워 캡처된 Request를 다시 표시하세요.',
    'network.filteredEmptyDetail': '현재 Filter를 수정하거나 지워 캡처된 Request를 다시 표시하세요.',
    'network.noSelectionTitle': '확인, 편집 또는 Replay할 Request를 선택하세요.',
    'network.noSelectionDetail': '목록에서 캡처된 Request를 선택해 세부 내용을 확인하거나 Replay 전 JSON을 편집하세요.',
    'network.emptyTitle': 'gRPC 네트워크 활동 확인 중...',
    'network.emptyDetail': 'Request를 실행하거나 {modifier} R로 새로고침해 캡처한 다음, 선택해 확인하거나 Replay하세요.',
    'network.setupGuide': '웹 애플리케이션 설정하기',

    'search.defaultPlaceholder': 'JSON 검색',
    'search.previousTitle': '이전 일치',
    'search.previous': '이전',
    'search.nextTitle': '다음 일치',
    'search.next': '다음',
    'search.closeTitle': '검색 닫기',
    'search.close': '닫기',
    'search.requestPlaceholder': 'Request 검색',
    'search.responsePlaceholder': 'Response 검색',

    'details.loadingPayload': 'Payload 로드 중...',
    'details.fullResponseUnavailable': '전체 Response Payload을 더 이상 사용할 수 없습니다.',
    'details.noResponse': '캡처된 Response가 없습니다.',
    'details.metadata': 'Metadata',
    'details.hideMetadataTitle': 'Metadata 세부 내용 숨기기',
    'details.showMetadataTitle': 'Metadata 세부 내용 표시하기',
    'details.hide': '숨기기',
    'details.showDetails': '세부 내용 표시',
    'details.frameUrl': 'Frame URL',
    'details.frameUrlMissing': '(캡처되지 않음 — 페이지를 새로고침하세요)',
    'details.backendUrl': 'Backend URL',
    'details.backendUrlMissing': '이 캡처에서 사용할 수 없음',
    'details.started': '시작',
    'details.completed': '완료',
    'details.duration': '소요 시간',
    'details.ttfm': 'TTFM',
    'details.messages': 'Stream 메시지',
    'details.olderMessagesDropped': '이전 Stream 메시지 {count}개 제외됨',
    'details.status': 'Status',
    'details.transport': 'Transport',
    'details.replay': 'Replay',
    'details.payloadSize': 'Payload 크기 (추정)',
    'details.unknown': '알 수 없음',
    'details.request': 'Request',
    'details.editRequest': 'Request 편집',
    'details.reviewJson': 'Replay 전 JSON 검토',
    'details.capturedRequest': '캡처된 Request Payload',
    'details.requestEditorActions': 'Request 편집 작업',
    'details.format': '포맷',
    'details.reset': '초기화',
    'details.cancel': '취소',
    'details.sending': '전송 중...',
    'details.sendRequest': 'Request 보내기',
    'details.copy': '복사',
    'details.search': '검색',
    'details.edit': '편집',
    'details.editReplayTitle': '실제 백엔드 Replay를 보내기 전에 캡처된 Request를 편집합니다.',
    'details.requestEvicted': '전체 Request Payload을 더 이상 사용할 수 없습니다(Cache에서 제거됨).',
    'details.replaySafety': '실제 백엔드 Request를 보내며 캡처된 인증 정보와 Metadata를 재사용할 수 있습니다.',
    'details.editableRequestJson': '편집 가능한 Request JSON',
    'details.noRequest': '캡처된 Request Payload가 없습니다.',
    'details.response': 'Response',
    'details.capturedResponse': '캡처된 Response Payload',
    'details.collapse': '접기',
    'details.expand': '펼치기',
    'details.responseEvicted': '전체 Response Payload을 더 이상 사용할 수 없습니다(Cache에서 제거됨).',
    'details.responseTruncated': 'Response Payload가 Cache에서 잘렸습니다.',

    'copy.requestLabel': 'Request',
    'copy.responseLabel': 'Response',
    'copy.success': '{label}을(를) Clipboard에 복사했습니다',
    'copy.failure': '{label} 복사에 실패했습니다',
    'copy.report': 'Debug Report 복사',
    'copy.reportAria': 'Debug Report 복사',
    'copy.chooseFormat': 'Debug Report 형식 선택',
    'copy.asMarkdown': 'Markdown으로 복사',
    'copy.asJson': 'JSON으로 복사',
    'copy.reportSensitiveWarning': '캡처된 URL과 Payload를 마스킹 없이 포함합니다.',
    'copy.markdownReportLabel': 'Markdown Debug Report',
    'copy.jsonReportLabel': 'JSON Debug Report',

    'replay.requestMissing': '전체 Request Payload을 더 이상 사용할 수 없습니다.',
    'replay.requestTruncated': '이 Request Payload는 잘려서 Replay할 수 없습니다.',
    'replay.unavailable': '이 캡처 Request는 Replay할 수 없습니다.',
    'replay.handleMissing': '이 Replay 핸들을 더 이상 사용할 수 없습니다.',
    'replay.frameMissing': 'Replay할 원본 프레임을 사용할 수 없습니다.',
    'replay.transportMissing': '캡처된 Transport를 Replay에 사용할 수 없습니다.',
    'replay.invalidJson': 'Request 본문은 올바른 JSON이어야 합니다.',
    'replay.jsonObject': 'Request 본문은 JSON 객체여야 합니다.',
    'replay.serializeFailed': 'Request 본문을 직렬화할 수 없습니다.',
    'replay.sizeLimit': 'Request 본문이 Replay 한도 5 MiB를 초과합니다.',
    'replay.accepted': 'Replay가 수락되었습니다. 새 Request 항목을 확인하세요',
    'replay.notAccepted': 'Replay Request가 수락되지 않았습니다.',
    'replay.routeFrame': 'Replay할 유효한 원본 프레임이 필요합니다.',
    'replay.routeHandle': '유효한 Replay 핸들이 필요합니다.',
    'replay.routeTransport': '유효한 Replay Transport가 필요합니다.',
    'replay.connectionReplaced': 'Replay 연결이 교체되었습니다.',
    'replay.connectionUnavailable': 'Replay 연결을 사용할 수 없습니다.',
    'replay.tooManyPending': '응답을 대기 중인 Replay Request가 너무 많습니다.',
    'replay.attemptId': 'Replay 시도 ID를 생성할 수 없습니다.',
    'replay.timeout': 'Replay 응답 대기 시간이 초과되었습니다. 원본 프레임을 더 이상 사용할 수 없을 수 있습니다.',
    'replay.rejectedByFrame': '원본 프레임이 Replay를 거부했습니다.',
    'replay.connectionClosed': 'Replay 연결이 닫혔습니다.',
    'replay.connectionDisconnected': 'Replay 연결이 끊겼습니다.',

    'error.title': '문제가 발생했습니다.',
    'error.detail': '렌더링 중 애플리케이션이 중단되었습니다. 매우 크거나 잘못된 gRPC 패킷이 원인일 수 있습니다.',
    'error.recover': 'Log 지우고 복구',
  },
};

export function normalizeLanguagePreference(value) {
  return LANGUAGE_PREFERENCES.includes(value) ? value : 'auto';
}

export function resolveBrowserLocale(languages) {
  const candidates = Array.isArray(languages) ? languages : [languages];
  return candidates.some(language => typeof language === 'string' && /^ko(?:[-_]|$)/i.test(language))
    ? 'ko'
    : 'en';
}

export function detectBrowserLocale() {
  try {
    if (typeof chrome !== 'undefined' && chrome.i18n?.getUILanguage) {
      const uiLanguage = chrome.i18n.getUILanguage();
      if (uiLanguage) return resolveBrowserLocale(uiLanguage);
    }
  } catch (_) {}

  if (typeof navigator !== 'undefined') {
    return resolveBrowserLocale(navigator.languages?.length ? navigator.languages : navigator.language);
  }

  return 'en';
}

export function getEffectiveLocale(preference, browserLocale) {
  const normalizedPreference = normalizeLanguagePreference(preference);
  return normalizedPreference === 'auto' ? resolveBrowserLocale(browserLocale) : normalizedPreference;
}

export function translate(locale, key, values = {}) {
  const catalog = MESSAGES[locale] || MESSAGES.en;
  const template = catalog[key] ?? MESSAGES.en[key] ?? key;
  return String(template).replace(/\{([A-Za-z0-9_]+)\}/g, (match, name) => (
    Object.prototype.hasOwnProperty.call(values, name) ? String(values[name]) : match
  ));
}
