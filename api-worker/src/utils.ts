import type { ContentItemInput, ContentSection, ContentStatus, ContentType, NormalizedContentItem } from "./types";

const VALID_TYPES = new Set<ContentType>(["question", "knowledge"]);
const VALID_STATUSES = new Set<ContentStatus>(["candidate", "published", "rejected", "duplicate"]);
const TRUSTED_SOURCE_HOSTS = new Set(["java.doocs.org", "github.com", "javaguide.cn", "www.javaguide.cn"]);
const TRUSTED_SOURCE_NAMES = ["doocs", "javaguide", "cs-notes", "code-roadmap"];
const PROMOTION_PATTERNS = [
  "关注公众号",
  "扫码",
  "加群",
  "知识星球",
  "付费",
  "优惠券",
  "领取资料",
  "添加微信",
  "转载自",
];
const TECH_KEYWORDS = [
  "java",
  "spring",
  "mysql",
  "redis",
  "jvm",
  "线程",
  "并发",
  "分布式",
  "数据库",
  "缓存",
  "消息队列",
  "前端",
  "vue",
  "react",
  "算法",
  "网络",
  "操作系统",
  "面试",
  "题",
];

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

export function normalizeTitleKey(value: string): string {
  return normalizeWhitespace(value)
    .toLowerCase()
    .replace(/[“”"‘’'`~!@#$%^&*()_+\-=[\]{};:：，,.。？?！!、/\\|<>《》【】（）]/g, "")
    .replace(/\s+/g, "");
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

function safeStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item) => typeof item === "string").map((item) => item.trim()).filter(Boolean)
    : [];
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

function isTrustedSource(input: ContentItemInput, sourceUrl: string, sourceName: string): boolean {
  if (input.trustedSource === true || input.trusted_source === true) return true;
  const normalizedName = sourceName.toLowerCase();
  if (TRUSTED_SOURCE_NAMES.some((name) => normalizedName.includes(name))) return true;

  try {
    const host = new URL(sourceUrl).hostname.toLowerCase();
    return TRUSTED_SOURCE_HOSTS.has(host);
  } catch {
    return false;
  }
}

function calculateReview(input: ContentItemInput, item: Omit<NormalizedContentItem, "status" | "reviewScore" | "reviewFlags" | "reviewReason" | "reviewedAt">) {
  const providedScore = input.reviewScore ?? input.review_score;
  const providedFlags = safeStringArray(input.reviewFlags ?? input.review_flags);
  const providedReason = input.reviewReason ?? input.review_reason ?? "";
  const trusted = isTrustedSource(input, item.sourceUrl, item.sourceName);
  const text = `${item.title}\n${item.excerpt}\n${item.contentMd}\n${item.contentHtml}`;
  const normalizedText = normalizeWhitespace(text).toLowerCase();
  const flags = new Set<string>(providedFlags);
  let score = typeof providedScore === "number" && Number.isFinite(providedScore) ? providedScore : 50;

  if (trusted) score += 10;

  if (item.title.length < 4 || item.title.startsWith("http")) {
    score -= 25;
    flags.add("weak_title");
  } else if (item.title.length <= 90) {
    score += 10;
  }

  const contentLength = normalizeWhitespace(item.contentMd || item.contentHtml).length;
  if (contentLength >= 800) {
    score += 25;
  } else if (contentLength >= 300) {
    score += 15;
  } else if (contentLength < 160) {
    score -= 35;
    flags.add("short_content");
  }

  if (TECH_KEYWORDS.some((keyword) => normalizedText.includes(keyword))) {
    score += 15;
  } else {
    score -= 15;
    flags.add("low_technical_signal");
  }

  if (PROMOTION_PATTERNS.some((pattern) => normalizedText.includes(pattern))) {
    score -= 30;
    flags.add("promotion_risk");
  }

  const reviewScore = Math.max(0, Math.min(100, Math.round(score)));
  return {
    score: reviewScore,
    flags: Array.from(flags),
    reason:
      providedReason.trim() ||
      `rule_score=${reviewScore}; trusted=${trusted}; length=${contentLength}; flags=${Array.from(flags).join(",") || "none"}`,
    trusted,
  };
}

function decideStatus(defaultStatus: ContentStatus, inputStatus: ContentStatus, review: { score: number; trusted: boolean }): ContentStatus {
  if (defaultStatus === "published") return inputStatus;
  if (inputStatus === "duplicate" || inputStatus === "rejected") return inputStatus;
  if (review.score < 60) return "rejected";
  if (review.trusted && review.score >= 85) return "published";
  return "candidate";
}

export async function normalizeContentInput(
  input: ContentItemInput,
  defaultStatus: ContentStatus,
  options: { honorInputStatus?: boolean; autoReview?: boolean } = {},
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
  const inputStatus = options.honorInputStatus && isContentStatus(input.status) ? input.status : defaultStatus;
  const hashBase = normalizeTextForHash(`${title}\n${contentMd || contentHtml || input.excerpt || ""}`);
  const hash = input.hash?.trim() || (await sha256Hex(hashBase));
  const id = input.id?.trim() || `${input.type}-${makeSlug(sourceUrl || title)}-${hash.slice(0, 12)}`;
  const baseItem = {
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
    hash,
    titleKey: normalizeTitleKey(title),
    duplicateOf: "",
  };
  const review = options.autoReview ? calculateReview(input, baseItem) : { score: 100, flags: [], reason: "", trusted: true };

  return {
    ...baseItem,
    status: options.autoReview ? decideStatus(defaultStatus, inputStatus, review) : inputStatus,
    reviewScore: review.score,
    reviewFlags: review.flags,
    reviewReason: review.reason,
    reviewedAt: options.autoReview ? new Date().toISOString() : "",
  };
}
