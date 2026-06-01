from __future__ import annotations

import hashlib
import re
from html.parser import HTMLParser
from urllib.parse import urldefrag, urljoin, urlparse


def canonicalize_url(url: str) -> str:
    clean_url, _ = urldefrag(url.strip())
    parsed = urlparse(clean_url)
    path = parsed.path.rstrip("/") or "/"
    query = parsed.query
    return parsed._replace(path=path, query=query, fragment="").geturl()


def normalize_text(value: str) -> str:
    return re.sub(r"\s+", " ", value).strip()


def content_hash(title: str, content: str) -> str:
    normalized = normalize_text(f"{title}\n{content}").lower()
    return hashlib.sha256(normalized.encode("utf-8")).hexdigest()


def excerpt(value: str, limit: int = 180) -> str:
    text = normalize_text(value)
    return text[:limit]


class HtmlDocumentParser(HTMLParser):
    def __init__(self, base_url: str):
        super().__init__(convert_charrefs=True)
        self.base_url = base_url
        self.title_parts: list[str] = []
        self.body_parts: list[str] = []
        self.links: set[str] = set()
        self._tag_stack: list[str] = []
        self._skip_depth = 0
        self._in_title = False

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        tag = tag.lower()
        self._tag_stack.append(tag)
        if tag in {"script", "style", "noscript", "svg", "canvas"}:
            self._skip_depth += 1
        if tag == "title":
            self._in_title = True
        if tag == "a":
            href = dict(attrs).get("href")
            if href:
                self.links.add(canonicalize_url(urljoin(self.base_url, href)))

    def handle_endtag(self, tag: str) -> None:
        tag = tag.lower()
        if tag == "title":
            self._in_title = False
        if tag in {"script", "style", "noscript", "svg", "canvas"} and self._skip_depth:
            self._skip_depth -= 1
        for index in range(len(self._tag_stack) - 1, -1, -1):
            if self._tag_stack[index] == tag:
                del self._tag_stack[index:]
                break

    def handle_data(self, data: str) -> None:
        text = normalize_text(data)
        if not text:
            return
        if self._in_title:
            self.title_parts.append(text)
            return
        if self._skip_depth:
            return
        if any(tag in {"article", "main", "section", "body", "p", "li", "h1", "h2", "h3", "pre"} for tag in self._tag_stack):
            self.body_parts.append(text)


def parse_html(html: str, url: str) -> tuple[str, str, set[str]]:
    parser = HtmlDocumentParser(url)
    parser.feed(html)
    title = normalize_text(" ".join(parser.title_parts))
    body = normalize_text("\n".join(parser.body_parts))
    return title, body, parser.links


def same_domain(url: str, base_url: str) -> bool:
    return urlparse(url).netloc.lower() == urlparse(base_url).netloc.lower()


def looks_like_content_url(url: str) -> bool:
    lower = url.lower()
    blocked_ext = (".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".pdf", ".zip", ".rar", ".7z", ".css", ".js")
    if lower.endswith(blocked_ext):
        return False
    if any(part in lower for part in ["/tag/", "/tags/", "/category/", "/author/", "/login", "/signup"]):
        return False
    return lower.startswith("http://") or lower.startswith("https://")
