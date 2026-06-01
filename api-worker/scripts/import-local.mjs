import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const workerDir = path.resolve(__dirname, "..");
const repoRoot = path.resolve(workerDir, "..");
const generatedDir = path.resolve(repoRoot, "web", "public", "data", "generated");
const batchSize = Number.parseInt(process.env.IMPORT_BATCH_SIZE ?? "40", 10);

function requiredEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required.`);
  }
  return value;
}

async function readJson(fileName) {
  const filePath = path.join(generatedDir, fileName);
  return JSON.parse(await fs.readFile(filePath, "utf8"));
}

function mapQuestion(item) {
  return {
    id: item.id,
    type: "question",
    title: item.title,
    category: item.category,
    tags: item.tags,
    excerpt: item.excerpt,
    content: item.content,
    contentHtml: item.contentHtml,
    sections: item.sections,
    sourceName: item.source,
    sourcePath: item.sourcePath,
  };
}

function mapKnowledge(item) {
  return {
    id: item.id,
    type: "knowledge",
    title: item.title,
    category: item.category,
    tags: item.tags,
    excerpt: item.description || item.excerpt,
    content: item.content,
    contentHtml: item.contentHtml,
    sourceName: item.source,
    sourcePath: item.sourcePath,
  };
}

async function main() {
  const apiBaseUrl = requiredEnv("ADMIN_API_BASE_URL").replace(/\/+$/, "");
  const adminToken = requiredEnv("ADMIN_TOKEN");
  const [questions, knowledge] = await Promise.all([readJson("questions.json"), readJson("knowledge.json")]);
  const items = [...questions.map(mapQuestion), ...knowledge.map(mapKnowledge)];
  const summary = {
    imported: 0,
    published: 0,
    duplicates: 0,
    batches: 0,
  };

  for (let index = 0; index < items.length; index += batchSize) {
    const batch = items.slice(index, index + batchSize);
    const body = JSON.stringify({
      questions: batch.filter((item) => item.type === "question"),
      knowledge: batch.filter((item) => item.type === "knowledge"),
    });

    const response = await fetch(`${apiBaseUrl}/api/admin/import-local`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${adminToken}`,
        "content-type": "application/json",
      },
      body,
    });

    const text = await response.text();
    if (!response.ok) {
      throw new Error(`Import batch ${summary.batches + 1} failed with ${response.status}: ${text}`);
    }

    const result = JSON.parse(text);
    summary.imported += result.imported ?? 0;
    summary.published += result.published ?? 0;
    summary.duplicates += result.duplicates ?? 0;
    summary.batches += 1;
    console.log(`Imported batch ${summary.batches}: ${result.imported ?? 0} items`);
  }

  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
