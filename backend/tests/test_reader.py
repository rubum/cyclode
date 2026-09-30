import pytest
from unittest.mock import AsyncMock, MagicMock, patch
from httpx import AsyncClient, ASGITransport
from app.api.reader import _clean_html_to_markdown, _fetch_github_repo_info


def test_clean_html_to_markdown():
    html = """
    <html>
        <head><title>Test Page</title></head>
        <body>
            <nav><a href="/home">Home</a></nav>
            <article>
                <h1>Arroyo Streaming Engine</h1>
                <p>Arroyo is a <strong>distributed</strong> streaming engine in Rust.</p>
                <pre><code class="language-rust">fn main() { println!("Hello"); }</code></pre>
                <ul>
                    <li>Watermarks</li>
                    <li>Stateful triggers</li>
                </ul>
            </article>
            <footer>Copyright 2026</footer>
        </body>
    </html>
    """
    md = _clean_html_to_markdown(html)
    assert "# Arroyo Streaming Engine" in md
    assert "**distributed**" in md
    assert "```rust" in md
    assert "fn main()" in md
    assert "Watermarks" in md
    assert "Copyright" not in md  # footer stripped
    assert "Home" not in md  # nav stripped


@pytest.mark.asyncio
async def test_fetch_github_repo_info():
    mock_meta_resp = MagicMock()
    mock_meta_resp.status_code = 200
    mock_meta_resp.text = ""
    mock_meta_resp.json.return_value = {
        "full_name": "arroyo-systems/arroyo",
        "description": "Distributed streaming engine in Rust",
        "stargazers_count": 4200,
        "forks_count": 350,
        "language": "Rust",
        "html_url": "https://github.com/arroyo-systems/arroyo",
        "clone_url": "https://github.com/arroyo-systems/arroyo.git"
    }

    mock_readme_resp = MagicMock()
    mock_readme_resp.status_code = 200
    mock_readme_resp.text = "# Arroyo\n\nArroyo is a distributed stream processing engine."

    async def mock_get(url, *args, **kwargs):
        if "/readme" in url or "raw.githubusercontent.com" in url:
            return mock_readme_resp
        elif "api.github.com" in url:
            return mock_meta_resp
        res = MagicMock()
        res.status_code = 404
        res.text = ""
        return res

    with patch("httpx.AsyncClient.get", side_effect=mock_get):
        data = await _fetch_github_repo_info("arroyo-systems", "arroyo")
        assert data["type"] == "github"
        assert data["repo_name"] == "arroyo-systems/arroyo"
        assert data["stars"] == 4200
        assert data["language"] == "Rust"
        assert "Arroyo is a distributed stream processing engine" in data["content_markdown"]


def test_clean_github_markdown_risingwave_html():
    from app.api.reader import _clean_github_markdown

    raw_sample = """<p align="center">
  <picture>
    <source srcset=".github/RisingWave-logo-dark.svg" width="500px" media='(prefers-color-scheme: dark)'>
    <img src=".github/RisingWave-logo-light.svg" width="500px">
  </picture>
</p>

<div align="center">
  <h3>🌊 Event Streaming for Agentic AI</h3>
</div>

<p align="center">
  <a href="https://docs.risingwave.com/">Docs</a> |
  <a href="./benchmarks.md">Benchmarks</a>
</p>

<p align="center">
  <a href="https://github.com/risingwavelabs/risingwave/releases/latest" target="_blank">
    <img alt="Release" src="https://img.shields.io/github/v/release/risingwavelabs/risingwave.svg">
  </a>
</p>

```html
<p align="center">Preserved in code block</p>
```
"""
    cleaned = _clean_github_markdown(raw_sample, "risingwavelabs", "risingwave", default_branch="main")

    # 1. Picture converted to dark logo with rebased URL
    assert "RisingWave-logo-dark.svg" in cleaned
    assert "https://raw.githubusercontent.com/risingwavelabs/risingwave/main/.github/RisingWave-logo-dark.svg" in cleaned

    # 2. HTML heading converted
    assert "### 🌊 Event Streaming for Agentic AI" in cleaned

    # 3. Wrapper tags stripped outside code blocks
    assert "<div align=\"center\">" not in cleaned
    assert "</div>" not in cleaned
    assert "<picture>" not in cleaned

    # 4. Links rebased
    assert "https://github.com/risingwavelabs/risingwave/blob/main/benchmarks.md" in cleaned

    # 5. Badges converted
    assert "![Release](https://img.shields.io/github/v/release/risingwavelabs/risingwave.svg)" in cleaned

    # 6. Fenced code block remains intact
    assert "<p align=\"center\">Preserved in code block</p>" in cleaned


def test_clean_html_to_markdown_docusaurus_docs():
    from app.api.reader import _clean_html_to_markdown

    doc_sample = """<!DOCTYPE html>
<html>
<head><title>Introduction | Arroyo Documentation</title></head>
<body>
<div id="__docusaurus">
  <div class="navbarSearchContainer">Search Ctrl K Cancel</div>
  <nav class="navbar"><a href="/">Home</a></nav>
  <aside class="theme-doc-sidebar-container sidebar">
    <ul><li>Sidebar Nav Item</li></ul>
  </aside>
  <main class="docMainContainer">
    <article>
      <h1>Introduction to Arroyo</h1>
      <p>Arroyo is a <strong>distributed stream processing engine</strong> written in Rust.</p>
      <h2>Quickstart</h2>
      <pre><code class="language-bash">cargo install arroyo</code></pre>
      <ul>
        <li>Sub-second recovery</li>
        <li>SQL and Rust APIs</li>
      </ul>
      <p>Visit the <a href="/tutorial">Tutorial</a> to get started.</p>
    </article>
  </main>
  <footer class="footer">Copyright 2026</footer>
</div>
</body>
</html>"""
    md = _clean_html_to_markdown(doc_sample, base_url="https://doc.arroyo.dev")

    # Header and sidebar elements must be stripped
    assert "Search Ctrl K" not in md
    assert "Sidebar Nav Item" not in md
    assert "Copyright" not in md

    # Content must be cleanly formatted
    assert "# Introduction to Arroyo" in md
    assert "**distributed stream processing engine**" in md
    assert "## Quickstart" in md
    assert "cargo install arroyo" in md
    assert "Sub-second recovery" in md
    assert "https://doc.arroyo.dev/tutorial" in md


def test_extract_site_navigation_docusaurus():
    from app.api.reader import _extract_site_navigation

    doc_sample = """<!DOCTYPE html>
<html>
<body>
<div id="__docusaurus">
  <aside class="theme-doc-sidebar-container sidebar">
    <nav class="menu" aria-label="Docs sidebar">
      <ul class="menu__list">
        <li class="menu__list-item"><a class="menu__link" href="/overview">Overview</a></li>
        <li class="menu__list-item">
          <div class="menu__list-item-collapsible">
            <a class="menu__link menu__link--sublist" href="/tutorial">Tutorials</a>
          </div>
          <ul class="menu__list">
            <li class="menu__list-item"><a class="menu__link" href="/tutorial/first-pipeline">First Pipeline</a></li>
            <li class="menu__list-item"><a class="menu__link" href="/tutorial/windowing">Windowing</a></li>
          </ul>
        </li>
        <li class="menu__list-item">
          <div class="menu__list-item-collapsible">
            <span class="menu__link menu__link--sublist">Architecture</span>
          </div>
          <ul class="menu__list">
            <li class="menu__list-item"><a class="menu__link" href="/architecture/controller">Controller</a></li>
          </ul>
        </li>
      </ul>
    </nav>
  </aside>
</div>
</body>
</html>"""
    tree = _extract_site_navigation(doc_sample, base_url="https://doc.arroyo.dev")
    assert len(tree) == 3
    assert tree[0]["title"] == "Overview"
    assert tree[0]["url"] == "https://doc.arroyo.dev/overview"

    assert tree[1]["title"] == "Tutorials"
    assert tree[1]["url"] == "https://doc.arroyo.dev/tutorial"
    assert len(tree[1]["children"]) == 2
    assert tree[1]["children"][0]["title"] == "First Pipeline"
    assert tree[1]["children"][0]["url"] == "https://doc.arroyo.dev/tutorial/first-pipeline"

    assert tree[2]["title"] == "Architecture"
    assert "children" in tree[2]
    assert tree[2]["children"][0]["title"] == "Controller"
    assert tree[2]["children"][0]["url"] == "https://doc.arroyo.dev/architecture/controller"


def test_extract_snippet():
    from app.api.reader import _extract_snippet

    text = "Line 1.\nLine 2.\nHere is an awesome high-throughput pipeline for streaming data.\nLine 4.\nLine 5."
    snippet = _extract_snippet(text, "high-throughput", max_chars=50)
    assert "high-throughput pipeline" in snippet
    assert "..." in snippet

    # Case insensitive
    snippet_ci = _extract_snippet(text, "PIPELINE", max_chars=50)
    assert "pipeline" in snippet_ci.lower()

    # Query not found returns first chunk
    snippet_not_found = _extract_snippet("Short string", "nonexistent", max_chars=20)
    assert "Short string" in snippet_not_found


@pytest.mark.asyncio
async def test_search_doc_pages_endpoint():
    from httpx import AsyncClient, ASGITransport
    from app.main import app
    from app.db.session import async_session_factory
    from app.db.models import DocPageCacheModel

    # Seed a cached doc page
    async with async_session_factory() as session:
        cached = DocPageCacheModel(
            id="test-doc-search-id-1",
            url="https://doc.arroyo.dev/tutorial/windowing",
            domain="doc.arroyo.dev",
            title="Windowing Mechanics",
            content_markdown="# Windowing Mechanics\n\nTumbling and sliding windows are fundamental primitives in stream processing.",
            headings_json='[{"title": "Windowing Mechanics", "level": 1}]'
        )
        await session.merge(cached)
        await session.commit()

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        # Search by term
        resp = await client.get("/api/reader/search?q=sliding+windows&domain=doc.arroyo.dev")
        assert resp.status_code == 200
        data = resp.json()
        assert data["total_results"] >= 1
        assert any("Windowing Mechanics" in r["title"] for r in data["results"])
        first_match = next(r for r in data["results"] if r["title"] == "Windowing Mechanics")
        assert "sliding windows" in first_match["snippet"].lower()

        # Search with no matches
        resp_empty = await client.get("/api/reader/search?q=completelyabsentqueryxyz")
        assert resp_empty.status_code == 200
        assert resp_empty.json()["total_results"] == 0


@pytest.mark.asyncio
async def test_fetch_arxiv_paper_info():
    from app.api.reader import _fetch_arxiv_paper_info

    sample_atom = """<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <entry>
    <id>http://arxiv.org/abs/1706.03762v7</id>
    <updated>2023-08-02T01:55:40Z</updated>
    <published>2017-06-12T17:57:34Z</published>
    <title>Attention Is All You Need</title>
    <summary>The dominant sequence transduction models are based on complex recurrent or convolutional neural networks.</summary>
    <author>
      <name>Ashish Vaswani</name>
    </author>
    <author>
      <name>Noam Shazeer</name>
    </author>
    <arxiv:comment xmlns:arxiv="http://arxiv.org/schemas/atom">15 pages, 5 figures</arxiv:comment>
    <arxiv:primary_category xmlns:arxiv="http://arxiv.org/schemas/atom" term="cs.CL" scheme="http://arxiv.org/schemas/atom"/>
    <category term="cs.CL" scheme="http://arxiv.org/schemas/atom"/>
    <category term="cs.LG" scheme="http://arxiv.org/schemas/atom"/>
  </entry>
</feed>"""

    mock_resp = MagicMock()
    mock_resp.status_code = 200
    mock_resp.text = sample_atom

    with patch("httpx.AsyncClient.get", return_value=mock_resp):
        info = await _fetch_arxiv_paper_info("1706.03762", "https://arxiv.org/abs/1706.03762")
        assert info["type"] == "arxiv"
        assert info["title"] == "Attention Is All You Need"
        assert "Ashish Vaswani" in info["authors"]
        assert "Noam Shazeer" in info["authors"]
        assert "cs.CL" in info["categories"]
        assert info["arxiv_id"] == "1706.03762"
        assert "/api/reader/proxy/pdf?url=https://arxiv.org/pdf/1706.03762.pdf" in info["pdf_url"]
        assert "The dominant sequence transduction models" in info["abstract"]
        assert "Attention Is All You Need" in info["content_markdown"]


@pytest.mark.asyncio
@pytest.mark.asyncio
async def test_get_url_reader_arxiv_and_pdf():
    from httpx import AsyncClient, ASGITransport
    from app.main import app

    mock_arxiv_result = {
        "type": "arxiv",
        "url": "https://arxiv.org/abs/2401.12345",
        "title": "Deep Reasoning with Multi-Agent Systems",
        "arxiv_id": "2401.12345",
        "authors": ["Jane Doe"],
        "published": "2024-01-15",
        "categories": ["cs.AI"],
        "pdf_url": "/api/reader/proxy/pdf?url=https://arxiv.org/pdf/2401.12345.pdf",
        "content_markdown": "# Deep Reasoning with Multi-Agent Systems\n\nAbstract here",
    }

    transport = ASGITransport(app=app)
    with patch("app.api.reader._fetch_arxiv_paper_info", return_value=mock_arxiv_result):
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            # 1. Test arXiv abs URL
            resp = await client.get("/api/reader?url=https://arxiv.org/abs/2401.12345")
            assert resp.status_code == 200
            data = resp.json()
            assert data["type"] == "arxiv"
            assert data["arxiv_id"] == "2401.12345"
            assert data["title"] == "Deep Reasoning with Multi-Agent Systems"
            assert "Jane Doe" in data["authors"]
            assert "/api/reader/proxy/pdf" in data["pdf_url"]

            # 2. Test direct .pdf URL
            pdf_resp = await client.get("/api/reader?url=https://example.com/research/whitepaper.pdf")
            assert pdf_resp.status_code == 200
            pdf_data = pdf_resp.json()
            assert pdf_data["type"] == "pdf"
            assert pdf_data["title"] == "whitepaper.pdf"
            assert "/api/reader/proxy/pdf" in pdf_data["pdf_url"]


@pytest.mark.asyncio
async def test_proxy_pdf_stream():
    from app.api.reader import proxy_pdf_stream
    from fastapi.responses import StreamingResponse

    # Mock upstream response stream
    mock_upstream_resp = MagicMock()
    mock_upstream_resp.status_code = 200
    mock_upstream_resp.headers = {
        "content-type": "application/pdf",
        "content-length": "1024",
        "etag": '"abc123etag"',
    }
    async def mock_aiter_bytes(chunk_size=65536):
        yield b"%PDF-1.5 mock pdf content"

    mock_upstream_resp.aiter_bytes = mock_aiter_bytes
    mock_upstream_resp.aclose = AsyncMock()

    mock_client = MagicMock()
    mock_client.build_request.return_value = MagicMock()
    mock_client.send = AsyncMock(return_value=mock_upstream_resp)
    mock_client.aclose = AsyncMock()

    with patch("httpx.AsyncClient", return_value=mock_client):
        response = await proxy_pdf_stream("https://arxiv.org/pdf/1706.03762.pdf")
        assert isinstance(response, StreamingResponse)
        assert response.media_type == "application/pdf"
        assert 'inline; filename="1706.03762.pdf"' in response.headers["Content-Disposition"]
        assert response.headers["Access-Control-Allow-Origin"] == "*"

        chunks = []
        async for chunk in response.body_iterator:
            chunks.append(chunk)
        assert b"".join(chunks) == b"%PDF-1.5 mock pdf content"


@pytest.mark.asyncio
async def test_reader_diff_context():
    from app.main import app
    from unittest.mock import AsyncMock, patch, MagicMock

    mock_text = "\n".join([f"def line_{i}(): pass" for i in range(1, 101)])
    mock_resp = MagicMock()
    mock_resp.status_code = 200
    mock_resp.text = mock_text

    mock_client = MagicMock()
    mock_client.get = AsyncMock(return_value=mock_resp)
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=None)

    transport = ASGITransport(app=app)
    with patch("app.api.reader.httpx.AsyncClient", return_value=mock_client):
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            resp = await client.get("/api/reader/diff/context?raw_url=https://raw.githubusercontent.com/owner/repo/main/lib/stores.ex&start_line=10&end_line=15")
            assert resp.status_code == 200
            data = resp.json()
            assert data["ok"] is True
            assert data["start_line"] == 10
            assert data["end_line"] == 15
            assert data["total_lines"] == 100
            assert len(data["lines"]) == 6
            assert data["lines"][0] == "def line_10(): pass"
            assert data["lines"][-1] == "def line_15(): pass"

            # Test clamping
            resp_clamp = await client.get("/api/reader/diff/context?raw_url=https://raw.githubusercontent.com/owner/repo/main/lib/stores.ex&start_line=95&end_line=150")
            assert resp_clamp.status_code == 200
            data_clamp = resp_clamp.json()
            assert data_clamp["start_line"] == 95
            assert data_clamp["end_line"] == 100
            assert len(data_clamp["lines"]) == 6



