import { HttpError, errorResponse, jsonResponse, readJsonBody, requireBearerToken } from "./http";
import {
  createCrawlJob,
  getContentById,
  listCategories,
  listContent,
  updateContentStatus,
  upsertContentItem,
} from "./repository";
import type { ContentItemInput, Env } from "./types";
import { isContentType, normalizeContentInput, parsePositiveInt } from "./utils";

function responseOrigin(request: Request, env: Env): string | null {
  return env.ALLOWED_ORIGIN || request.headers.get("origin") || "*";
}

function notFound(): never {
  throw new HttpError(404, "not_found", "The requested API route was not found.");
}

async function handleListContent(url: URL, env: Env) {
  const typeParam = url.searchParams.get("type");
  if (typeParam && !isContentType(typeParam)) {
    throw new HttpError(400, "invalid_type", "type must be question or knowledge.");
  }
  const type = typeParam && isContentType(typeParam) ? typeParam : undefined;

  const data = await listContent(env.DB, {
    type,
    q: url.searchParams.get("q")?.trim() || undefined,
    category: url.searchParams.get("category")?.trim() || undefined,
    page: parsePositiveInt(url.searchParams.get("page"), 1, 100000),
    pageSize: parsePositiveInt(url.searchParams.get("pageSize"), 1000, 2000),
    status: "published",
  });

  return data;
}

async function handleCategories(url: URL, env: Env) {
  const typeParam = url.searchParams.get("type");
  if (typeParam && !isContentType(typeParam)) {
    throw new HttpError(400, "invalid_type", "type must be question or knowledge.");
  }
  const type = typeParam && isContentType(typeParam) ? typeParam : undefined;

  return {
    items: await listCategories(env.DB, type),
  };
}

async function handleImportLocal(request: Request, env: Env) {
  const body = await readJsonBody<{ questions?: ContentItemInput[]; knowledge?: ContentItemInput[] }>(request);
  const questions = Array.isArray(body.questions) ? body.questions.map((item) => ({ ...item, type: "question" as const })) : [];
  const knowledge = Array.isArray(body.knowledge) ? body.knowledge.map((item) => ({ ...item, type: "knowledge" as const })) : [];
  const items = [...questions, ...knowledge];

  const results = [];
  for (const input of items) {
    const normalized = await normalizeContentInput(input, "published");
    results.push(await upsertContentItem(env.DB, normalized));
  }

  return {
    imported: results.length,
    published: results.filter((item) => item.status === "published").length,
    duplicates: results.filter((item) => item.status === "duplicate").length,
    items: results,
  };
}

async function handleCandidateBatch(request: Request, env: Env) {
  const body = await readJsonBody<{ items?: ContentItemInput[]; jobId?: string }>(request);
  const inputs = Array.isArray(body.items) ? body.items : [];
  if (inputs.length === 0) {
    throw new HttpError(400, "empty_batch", "items must contain at least one candidate.");
  }
  if (inputs.length > 100) {
    throw new HttpError(413, "batch_too_large", "A batch can contain at most 100 candidates.");
  }

  const results = [];
  for (const input of inputs) {
    const normalized = await normalizeContentInput(input, "candidate");
    results.push(await upsertContentItem(env.DB, normalized));
  }

  return {
    jobId: body.jobId ?? null,
    accepted: results.length,
    candidates: results.filter((item) => item.status === "candidate").length,
    duplicates: results.filter((item) => item.status === "duplicate").length,
    items: results,
  };
}

async function handleAdmin(request: Request, url: URL, env: Env) {
  requireBearerToken(request, env.ADMIN_TOKEN);

  if (request.method !== "POST") {
    throw new HttpError(405, "method_not_allowed", "Admin routes only support POST.");
  }

  if (url.pathname === "/api/admin/import-local") {
    return handleImportLocal(request, env);
  }

  if (url.pathname === "/api/admin/crawl-jobs") {
    const body = await readJsonBody<{ sourceId?: string; config?: unknown; status?: string }>(request);
    return createCrawlJob(env.DB, body);
  }

  if (url.pathname === "/api/admin/candidates/batch") {
    return handleCandidateBatch(request, env);
  }

  const publishMatch = url.pathname.match(/^\/api\/admin\/content\/([^/]+)\/publish$/);
  if (publishMatch) {
    const updated = await updateContentStatus(env.DB, decodeURIComponent(publishMatch[1]), "published");
    if (!updated) notFound();
    return { id: decodeURIComponent(publishMatch[1]), status: "published" };
  }

  const rejectMatch = url.pathname.match(/^\/api\/admin\/content\/([^/]+)\/reject$/);
  if (rejectMatch) {
    const updated = await updateContentStatus(env.DB, decodeURIComponent(rejectMatch[1]), "rejected");
    if (!updated) notFound();
    return { id: decodeURIComponent(rejectMatch[1]), status: "rejected" };
  }

  notFound();
}

export async function handleRequest(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const origin = responseOrigin(request, env);

  if (request.method === "OPTIONS") {
    return jsonResponse({}, { status: 204 }, origin);
  }

  try {
    if (url.pathname === "/api/health") {
      return jsonResponse({ ok: true, service: "question-bank-api" }, undefined, origin);
    }

    if (url.pathname === "/api/content" && request.method === "GET") {
      return jsonResponse(await handleListContent(url, env), undefined, origin);
    }

    const contentMatch = url.pathname.match(/^\/api\/content\/([^/]+)$/);
    if (contentMatch && request.method === "GET") {
      const item = await getContentById(env.DB, decodeURIComponent(contentMatch[1]), "published");
      if (!item) notFound();
      return jsonResponse({ item }, undefined, origin);
    }

    if (url.pathname === "/api/categories" && request.method === "GET") {
      return jsonResponse(await handleCategories(url, env), undefined, origin);
    }

    if (url.pathname.startsWith("/api/admin/")) {
      return jsonResponse(await handleAdmin(request, url, env), undefined, origin);
    }

    notFound();
  } catch (error) {
    return errorResponse(error, origin);
  }
}

export default {
  fetch(request: Request, env: Env) {
    return handleRequest(request, env);
  },
};
