// Copyright (c) 2019 SafetyCulture Pty Ltd. All Rights Reserved.
//
// Assembles the "environment info" block that's always required at the top of
// every internal bug report, from data grpc-web-devtools already captures. This is
// intentionally hardcoded Korean output for one specific internal process —
// it does not go through the extension's own i18n system, and isn't affected
// by the panel's en/ko UI setting.
//
// Build version comes from the app-version gRPC request header, captured via
// an explicit allowlist in public/protobuf-ts-interceptor.js (never a
// wholesale copy of request metadata, since that also carries the auth
// token) and persisted alongside the entry by state/networkCache.js.

function pad(value) {
  return String(value).padStart(2, '0');
}

export function formatLocalTimestamp(date) {
  const safeDate = date instanceof Date ? date : new Date(date);
  if (!Number.isFinite(safeDate.getTime())) return '';
  return `${safeDate.getFullYear()}-${pad(safeDate.getMonth() + 1)}-${pad(safeDate.getDate())} ${pad(safeDate.getHours())}:${pad(safeDate.getMinutes())}`;
}

export function getChromeVersion(userAgent) {
  const match = String(userAgent || '').match(/Chrome\/([\d.]+)/);
  return match ? match[1] : null;
}

// Walks the retained log newest-first (mirrors the pattern in utils/auditReport.js)
// looking for the most recent call to a method ending in "/GetOpUser", resolves
// the full cached entry (summaries alone don't carry the response body), and
// pulls out exactly the fields the BTS template's "테스트 계정" line needs.
export function findLatestOpUserInfo(allEntries, getEntry) {
  if (!Array.isArray(allEntries) || typeof getEntry !== 'function') return null;

  for (let index = allEntries.length - 1; index >= 0; index -= 1) {
    const summary = allEntries[index];
    if (typeof summary?.method !== 'string' || !summary.method.endsWith('/GetOpUser')) continue;

    let fullEntry;
    try {
      fullEntry = getEntry(summary.entryId);
    } catch (_) {
      continue;
    }
    const response = fullEntry?.response;
    if (!response || typeof response !== 'object' || response.__truncated) continue;

    return {
      email: typeof response.email === 'string' ? response.email : null,
      company: typeof response.operatorInfo?.fullName === 'string' ? response.operatorInfo.fullName : null,
      role: typeof response.role === 'string' ? response.role : null,
    };
  }

  return null;
}

// Same newest-first scan as findLatestOpUserInfo, but for the app-version
// header captured on any call (not just GetOpUser) — whichever request most
// recently ran carries the build the tester is actually using right now.
export function findLatestBuildVersion(allEntries, getEntry) {
  if (!Array.isArray(allEntries) || typeof getEntry !== 'function') return null;

  for (let index = allEntries.length - 1; index >= 0; index -= 1) {
    const summary = allEntries[index];
    let fullEntry;
    try {
      fullEntry = getEntry(summary?.entryId);
    } catch (_) {
      continue;
    }
    const appVersion = fullEntry?.meta?.['app-version'];
    if (typeof appVersion === 'string' && appVersion) return appVersion;
  }

  return null;
}

// Any captured entry's page location works for the "이슈 발생 URL" line — not
// redacted (unlike the Audit Report's URL handling), because this is a
// frontend page URL whose hash/query often carries real reproduction state
// (e.g. a map viewport position), not secrets. Auth-bearing URLs in this app
// are backend API calls, not this one.
export function findLatestPageUrl(allEntries) {
  if (!Array.isArray(allEntries)) return null;

  for (let index = allEntries.length - 1; index >= 0; index -= 1) {
    const location = allEntries[index]?.location;
    if (typeof location === 'string' && location) return location;
  }

  return null;
}

// Rule-based domain classification (dev / QA / Stage / Real), matched against
// this org's own domain table across its apps: each tier's hostname reliably
// contains that tier's name as a substring (e.g. app.dev2.example.com,
// qa-app.example.com, stage-app.example.com), and Real is whatever's left
// with none of those markers (app.example.com). Checked in dev/QA/Stage order
// since dev2 hosts otherwise happen to also read as ordinary hostnames with
// no other marker present.
const ENVIRONMENT_MARKERS = [
  ['dev', 'dev'],
  ['qa', 'QA'],
  ['stage', 'Stage'],
];

export function classifyEnvironment(url) {
  if (typeof url !== 'string' || !url) return null;

  let hostname;
  try {
    hostname = new URL(url).hostname.toLowerCase();
  } catch (_) {
    return null;
  }

  const marker = ENVIRONMENT_MARKERS.find(([substring]) => hostname.includes(substring));
  return marker ? marker[1] : 'Real';
}

function formatTestAccountLine(opUserInfo) {
  if (!opUserInfo) return '- 테스트 계정 : ';
  const parts = [opUserInfo.email, opUserInfo.company].filter(Boolean).join(' ');
  const role = opUserInfo.role ? ` (${opUserInfo.role})` : '';
  return `- 테스트 계정 : ${parts}${role}`;
}

export function buildBtsInfoText({ url, chromeVersion, timestamp, opUserInfo, buildVersion, environment } = {}) {
  return [
    '[빌드 버전]',
    `- ${buildVersion || ''}`,
    '',
    '[테스트 환경 정보]',
    `- 환경 : ${environment || ''}`,
    `- OS 버전 : ${chromeVersion || ''}`,
    `- 발생 시간: ${timestamp || ''}`,
    formatTestAccountLine(opUserInfo),
    `- 이슈 발생 URL : ${url || ''}`,
    '- rpc 호출기록 : (Audit Report를 다운로드하여 첨부해 주세요)',
  ].join('\n');
}
