import { afterEach, describe, expect, it, vi } from "vitest";
import { loadContentBundle, plainTextToHtml } from "../src/api/content";

function jsonResponse(value: unknown) {
  return new Response(JSON.stringify(value), {
    headers: {
      "Content-Type": "application/json",
    },
  });
}

describe("api content mapping", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders plain API content as safe readable paragraphs", () => {
    const html = plainTextToHtml("第一段正文。\n\n第二段 <script>alert(1)</script>");

    expect(html).toBe("<p>第一段正文。</p><p>第二段 &lt;script&gt;alert(1)&lt;/script&gt;</p>");
  });

  it("fills missing API questions from static generated data", async () => {
    const fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/health" || url.startsWith("/api/categories")) {
        return jsonResponse({ ok: true, items: [] });
      }
      if (url.startsWith("/api/content?type=question")) {
        return jsonResponse({ items: [], page: 1, pageSize: 1000, total: 0 });
      }
      if (url.startsWith("/api/content?type=knowledge")) {
        return jsonResponse({
          items: [
            {
              id: "api-knowledge-1",
              type: "knowledge",
              title: "API Redis 知识",
              category: "数据库",
              tags: ["Redis"],
              excerpt: "Redis 知识摘要。",
              content: "Redis 知识正文。",
              status: "published",
              sourceName: "api",
            },
          ],
          page: 1,
          pageSize: 1000,
          total: 1,
        });
      }
      if (url.endsWith("/data/generated/questions.json")) {
        return jsonResponse([
          {
            id: "static-question-1",
            title: "静态 Java 题",
            source: "code-roadmap",
            category: "Java",
            tags: ["线程池"],
            sourcePath: "code-roadmap-main/question.md",
            content: "线程池题解。",
            contentHtml: "<p>线程池题解。</p>",
            sections: [],
            excerpt: "线程池题。",
          },
        ]);
      }
      if (url.endsWith("/data/generated/knowledge.json")) {
        return jsonResponse([]);
      }
      if (url.endsWith("/data/generated/meta.json")) {
        return jsonResponse({
          generatedAt: "2026-06-02T00:00:00.000Z",
          questionCount: 1,
          knowledgeCount: 0,
          questionCategories: { Java: 1 },
          knowledgeCategories: {},
        });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });

    vi.stubGlobal("fetch", fetch);

    const bundle = await loadContentBundle();

    expect(bundle.questions).toHaveLength(1);
    expect(bundle.questions[0].title).toBe("静态 Java 题");
    expect(bundle.knowledge).toHaveLength(1);
    expect(bundle.knowledge[0].title).toBe("API Redis 知识");
    expect(bundle.meta.dataSource).toBe("mixed");
    expect(bundle.meta.questionCount).toBe(1);
    expect(bundle.meta.knowledgeCount).toBe(1);
  });
});
