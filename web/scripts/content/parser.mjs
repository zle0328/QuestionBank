import crypto from "node:crypto";
import path from "node:path";
import matter from "gray-matter";
import MarkdownIt from "markdown-it";

const markdown = new MarkdownIt({
  html: true,
  linkify: true,
  typographer: true,
});

const PROMO_PATTERNS = [
  /八股文一网打尽/,
  /程序员面试刷题神器\s*-\s*面试鸭/,
  /^<!--\s*@include:/,
];

const KNOWN_TAGS = [
  "Java",
  "JVM",
  "Spring",
  "MySQL",
  "Redis",
  "前端",
  "后端",
  "Go",
  "Node",
  "Vue",
  "React",
  "HTTP",
  "Linux",
  "操作系统",
  "计算机网络",
  "数据库",
  "分布式",
  "系统设计",
  "AI",
  "RAG",
  "Agent",
];

export function normalizeSlash(value) {
  return value.split(path.sep).join("/");
}

export function stableId(prefix, value) {
  const digest = crypto.createHash("sha1").update(value).digest("hex").slice(0, 12);
  return `${prefix}-${digest}`;
}

export function renderMarkdown(content) {
  return markdown.render(content || "");
}

export function normalizeTags(value) {
  const raw = Array.isArray(value) ? value : value ? [value] : [];
  return raw
    .flatMap((item) => (Array.isArray(item) ? item : [item]))
    .map((item) => String(item).trim())
    .filter(Boolean);
}

export function stripPromotionalLines(content) {
  return content
    .split(/\r?\n/)
    .filter((line) => !PROMO_PATTERNS.some((pattern) => pattern.test(line.trim())))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function stripMarkdown(content) {
  return (content || "")
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

export function excerpt(content, length = 180) {
  const text = stripMarkdown(content);
  return text.length > length ? `${text.slice(0, length)}...` : text;
}

function basenameTitle(filePath) {
  return path.basename(filePath, path.extname(filePath)).replace(/^\d+\.\s*/, "").trim();
}

function firstHeading(content) {
  const match = content.match(/^#{1,3}\s+(.+?)\s*#*\s*$/m);
  return match?.[1]?.trim() ?? "";
}

function removeFirstMatchingHeading(content, title) {
  const escapedTitle = title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`^#{1,3}[ \\t]+${escapedTitle}[ \\t]*#*[ \\t]*(?:\\r?\\n)?`, "m");
  return content.replace(pattern, "").trim();
}

function inferTags(seed) {
  const lowerSeed = seed.toLowerCase();
  return KNOWN_TAGS.filter((tag) => {
    const lowerTag = tag.toLowerCase();
    return seed.includes(tag) || lowerSeed.includes(lowerTag);
  });
}

function unique(values) {
  return Array.from(new Set(values.filter(Boolean)));
}

export function parseSections(content) {
  const headingPattern = /^(#{2,4})\s+(.+?)\s*#*\s*$/gm;
  const matches = Array.from(content.matchAll(headingPattern));

  if (matches.length === 0) {
    return [
      {
        title: "题解",
        level: 2,
        content: content.trim(),
        html: renderMarkdown(content),
        excerpt: excerpt(content, 140),
      },
    ];
  }

  const prelude = content.slice(0, matches[0].index).trim();
  const sections = [];

  if (prelude) {
    sections.push({
      title: "概览",
      level: 2,
      content: prelude,
      html: renderMarkdown(prelude),
      excerpt: excerpt(prelude, 140),
    });
  }

  matches.forEach((match, index) => {
    const next = matches[index + 1];
    const start = Number(match.index) + match[0].length;
    const end = next ? Number(next.index) : content.length;
    const body = content.slice(start, end).trim();
    const title = stripMarkdown(match[2]).trim();

    sections.push({
      title,
      level: match[1].length,
      content: body,
      html: renderMarkdown(body),
      excerpt: excerpt(body, 140),
    });
  });

  return sections;
}

export function parseQuestionMarkdown({ raw, filePath, rootDir }) {
  const parsed = matter(raw);
  const relativePath = normalizeSlash(path.relative(rootDir, filePath));
  const category = relativePath.split("/")[0] || "未分类";
  const cleanedContent = stripPromotionalLines(parsed.content);
  const title = String(parsed.data.title || firstHeading(cleanedContent) || basenameTitle(filePath)).trim();
  const content = removeFirstMatchingHeading(cleanedContent, title);
  const tags = unique([
    ...normalizeTags(parsed.data.tags ?? parsed.data.tag),
    ...inferTags(`${category} ${title} ${relativePath}`),
  ]);

  return {
    id: stableId("q", relativePath),
    title,
    source: "code-roadmap",
    category,
    tags,
    sourcePath: relativePath,
    content,
    contentHtml: renderMarkdown(content),
    sections: parseSections(content),
    excerpt: excerpt(content),
  };
}

export function parseKnowledgeMarkdown({ raw, filePath, rootDir }) {
  const parsed = matter(raw);
  const relativePath = normalizeSlash(path.relative(rootDir, filePath));
  const topLevelCategory = relativePath.split("/")[0] || "未分类";
  const cleanedContent = stripPromotionalLines(parsed.content);
  const title = String(parsed.data.title || firstHeading(cleanedContent) || basenameTitle(filePath)).trim();
  const content = removeFirstMatchingHeading(cleanedContent, title);
  const category = String(parsed.data.category || topLevelCategory).trim();
  const tags = unique([
    ...normalizeTags(parsed.data.tags ?? parsed.data.tag),
    ...inferTags(`${category} ${title} ${relativePath}`),
  ]);
  const description = String(parsed.data.description || "").trim();

  return {
    id: stableId("k", relativePath),
    title,
    source: "JavaGuide",
    category,
    tags,
    description,
    sourcePath: relativePath,
    content,
    contentHtml: renderMarkdown(content),
    excerpt: description || excerpt(content),
  };
}
