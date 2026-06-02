from __future__ import annotations

import hashlib
import re
from html.parser import HTMLParser
from urllib.parse import urldefrag, urljoin, urlparse

BLOCK_TAGS = {"article", "main", "section", "p", "li", "h1", "h2", "h3", "h4", "pre", "blockquote", "td", "th"}
CONTENT_CLASS_HINTS = {
    "article",
    "article-content",
    "content-container",
    "doc-content",
    "entry-content",
    "markdown",
    "markdown-body",
    "post-content",
    "theme-default-content",
    "vp-doc",
}
SKIP_CLASS_NAMES = {
    "aside",
    "appearance",
    "breadcrumb",
    "copyright",
    "edit-info",
    "edit-link",
    "footer",
    "header-anchor",
    "menu",
    "nav",
    "outline",
    "pager",
    "return-to-top",
    "search",
    "sidebar",
    "social",
    "social-links",
    "toc",
}
SKIP_COMPONENT_HINTS = {
    "docfooter",
    "localnav",
    "navbard",
    "navbar",
    "skiplink",
    "vpdocaside",
    "vpdocfooter",
    "vpfooter",
    "vplocalnav",
    "vpnav",
    "vpsidebar",
}
SKIP_TAGS = {"button", "canvas", "footer", "form", "header", "nav", "noscript", "script", "style", "svg", "aside"}
NAV_NOISE_PHRASES = [
    "skip to content",
    "main navigation",
    "sidebar navigation",
    "return to top",
    "appearance",
    "search",
]


def canonicalize_url(url: str) -> str:
    clean_url, _ = urldefrag(url.strip())
    parsed = urlparse(clean_url)
    path = parsed.path.rstrip("/") or "/"
    query = parsed.query
    return parsed._replace(path=path, query=query, fragment="").geturl()


def normalize_text(value: str) -> str:
    return re.sub(r"\s+", " ", value).strip()


def normalize_blocks(parts: list[str]) -> str:
    blocks: list[str] = []
    for part in parts:
        text = normalize_text(part)
        if not text or (blocks and blocks[-1] == text):
            continue
        blocks.append(text)
    return "\n".join(blocks)


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
        self.heading_parts: list[str] = []
        self.fallback_parts: list[str] = []
        self._containers: dict[int, list[str]] = {}
        self._container_scores: dict[int, int] = {}
        self.links: set[str] = set()
        self._tag_stack: list[str] = []
        self._class_stack: list[str] = []
        self._skip_depth = 0
        self._in_title = False
        self._active_containers: list[int] = []
        self._next_container_id = 1

    @staticmethod
    def _attr_text(attrs: list[tuple[str, str | None]]) -> str:
        values = [value for key, value in attrs if key in {"class", "id", "role", "aria-label"} and value]
        return " ".join(values).lower()

    @staticmethod
    def _class_names(attrs: list[tuple[str, str | None]]) -> set[str]:
        class_value = dict(attrs).get("class") or ""
        return {item.strip().lower() for item in class_value.split() if item.strip()}

    @staticmethod
    def _has_content_hint(class_names: set[str]) -> bool:
        return any(class_name == hint or hint in class_name for class_name in class_names for hint in CONTENT_CLASS_HINTS)

    @staticmethod
    def _is_skip_region(tag: str, attr_text: str, class_names: set[str]) -> bool:
        if tag in SKIP_TAGS:
            return True
        normalized_classes = "".join(re.sub(r"[^a-z0-9]", "", class_name) for class_name in class_names)
        return bool(
            class_names & SKIP_CLASS_NAMES
            or any(hint in normalized_classes for hint in SKIP_COMPONENT_HINTS)
            or any(phrase in attr_text for phrase in NAV_NOISE_PHRASES)
        )

    def _starts_content_container(self, tag: str, class_names: set[str]) -> bool:
        return tag == "article" or self._has_content_hint(class_names)

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        tag = tag.lower()
        attr_text = self._attr_text(attrs)
        class_names = self._class_names(attrs)
        self._tag_stack.append(tag)
        self._class_stack.append(" ".join(class_names))
        if self._is_skip_region(tag, attr_text, class_names):
            self._skip_depth += 1
        if tag == "title":
            self._in_title = True
        if tag == "a":
            href = dict(attrs).get("href")
            if href:
                self.links.add(canonicalize_url(urljoin(self.base_url, href)))
        if not self._skip_depth and self._starts_content_container(tag, class_names):
            container_id = self._next_container_id
            self._next_container_id += 1
            self._active_containers.append(container_id)
            self._containers[container_id] = []
            self._container_scores[container_id] = 2 if tag == "article" else 1

    def handle_endtag(self, tag: str) -> None:
        tag = tag.lower()
        if self._tag_stack and self._tag_stack[-1] == tag:
            attr_text = self._class_stack[-1]
        else:
            attr_text = ""
        if tag == "title":
            self._in_title = False
        class_names = set(attr_text.split())
        if self._is_skip_region(tag, attr_text, class_names) and self._skip_depth:
            self._skip_depth -= 1
        if (
            self._active_containers
            and tag in {"article", "div", "main", "section"}
            and self._starts_content_container(tag, class_names)
        ):
            self._active_containers.pop()
        for index in range(len(self._tag_stack) - 1, -1, -1):
            if self._tag_stack[index] == tag:
                del self._tag_stack[index:]
                del self._class_stack[index:]
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
        if self._active_containers and self._tag_stack and self._tag_stack[-1] == "h1":
            self.heading_parts.append(text)
            return
        if any(tag in BLOCK_TAGS for tag in self._tag_stack):
            self.fallback_parts.append(text)
            for container_id in self._active_containers:
                self._containers[container_id].append(text)

    @staticmethod
    def _score_body(value: str, base_score: int = 0) -> int:
        normalized = value.lower()
        score = base_score + len(value)
        if re.search(r"[。！？；：，、]", value):
            score += 120
        if re.search(r"(方案|方法|步骤|复杂度|面试|实现|问题|总结|redis|java|mysql|url)", normalized):
            score += 160
        for phrase in NAV_NOISE_PHRASES:
            if phrase in normalized:
                score -= 300
        if "sidebar navigation" in normalized or "main navigation" in normalized:
            score -= 500
        return score

    def best_body(self) -> str:
        candidates = []
        for container_id, parts in self._containers.items():
            body = normalize_blocks(parts)
            if body:
                candidates.append((self._score_body(body, self._container_scores.get(container_id, 0)), body))
        fallback = normalize_blocks(self.fallback_parts)
        if fallback:
            candidates.append((self._score_body(fallback, -200), fallback))
        if not candidates:
            return ""
        return max(candidates, key=lambda item: item[0])[1]


def parse_html(html: str, url: str) -> tuple[str, str, set[str]]:
    parser = HtmlDocumentParser(url)
    parser.feed(html)
    title = normalize_text(" ".join(parser.heading_parts)) or normalize_text(" ".join(parser.title_parts))
    body = parser.best_body()
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
