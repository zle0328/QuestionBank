export interface ContentSection {
  title: string;
  level: number;
  content: string;
  html: string;
  excerpt: string;
}

export interface QuestionItem {
  id: string;
  title: string;
  source: "code-roadmap" | string;
  category: string;
  tags: string[];
  sourcePath: string;
  content: string;
  contentHtml: string;
  sections: ContentSection[];
  excerpt: string;
}

export interface KnowledgeItem {
  id: string;
  title: string;
  source: "JavaGuide" | string;
  category: string;
  tags: string[];
  description: string;
  sourcePath: string;
  content: string;
  contentHtml: string;
  excerpt: string;
}

export interface GeneratedMeta {
  generatedAt: string;
  questionCount: number;
  knowledgeCount: number;
  questionCategories: Record<string, number>;
  knowledgeCategories: Record<string, number>;
  dataSource?: "api" | "static";
}

export type AppMode = "questions" | "knowledge" | "favorites" | "review" | "mastered";
