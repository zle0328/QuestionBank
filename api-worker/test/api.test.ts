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
    const firstResponse = await handleRequest(
      adminPost("/api/admin/candidates/batch", {
        items: [
          {
            id: "candidate-1",
            type: "question",
            title: "Vue diff 算法是什么？",
            category: "前端",
            contentMd: "虚拟 DOM 对比并复用节点。",
            hash: "same-hash",
            sourceUrl: "https://source.test/vue-diff",
          },
          {
            id: "candidate-2",
            type: "question",
            title: "Vue diff 算法是什么？",
            category: "前端",
            contentMd: "虚拟 DOM 对比并复用节点。",
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
