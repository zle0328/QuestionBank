import type {
  ApiContentItem,
  ContentItemRow,
  ContentStatus,
  ListContentOptions,
  NormalizedContentItem,
} from "./types";
import { escapeSqlLike, parseJsonArray, safeJsonArray } from "./utils";

interface CountRow {
  total: number;
}

interface CategoryRow {
  category: string;
  count: number;
}

interface DuplicateRow {
  id: string;
  status: ContentStatus;
  hash: string;
  source_url: string | null;
}

interface InsertResult {
  id: string;
  status: ContentStatus;
  duplicateOf?: string;
}

export function rowToApiContentItem(row: ContentItemRow): ApiContentItem {
  return {
    id: row.id,
    type: row.type,
    title: row.title,
    category: row.category,
    tags: parseJsonArray<string>(row.tags_json, []),
    excerpt: row.excerpt,
    content: row.content_md,
    contentHtml: row.content_html,
    sections: parseJsonArray(row.sections_json, []),
    sourceUrl: row.source_url ?? "",
    sourceName: row.source_name,
    sourcePath: row.source_path ?? "",
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    publishedAt: row.published_at,
  };
}

function makeWhereClause(options: ListContentOptions): { sql: string; params: unknown[] } {
  const clauses = ["status = ?"];
  const params: unknown[] = [options.status ?? "published"];

  if (options.type) {
    clauses.push("type = ?");
    params.push(options.type);
  }

  if (options.category) {
    clauses.push("category = ?");
    params.push(options.category);
  }

  if (options.q) {
    const like = `%${escapeSqlLike(options.q)}%`;
    clauses.push(
      "(title LIKE ? ESCAPE '\\' OR category LIKE ? ESCAPE '\\' OR tags_json LIKE ? ESCAPE '\\' OR excerpt LIKE ? ESCAPE '\\' OR content_md LIKE ? ESCAPE '\\')",
    );
    params.push(like, like, like, like, like);
  }

  return {
    sql: `WHERE ${clauses.join(" AND ")}`,
    params,
  };
}

export async function listContent(db: D1Database, options: ListContentOptions) {
  const where = makeWhereClause(options);
  const offset = (options.page - 1) * options.pageSize;
  const totalRow = await db
    .prepare(`SELECT COUNT(*) AS total FROM content_items ${where.sql}`)
    .bind(...where.params)
    .first<CountRow>();

  const result = await db
    .prepare(
      `SELECT * FROM content_items ${where.sql} ORDER BY published_at DESC, updated_at DESC, title ASC LIMIT ? OFFSET ?`,
    )
    .bind(...where.params, options.pageSize, offset)
    .all<ContentItemRow>();

  return {
    items: (result.results ?? []).map(rowToApiContentItem),
    page: options.page,
    pageSize: options.pageSize,
    total: totalRow?.total ?? 0,
  };
}

export async function getContentById(db: D1Database, id: string, status: ContentStatus = "published") {
  const row = await db
    .prepare("SELECT * FROM content_items WHERE id = ? AND status = ? LIMIT 1")
    .bind(id, status)
    .first<ContentItemRow>();
  return row ? rowToApiContentItem(row) : null;
}

export async function listCategories(db: D1Database, type?: string) {
  const params: unknown[] = ["published"];
  const typeClause = type ? "AND type = ?" : "";
  if (type) params.push(type);

  const result = await db
    .prepare(
      `SELECT category, COUNT(*) AS count FROM content_items WHERE status = ? ${typeClause} GROUP BY category ORDER BY category ASC`,
    )
    .bind(...params)
    .all<CategoryRow>();

  return (result.results ?? []).map((item) => ({
    name: item.category || "未分类",
    count: item.count,
  }));
}

async function findDuplicate(db: D1Database, item: NormalizedContentItem) {
  const byHash = await db
    .prepare("SELECT id, status, hash, source_url FROM content_items WHERE hash = ? LIMIT 1")
    .bind(item.hash)
    .first<DuplicateRow>();
  if (byHash) return byHash;

  if (!item.sourceUrl) return null;
  return await db
    .prepare("SELECT id, status, hash, source_url FROM content_items WHERE source_url = ? LIMIT 1")
    .bind(item.sourceUrl)
    .first<DuplicateRow>();
}

export async function upsertContentItem(db: D1Database, item: NormalizedContentItem): Promise<InsertResult> {
  const duplicate = await findDuplicate(db, item);
  const nextStatus: ContentStatus = duplicate ? "duplicate" : item.status;
  const now = new Date().toISOString();
  const publishedAt = nextStatus === "published" ? now : null;

  await db
    .prepare(
      `INSERT INTO content_items (
        id, type, title, category, tags_json, excerpt, content_md, content_html, sections_json,
        source_url, source_name, source_path, status, hash, created_at, updated_at, published_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        title = excluded.title,
        category = excluded.category,
        tags_json = excluded.tags_json,
        excerpt = excluded.excerpt,
        content_md = excluded.content_md,
        content_html = excluded.content_html,
        sections_json = excluded.sections_json,
        source_url = excluded.source_url,
        source_name = excluded.source_name,
        source_path = excluded.source_path,
        status = excluded.status,
        hash = excluded.hash,
        updated_at = excluded.updated_at,
        published_at = COALESCE(content_items.published_at, excluded.published_at)`,
    )
    .bind(
      item.id,
      item.type,
      item.title,
      item.category,
      safeJsonArray(item.tags),
      item.excerpt,
      item.contentMd,
      item.contentHtml,
      JSON.stringify(item.sections),
      item.sourceUrl || null,
      item.sourceName,
      item.sourcePath || null,
      nextStatus,
      item.hash,
      now,
      now,
      publishedAt,
    )
    .run();

  return {
    id: item.id,
    status: nextStatus,
    duplicateOf: duplicate?.id,
  };
}

export async function updateContentStatus(db: D1Database, id: string, status: Extract<ContentStatus, "published" | "rejected">) {
  const now = new Date().toISOString();
  const result = await db
    .prepare(
      "UPDATE content_items SET status = ?, updated_at = ?, published_at = CASE WHEN ? = 'published' THEN COALESCE(published_at, ?) ELSE published_at END WHERE id = ?",
    )
    .bind(status, now, status, now, id)
    .run();

  return (result.meta?.changes ?? 0) > 0;
}

export async function createCrawlJob(db: D1Database, payload: { sourceId?: string; config?: unknown; status?: string }) {
  const id = `job-${crypto.randomUUID()}`;
  const now = new Date().toISOString();
  await db
    .prepare(
      "INSERT INTO crawl_jobs (id, source_id, status, config_json, created_at) VALUES (?, ?, ?, ?, ?)",
    )
    .bind(id, payload.sourceId ?? null, payload.status ?? "queued", JSON.stringify(payload.config ?? {}), now)
    .run();

  return { id, status: payload.status ?? "queued", createdAt: now };
}
