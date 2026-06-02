import { describe, expect, it } from "vitest";
import { handleRequest } from "../src/index";
import type { Env } from "../src/types";
import { FakeD1Database } from "./fake-d1";

function makeEnv(): Env {
  return {
    DB: new FakeD1Database() as unknown as D1Database,
    ADMIN_TOKEN: "secret-token",
  };
}

async function json(response: Response) {
  return (await response.json()) as Record<string, unknown>;
}

function apiRequest(path: string, init: RequestInit = {}) {
  return new Request(`https://example.test${path}`, init);
}

function adminPost(path: string, body: unknown, token = "secret-token") {
  return apiRequest(path, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

describe("question bank api worker", () => {
  it("returns health status", async () => {
    const response = await handleRequest(apiRequest("/api/health"), makeEnv());
    expect(response.status).toBe(200);
    await expect(json(response)).resolves.toMatchObject({ ok: true, service: "question-bank-api" });
  });

  it("requires admin bearer token for writes", async () => {
    const response = await handleRequest(
      apiRequest("/api/admin/import-local", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ questions: [] }),
      }),
      makeEnv(),
    );

    expect(response.status).toBe(401);
    await expect(json(response)).resolves.toMatchObject({ error: { code: "unauthorized" } });
  });

  it("imports local content as published and exposes only published rows", async () => {
    const env = makeEnv();
    const importResponse = await handleRequest(
      adminPost("/api/admin/import-local", {
        questions: [
          {
            id: "q-1",
            title: "Java 线程池怎么配置？",
            category: "Java",
            tags: ["线程池"],
            content: "回答重点：根据 CPU 和 IO 比例配置。",
            sourcePath: "local/java-thread-pool.md",
          },
        ],
        knowledge: [
          {
            id: "k-1",
            title: "Redis 基础",
            category: "数据库",
            tags: ["Redis"],
            content: "Redis 是内存数据结构存储。",
            sourcePath: "local/redis.md",
          },
        ],
      }),
      env,
    );
    expect(importResponse.status).toBe(200);
    await expect(json(importResponse)).resolves.toMatchObject({ imported: 2, published: 2 });

    const listResponse = await handleRequest(apiRequest("/api/content?type=question&q=线程池"), env);
    const listBody = await json(listResponse);
    expect(listResponse.status).toBe(200);
    expect(listBody).toMatchObject({ total: 1, page: 1 });
    expect(listBody.items).toEqual([
      expect.objectContaining({
        id: "q-1",
        type: "question",
        status: "published",
        title: "Java 线程池怎么配置？",
      }),
    ]);

    const detailResponse = await handleRequest(apiRequest("/api/content/q-1"), env);
    expect(detailResponse.status).toBe(200);
    await expect(json(detailResponse)).resolves.toMatchObject({
      item: { id: "q-1", title: "Java 线程池怎么配置？", status: "published" },
    });
  });

  it("stores crawler batches as candidates and marks repeated hashes as duplicate", async () => {
    const env = makeEnv();
    const candidateContent = "Vue diff 算法是前端面试常见问题，核心是虚拟 DOM 对比、key 复用、节点更新和性能优化。".repeat(20);
    const firstResponse = await handleRequest(
      adminPost("/api/admin/candidates/batch", {
        items: [
          {
            id: "candidate-1",
            type: "question",
            title: "Vue diff 算法是什么？",
            category: "前端",
            contentMd: candidateContent,
            hash: "same-hash",
            sourceUrl: "https://source.test/vue-diff",
          },
          {
            id: "candidate-2",
            type: "question",
            title: "Vue diff 算法是什么？",
            category: "前端",
            contentMd: `${candidateContent} 重复内容。`,
            hash: "same-hash",
            sourceUrl: "https://source.test/vue-diff-copy",
          },
        ],
      }),
      env,
    );
    expect(firstResponse.status).toBe(200);
    await expect(json(firstResponse)).resolves.toMatchObject({ accepted: 2, candidates: 1, duplicates: 1 });

    const listResponse = await handleRequest(apiRequest("/api/content?type=question&q=Vue"), env);
    const listBody = await json(listResponse);
    expect(listResponse.status).toBe(200);
    expect(listBody).toMatchObject({ total: 0 });

    const publishResponse = await handleRequest(adminPost("/api/admin/content/candidate-1/publish", {}), env);
    expect(publishResponse.status).toBe(200);

    const publishedResponse = await handleRequest(apiRequest("/api/content?type=question&q=Vue"), env);
    const publishedBody = await json(publishedResponse);
    expect(publishedBody).toMatchObject({ total: 1 });
  });

  it("auto-publishes trusted high quality candidates", async () => {
    const env = makeEnv();
    const content = "Java 高并发系统面试中，经常会考线程池、Redis 缓存、MySQL 索引、消息队列和分布式锁。".repeat(40);

    const response = await handleRequest(
      adminPost("/api/admin/candidates/batch", {
        items: [
          {
            id: "trusted-1",
            type: "knowledge",
            title: "Java 高并发面试知识总结",
            category: "Java后端进阶",
            tags: ["Java", "高并发"],
            contentMd: content,
            sourceName: "Doocs advanced-java",
            sourceUrl: "https://java.doocs.org/high-concurrency/",
            trustedSource: true,
          },
        ],
      }),
      env,
    );

    expect(response.status).toBe(200);
    await expect(json(response)).resolves.toMatchObject({ accepted: 1, published: 1, candidates: 0, rejected: 0 });

    const listResponse = await handleRequest(apiRequest("/api/content?type=knowledge&q=高并发"), env);
    const listBody = await json(listResponse);
    expect(listBody).toMatchObject({ total: 1 });
  });

  it("rejects weak candidates automatically", async () => {
    const env = makeEnv();
    const response = await handleRequest(
      adminPost("/api/admin/candidates/batch", {
        items: [
          {
            id: "weak-1",
            type: "knowledge",
            title: "首页",
            category: "未分类",
            contentMd: "关注公众号，扫码加群领取资料。",
            sourceUrl: "https://blog.example/",
          },
        ],
      }),
      env,
    );

    expect(response.status).toBe(200);
    const body = await json(response);
    expect(body).toMatchObject({ accepted: 1, published: 0, candidates: 0, rejected: 1 });
    expect(body.items).toEqual([
      expect.objectContaining({
        id: "weak-1",
        status: "rejected",
      }),
    ]);
  });

  it("marks similar titles as duplicates even when content hash differs", async () => {
    const env = makeEnv();
    const content = "Redis 面试会考缓存穿透、缓存击穿、缓存雪崩、分布式锁、持久化和淘汰策略。".repeat(30);
    await handleRequest(
      adminPost("/api/admin/candidates/batch", {
        items: [
          {
            id: "redis-1",
            type: "question",
            title: "Redis 缓存穿透怎么解决？",
            category: "数据库",
            contentMd: content,
            sourceName: "Doocs advanced-java",
            trustedSource: true,
          },
        ],
      }),
      env,
    );

    const response = await handleRequest(
      adminPost("/api/admin/candidates/batch", {
        items: [
          {
            id: "redis-2",
            type: "question",
            title: "Redis缓存穿透怎么解决",
            category: "数据库",
            contentMd: `${content} 布隆过滤器和空值缓存都可以使用。`,
            sourceUrl: "https://another.example/redis-cache-penetration",
          },
        ],
      }),
      env,
    );

    expect(response.status).toBe(200);
    const body = await json(response);
    expect(body).toMatchObject({ accepted: 1, duplicates: 1 });
    expect(body.items).toEqual([
      expect.objectContaining({
        id: "redis-2",
        status: "duplicate",
        duplicateOf: "redis-1",
      }),
    ]);
  });

  it("keeps repeated submits with the same id idempotent", async () => {
    const env = makeEnv();
    const content = "MySQL 索引面试常考 B+ 树、回表、覆盖索引、最左前缀和慢查询优化。".repeat(30);
    const payload = {
      items: [
        {
          id: "mysql-index-1",
          type: "question",
          title: "MySQL 索引为什么用 B+ 树？",
          category: "数据库",
          contentMd: content,
          hash: "mysql-index-hash",
          sourceUrl: "https://source.test/mysql-index",
        },
      ],
    };

    const firstResponse = await handleRequest(adminPost("/api/admin/candidates/batch", payload), env);
    expect(firstResponse.status).toBe(200);
    await expect(json(firstResponse)).resolves.toMatchObject({ accepted: 1, candidates: 1, duplicates: 0 });

    const secondResponse = await handleRequest(adminPost("/api/admin/candidates/batch", payload), env);
    expect(secondResponse.status).toBe(200);
    await expect(json(secondResponse)).resolves.toMatchObject({ accepted: 1, candidates: 1, duplicates: 0 });
  });

  it("updates existing content when the same source url is recrawled", async () => {
    const env = makeEnv();
    const oldContent = "Skip to content Main Navigation Sidebar Navigation 高并发架构 消息队列。";
    const newContent = "Java 高并发面试文章正文，完整讲解消息队列、Redis 缓存、MySQL 索引、分布式锁和系统设计。".repeat(40);

    await handleRequest(
      adminPost("/api/admin/import-local", {
        knowledge: [
          {
            id: "old-nav-summary",
            title: "如何从大量的 URL 中找出相同的 URL？ | advanced-java",
            category: "Java后端进阶",
            content: oldContent,
            sourceUrl: "https://java.doocs.org/big-data/find-common-urls",
            status: "published",
          },
        ],
      }),
      env,
    );

    const response = await handleRequest(
      adminPost("/api/admin/candidates/batch", {
        items: [
          {
            id: "new-full-article",
            type: "knowledge",
            title: "如何从大量的 URL 中找出相同的 URL？",
            category: "Java后端进阶",
            contentMd: newContent,
            sourceName: "Doocs advanced-java",
            sourceUrl: "https://java.doocs.org/big-data/find-common-urls",
            trustedSource: true,
          },
        ],
      }),
      env,
    );

    expect(response.status).toBe(200);
    await expect(json(response)).resolves.toMatchObject({ accepted: 1, published: 1, duplicates: 0 });

    const listResponse = await handleRequest(apiRequest("/api/content?type=knowledge&q=大量"), env);
    const listBody = await json(listResponse);
    expect(listBody).toMatchObject({ total: 1 });
    expect(listBody.items).toEqual([
      expect.objectContaining({
        id: "old-nav-summary",
        title: "如何从大量的 URL 中找出相同的 URL？",
        content: expect.stringContaining("完整讲解消息队列"),
      }),
    ]);
  });

  it("returns published categories by type", async () => {
    const env = makeEnv();
    await handleRequest(
      adminPost("/api/admin/import-local", {
        questions: [{ id: "q-1", title: "MySQL 索引", category: "数据库", content: "索引可以提升查询效率。" }],
        knowledge: [{ id: "k-1", title: "Java 集合", category: "Java", content: "集合框架。" }],
      }),
      env,
    );

    const response = await handleRequest(apiRequest("/api/categories?type=question"), env);
    expect(response.status).toBe(200);
    await expect(json(response)).resolves.toMatchObject({ items: [{ name: "数据库", count: 1 }] });
  });
});
