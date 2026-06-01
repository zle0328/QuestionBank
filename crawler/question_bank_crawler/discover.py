from __future__ import annotations

import xml.etree.ElementTree as ET
from urllib.error import URLError
from urllib.request import Request, urlopen

from .extract import canonicalize_url


def fetch_text(url: str, user_agent: str, timeout: float = 15.0) -> str:
    request = Request(url, headers={"User-Agent": user_agent, "Accept": "text/html,application/xml,text/xml,*/*"})
    with urlopen(request, timeout=timeout) as response:
        charset = response.headers.get_content_charset() or "utf-8"
        return response.read().decode(charset, errors="replace")


def parse_feed_urls(xml_text: str) -> list[str]:
    try:
        root = ET.fromstring(xml_text)
    except ET.ParseError:
        return []

    urls: list[str] = []
    for element in root.iter():
        tag = element.tag.rsplit("}", 1)[-1].lower()
        if tag in {"loc", "link"} and element.text and element.text.strip().startswith(("http://", "https://")):
            urls.append(canonicalize_url(element.text))
        if tag == "link":
            href = element.attrib.get("href")
            if href:
                urls.append(canonicalize_url(href))
    return list(dict.fromkeys(urls))


def discover_feed_urls(urls: list[str], user_agent: str) -> tuple[list[str], list[tuple[str, str]]]:
    discovered: list[str] = []
    failures: list[tuple[str, str]] = []
    for url in urls:
        try:
            discovered.extend(parse_feed_urls(fetch_text(url, user_agent)))
        except (OSError, URLError) as error:
            failures.append((url, str(error)))
    return list(dict.fromkeys(discovered)), failures
