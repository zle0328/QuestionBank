from __future__ import annotations

import argparse
import os
import sys

from .client import candidates_to_json, submit_candidates
from .config import load_config
from .crawler import crawl_all


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Crawl configured sources and submit QuestionBank candidates.")
    parser.add_argument("--config", default="sources.json", help="Path to sources JSON config.")
    parser.add_argument("--limit", type=int, default=None, help="Override max pages per source.")
    parser.add_argument("--dry-run", action="store_true", help="Print candidates without submitting.")
    parser.add_argument("--submit", action="store_true", help="Submit candidates to Worker API.")
    parser.add_argument("--api-base-url", default=os.getenv("ADMIN_API_BASE_URL"), help="Worker API base URL.")
    parser.add_argument("--admin-token", default=os.getenv("ADMIN_TOKEN"), help="Admin bearer token.")
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    config = load_config(args.config)
    results = crawl_all(config, limit=args.limit)
    candidates = [item for result in results for item in result.candidates]
    failures = [failure for result in results for failure in result.failures]

    print(f"candidates={len(candidates)} failures={len(failures)}")
    for failure in failures[:20]:
      print(f"failure url={failure.url} reason={failure.reason}", file=sys.stderr)

    if args.dry_run or not args.submit:
        print(candidates_to_json(candidates))
        return 0

    if not candidates:
        print("No candidates discovered; skipping submit.")
        return 0

    if not args.api_base_url or not args.admin_token:
        print("--api-base-url/ADMIN_API_BASE_URL and --admin-token/ADMIN_TOKEN are required when --submit is used.", file=sys.stderr)
        return 2

    response = submit_candidates(args.api_base_url, args.admin_token, candidates)
    print(response)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
