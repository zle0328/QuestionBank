import type { ContentItemRow } from "../src/types";

interface FakeMeta {
  changes?: number;
}

interface FakeRunResult {
  success: boolean;
  meta: FakeMeta;
}

interface CrawlJobRow {
  id: string;
  source_id: string | null;
  status: string;
  config_json: string;
  created_at: string;
}

type Row = ContentItemRow | CrawlJobRow | { total: number } | { category: string; count: number };

class FakeStatement {
  private params: unknown[] = [];

  constructor(
    private readonly sql: string,
    private readonly db: FakeD1Database,
  ) {}

  bind(...params: unknown[]) {
    this.params = params;
    return this;
  }

  async first<T = Row>(): Promise<T | null> {
    if (this.sql.includes("COUNT(*) AS total")) {
      return { total: this.db.filterContent(this.sql, this.params).length } as T;
    }

    if (this.sql.includes("WHERE id = ? AND status = ?")) {
      const [id, status] = this.params;
      return (this.db.contentItems.find((item) => item.id === id && item.status === status) ?? null) as T | null;
    }

    if (this.sql.includes("WHERE hash = ?")) {
      const [hash, excludedId] = this.params;
      return (this.db.contentItems.find((item) => item.hash === hash && item.id !== excludedId) ?? null) as T | null;
    }

    if (this.sql.includes("WHERE source_url = ?")) {
      const [sourceUrl, excludedId] = this.params;
      return (this.db.contentItems.find((item) => item.source_url === sourceUrl && item.id !== excludedId) ?? null) as T | null;
    }

    if (this.sql.includes("WHERE type = ? AND title_key = ?")) {
      const [type, titleKey, excludedId] = this.params;
      return (this.db.contentItems.find((item) => item.type === type && item.title_key === titleKey && item.id !== excludedId) ?? null) as T | null;
    }

    return null;
  }

  async all<T = Row>(): Promise<{ results: T[]; success: boolean; meta: FakeMeta }> {
    if (this.sql.includes("GROUP BY category")) {
      const status = this.params[0];
      const type = this.params[1];
      const counts = new Map<string, number>();
      for (const item of this.db.contentItems) {
        if (item.status !== status) continue;
        if (type && item.type !== type) continue;
        counts.set(item.category, (counts.get(item.category) ?? 0) + 1);
      }
      const results = Array.from(counts, ([category, count]) => ({ category, count })).sort((left, right) =>
        left.category.localeCompare(right.category, "zh-CN"),
      );
      return { results: results as T[], success: true, meta: {} };
    }

    if (this.sql.includes("FROM content_items")) {
      const limit = Number(this.params[this.params.length - 2] ?? 1000);
      const offset = Number(this.params[this.params.length - 1] ?? 0);
      const results = this.db
        .filterContent(this.sql, this.params.slice(0, -2))
        .sort((left, right) => right.updated_at.localeCompare(left.updated_at) || left.title.localeCompare(right.title))
        .slice(offset, offset + limit);
      return { results: results as T[], success: true, meta: {} };
    }

    return { results: [], success: true, meta: {} };
  }

  async run(): Promise<FakeRunResult> {
    if (this.sql.includes("INSERT INTO content_items")) {
      this.db.upsertContent(this.params);
      return { success: true, meta: { changes: 1 } };
    }

    if (this.sql.includes("UPDATE content_items SET status")) {
      const [status, updatedAt, , publishedAt, id] = this.params;
      const item = this.db.contentItems.find((row) => row.id === id);
      if (!item) return { success: true, meta: { changes: 0 } };
      item.status = status as ContentItemRow["status"];
      item.updated_at = String(updatedAt);
      if (status === "published" && !item.published_at) {
        item.published_at = String(publishedAt);
      }
      return { success: true, meta: { changes: 1 } };
    }

    if (this.sql.includes("INSERT INTO crawl_jobs")) {
      const [id, sourceId, status, configJson, createdAt] = this.params;
      this.db.crawlJobs.push({
        id: String(id),
        source_id: sourceId ? String(sourceId) : null,
        status: String(status),
        config_json: String(configJson),
        created_at: String(createdAt),
      });
      return { success: true, meta: { changes: 1 } };
    }

    return { success: true, meta: { changes: 0 } };
  }
}

export class FakeD1Database {
  readonly contentItems: ContentItemRow[] = [];
  readonly crawlJobs: CrawlJobRow[] = [];

  prepare(sql: string) {
    return new FakeStatement(sql, this);
  }

  filterContent(sql: string, params: unknown[]) {
    let index = 0;
    const status = params[index++];
    const hasType = sql.includes("type = ?");
    const type = hasType ? params[index++] : undefined;
    const hasCategory = sql.includes("category = ?");
    const category = hasCategory ? params[index++] : undefined;
    const hasSearch = sql.includes("LIKE ?");
    const query = hasSearch ? String(params[index] ?? "").replace(/^%|%$/g, "").toLowerCase() : "";

    return this.contentItems.filter((item) => {
      if (item.status !== status) return false;
      if (type && item.type !== type) return false;
      if (category && item.category !== category) return false;
      if (!query) return true;
      const haystack = `${item.title} ${item.category} ${item.tags_json} ${item.excerpt} ${item.content_md}`.toLowerCase();
      return haystack.includes(query);
    });
  }

  upsertContent(params: unknown[]) {
    const [
      id,
      type,
      title,
      category,
      tagsJson,
      excerpt,
      contentMd,
      contentHtml,
      sectionsJson,
      sourceUrl,
      sourceName,
      sourcePath,
      status,
      hash,
      titleKey,
      duplicateOf,
      reviewScore,
      reviewFlagsJson,
      reviewReason,
      reviewedAt,
      createdAt,
      updatedAt,
      publishedAt,
    ] = params;
    const existing = this.contentItems.find((item) => item.id === id);
    const next: ContentItemRow = {
      id: String(id),
      type: type as ContentItemRow["type"],
      title: String(title),
      category: String(category),
      tags_json: String(tagsJson),
      excerpt: String(excerpt),
      content_md: String(contentMd),
      content_html: String(contentHtml),
      sections_json: String(sectionsJson),
      source_url: sourceUrl ? String(sourceUrl) : null,
      source_name: String(sourceName),
      source_path: sourcePath ? String(sourcePath) : null,
      status: status as ContentItemRow["status"],
      hash: String(hash),
      title_key: String(titleKey ?? ""),
      duplicate_of: duplicateOf ? String(duplicateOf) : null,
      review_score: Number(reviewScore ?? 0),
      review_flags_json: String(reviewFlagsJson ?? "[]"),
      review_reason: String(reviewReason ?? ""),
      reviewed_at: reviewedAt ? String(reviewedAt) : null,
      created_at: String(createdAt),
      updated_at: String(updatedAt),
      published_at: publishedAt ? String(publishedAt) : null,
    };

    if (existing) {
      Object.assign(existing, next, { created_at: existing.created_at, published_at: existing.published_at ?? next.published_at });
    } else {
      this.contentItems.push(next);
    }
  }
}
