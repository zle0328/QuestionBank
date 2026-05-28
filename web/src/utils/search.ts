export function normalizeSearchText(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
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

export function countBy<T>(items: T[], getKey: (item: T) => string): Record<string, number> {
  return items.reduce<Record<string, number>>((acc, item) => {
    const key = getKey(item) || "未分类";
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});
}
