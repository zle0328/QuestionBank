export function normalizeSearchText(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

export interface WeightedSearchField {
  value: string | string[] | undefined;
  weight: number;
}

function flattenSearchField(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value.join(" ") : (value ?? "");
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function searchTerms(query: string): string[] {
  const normalizedQuery = normalizeSearchText(query);
  if (!normalizedQuery) return [];

  return Array.from(new Set(normalizedQuery.split(" ").filter(Boolean))).sort((left, right) => right.length - left.length);
}

export function matchesText(fields: Array<string | string[] | undefined>, query: string): boolean {
  const normalizedQuery = normalizeSearchText(query);
  if (!normalizedQuery) return true;

  const haystack = normalizeSearchText(
    fields
      .flatMap((field) => (Array.isArray(field) ? field : [field ?? ""]))
      .join(" "),
  );

  return normalizedQuery.split(" ").every((part) => haystack.includes(part));
}

export function searchScore(fields: WeightedSearchField[], query: string): number {
  const terms = searchTerms(query);
  if (terms.length === 0) return 1;

  const haystacks = fields.map((field) => ({
    text: normalizeSearchText(flattenSearchField(field.value)),
    weight: field.weight,
  }));
  const combined = haystacks.map((field) => field.text).join(" ");
  if (!terms.every((term) => combined.includes(term))) return 0;

  return terms.reduce((total, term) => {
    const termScore = haystacks.reduce((score, field) => {
      if (!field.text.includes(term)) return score;

      const exactBoost = field.text === term ? field.weight * 3 : 0;
      const prefixBoost = field.text.startsWith(term) ? field.weight * 1.5 : 0;
      return score + field.weight + exactBoost + prefixBoost;
    }, 0);

    return total + termScore;
  }, 0);
}

export function highlightMatches(value: string | undefined, query: string): string {
  const safeValue = escapeHtml(value ?? "");
  const terms = searchTerms(query);
  if (terms.length === 0 || !safeValue) return safeValue;

  const pattern = new RegExp(`(${terms.map(escapeRegExp).join("|")})`, "gi");
  return safeValue.replace(pattern, "<mark>$1</mark>");
}

export function countBy<T>(items: T[], getKey: (item: T) => string): Record<string, number> {
  return items.reduce<Record<string, number>>((acc, item) => {
    const key = getKey(item) || "未分类";
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});
}
