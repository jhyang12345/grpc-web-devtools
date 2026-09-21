const NO_CACHE_PATTERN = /no-cache/i;

function headerValue(headers, name) {
  if (!Array.isArray(headers)) return undefined;
  const match = headers.find(
    (header) => header && typeof header.name === "string" && header.name.toLowerCase() === name
  );
  return match ? match.value : undefined;
}

// Chrome sends "Cache-Control: no-cache" (and "Pragma: no-cache") on the main
// document request only for a hard/force reload (Cmd/Ctrl+Shift+R, or "Empty
// Cache and Hard Reload"). A normal reload sends "Cache-Control: max-age=0"
// instead, so this is the only way to tell the two apart from a devtools
// extension, which never sees the actual keyboard shortcut.
export function isHardReloadEntry(harEntry) {
  if (!harEntry || !harEntry.request) return false;

  const resourceType = harEntry._resourceType || harEntry.resourceType;
  if (resourceType !== "document") return false;

  const headers = harEntry.request.headers;
  const cacheControl = headerValue(headers, "cache-control");
  const pragma = headerValue(headers, "pragma");

  return NO_CACHE_PATTERN.test(cacheControl || "") || NO_CACHE_PATTERN.test(pragma || "");
}
