<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import {
  ArrowLeft,
  BookOpen,
  CheckCircle2,
  ChevronLeft,
  ChevronDown,
  ChevronRight,
  Clock3,
  ExternalLink,
  Filter,
  LibraryBig,
  Menu,
  RotateCcw,
  Search,
  Star,
  X,
} from "@lucide/vue";
import type { AppMode, GeneratedMeta, KnowledgeItem, QuestionItem } from "./types";
import { loadContentBundle } from "./api/content";
import { countBy, highlightMatches, searchScore } from "./utils/search";
import { readSet, readStringArray, writeSet, writeStringArray } from "./utils/storage";

const emptyMeta: GeneratedMeta = {
  generatedAt: "",
  questionCount: 0,
  knowledgeCount: 0,
  questionCategories: {},
  knowledgeCategories: {},
};

const questions = ref<QuestionItem[]>([]);
const knowledge = ref<KnowledgeItem[]>([]);
const meta = ref<GeneratedMeta>(emptyMeta);
const isLoading = ref(true);
const loadError = ref("");

const STORAGE_KEYS = {
  favorites: "question-bank:favorites",
  mastered: "question-bank:mastered",
  review: "question-bank:review",
  recent: "question-bank:recent",
};

const modeItems = [
  { id: "questions" as const, label: "题库", icon: LibraryBig },
  { id: "knowledge" as const, label: "知识库", icon: BookOpen },
  { id: "favorites" as const, label: "收藏", icon: Star },
  { id: "review" as const, label: "待复习", icon: Clock3 },
  { id: "mastered" as const, label: "已掌握", icon: CheckCircle2 },
];

const mode = ref<AppMode>("questions");
const query = ref("");
const selectedCategory = ref("全部");
const mobileFiltersOpen = ref(false);
const favoriteIds = ref(readSet(STORAGE_KEYS.favorites));
const masteredIds = ref(readSet(STORAGE_KEYS.mastered));
const reviewIds = ref(readSet(STORAGE_KEYS.review));
const revealedIds = ref(new Set<string>());
const recentIds = ref(readStringArray(STORAGE_KEYS.recent));
const selectedQuestionId = ref("");
const selectedKnowledgeId = ref("");
const mobileDetailOpen = ref(false);

const isQuestionMode = computed(() => mode.value !== "knowledge");
const questionPool = computed(() => {
  if (mode.value === "favorites") {
    return questions.value.filter((item) => favoriteIds.value.has(item.id));
  }

  if (mode.value === "mastered") {
    return questions.value.filter((item) => masteredIds.value.has(item.id));
  }

  if (mode.value === "review") {
    return questions.value.filter((item) => reviewIds.value.has(item.id));
  }

  return questions.value;
});

const currentCategoryCounts = computed(() => {
  if (isQuestionMode.value) {
    return countBy<QuestionItem>(questionPool.value, (item) => item.category);
  }

  return countBy<KnowledgeItem>(knowledge.value, (item) => item.category);
});

const categoryItems = computed(() => {
  const entries = Object.entries(currentCategoryCounts.value).sort(([left], [right]) =>
    left.localeCompare(right, "zh-CN"),
  );
  const total = entries.reduce((sum, [, count]) => sum + count, 0);
  return [{ name: "全部", count: total }, ...entries.map(([name, count]) => ({ name, count }))];
});

const hasSearchQuery = computed(() => query.value.trim().length > 0);
const trimmedQuery = computed(() => query.value.trim());

function getQuestionSearchScore(item: QuestionItem) {
  return searchScore(
    [
      { value: item.title, weight: 8 },
      { value: item.tags, weight: 5 },
      { value: item.category, weight: 4 },
      { value: item.excerpt, weight: 2 },
      { value: item.sourcePath, weight: 1 },
    ],
    query.value,
  );
}

function getKnowledgeSearchScore(item: KnowledgeItem) {
  return searchScore(
    [
      { value: item.title, weight: 8 },
      { value: item.tags, weight: 5 },
      { value: item.category, weight: 4 },
      { value: item.description, weight: 3 },
      { value: item.excerpt, weight: 2 },
      { value: item.sourcePath, weight: 1 },
    ],
    query.value,
  );
}

const filteredQuestions = computed(() => {
  const items = questionPool.value
    .map((item, index) => ({ item, index, score: getQuestionSearchScore(item) }))
    .filter(({ item, score }) => {
      const categoryOk = selectedCategory.value === "全部" || item.category === selectedCategory.value;
      return categoryOk && score > 0;
    });

  if (hasSearchQuery.value) {
    items.sort((left, right) => right.score - left.score || left.item.title.localeCompare(right.item.title, "zh-CN"));
  } else {
    items.sort((left, right) => left.index - right.index);
  }

  return items.map(({ item }) => item);
});

const filteredKnowledge = computed(() => {
  const items = knowledge.value
    .map((item, index) => ({ item, index, score: getKnowledgeSearchScore(item) }))
    .filter(({ item, score }) => {
      const categoryOk = selectedCategory.value === "全部" || item.category === selectedCategory.value;
      return categoryOk && score > 0;
    });

  if (hasSearchQuery.value) {
    items.sort((left, right) => right.score - left.score || left.item.title.localeCompare(right.item.title, "zh-CN"));
  } else {
    items.sort((left, right) => left.index - right.index);
  }

  return items.map(({ item }) => item);
});

const activeQuestion = computed(() => {
  if (!isQuestionMode.value) return null;
  return (
    filteredQuestions.value.find((item) => item.id === selectedQuestionId.value) ??
    filteredQuestions.value[0] ??
    null
  );
});

const activeKnowledge = computed(() => {
  if (mode.value !== "knowledge") return null;
  return (
    filteredKnowledge.value.find((item) => item.id === selectedKnowledgeId.value) ??
    filteredKnowledge.value[0] ??
    null
  );
});

const relatedKnowledge = computed(() => {
  if (!activeQuestion.value) return [];
  const tokens = [activeQuestion.value.category, ...activeQuestion.value.tags].filter(Boolean);

  return knowledge.value
    .map((item) => {
      const haystack = `${item.title} ${item.category} ${item.tags.join(" ")} ${item.description} ${item.excerpt}`;
      const score = tokens.reduce((sum, token) => sum + (haystack.includes(token) ? 1 : 0), 0);
      return { item, score };
    })
    .filter(({ score }) => score > 0)
    .sort((left, right) => right.score - left.score || left.item.title.localeCompare(right.item.title, "zh-CN"))
    .slice(0, 5)
    .map(({ item }) => item);
});

const recentQuestions = computed(() =>
  recentIds.value
    .map((id) => questions.value.find((item) => item.id === id))
    .filter((item): item is QuestionItem => Boolean(item))
    .slice(0, 5),
);

const masteredPercent = computed(() =>
  questions.value.length > 0 ? Math.round((masteredIds.value.size / questions.value.length) * 100) : 0,
);

const activeQuestionIndex = computed(() =>
  activeQuestion.value ? filteredQuestions.value.findIndex((item) => item.id === activeQuestion.value?.id) : -1,
);

const questionProgressLabel = computed(() => {
  if (!activeQuestion.value || activeQuestionIndex.value < 0) return "未选择题目";

  return `第 ${activeQuestionIndex.value + 1} / ${filteredQuestions.value.length} 题`;
});

const canGoPreviousQuestion = computed(() => activeQuestionIndex.value > 0);
const canGoNextQuestion = computed(
  () => activeQuestionIndex.value >= 0 && activeQuestionIndex.value < filteredQuestions.value.length - 1,
);

const activeListTitle = computed(() => {
  if (mode.value === "knowledge") return "知识文章";
  if (mode.value === "favorites") return "收藏题目";
  if (mode.value === "review") return "待复习题目";
  if (mode.value === "mastered") return "已掌握题目";
  return "面试题目";
});

const visibleCount = computed(() =>
  mode.value === "knowledge" ? filteredKnowledge.value.length : filteredQuestions.value.length,
);

const hasGeneratedData = computed(
  () => !isLoading.value && !loadError.value && questions.value.length > 0 && knowledge.value.length > 0,
);
const dataSourceLabel = computed(() => (meta.value.dataSource === "api" ? "D1 API" : "静态数据"));

const hasActiveFilter = computed(() => hasSearchQuery.value || selectedCategory.value !== "全部");
const canReturnToQuestionsFromEmpty = computed(
  () => !hasActiveFilter.value && ["favorites", "review", "mastered"].includes(mode.value),
);

const filterSummaryItems = computed(() => {
  const items: string[] = [];
  if (trimmedQuery.value) items.push(`搜索：${trimmedQuery.value}`);
  if (selectedCategory.value !== "全部") items.push(`分类：${selectedCategory.value}`);
  return items;
});

const emptyState = computed(() => {
  if (hasActiveFilter.value) {
    return {
      title: "没有匹配内容",
      description: "换个关键词或清空分类筛选再试。",
    };
  }

  if (mode.value === "favorites") {
    return {
      title: "还没有收藏题目",
      description: "在题目行或详情页点击星标，就能把重点题目收进这里。",
    };
  }

  if (mode.value === "review") {
    return {
      title: "还没有待复习题目",
      description: "遇到不稳的题目点一下时钟，之后可以集中回看。",
    };
  }

  if (mode.value === "mastered") {
    return {
      title: "还没有已掌握题目",
      description: "确认答得顺以后标记已掌握，顶部进度会同步更新。",
    };
  }

  return {
    title: "没有可展示内容",
    description: "请先生成题库数据，或切换到其他视图查看。",
  };
});

async function loadGeneratedData() {
  try {
    isLoading.value = true;
    loadError.value = "";

    const { questions: loadedQuestions, knowledge: loadedKnowledge, meta: loadedMeta } = await loadContentBundle();

    questions.value = loadedQuestions;
    knowledge.value = loadedKnowledge;
    meta.value = loadedMeta;
    selectedQuestionId.value =
      recentIds.value.find((id) => loadedQuestions.some((item) => item.id === id)) ?? loadedQuestions[0]?.id ?? "";
    selectedKnowledgeId.value = loadedKnowledge[0]?.id ?? "";
  } catch (error) {
    loadError.value = error instanceof Error ? error.message : "题库数据加载失败";
  } finally {
    isLoading.value = false;
  }
}

onMounted(loadGeneratedData);

watch(mode, () => {
  selectedCategory.value = "全部";
  mobileFiltersOpen.value = false;
  mobileDetailOpen.value = false;
});

watch(filteredQuestions, (items) => {
  if (!isQuestionMode.value) return;
  if (!items.some((item) => item.id === selectedQuestionId.value)) {
    selectedQuestionId.value = items[0]?.id ?? "";
  }
});

watch(filteredKnowledge, (items) => {
  if (mode.value !== "knowledge") return;
  if (!items.some((item) => item.id === selectedKnowledgeId.value)) {
    selectedKnowledgeId.value = items[0]?.id ?? "";
  }
});

function selectCategory(category: string) {
  selectedCategory.value = category;
  mobileFiltersOpen.value = false;
}

function isMobileViewport() {
  return typeof window !== "undefined" && window.matchMedia("(max-width: 940px)").matches;
}

function openMobileDetailIfNeeded() {
  if (!isMobileViewport()) return;

  mobileDetailOpen.value = true;
  mobileFiltersOpen.value = false;
  window.requestAnimationFrame(() => window.scrollTo({ top: 0, left: 0 }));
}

function closeMobileDetail() {
  mobileDetailOpen.value = false;
}

function selectQuestion(id: string) {
  selectedQuestionId.value = id;
  addRecentQuestion(id);
  openMobileDetailIfNeeded();
}

function selectKnowledge(id: string) {
  selectedKnowledgeId.value = id;
  openMobileDetailIfNeeded();
}

function openKnowledge(id: string) {
  mode.value = "knowledge";
  selectedCategory.value = "全部";
  selectedKnowledgeId.value = id;
  openMobileDetailIfNeeded();
}

function toggleSet(id: string, collection: typeof favoriteIds, key: string) {
  const next = new Set(collection.value);
  if (next.has(id)) {
    next.delete(id);
  } else {
    next.add(id);
  }
  collection.value = next;
  writeSet(key, next);
}

function toggleFavorite(id: string) {
  toggleSet(id, favoriteIds, STORAGE_KEYS.favorites);
}

function toggleMastered(id: string) {
  const next = new Set(masteredIds.value);
  if (next.has(id)) {
    next.delete(id);
  } else {
    next.add(id);
    if (reviewIds.value.has(id)) {
      const nextReview = new Set(reviewIds.value);
      nextReview.delete(id);
      reviewIds.value = nextReview;
      writeSet(STORAGE_KEYS.review, nextReview);
    }
  }
  masteredIds.value = next;
  writeSet(STORAGE_KEYS.mastered, next);
}

function toggleReview(id: string) {
  const next = new Set(reviewIds.value);
  if (next.has(id)) {
    next.delete(id);
  } else {
    next.add(id);
    if (masteredIds.value.has(id)) {
      const nextMastered = new Set(masteredIds.value);
      nextMastered.delete(id);
      masteredIds.value = nextMastered;
      writeSet(STORAGE_KEYS.mastered, nextMastered);
    }
  }
  reviewIds.value = next;
  writeSet(STORAGE_KEYS.review, next);
}

function toggleReveal(id: string) {
  const next = new Set(revealedIds.value);
  if (next.has(id)) {
    next.delete(id);
  } else {
    next.add(id);
  }
  revealedIds.value = next;
}

function addRecentQuestion(id: string) {
  const next = [id, ...recentIds.value.filter((item) => item !== id)].slice(0, 12);
  recentIds.value = next;
  writeStringArray(STORAGE_KEYS.recent, next);
}

function resetFilters() {
  query.value = "";
  selectedCategory.value = "全部";
}

function clearSearch() {
  query.value = "";
}

function returnToQuestions() {
  mode.value = "questions";
  resetFilters();
}

function isFavorite(id: string) {
  return favoriteIds.value.has(id);
}

function isReview(id: string) {
  return reviewIds.value.has(id);
}

function isMastered(id: string) {
  return masteredIds.value.has(id);
}

function isRevealed(id: string) {
  return revealedIds.value.has(id);
}

function highlighted(value: string | undefined) {
  return highlightMatches(value, query.value);
}

function goToQuestion(offset: -1 | 1) {
  const next = filteredQuestions.value[activeQuestionIndex.value + offset];
  if (!next) return;

  selectQuestion(next.id);
}
</script>

<template>
  <div class="app-shell">
    <header class="topbar">
      <div class="brand">
        <span class="brand-mark" aria-hidden="true">
          <BookOpen :size="22" />
        </span>
        <span>
          <strong>面试题库</strong>
          <small>静态刷题站</small>
        </span>
      </div>

      <div class="search-box">
        <Search :size="18" aria-hidden="true" />
        <input
          v-model="query"
          type="search"
          aria-label="搜索题目、知识点、分类或路径"
          placeholder="搜索题目、知识点、分类或路径"
          @keydown.esc="clearSearch"
        />
        <button
          v-if="query"
          class="search-clear"
          type="button"
          aria-label="清空搜索"
          title="清空搜索"
          @click="clearSearch"
        >
          <X :size="16" />
        </button>
      </div>

      <button class="icon-button mobile-only" type="button" aria-label="打开筛选" @click="mobileFiltersOpen = true">
        <Menu :size="20" />
      </button>

      <nav class="mode-tabs" aria-label="视图切换">
        <button
          v-for="item in modeItems"
          :key="item.id"
          type="button"
          :class="{ active: mode === item.id }"
          @click="mode = item.id"
        >
          <component :is="item.icon" :size="16" aria-hidden="true" />
          {{ item.label }}
        </button>
      </nav>

      <div class="stats-strip" aria-label="数据统计">
        <span>{{ meta.questionCount || questions.length }} 题</span>
        <span>{{ meta.knowledgeCount || knowledge.length }} 篇知识</span>
        <span>{{ dataSourceLabel }}</span>
        <span>待复习 {{ reviewIds.size }}</span>
        <span>掌握 {{ masteredPercent }}%</span>
      </div>
    </header>

    <main v-if="hasGeneratedData" class="workspace" :class="{ 'mobile-detail-open': mobileDetailOpen }">
      <aside class="filter-panel" :class="{ open: mobileFiltersOpen }" aria-label="筛选分类">
        <div class="panel-heading">
          <span>
            <Filter :size="16" aria-hidden="true" />
            分类筛选
          </span>
          <button class="icon-button mobile-only" type="button" aria-label="关闭筛选" @click="mobileFiltersOpen = false">
            <X :size="18" />
          </button>
        </div>

        <div class="category-list">
          <button
            v-for="item in categoryItems"
            :key="item.name"
            type="button"
            :class="{ active: selectedCategory === item.name }"
            @click="selectCategory(item.name)"
          >
            <span>{{ item.name }}</span>
            <span>{{ item.count }}</span>
          </button>
        </div>

        <section class="side-section">
          <h2>最近浏览</h2>
          <p v-if="recentQuestions.length === 0" class="muted">打开题目后会自动记录。</p>
          <button
            v-for="item in recentQuestions"
            :key="item.id"
            type="button"
            class="recent-link"
            @click="mode = 'questions'; selectQuestion(item.id)"
          >
            {{ item.title }}
          </button>
        </section>

        <section class="side-section source-note">
          <h2>资料源</h2>
          <p>题目来自 code-roadmap 高频面试题，知识文章来自 JavaGuide docs。上线前请保留来源与版权说明。</p>
        </section>
      </aside>

      <section class="list-panel" aria-live="polite">
        <div class="panel-heading">
          <span>{{ activeListTitle }}</span>
          <span class="count-pill">{{ visibleCount }}</span>
        </div>

        <div v-if="visibleCount === 0" class="empty-state">
          <Search :size="28" aria-hidden="true" />
          <h2>{{ emptyState.title }}</h2>
          <p>{{ emptyState.description }}</p>
          <button v-if="hasActiveFilter" type="button" class="text-button" @click="resetFilters">
            <RotateCcw :size="16" aria-hidden="true" />
            重置筛选
          </button>
          <button v-else-if="canReturnToQuestionsFromEmpty" type="button" class="text-button" @click="returnToQuestions">
            <LibraryBig :size="16" aria-hidden="true" />
            去题库
          </button>
        </div>

        <template v-else-if="isQuestionMode">
          <div v-if="filterSummaryItems.length" class="filter-summary">
            <span v-for="item in filterSummaryItems" :key="item">{{ item }}</span>
            <button type="button" class="text-button" @click="resetFilters">
              <RotateCcw :size="15" aria-hidden="true" />
              清空
            </button>
          </div>
          <article
            v-for="item in filteredQuestions"
            :key="item.id"
            class="item-row"
            :class="{ active: activeQuestion?.id === item.id }"
            tabindex="0"
            role="button"
            @click="selectQuestion(item.id)"
            @keydown.enter.prevent="selectQuestion(item.id)"
            @keydown.space.prevent="selectQuestion(item.id)"
          >
            <div class="item-main">
              <h2 v-html="highlighted(item.title)"></h2>
              <p v-html="highlighted(item.excerpt || '暂无摘要，打开后查看完整题解。')"></p>
              <div class="meta-line">
                <span v-html="highlighted(item.category)"></span>
                <span v-if="item.tags.length" v-html="highlighted(item.tags.slice(0, 3).join(' / '))"></span>
                <span v-if="isMastered(item.id)" class="state-chip mastered">已掌握</span>
                <span v-else-if="isReview(item.id)" class="state-chip review">待复习</span>
                <span v-if="isFavorite(item.id)" class="state-chip favorite">已收藏</span>
              </div>
            </div>
            <div class="row-actions">
              <button
                type="button"
                class="icon-button"
                :class="{ selected: isFavorite(item.id) }"
                :aria-label="isFavorite(item.id) ? '取消收藏' : '收藏题目'"
                :title="isFavorite(item.id) ? '取消收藏' : '收藏题目'"
                @click.stop="toggleFavorite(item.id)"
              >
                <Star :size="17" />
              </button>
              <button
                type="button"
                class="icon-button"
                :class="{ selected: isReview(item.id) }"
                :aria-label="isReview(item.id) ? '移出待复习' : '加入待复习'"
                :title="isReview(item.id) ? '移出待复习' : '加入待复习'"
                @click.stop="toggleReview(item.id)"
              >
                <Clock3 :size="17" />
              </button>
              <button
                type="button"
                class="icon-button"
                :class="{ selected: isMastered(item.id) }"
                :aria-label="isMastered(item.id) ? '取消已掌握' : '标记已掌握'"
                :title="isMastered(item.id) ? '取消已掌握' : '标记已掌握'"
                @click.stop="toggleMastered(item.id)"
              >
                <CheckCircle2 :size="17" />
              </button>
            </div>
          </article>
        </template>

        <template v-else>
          <div v-if="filterSummaryItems.length" class="filter-summary">
            <span v-for="item in filterSummaryItems" :key="item">{{ item }}</span>
            <button type="button" class="text-button" @click="resetFilters">
              <RotateCcw :size="15" aria-hidden="true" />
              清空
            </button>
          </div>
          <article
            v-for="item in filteredKnowledge"
            :key="item.id"
            class="item-row"
            :class="{ active: activeKnowledge?.id === item.id }"
            tabindex="0"
            role="button"
            @click="selectKnowledge(item.id)"
            @keydown.enter.prevent="selectKnowledge(item.id)"
            @keydown.space.prevent="selectKnowledge(item.id)"
          >
            <div class="item-main">
              <h2 v-html="highlighted(item.title)"></h2>
              <p v-html="highlighted(item.description || item.excerpt || '暂无摘要，打开后查看完整知识内容。')"></p>
              <div class="meta-line">
                <span v-html="highlighted(item.category)"></span>
                <span v-if="item.tags.length" v-html="highlighted(item.tags.slice(0, 4).join(' / '))"></span>
              </div>
            </div>
          </article>
        </template>
      </section>

      <section class="detail-panel">
        <div class="mobile-detail-bar mobile-only">
          <button type="button" class="text-button" @click="closeMobileDetail">
            <ArrowLeft :size="16" aria-hidden="true" />
            返回列表
          </button>
          <span>{{ activeQuestion ? "题目详情" : "知识详情" }}</span>
        </div>

        <article v-if="activeQuestion" class="detail-content">
          <div class="detail-kicker">
            <span>{{ activeQuestion.category }}</span>
            <span>{{ activeQuestion.source }}</span>
          </div>
          <div class="detail-title-row">
            <h1>{{ activeQuestion.title }}</h1>
            <div class="detail-actions">
              <button
                type="button"
                class="icon-button"
                :class="{ selected: isFavorite(activeQuestion.id) }"
                :aria-label="isFavorite(activeQuestion.id) ? '取消收藏' : '收藏题目'"
                :title="isFavorite(activeQuestion.id) ? '取消收藏' : '收藏题目'"
                @click="toggleFavorite(activeQuestion.id)"
              >
                <Star :size="18" />
              </button>
              <button
                type="button"
                class="icon-button"
                :class="{ selected: isReview(activeQuestion.id) }"
                :aria-label="isReview(activeQuestion.id) ? '移出待复习' : '加入待复习'"
                :title="isReview(activeQuestion.id) ? '移出待复习' : '加入待复习'"
                @click="toggleReview(activeQuestion.id)"
              >
                <Clock3 :size="18" />
              </button>
              <button
                type="button"
                class="icon-button"
                :class="{ selected: isMastered(activeQuestion.id) }"
                :aria-label="isMastered(activeQuestion.id) ? '取消已掌握' : '标记已掌握'"
                :title="isMastered(activeQuestion.id) ? '取消已掌握' : '标记已掌握'"
                @click="toggleMastered(activeQuestion.id)"
              >
                <CheckCircle2 :size="18" />
              </button>
            </div>
          </div>

          <div class="tag-row" aria-label="题目标签">
            <span v-for="tag in activeQuestion.tags" :key="tag">{{ tag }}</span>
          </div>

          <p class="lead-text">{{ activeQuestion.excerpt || "这道题暂无摘要，展开答案查看完整内容。" }}</p>

          <div class="study-toolbar" aria-label="刷题操作">
            <div class="study-progress">
              <span>{{ questionProgressLabel }}</span>
              <strong v-if="isMastered(activeQuestion.id)">已掌握</strong>
              <strong v-else-if="isReview(activeQuestion.id)">待复习</strong>
              <strong v-else>练习中</strong>
            </div>
            <div class="study-controls">
              <button
                type="button"
                class="text-button"
                :disabled="!canGoPreviousQuestion"
                @click="goToQuestion(-1)"
              >
                <ChevronLeft :size="16" aria-hidden="true" />
                上一题
              </button>
              <button type="button" class="text-button" :disabled="!canGoNextQuestion" @click="goToQuestion(1)">
                下一题
                <ChevronRight :size="16" aria-hidden="true" />
              </button>
              <button type="button" class="text-button" @click="toggleReveal(activeQuestion.id)">
                <ChevronDown :size="16" aria-hidden="true" />
                {{ isRevealed(activeQuestion.id) ? "隐藏答案" : "查看答案" }}
              </button>
              <button
                type="button"
                class="text-button"
                :class="{ selected: isReview(activeQuestion.id) }"
                @click="toggleReview(activeQuestion.id)"
              >
                <Clock3 :size="16" aria-hidden="true" />
                {{ isReview(activeQuestion.id) ? "移出复习" : "加入复习" }}
              </button>
              <button
                type="button"
                class="text-button"
                :class="{ selected: isMastered(activeQuestion.id) }"
                @click="toggleMastered(activeQuestion.id)"
              >
                <CheckCircle2 :size="16" aria-hidden="true" />
                {{ isMastered(activeQuestion.id) ? "取消掌握" : "标记掌握" }}
              </button>
            </div>
          </div>

          <div v-if="!isRevealed(activeQuestion.id)" class="answer-gate">
            <h2>先想一想，再看答案</h2>
            <p>刷题模式默认隐藏答案，适合自测。你可以随时展开或重新隐藏。</p>
            <button type="button" class="primary-button" @click="toggleReveal(activeQuestion.id)">
              <ChevronDown :size="17" aria-hidden="true" />
              查看答案
            </button>
          </div>

          <div v-else class="answer-content">
            <button type="button" class="text-button answer-toggle" @click="toggleReveal(activeQuestion.id)">
              <ChevronDown :size="16" aria-hidden="true" />
              隐藏答案
            </button>
            <section v-for="section in activeQuestion.sections" :key="section.title" class="answer-section">
              <h2>{{ section.title }}</h2>
              <div class="markdown-body" v-html="section.html"></div>
            </section>
          </div>

          <section v-if="relatedKnowledge.length" class="related-block">
            <h2>关联知识</h2>
            <button
              v-for="item in relatedKnowledge"
              :key="item.id"
              type="button"
              class="related-link"
              @click="openKnowledge(item.id)"
            >
              <span>{{ item.title }}</span>
              <ExternalLink :size="15" aria-hidden="true" />
            </button>
          </section>

          <footer class="source-path">来源：{{ activeQuestion.sourcePath }}</footer>
        </article>

        <article v-else-if="activeKnowledge" class="detail-content">
          <div class="detail-kicker">
            <span>{{ activeKnowledge.category }}</span>
            <span>{{ activeKnowledge.source }}</span>
          </div>
          <h1>{{ activeKnowledge.title }}</h1>
          <div class="tag-row" aria-label="知识标签">
            <span v-for="tag in activeKnowledge.tags" :key="tag">{{ tag }}</span>
          </div>
          <p v-if="activeKnowledge.description" class="lead-text">{{ activeKnowledge.description }}</p>
          <div class="markdown-body article-body" v-html="activeKnowledge.contentHtml"></div>
          <footer class="source-path">来源：{{ activeKnowledge.sourcePath }}</footer>
        </article>

        <div v-else class="empty-state detail-empty">
          <BookOpen :size="30" aria-hidden="true" />
          <h2>选择一条内容开始</h2>
          <p>左侧列表会根据搜索和分类筛选自动更新。</p>
        </div>
      </section>
    </main>

    <section v-else-if="isLoading" class="bootstrap-error">
      <h1>正在加载题库数据</h1>
      <p>第一次打开会读取本地生成的题目和知识库索引。</p>
    </section>

    <section v-else class="bootstrap-error">
      <h1>题库数据不可用</h1>
      <p>
        {{ loadError || "请在 web 目录运行 npm run ingest，生成题目和知识库 JSON 后再启动网站。" }}
      </p>
    </section>

    <button
      v-if="mobileFiltersOpen"
      class="mobile-backdrop"
      type="button"
      aria-label="关闭筛选"
      @click="mobileFiltersOpen = false"
    ></button>
  </div>
</template>
