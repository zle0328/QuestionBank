from __future__ import annotations

import json
from dataclasses import asdict
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from .models import CandidateItem

DEFAULT_API_USER_AGENT = "QuestionBankCrawler/0.1 (+https://github.com/zle0328/QuestionBank)"


def submit_candidates(
    api_base_url: str,
    admin_token: str,
    items: list[CandidateItem],
    job_id: str | None = None,
    user_agent: str | None = None,
) -> dict:
    endpoint = api_base_url.rstrip("/") + "/api/admin/candidates/batch"
    payload = {
        "jobId": job_id,
        "items": [
            {
                "type": item.type,
                "title": item.title,
                "category": item.category,
                "tags": item.tags,
                "excerpt": item.excerpt,
                "contentMd": item.content_md,
                "sourceUrl": item.source_url,
                "sourceName": item.source_name,
                "hash": item.hash,
                "trustedSource": item.trusted_source,
                "reviewScore": item.review_score,
                "reviewFlags": item.review_flags,
                "reviewReason": item.review_reason,
            }
            for item in items
        ],
    }
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    request = Request(
        endpoint,
        data=body,
        method="POST",
        headers={
            "Authorization": f"Bearer {admin_token}",
            "Content-Type": "application/json; charset=utf-8",
            "Accept": "application/json",
            "User-Agent": (user_agent or DEFAULT_API_USER_AGENT).strip() or DEFAULT_API_USER_AGENT,
            "X-QuestionBank-Crawler": "1",
        },
    )

    try:
        with urlopen(request, timeout=30) as response:
            return json.loads(response.read().decode("utf-8"))
    except HTTPError as error:
        detail = error.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"Worker API returned {error.code}: {detail}") from error
    except URLError as error:
        raise RuntimeError(f"Worker API request failed: {error}") from error


def candidates_to_json(items: list[CandidateItem]) -> str:
    return json.dumps([asdict(item) for item in items], ensure_ascii=False, indent=2)
