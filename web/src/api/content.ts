import type { ContentSection, GeneratedMeta, KnowledgeItem, QuestionItem } from "../types";
import { countBy } from "../utils/search";

type ApiContentType = "question" | "knowledge";
type ApiContentStatus = "candidate" | "published" | "rejected" | "duplicate";

interface ApiContentItem {
  id: string;
  type: ApiContentType;
  title: string;
  category: string;
  tags?: string[];
  excerpt?: string;
  content?: string;
  contentHtml?: string;
  sections?: ContentSection[];
  sourceUrl?: string;
  sourceName?: string;
  sourcePath?: string;
  status: ApiContentStatus;
  createdAt?: string;
  updatedAt?: string;
  publishedAt?: string | null;
}

interface ApiContentListResponse {
  items: ApiContentItem[];
  page: number;
  pageSize: number;
  total: number;
}

interface ContentBundle {
  questions: QuestionItem[];
  knowledge: KnowledgeItem[];
  meta: GeneratedMeta;
}

const STATIC_DATA_BASE = `${import.meta.env.BASE_URL}data/generated`;
const API_PAGE_SIZE = 1000;

function apiBaseUrl() {
  const configured = import.meta.env.VITE_API_BASE_URL?.trim();
  return (configured || "").replace(/\/+$/, "");
}

function apiUrl(path: string) {
  const base = apiBaseUrl();
  return `${base}${path}`;
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`${url} 加载失败：${response.status}`);
  }
  return (await response.json()) as T;
}

async function loadStaticJson<T>(fileName: string): Promise<T> {
  return fetchJson<T>(`${STATIC_DATA_BASE}/${fileName}`);
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function plainTextToHtml(value: string): string {
  return value
    .split(/\n+/)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => `<p>${escapeHtml(block)}</p>`)
    .join("");
}

function apiItemToQuestion(item: ApiContentItem): QuestionItem {
  const content = item.content ?? "";
  const contentHtml = item.contentHtml || plainTextToHtml(content);

  return {
    id: item.id,
    title: item.title,
    source: item.sourceName || "api",
    category: item.category || "未分类",
    tags: item.tags ?? [],
    sourcePath: item.sourcePath || item.sourceUrl || "",
    content,
    contentHtml,
    sections: item.sections?.length
      ? item.sections
      : [
          {
            title: "题解",
            level: 2,
            content,
            html: contentHtml,
            excerpt: item.excerpt ?? "",
          },
        ],
    excerpt: item.excerpt ?? "",
  };
}

function apiItemToKnowledge(item: ApiContentItem): KnowledgeItem {
  const content = item.content ?? "";
  const contentHtml = item.contentHtml || plainTextToHtml(content);

  return {
    id: item.id,
    title: item.title,
    source: item.sourceName || "api",
    category: item.category || "未分类",
    tags: item.tags ?? [],
    description: item.excerpt ?? "",
    sourcePath: item.sourcePath || item.sourceUrl || "",
    content,
    contentHtml,
    excerpt: item.excerpt ?? "",
  };
}

async function fetchApiContent(type: ApiContentType): Promise<ApiContentItem[]> {
  const firstPage = await fetchJson<ApiContentListResponse>(
    apiUrl(`/api/content?type=${type}&page=1&pageSize=${API_PAGE_SIZE}`),
  );
  const items = [...firstPage.items];
  const pageCount = Math.ceil(firstPage.total / firstPage.pageSize);

  for (let page = 2; page <= pageCount; page += 1) {
    const response = await fetchJson<ApiContentListResponse>(
      apiUrl(`/api/content?type=${type}&page=${page}&pageSize=${API_PAGE_SIZE}`),
    );
    items.push(...response.items);
  }

  return items.filter((item) => item.status === "published");
}

async function loadFromApi(): Promise<ContentBundle> {
  await fetchJson<{ ok: boolean }>(apiUrl("/api/health"));
  await Promise.all([fetchJson(apiUrl("/api/categories?type=question")), fetchJson(apiUrl("/api/categories?type=knowledge"))]);

  const [apiQuestions, apiKnowledge] = await Promise.all([fetchApiContent("question"), fetchApiContent("knowledge")]);
  const mappedQuestions = apiQuestions.map(apiItemToQuestion);
  const mappedKnowledge = apiKnowledge.map(apiItemToKnowledge);

  if (mappedQuestions.length > 0 && mappedKnowledge.length > 0) {
    return {
      questions: mappedQuestions,
      knowledge: mappedKnowledge,
      meta: {
        generatedAt: new Date().toISOString(),
        questionCount: mappedQuestions.length,
        knowledgeCount: mappedKnowledge.length,
        questionCategories: countBy(mappedQuestions, (item) => item.category),
        knowledgeCategories: countBy(mappedKnowledge, (item) => item.category),
        dataSource: "api",
      },
    };
  }

  const staticBundle = await loadFromStatic();
  const questions = mappedQuestions.length > 0 ? mappedQuestions : staticBundle.questions;
  const knowledge = mappedKnowledge.length > 0 ? mappedKnowledge : staticBundle.knowledge;
  const dataSource = mappedQuestions.length === 0 && mappedKnowledge.length === 0 ? "static" : "mixed";

  return {
    questions,
    knowledge,
    meta: {
      generatedAt: new Date().toISOString(),
      questionCount: questions.length,
      knowledgeCount: knowledge.length,
      questionCategories: countBy(questions, (item) => item.category),
      knowledgeCategories: countBy(knowledge, (item) => item.category),
      dataSource,
    },
  };
}

async function loadFromStatic(): Promise<ContentBundle> {
  const [questions, knowledge, meta] = await Promise.all([
    loadStaticJson<QuestionItem[]>("questions.json"),
    loadStaticJson<KnowledgeItem[]>("knowledge.json"),
    loadStaticJson<GeneratedMeta>("meta.json"),
  ]);

  return {
    questions,
    knowledge,
    meta: {
      ...meta,
      dataSource: "static",
    },
  };
}

export async function loadContentBundle(): Promise<ContentBundle> {
  try {
    return await loadFromApi();
  } catch (apiError) {
    try {
      return await loadFromStatic();
    } catch (staticError) {
      const apiMessage = apiError instanceof Error ? apiError.message : "API 加载失败";
      const staticMessage = staticError instanceof Error ? staticError.message : "静态数据加载失败";
      throw new Error(`API 与静态题库数据都不可用。API：${apiMessage}；静态：${staticMessage}`);
    }
  }
}
