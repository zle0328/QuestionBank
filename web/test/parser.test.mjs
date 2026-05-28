import { describe, expect, it } from "vitest";
import path from "node:path";
import {
  parseKnowledgeMarkdown,
  parseQuestionMarkdown,
  stripPromotionalLines,
} from "../scripts/content/parser.mjs";

describe("content parser", () => {
  it("parses a code-roadmap interview question into title, category, and sections", () => {
    const rootDir = path.resolve("fixtures", "高频面试题");
    const filePath = path.join(rootDir, "Java 热门面试题 200 道", "Java 中如何创建多线程？.md");
    const raw = `## Java 中如何创建多线程？
> 八股文一网打尽，更多面试题请看[程序员面试刷题神器 - 面试鸭](https://www.mianshiya.com/)

## 回答重点

使用 Runnable、Thread、Callable、线程池等方式。

## 扩展知识

线程池适合管理大量并发任务。
`;

    const item = parseQuestionMarkdown({ raw, filePath, rootDir });

    expect(item.title).toBe("Java 中如何创建多线程？");
    expect(item.category).toBe("Java 热门面试题 200 道");
    expect(item.tags).toContain("Java");
    expect(item.sections.map((section) => section.title)).toEqual(["回答重点", "扩展知识"]);
    expect(item.content).not.toContain("八股文一网打尽");
  });

  it("parses JavaGuide frontmatter as knowledge metadata", () => {
    const rootDir = path.resolve("fixtures", "docs");
    const filePath = path.join(rootDir, "java", "basis", "java-basic-questions-01.md");
    const raw = `---
title: Java基础常见面试题总结(上)
category: Java
description: Java基础常见面试题总结。
tag:
  - Java基础
---

## 基础概念与常识

### Java 语言有哪些特点?

简单易学、面向对象、平台无关。
`;

    const item = parseKnowledgeMarkdown({ raw, filePath, rootDir });

    expect(item.title).toBe("Java基础常见面试题总结(上)");
    expect(item.category).toBe("Java");
    expect(item.description).toBe("Java基础常见面试题总结。");
    expect(item.tags).toEqual(expect.arrayContaining(["Java基础", "Java"]));
  });

  it("falls back to the file name when markdown has no frontmatter or heading", () => {
    const rootDir = path.resolve("fixtures", "高频面试题");
    const filePath = path.join(rootDir, "前端热门面试题 200 道", "什么是事件循环？.md");

    const item = parseQuestionMarkdown({
      raw: "事件循环用于协调调用栈、宏任务和微任务。",
      filePath,
      rootDir,
    });

    expect(item.title).toBe("什么是事件循环？");
    expect(item.sections[0].title).toBe("题解");
    expect(item.excerpt).toContain("事件循环");
  });

  it("removes repeated promotional lines without removing normal links", () => {
    const cleaned = stripPromotionalLines(`
> 八股文一网打尽，更多面试题请看[程序员面试刷题神器 - 面试鸭](https://www.mianshiya.com/)

参考：[相关题目](https://www.mianshiya.com/question/1)
`);

    expect(cleaned).not.toContain("八股文一网打尽");
    expect(cleaned).toContain("相关题目");
  });
});
