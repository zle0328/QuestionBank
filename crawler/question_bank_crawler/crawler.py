from __future__ import annotations

import re
import time
from collections import deque
from urllib.error import HTTPError, URLError
from urllib.parse import urljoin, urlparse
from urllib.robotparser import RobotFileParser

from .discover import discover_feed_urls, fetch_text
from .extract import canonicalize_url, content_hash, excerpt, looks_like_content_url, parse_html, same_domain
from .models import CandidateItem, CrawlFailure, CrawlResult, CrawlerConfig, SourceConfig

MIN_TEXT_LENGTH = 120
PROMOTION_PATTERNS = ["关注公众号", "扫码", "加群", "知识星球", "付费", "优惠券", "领取资料", "添加微信"]
TECH_KEYWORDS = [
    "java",
    "spring",
    "mysql",
    "redis",
    "jvm",
    "线程",
    "并发",
    "分布式",
    "数据库",
    "缓存",
    "消息队列",
    "前端",
    "vue",
    "react",
    "算法",
    "网络",
    "操作系统",
    "面试",
    "题",
]
QUESTION_URL_HINTS = [
    "interview",
    "interview-question",
    "interview-questions",
    "question",
    "questions",
    "mian-shi",
    "mianshi",
    "面试",
    "面试题",
    "题库",
]
QUESTION_TITLE_HINTS = ["面试题", "题库", "问答", "常见问题", "高频题", "自测题"]
QUESTION_BODY_HINTS = ["回答重点", "题目：", "题解", "面试官：", "候选人：", "常考", "高频面试"]


def _robots_url(base_url: str) -> str:
    parsed = urlparse(base_url)
    return f"{parsed.scheme}://{parsed.netloc}/robots.txt"


def load_robots(source: SourceConfig, user_agent: str) -> RobotFileParser:
    parser = RobotFileParser()
    parser.set_url(_robots_url(source.base_url))
    try:
        parser.read()
    except (OSError, URLError):
        parser.parse("")
    return parser


def seed_urls(source: SourceConfig, config: CrawlerConfig) -> tuple[list[str], list[CrawlFailure]]:
    feed_urls, feed_failures = discover_feed_urls(source.sitemap_urls + source.rss_urls, config.user_agent)
    seeds = [source.base_url, *source.start_urls, *feed_urls]
    canonical_seeds = [
        canonicalize_url(urljoin(source.base_url, url))
        for url in seeds
        if url and looks_like_content_url(urljoin(source.base_url, url))
    ]
    failures = [CrawlFailure(url=url, reason=reason) for url, reason in feed_failures]
    return list(dict.fromkeys(canonical_seeds)), failures


def review_content(source: SourceConfig, title: str, body: str) -> tuple[int, list[str], str]:
    flags: list[str] = []
    score = 50 + (10 if source.trusted else 0)
    normalized = f"{title}\n{body}".lower()
    text_length = len(body.strip())

    if len(title.strip()) < 4 or title.startswith("http"):
        score -= 25
        flags.append("weak_title")
    elif len(title) <= 90:
        score += 10

    if text_length >= 800:
        score += 25
    elif text_length >= 300:
        score += 15
    elif text_length < 160:
        score -= 35
        flags.append("short_content")

    if any(keyword in normalized for keyword in TECH_KEYWORDS):
        score += 15
    else:
        score -= 15
        flags.append("low_technical_signal")

    if any(pattern in normalized for pattern in PROMOTION_PATTERNS):
        score -= 30
        flags.append("promotion_risk")

    final_score = max(0, min(100, round(score)))
    return final_score, flags, f"crawler_rule_score={final_score}; trusted={source.trusted}; length={text_length}; flags={','.join(flags) or 'none'}"


def infer_candidate_type(source: SourceConfig, url: str, title: str, body: str):
    if not source.auto_type:
        return source.type

    normalized_url = url.lower()
    normalized_title = title.lower()
    normalized_body = body.lower()
    score = 2 if source.type == "question" else 0

    if any(hint in normalized_url for hint in QUESTION_URL_HINTS):
        score += 2
    if any(hint in normalized_title for hint in QUESTION_TITLE_HINTS):
        score += 3
    if "？" in title or "?" in title:
        score += 1
    if any(hint.lower() in normalized_body for hint in QUESTION_BODY_HINTS):
        score += 3
    if len(re.findall(r"^#{2,4}\s+.+[？?]", body, flags=re.MULTILINE)) >= 2:
        score += 2
    if len(re.findall(r"面试官\s*[：:]", body)) >= 2:
        score += 3

    return "question" if score >= 3 else "knowledge"


def crawl_source(source: SourceConfig, config: CrawlerConfig, limit: int | None = None) -> CrawlResult:
    max_pages = limit or source.max_pages or config.default_max_pages
    delay = source.delay_seconds if source.delay_seconds is not None else config.default_delay_seconds
    robots = load_robots(source, config.user_agent)
    seeds, failures = seed_urls(source, config)
    queue: deque[str] = deque(seeds)
    seen: set[str] = set()
    candidates: list[CandidateItem] = []
    last_fetch_at = 0.0

    while queue and len(seen) < max_pages:
        url = queue.popleft()
        if url in seen or not same_domain(url, source.base_url):
            continue
        seen.add(url)

        if not robots.can_fetch(config.user_agent, url):
            failures.append(CrawlFailure(url=url, reason="blocked_by_robots_txt"))
            continue

        wait_seconds = delay - (time.monotonic() - last_fetch_at)
        if wait_seconds > 0:
            time.sleep(wait_seconds)

        try:
            html = fetch_text(url, config.user_agent)
            last_fetch_at = time.monotonic()
        except HTTPError as error:
            failures.append(CrawlFailure(url=url, reason=f"http_{error.code}"))
            continue
        except (OSError, URLError) as error:
            failures.append(CrawlFailure(url=url, reason=str(error)))
            continue

        title, body, links = parse_html(html, url)
        if len(body) < MIN_TEXT_LENGTH:
            failures.append(CrawlFailure(url=url, reason="empty_or_short_content"))
        else:
            review_score, review_flags, review_reason = review_content(source, title or url, body)
            candidates.append(
                CandidateItem(
                    type=infer_candidate_type(source, url, title or url, body),
                    title=title or url,
                    category=source.category,
                    tags=source.tags,
                    excerpt=excerpt(body),
                    content_md=body,
                    source_url=url,
                    source_name=source.name,
                    hash=content_hash(title or url, body),
                    trusted_source=source.trusted,
                    review_score=review_score,
                    review_flags=review_flags,
                    review_reason=review_reason,
                )
            )

        for link in links:
            if len(seen) + len(queue) >= max_pages:
                break
            if link not in seen and same_domain(link, source.base_url) and looks_like_content_url(link):
                queue.append(link)

    return CrawlResult(source_name=source.name, candidates=candidates, failures=failures)


def crawl_all(config: CrawlerConfig, limit: int | None = None) -> list[CrawlResult]:
    return [crawl_source(source, config, limit=limit) for source in config.sources]
