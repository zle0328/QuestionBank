export type ContentType = "question" | "knowledge";
export type ContentStatus = "candidate" | "published" | "rejected" | "duplicate";

export interface Env {
  DB: D1Database;
  ADMIN_TOKEN?: string;
  ALLOWED_ORIGIN?: string;
}

export interface ContentSection {
  title: string;
  level: number;
  content: string;
  html: string;
  excerpt: string;
}

export interface ContentItemRow {
  id: string;
  type: ContentType;
  title: string;
  category: string;
  tags_json: string;
  excerpt: string;
  content_md: string;
  content_html: string;
  sections_json: string;
  source_url: string | null;
  source_name: string;
  source_path: string | null;
  status: ContentStatus;
  hash: string;
  created_at: string;
  updated_at: string;
  published_at: string | null;
}

export interface ContentItemInput {
  id?: string;
  type: ContentType;
  title: string;
  category?: string;
  tags?: string[];
  excerpt?: string;
  content?: string;
  contentMd?: string;
  contentHtml?: string;
  sections?: ContentSection[];
  sourceUrl?: string;
  source_url?: string;
  sourceName?: string;
  source_name?: string;
  source?: string;
  sourcePath?: string;
  source_path?: string;
  status?: ContentStatus;
  hash?: string;
}

export interface ListContentOptions {
  type?: ContentType;
  q?: string;
  category?: string;
  page: number;
  pageSize: number;
  status?: ContentStatus;
}

export interface NormalizedContentItem {
  id: string;
  type: ContentType;
  title: string;
  category: string;
  tags: string[];
  excerpt: string;
  contentMd: string;
  contentHtml: string;
  sections: ContentSection[];
  sourceUrl: string;
  sourceName: string;
  sourcePath: string;
  status: ContentStatus;
  hash: string;
}

export interface ApiContentItem {
  id: string;
  type: ContentType;
  title: string;
  category: string;
  tags: string[];
  excerpt: string;
  content: string;
  contentHtml: string;
  sections: ContentSection[];
  sourceUrl: string;
  sourceName: string;
  sourcePath: string;
  status: ContentStatus;
  createdAt: string;
  updatedAt: string;
  publishedAt: string | null;
}
