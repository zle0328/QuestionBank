import type { ContentItemInput, ContentSection, ContentStatus, ContentType, NormalizedContentItem } from "./types";

const VALID_TYPES = new Set<ContentType>(["question", "knowledge"]);
const VALID_STATUSES = new Set<ContentStatus>(["candidate", "published", "rejected", "duplicate"]);

export function isContentType(value: string | null | undefined): value is ContentType {
  return Boolean(value && VALID_TYPES.has(value as ContentType));
}

export function isContentStatus(value: string | null | undefined): value is ContentStatus {
  return Boolean(value && VALID_STATUSES.has(value as ContentStatus));
}

export function parsePositiveInt(value: string | null, fallback: number, max: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return Math.min(parsed, max);
}

export function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

export function normalizeTextForHash(value: string): string {
  return normalizeWhitespace(value)
    .toLowerCase()
    .replace(/[“”]/g, "\"")
    .replace(/[‘’]/g, "'")
    .replace(/[，。！？；：、]/g, "");
}

export async function sha256Hex(value: string): Promise<string> {
  const data = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export function canonicalizeUrl(value: string | undefined): string {
  if (!value) return "";

  try {
    const url = new URL(value);
    url.hash = "";
    url.searchParams.sort();
    const pathname = url.pathname.length > 1 ? url.pathname.replace(/\/+$/, "") : url.pathname;
    url.pathname = pathname || "/";
    return url.toString();
  } catch {
    return value.trim();
  }
}

export function makeSlug(value: string): string {
  const normalized = normalizeWhitespace(value)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "");
  return normalized || "item";
}

export function safeJsonArray(value: unknown): string {
  if (!Array.isArray(value)) return "[]";
  return JSON.stringify(value.filter((item) => typeof item === "string").map((item) => item.trim()).filter(Boolean));
}

export function parseJsonArray<T>(value: string | null | undefined, fallback: T[]): T[] {
  if (!value) return fallback;
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? (parsed as T[]) : fallback;
  } catch {
    return fallback;
  }
}

export function escapeSqlLike(value: string): string {
  return value.replace(/[\\%_]/g, (match) => `\\${match}`);
}

function assertString(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${field} is required`);
  }
  return value.trim();
}

function normalizeSections(value: unknown): ContentSection[] {
  if (!Array.isArray(value)) return [];

  return value
    .filter((section): section is Partial<ContentSection> => typeof section === "object" && section !== null)
    .map((section) => ({
      title: typeof section.title === "string" && section.title.trim() ? section.title.trim() : "答案",
      level: typeof section.level === "number" && Number.isFinite(section.level) ? section.level : 2,
      content: typeof section.content === "string" ? section.content : "",
      html: typeof section.html === "string" ? section.html : "",
      excerpt: typeof section.excerpt === "string" ? section.excerpt : "",
    }))
    .filter((section) => section.content || section.html || section.excerpt);
}

export async function normalizeContentInput(
  input: ContentItemInput,
  defaultStatus: ContentStatus,
): Promise<NormalizedContentItem> {
  if (!isContentType(input.type)) {
    throw new Error("type must be question or knowledge");
  }

  const title = assertString(input.title, "title");
  const contentMd = input.contentMd ?? input.content ?? "";
  const contentHtml = input.contentHtml ?? "";
  const sourceUrl = canonicalizeUrl(input.sourceUrl ?? input.source_url);
  const sourceName = input.sourceName ?? input.source_name ?? input.source ?? "";
  const sourcePath = input.sourcePath ?? input.source_path ?? sourceUrl;
  const status = isContentStatus(input.status) ? input.status : defaultStatus;
  const hashBase = normalizeTextForHash(`${title}\n${contentMd || contentHtml || input.excerpt || ""}`);
  const hash = input.hash?.trim() || (await sha256Hex(hashBase));
  const id = input.id?.trim() || `${input.type}-${makeSlug(sourceUrl || title)}-${hash.slice(0, 12)}`;

  return {
    id,
    type: input.type,
    title,
    category: input.category?.trim() || "未分类",
    tags: Array.isArray(input.tags) ? input.tags.map((tag) => tag.trim()).filter(Boolean).slice(0, 20) : [],
    excerpt: input.excerpt?.trim() || normalizeWhitespace(contentMd.replace(/[#>*_`[\]()]/g, " ")).slice(0, 180),
    contentMd,
    contentHtml,
    sections: normalizeSections(input.sections),
    sourceUrl,
    sourceName: sourceName.trim(),
    sourcePath: sourcePath?.trim() || "",
    status,
    hash,
  };
}
