export interface ParsedWebcal {
  originalUrl: string;
  subscriptionUrl: string;
  suggestedName: string;
}

function stripControlChars(value: string): string {
  // eslint-disable-next-line no-control-regex
  return value.replace(/[\u0000-\u001F\u007F]/g, "").trim();
}

function extensionlessName(value: string): string {
  return value.replace(/\.(ics|ical)$/i, "");
}

function decodePathSegment(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export function parseWebcal(raw: string): ParsedWebcal | null {
  let url: URL;

  try {
    url = new URL(raw);
  } catch {
    return null;
  }

  if (url.protocol === "webcal:" || url.protocol === "webcals:") {
    url = new URL(raw.replace(/^webcals?:/i, "https:"));
  } else if (url.protocol !== "http:" && url.protocol !== "https:") {
    return null;
  }

  const subscriptionUrl = url.toString();
  const queryName = stripControlChars(url.searchParams.get("name") || "");
  const pathSegment = stripControlChars(decodePathSegment(url.pathname.split("/").filter(Boolean).pop() || ""));
  const suggestedName = queryName || extensionlessName(pathSegment) || url.hostname;

  return {
    originalUrl: raw,
    subscriptionUrl,
    suggestedName,
  };
}
