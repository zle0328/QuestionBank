from __future__ import annotations

import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from question_bank_crawler.cli import main
from question_bank_crawler.client import submit_candidates
from question_bank_crawler.config import load_config
from question_bank_crawler.crawler import crawl_source
from question_bank_crawler.extract import content_hash, parse_html
from question_bank_crawler.models import CandidateItem, CrawlResult, CrawlerConfig, SourceConfig


class CrawlerTests(unittest.TestCase):
    def test_load_config_maps_sources(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            path = Path(temp_dir) / "sources.json"
            path.write_text(
                json.dumps(
                    {
                        "userAgent": "QuestionBankCrawler/Test",
                        "defaultDelaySeconds": 0,
                        "sources": [
                            {
                                "name": "Docs",
                                "baseUrl": "https://docs.example/",
                                "type": "question",
                                "category": "Java",
                                "tags": ["JVM", "面试"],
                                "sitemapUrls": ["https://docs.example/sitemap.xml"],
                                "maxPages": 3,
                            }
                        ],
                    }
                ),
                encoding="utf-8",
            )

            config = load_config(path)

        self.assertEqual(config.user_agent, "QuestionBankCrawler/Test")
        self.assertEqual(config.sources[0].type, "question")
        self.assertEqual(config.sources[0].category, "Java")
        self.assertEqual(config.sources[0].tags, ["JVM", "面试"])

    def test_parse_html_extracts_title_text_and_links(self) -> None:
        html = """
        <html>
          <head><title>Redis 面试题</title><script>ignored()</script></head>
          <body>
            <main>
              <h1>Redis 面试题</h1>
              <p>Redis 常见数据结构包括 String、Hash、List、Set 和 ZSet。</p>
              <a href="/redis/lock">分布式锁</a>
            </main>
          </body>
        </html>
        """

        title, body, links = parse_html(html, "https://docs.example/redis")

        self.assertEqual(title, "Redis 面试题")
        self.assertIn("Redis 常见数据结构", body)
        self.assertIn("https://docs.example/redis/lock", links)

    def test_parse_vitepress_page_prefers_article_body_over_navigation(self) -> None:
        html = """
        <html>
          <head><title>如何从大量的 URL 中找出相同的 URL？ | advanced-java</title></head>
          <body>
            <div id="app">
              <a class="VPSkipLink" href="#VPContent">Skip to content</a>
              <header class="VPNav">
                <button class="VPNavBarSearchButton">Search ⌘ Ctrl K</button>
                <nav class="VPNavBarMenu">Main Navigation 首页 高并发架构 分布式系统</nav>
              </header>
              <aside class="VPSidebar">
                <nav>Sidebar Navigation 高并发架构 消息队列 为什么使用消息队列？</nav>
              </aside>
              <main id="VPContent" class="VPContent">
                <div class="VPDoc">
                  <div class="container">
                    <div class="content">
                      <div class="content-container">
                        <div class="vp-doc">
                          <h1>如何从大量的 URL 中找出相同的 URL？</h1>
                          <p>题目：给定 a、b 两个文件，各存放 50 亿个 URL，每个 URL 各占 64B，内存限制是 4G。</p>
                          <p>方案一：采用分治策略。遍历文件 a，对每个 URL 求 hash 后取模，将 URL 分散到 1000 个小文件中。</p>
                          <p>方案二：对每个小文件使用 HashSet 统计，再与另一个文件中对应的小文件做交集判断。</p>
                          <h2>方法总结</h2>
                          <p>核心思路是先切分降低内存压力，再用集合或前缀树完成去重和匹配。</p>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </main>
              <footer class="VPFooter">Released under the CC-BY-SA-4.0 license.</footer>
            </div>
          </body>
        </html>
        """

        title, body, links = parse_html(html, "https://java.doocs.org/big-data/find-common-urls")

        self.assertEqual(title, "如何从大量的 URL 中找出相同的 URL？")
        self.assertIn("给定 a、b 两个文件", body)
        self.assertIn("采用分治策略", body)
        self.assertIn("核心思路是先切分降低内存压力", body)
        self.assertNotIn("Skip to content", body)
        self.assertNotIn("Main Navigation", body)
        self.assertNotIn("Sidebar Navigation", body)
        self.assertGreater(len(body), 180)

    def test_parse_html_preserves_markdown_structure(self) -> None:
        html = """
        <html>
          <head><title>Java 线程池面试题</title></head>
          <body>
            <article class="markdown-body">
              <h1>Java 线程池面试题</h1>
              <p>线程池用于复用线程，降低创建和销毁线程的开销。</p>
              <h2>回答重点</h2>
              <ul>
                <li>核心线程数、最大线程数和队列容量需要结合任务类型配置。</li>
                <li>拒绝策略要结合业务降级或告警处理。</li>
              </ul>
              <blockquote>面试时要主动说明监控和压测。</blockquote>
              <pre><code>ExecutorService pool = Executors.newFixedThreadPool(8);</code></pre>
              <p>更多参考 <a href="/java/thread-pool">线程池详解</a>。</p>
            </article>
          </body>
        </html>
        """

        title, body, links = parse_html(html, "https://docs.example/java/thread-pool-interview")

        self.assertEqual(title, "Java 线程池面试题")
        self.assertIn("## 回答重点", body)
        self.assertIn("- 核心线程数、最大线程数和队列容量需要结合任务类型配置。", body)
        self.assertIn("> 面试时要主动说明监控和压测。", body)
        self.assertIn("```", body)
        self.assertIn("ExecutorService pool", body)
        self.assertIn("[线程池详解](https://docs.example/java/thread-pool)", body)
        self.assertIn("https://docs.example/java/thread-pool", links)

    def test_parse_interview_dialogue_promotes_questions_to_sections(self) -> None:
        html = """
        <html>
          <head><title>消息队列面试场景</title></head>
          <body>
            <main class="vp-doc">
              <h1>消息队列面试场景</h1>
              <p>面试官：你在系统里用过消息队列吗？</p>
              <p>候选人：用过，我们在订单系统里发送订单消息。</p>
              <p>面试官：那你们为什么使用消息队列啊？</p>
              <p>候选人：主要是异步解耦、削峰填谷和提升系统吞吐量。</p>
              <p>面试官：如何保证消息不被重复消费啊？</p>
              <p>候选人：消费端要设计幂等，例如用唯一业务键做去重。</p>
            </main>
          </body>
        </html>
        """

        title, body, _ = parse_html(html, "https://java.doocs.org/high-concurrency/mq-interview")

        self.assertEqual(title, "消息队列面试场景")
        self.assertIn("## 你在系统里用过消息队列吗？", body)
        self.assertIn("## 那你们为什么使用消息队列啊？", body)
        self.assertIn("## 如何保证消息不被重复消费啊？", body)
        self.assertIn("> 候选人：主要是异步解耦、削峰填谷和提升系统吞吐量。", body)

    def test_content_hash_is_stable_for_whitespace(self) -> None:
        left = content_hash("Java 线程池", "核心线程数  和  队列")
        right = content_hash("Java 线程池", "核心线程数 和 队列")

        self.assertEqual(left, right)

    def test_robots_blocking_skips_fetch(self) -> None:
        source = SourceConfig(name="Docs", base_url="https://docs.example/", max_pages=1, delay_seconds=0)
        config = CrawlerConfig(user_agent="QuestionBankCrawler/Test", default_delay_seconds=0)

        class Robots:
            def can_fetch(self, user_agent: str, url: str) -> bool:
                return False

        with (
            patch("question_bank_crawler.crawler.load_robots", return_value=Robots()),
            patch("question_bank_crawler.crawler.seed_urls", return_value=(["https://docs.example/a"], [])),
            patch("question_bank_crawler.crawler.fetch_text") as fetch_text,
        ):
            result = crawl_source(source, config)

        fetch_text.assert_not_called()
        self.assertEqual(result.candidates, [])
        self.assertEqual(result.failures[0].reason, "blocked_by_robots_txt")

    def test_html_page_becomes_candidate(self) -> None:
        source = SourceConfig(
            name="Docs",
            base_url="https://docs.example/",
            type="knowledge",
            category="后端",
            tags=["Redis"],
            max_pages=1,
            delay_seconds=0,
        )
        config = CrawlerConfig(user_agent="QuestionBankCrawler/Test", default_delay_seconds=0)
        paragraph = "Redis 是常用的内存数据结构存储，面试中经常考缓存、持久化、过期策略、淘汰策略和分布式锁。"
        html = f"<html><head><title>Redis 基础</title></head><body><article><p>{paragraph * 3}</p></article></body></html>"

        class Robots:
            def can_fetch(self, user_agent: str, url: str) -> bool:
                return True

        with (
            patch("question_bank_crawler.crawler.load_robots", return_value=Robots()),
            patch("question_bank_crawler.crawler.seed_urls", return_value=(["https://docs.example/redis"], [])),
            patch("question_bank_crawler.crawler.fetch_text", return_value=html),
        ):
            result = crawl_source(source, config)

        self.assertEqual(len(result.candidates), 1)
        self.assertEqual(result.candidates[0].title, "Redis 基础")
        self.assertEqual(result.candidates[0].category, "后端")
        self.assertEqual(result.candidates[0].tags, ["Redis"])
        self.assertEqual(result.failures, [])

    def test_submit_with_no_candidates_exits_successfully(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            path = Path(temp_dir) / "sources.json"
            path.write_text(
                json.dumps(
                    {
                        "userAgent": "QuestionBankCrawler/Test",
                        "sources": [],
                    }
                ),
                encoding="utf-8",
            )

            with patch("question_bank_crawler.cli.submit_candidates") as submit_candidates:
                exit_code = main(
                    [
                        "--config",
                        str(path),
                        "--submit",
                        "--api-base-url",
                        "https://worker.example",
                        "--admin-token",
                        "secret",
                    ]
                )

        submit_candidates.assert_not_called()
        self.assertEqual(exit_code, 0)

    def test_submit_candidates_sends_project_user_agent(self) -> None:
        item = CandidateItem(
            type="question",
            title="Java 线程池怎么配置？",
            category="Java",
            tags=["线程池"],
            excerpt="线程池参数配置。",
            content_md="Java 线程池面试会考核心线程数、最大线程数、队列、拒绝策略和监控。",
            source_url="https://docs.example/thread-pool",
            source_name="Docs",
            hash="hash-1",
        )

        class Response:
            headers = {}

            def __enter__(self) -> "Response":
                return self

            def __exit__(self, *args: object) -> None:
                return None

            def read(self) -> bytes:
                return b'{"accepted":1}'

        with patch("question_bank_crawler.client.urlopen", return_value=Response()) as urlopen:
            response = submit_candidates("https://worker.example", "secret", [item], user_agent="QuestionBankCrawler/Test")

        request = urlopen.call_args.args[0]
        self.assertEqual(response, {"accepted": 1})
        self.assertEqual(request.get_header("User-agent"), "QuestionBankCrawler/Test")
        self.assertEqual(request.get_header("X-questionbank-crawler"), "1")
        self.assertEqual(request.get_header("Accept"), "application/json")

    def test_cli_passes_config_user_agent_to_submit(self) -> None:
        candidate = CandidateItem(
            type="knowledge",
            title="Redis 基础",
            category="数据库",
            tags=["Redis"],
            excerpt="Redis 面试基础。",
            content_md="Redis 面试会考缓存、持久化、过期策略、淘汰策略和分布式锁。",
            source_url="https://docs.example/redis",
            source_name="Docs",
            hash="hash-redis",
        )

        with tempfile.TemporaryDirectory() as temp_dir:
            path = Path(temp_dir) / "sources.json"
            path.write_text(
                json.dumps(
                    {
                        "userAgent": "QuestionBankCrawler/CI",
                        "sources": [
                            {
                                "name": "Docs",
                                "baseUrl": "https://docs.example/",
                            }
                        ],
                    }
                ),
                encoding="utf-8",
            )

            with (
                patch("question_bank_crawler.cli.crawl_all", return_value=[CrawlResult("Docs", [candidate], [])]),
                patch("question_bank_crawler.cli.submit_candidates", return_value={"accepted": 1}) as submit,
            ):
                exit_code = main(
                    [
                        "--config",
                        str(path),
                        "--submit",
                        "--api-base-url",
                        "https://worker.example",
                        "--admin-token",
                        "secret",
                    ]
                )

        self.assertEqual(exit_code, 0)
        self.assertEqual(submit.call_args.kwargs["user_agent"], "QuestionBankCrawler/CI")


if __name__ == "__main__":
    unittest.main()
