from __future__ import annotations

from dataclasses import dataclass, field
from typing import Literal

ContentType = Literal["question", "knowledge"]


@dataclass(frozen=True)
class SourceConfig:
    name: str
    base_url: str
    type: ContentType = "knowledge"
    category: str = "未分类"
    tags: list[str] = field(default_factory=list)
    sitemap_urls: list[str] = field(default_factory=list)
    rss_urls: list[str] = field(default_factory=list)
    start_urls: list[str] = field(default_factory=list)
    max_pages: int | None = None
    delay_seconds: float | None = None
    trusted: bool = False


@dataclass(frozen=True)
class CrawlerConfig:
    user_agent: str
    default_delay_seconds: float = 2.0
    default_max_pages: int = 20
    sources: list[SourceConfig] = field(default_factory=list)


@dataclass(frozen=True)
class CandidateItem:
    type: ContentType
    title: str
    category: str
    tags: list[str]
    excerpt: str
    content_md: str
    source_url: str
    source_name: str
    hash: str
    trusted_source: bool = False
    review_score: int = 0
    review_flags: list[str] = field(default_factory=list)
    review_reason: str = ""


@dataclass(frozen=True)
class CrawlFailure:
    url: str
    reason: str


@dataclass(frozen=True)
class CrawlResult:
    source_name: str
    candidates: list[CandidateItem]
    failures: list[CrawlFailure]
