from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from .models import CrawlerConfig, SourceConfig


def _string_list(value: Any) -> list[str]:
    if not isinstance(value, list):
        return []
    return [item.strip() for item in value if isinstance(item, str) and item.strip()]


def load_config(path: str | Path) -> CrawlerConfig:
    data = json.loads(Path(path).read_text(encoding="utf-8"))
    sources = []
    for raw_source in data.get("sources", []):
        if not isinstance(raw_source, dict):
            continue
        source_type = raw_source.get("type", "knowledge")
        if source_type not in {"question", "knowledge"}:
            source_type = "knowledge"
        sources.append(
            SourceConfig(
                name=str(raw_source.get("name") or raw_source.get("baseUrl") or "unknown"),
                base_url=str(raw_source["baseUrl"]),
                type=source_type,
                category=str(raw_source.get("category") or "未分类"),
                tags=_string_list(raw_source.get("tags")),
                sitemap_urls=_string_list(raw_source.get("sitemapUrls")),
                rss_urls=_string_list(raw_source.get("rssUrls")),
                start_urls=_string_list(raw_source.get("startUrls")),
                max_pages=int(raw_source["maxPages"]) if raw_source.get("maxPages") else None,
                delay_seconds=float(raw_source["delaySeconds"]) if raw_source.get("delaySeconds") else None,
                trusted=bool(raw_source.get("trusted", False)),
            )
        )

    return CrawlerConfig(
        user_agent=str(data.get("userAgent") or "QuestionBankCrawler/0.1"),
        default_delay_seconds=float(data.get("defaultDelaySeconds", 2.0)),
        default_max_pages=int(data.get("defaultMaxPages", 20)),
        sources=sources,
    )
