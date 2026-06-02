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
const NAVIGATION_NOISE_PATTERNS = ["skip to content", "main navigation", "sidebar navigation", "return to top"];

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function stripMarkdown(value: string): string {
  return (value || "")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^>\s?/gm, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/[>*_~`#-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function excerptFromMarkdown(value: string, length = 180): string {
  const text = stripMarkdown(value);
  return text.length > length ? `${text.slice(0, length)}...` : text;
}

function renderInlineMarkdown(value: string): string {
  const escaped = escapeHtml(value);
  return escaped
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, (_match, label: string, href: string) => {
      return `<a href="${href}" target="_blank" rel="noopener noreferrer">${label}</a>`;
    });
}

function flushParagraph(lines: string[], html: string[]): void {
  if (lines.length === 0) return;
  html.push(`<p>${renderInlineMarkdown(lines.join(" "))}</p>`);
  lines.length = 0;
}

function flushList(lines: string[], html: string[], ordered: boolean): void {
  if (lines.length === 0) return;
  html.push(`<${ordered ? "ol" : "ul"}>${lines.map((line) => `<li>${renderInlineMarkdown(line)}</li>`).join("")}</${ordered ? "ol" : "ul"}>`);
  lines.length = 0;
}

export function renderMarkdown(content: string): string {
  const html: string[] = [];
  const paragraph: string[] = [];
  const unorderedItems: string[] = [];
  const orderedItems: string[] = [];
  const lines = (content || "").replace(/\r\n?/g, "\n").split("\n");
  let inCodeFence = false;
  let codeLines: string[] = [];

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    const trimmed = line.trim();

    if (trimmed.startsWith("```")) {
      flushParagraph(paragraph, html);
      flushList(unorderedItems, html, false);
      flushList(orderedItems, html, true);
      if (inCodeFence) {
        html.push(`<pre><code>${escapeHtml(codeLines.join("\n"))}</code></pre>`);
        codeLines = [];
        inCodeFence = false;
      } else {
        inCodeFence = true;
      }
      continue;
    }

    if (inCodeFence) {
      codeLines.push(line);
      continue;
    }

    if (!trimmed) {
      flushParagraph(paragraph, html);
      flushList(unorderedItems, html, false);
      flushList(orderedItems, html, true);
      continue;
    }

    const heading = trimmed.match(/^(#{1,4})\s+(.+?)\s*#*$/);
    if (heading) {
      flushParagraph(paragraph, html);
      flushList(unorderedItems, html, false);
      flushList(orderedItems, html, true);
      const level = heading[1].length;
      html.push(`<h${level}>${renderInlineMarkdown(heading[2])}</h${level}>`);
      continue;
    }

    const unordered = trimmed.match(/^[-*]\s+(.+)$/);
    if (unordered) {
      flushParagraph(paragraph, html);
      flushList(orderedItems, html, true);
      unorderedItems.push(unordered[1]);
      continue;
    }

    const ordered = trimmed.match(/^\d+\.\s+(.+)$/);
    if (ordered) {
      flushParagraph(paragraph, html);
      flushList(unorderedItems, html, false);
      orderedItems.push(ordered[1]);
      continue;
    }

    if (trimmed.startsWith(">")) {
      flushParagraph(paragraph, html);
      flushList(unorderedItems, html, false);
      flushList(orderedItems, html, true);
      html.push(`<blockquote><p>${renderInlineMarkdown(trimmed.replace(/^>\s?/, ""))}</p></blockquote>`);
      continue;
    }

    flushList(unorderedItems, html, false);
    flushList(orderedItems, html, true);
    paragraph.push(trimmed);
  }

  if (inCodeFence) {
    html.push(`<pre><code>${escapeHtml(codeLines.join("\n"))}</code></pre>`);
  }
  flushParagraph(paragraph, html);
  flushList(unorderedItems, html, false);
  flushList(orderedItems, html, true);

  return html.join("");
}

export function parseSectionsFromMarkdown(content: string): ContentSection[] {
  const normalized = (content || "").trim();
  if (!normalized) return [];

  const headingPattern = /^(#{2,4})\s+(.+?)\s*#*\s*$/gm;
  const matches = Array.from(normalized.matchAll(headingPattern));

  if (matches.length === 0) {
    return [
      {
        title: "题解",
        level: 2,
        content: normalized,
        html: renderMarkdown(normalized),
        excerpt: excerptFromMarkdown(normalized, 140),
      },
    ];
  }

  const sections: ContentSection[] = [];
  const prelude = normalized.slice(0, matches[0].index).trim();
  if (prelude) {
    sections.push({
      title: "概览",
      level: 2,
      content: prelude,
      html: renderMarkdown(prelude),
      excerpt: excerptFromMarkdown(prelude, 140),
    });
  }

  matches.forEach((match, index) => {
    const next = matches[index + 1];
    const start = Number(match.index) + match[0].length;
    const end = next ? Number(next.index) : normalized.length;
    const body = normalized.slice(start, end).trim();
    sections.push({
      title: stripMarkdown(match[2]).trim() || "答案",
      level: match[1].length,
      content: body,
      html: renderMarkdown(body),
      excerpt: excerptFromMarkdown(body, 140),
    });
  });

  return sections.filter((section) => section.content || section.html || section.excerpt);
}

function markdownStructureScore(value: string): { score: number; flags: string[]; headingCount: number } {
  const headingCount = (value.match(/^#{2,4}\s+/gm) ?? []).length;
  const listCount = (value.match(/^(?:[-*]|\d+\.)\s+/gm) ?? []).length;
  const codeFenceCount = (value.match(/```/g) ?? []).length / 2;
  const linkCount = (value.match(/\[[^\]]+\]\(https?:\/\/[^)\s]+\)/g) ?? []).length;
  const score = Math.min(25, headingCount * 8 + Math.min(8, listCount * 2) + Math.min(6, Math.floor(codeFenceCount) * 3) + Math.min(4, linkCount));
  const flags: string[] = [];
  if (headingCount === 0 && listCount < 2 && codeFenceCount < 1) {
    flags.push("weak_structure");
  }
  return { score, flags, headingCount };
}

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

function normalizeContentSections(inputSections: unknown, contentMd: string): ContentSection[] {
  const sections = normalizeSections(inputSections);
  if (sections.length > 0) return sections;
  return parseSectionsFromMarkdown(contentMd);
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
  const structure = markdownStructureScore(item.contentMd);
  score += structure.score;
  for (const flag of structure.flags) flags.add(flag);

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

  if (NAVIGATION_NOISE_PATTERNS.some((pattern) => normalizedText.includes(pattern))) {
    score -= 60;
    flags.add("navigation_noise");
  }

  if (flags.has("weak_structure") && contentLength < 800) {
    score -= 15;
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

function decideStatus(
  defaultStatus: ContentStatus,
  inputStatus: ContentStatus,
  review: { score: number; trusted: boolean; flags: string[] },
): ContentStatus {
  if (defaultStatus === "published") return inputStatus;
  if (inputStatus === "duplicate" || inputStatus === "rejected") return inputStatus;
  if (review.score < 60) return "rejected";
  if (review.flags.includes("weak_structure")) return "candidate";
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
  const contentHtml = input.contentHtml?.trim() || renderMarkdown(contentMd);
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
    excerpt: input.excerpt?.trim() || excerptFromMarkdown(contentMd),
    contentMd,
    contentHtml,
    sections: normalizeContentSections(input.sections, contentMd),
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
