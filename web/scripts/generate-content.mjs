import fs from "node:fs/promises";
import path from "node:path";
import fg from "fast-glob";
import {
  parseKnowledgeMarkdown,
  parseQuestionMarkdown,
} from "./content/parser.mjs";

const webRoot = process.cwd();
const repoRoot = path.resolve(webRoot, "..");
const questionRoot = path.join(repoRoot, "code-roadmap-main", "code-roadmap-main", "高频面试题");
const knowledgeRoot = path.join(repoRoot, "JavaGuide-main", "JavaGuide-main", "docs");
const outputRoots = [
  path.join(webRoot, "src", "data", "generated"),
  path.join(webRoot, "public", "data", "generated"),
];

async function readMarkdownFiles(root, patterns) {
  const files = await fg(patterns, {
    cwd: root,
    absolute: true,
    onlyFiles: true,
    dot: false,
  });

  return Promise.all(
    files.map(async (filePath) => ({
      filePath,
      raw: await fs.readFile(filePath, "utf8"),
    })),
  );
}

function countBy(items, key) {
  return items.reduce((acc, item) => {
    const value = item[key] || "未分类";
    acc[value] = (acc[value] ?? 0) + 1;
    return acc;
  }, {});
}

function sortedEntries(record) {
  return Object.fromEntries(
    Object.entries(record).sort(([left], [right]) => left.localeCompare(right, "zh-CN")),
  );
}

function assertUsefulContent(questions, knowledge) {
  if (questions.length === 0) {
    throw new Error("No questions were generated from code-roadmap.");
  }

  if (knowledge.length === 0) {
    throw new Error("No knowledge articles were generated from JavaGuide.");
  }

  const categoryText = questions.map((item) => item.category).join(" ");
  for (const expected of ["Java", "前端", "后端"]) {
    if (!categoryText.includes(expected)) {
      throw new Error(`Expected question category containing "${expected}".`);
    }
  }
}

async function main() {
  const [questionFiles, knowledgeFiles] = await Promise.all([
    readMarkdownFiles(questionRoot, ["**/*.md", "!**/README.md"]),
    readMarkdownFiles(knowledgeRoot, [
      "**/*.md",
      "!snippets/**",
      "!.vuepress/**",
      "!**/TODO.md",
    ]),
  ]);

  const questions = questionFiles
    .map(({ filePath, raw }) => {
      const item = parseQuestionMarkdown({ raw, filePath, rootDir: questionRoot });
      return {
        ...item,
        sourcePath: `code-roadmap-main/code-roadmap-main/高频面试题/${item.sourcePath}`,
      };
    })
    .sort((left, right) =>
      `${left.category}/${left.title}`.localeCompare(`${right.category}/${right.title}`, "zh-CN"),
    );

  const knowledge = knowledgeFiles
    .map(({ filePath, raw }) => {
      const item = parseKnowledgeMarkdown({ raw, filePath, rootDir: knowledgeRoot });
      return {
        ...item,
        sourcePath: `JavaGuide-main/JavaGuide-main/docs/${item.sourcePath}`,
      };
    })
    .sort((left, right) =>
      `${left.category}/${left.title}`.localeCompare(`${right.category}/${right.title}`, "zh-CN"),
    );

  assertUsefulContent(questions, knowledge);

  const meta = {
    generatedAt: new Date().toISOString(),
    questionCount: questions.length,
    knowledgeCount: knowledge.length,
    questionCategories: sortedEntries(countBy(questions, "category")),
    knowledgeCategories: sortedEntries(countBy(knowledge, "category")),
  };

  await Promise.all(
    outputRoots.map(async (outputRoot) => {
      await fs.mkdir(outputRoot, { recursive: true });
      await Promise.all([
        fs.writeFile(path.join(outputRoot, "questions.json"), `${JSON.stringify(questions, null, 2)}\n`),
        fs.writeFile(path.join(outputRoot, "knowledge.json"), `${JSON.stringify(knowledge, null, 2)}\n`),
        fs.writeFile(path.join(outputRoot, "meta.json"), `${JSON.stringify(meta, null, 2)}\n`),
      ]);
    }),
  );

  console.log(`Generated ${questions.length} questions and ${knowledge.length} knowledge articles.`);
  console.log(
    `Question categories: ${Object.entries(meta.questionCategories)
      .map(([name, count]) => `${name}(${count})`)
      .join(", ")}`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
