import "server-only";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

/**
 * Reads a saved link's own metadata so a card can show a real title and image.
 *
 * The server fetches a URL a person typed, so this is a classic SSRF surface:
 * every hop is resolved and checked against private address ranges before the
 * request is made, redirects are followed by hand rather than by fetch, and the
 * body is read with a hard cap. A link that needs a login (most private Drive
 * files) simply yields nothing, and the caller falls back.
 */

const FETCH_TIMEOUT_MS = 6000;
const MAX_HTML_BYTES = 512 * 1024;
const MAX_IMAGE_BYTES = 3 * 1024 * 1024;
const MAX_REDIRECTS = 3;

const USER_AGENT =
  "Mozilla/5.0 (compatible; TPPTaskTracker/1.0; +link-preview)";

export type FetchedImage = { bytes: Uint8Array; contentType: string };

export type LinkPreview = {
  title: string | null;
  description: string | null;
  siteName: string | null;
  image: FetchedImage | null;
  icon: FetchedImage | null;
};

/* ------------------------------------------------------------------ *
 * SSRF guards
 * ------------------------------------------------------------------ */

function isPrivateIPv4(address: string): boolean {
  const [a, b] = address.split(".").map(Number);
  if (a === 10 || a === 127 || a === 0) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 169 && b === 254) return true; // link-local, incl. cloud metadata
  if (a >= 224) return true; // multicast / reserved
  return false;
}

function isPrivateIPv6(address: string): boolean {
  const value = address.toLowerCase();
  if (value === "::1" || value === "::") return true;
  if (value.startsWith("fe80")) return true; // link-local
  if (/^f[cd]/.test(value)) return true; // unique local
  if (value.startsWith("::ffff:")) return isPrivateIPv4(value.slice(7));
  return false;
}

async function isReachableHost(hostname: string): Promise<boolean> {
  try {
    const direct = isIP(hostname);
    if (direct === 4) return !isPrivateIPv4(hostname);
    if (direct === 6) return !isPrivateIPv6(hostname);

    const { address, family } = await lookup(hostname);
    return family === 4 ? !isPrivateIPv4(address) : !isPrivateIPv6(address);
  } catch {
    return false;
  }
}

/** Fetch, following redirects ourselves so every hop can be vetted. */
async function safeFetch(startUrl: string): Promise<Response | null> {
  let current = startUrl;

  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    let parsed: URL;
    try {
      parsed = new URL(current);
    } catch {
      return null;
    }

    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    if (!(await isReachableHost(parsed.hostname))) return null;

    let response: Response;
    try {
      response = await fetch(parsed.toString(), {
        redirect: "manual",
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        headers: { "User-Agent": USER_AGENT, Accept: "text/html,*/*" },
      });
    } catch {
      return null;
    }

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) return null;
      current = new URL(location, parsed).toString();
      continue;
    }

    return response.ok ? response : null;
  }

  return null;
}

/* ------------------------------------------------------------------ *
 * Parsing
 * ------------------------------------------------------------------ */

function decodeEntities(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .trim();
}

/** Pull one meta tag's content, tolerating attribute order. */
function metaContent(html: string, key: string): string | null {
  const pattern = new RegExp(
    `<meta[^>]+(?:property|name)\\s*=\\s*["']${key}["'][^>]*>`,
    "i",
  );
  const tag = html.match(pattern)?.[0];
  if (!tag) return null;

  const content = tag.match(/content\s*=\s*["']([^"']*)["']/i)?.[1];
  return content ? decodeEntities(content) : null;
}

async function readCapped(
  response: Response,
  limit: number,
): Promise<Uint8Array> {
  const reader = response.body?.getReader();
  if (!reader) return new Uint8Array();

  const chunks: Uint8Array[] = [];
  let total = 0;

  for (;;) {
    const { done, value } = await reader.read();
    if (done || !value) break;
    chunks.push(value);
    total += value.byteLength;
    if (total >= limit) {
      await reader.cancel();
      break;
    }
  }

  const out = new Uint8Array(Math.min(total, limit));
  let offset = 0;
  for (const chunk of chunks) {
    if (offset >= out.length) break;
    out.set(chunk.subarray(0, out.length - offset), offset);
    offset += chunk.byteLength;
  }
  return out;
}

/** True when we've been handed a sign-in wall rather than the page itself. */
function looksLikeLogin(url: string, title: string | null): boolean {
  const host = (() => {
    try {
      return new URL(url).hostname;
    } catch {
      return "";
    }
  })();

  if (/accounts\.google\.com|login\.microsoftonline\.com/.test(host)) {
    return true;
  }
  return /^(sign in|log in|login|sign in - google accounts)/i.test(title ?? "");
}

async function fetchImage(url: string): Promise<FetchedImage | null> {
  try {
    const response = await safeFetch(url);
    const type = response?.headers.get("content-type") ?? "";
    if (!response || !type.startsWith("image/")) return null;

    const bytes = await readCapped(response, MAX_IMAGE_BYTES);
    if (bytes.byteLength === 0) return null;

    return { bytes, contentType: type.split(";")[0].trim() };
  } catch {
    return null;
  }
}

/**
 * The site's icon, taken from the domain rather than the page.
 *
 * This is what makes Drive work: the folder needs a login, but
 * drive.google.com/favicon.ico is public, so the card can still show the real
 * Drive mark instead of a placeholder.
 */
async function fetchIcon(
  pageUrl: string,
  html: string | null,
): Promise<FetchedImage | null> {
  const candidates: string[] = [];

  if (html) {
    const tags = html.match(/<link[^>]+rel\s*=\s*["'][^"']*icon[^"']*["'][^>]*>/gi);
    for (const tag of tags ?? []) {
      const href = tag.match(/href\s*=\s*["']([^"']+)["']/i)?.[1];
      if (href) candidates.push(href);
    }
  }

  candidates.push("/favicon.ico");

  for (const candidate of candidates.slice(0, 4)) {
    try {
      const absolute = new URL(candidate, pageUrl).toString();
      const icon = await fetchImage(absolute);
      if (icon) return icon;
    } catch {
      // try the next candidate
    }
  }

  return null;
}

export async function fetchLinkPreview(
  url: string,
): Promise<LinkPreview | null> {
  const response = await safeFetch(url);

  // Even a page we can't read may still serve an icon from its domain.
  if (!response) {
    const icon = await fetchIcon(url, null);
    return icon
      ? { title: null, description: null, siteName: null, image: null, icon }
      : null;
  }

  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("html")) {
    const icon = await fetchIcon(url, null);
    return icon
      ? { title: null, description: null, siteName: null, image: null, icon }
      : null;
  }

  const html = new TextDecoder().decode(
    await readCapped(response, MAX_HTML_BYTES),
  );

  const title =
    metaContent(html, "og:title") ??
    metaContent(html, "twitter:title") ??
    (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]
      ? decodeEntities(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)![1])
      : null);

  // A login page is a successful response with useless content — drop its
  // title so the card doesn't read "Sign in - Google Accounts", but keep the
  // icon, which is the whole point for Drive.
  if (looksLikeLogin(response.url || url, title)) {
    // Take the icon from the URL that was saved, not the sign-in host we were
    // bounced to — drive.google.com/favicon.ico is the Drive mark, whereas
    // accounts.google.com's is a generic Google one.
    const icon = await fetchIcon(url, null);
    return icon
      ? { title: null, description: null, siteName: null, image: null, icon }
      : null;
  }

  const description =
    metaContent(html, "og:description") ??
    metaContent(html, "twitter:description") ??
    metaContent(html, "description");

  const siteName = metaContent(html, "og:site_name");

  const imageUrl =
    metaContent(html, "og:image") ??
    metaContent(html, "og:image:url") ??
    metaContent(html, "twitter:image");

  let image: FetchedImage | null = null;
  if (imageUrl) {
    try {
      const absolute = new URL(imageUrl, response.url || url).toString();
      image = await fetchImage(absolute);
    } catch {
      // An unreachable image shouldn't cost us the title.
    }
  }

  const icon = await fetchIcon(response.url || url, html);

  if (!title && !description && !image && !icon) return null;

  return {
    title: title?.slice(0, 200) ?? null,
    description: description?.slice(0, 400) ?? null,
    siteName: siteName?.slice(0, 100) ?? null,
    image,
    icon,
  };
}
