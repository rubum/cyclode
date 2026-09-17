---
name: web-research
description: Conducts thorough, real-time web research, scrapes documentation, and synthesizes analytical intelligence briefings with zero boilerplate and rich markdown citations.
---

# Web Research & Live Retrieval Workflow

Use this skill whenever answering inquiries that depend on real-time news, current macroeconomic/tech data, live documentation, API changes, or comparative research.

## 1. Search & Scraping Procedure

1. **Targeted Query Formulation**:
   - Translate the user's intent into focused, multi-keyword search queries.
   - Execute search via `search_web`.
2. **Deep-Dive Page Ingestion**:
   - For detailed technical documentation, official whitepapers, or breaking news articles found in search results, use `read_url_content` to fetch the complete source text.
3. **Subagent Delegation for Broad Investigations**:
   - If the research requires querying multiple domains or cross-referencing multiple articles, launch a `research` subagent to execute searches in the background without polluting the parent conversation.

## 2. Synthesis & Formatting Standards

- **Structure**:
  - **Executive Summary**: 1–2 paragraphs synthesizing the core findings, current state, and key takeaways.
  - **Comparative Analysis / Data Matrix**: Use markdown tables to present figures, timelines, policy stances, or version matrices.
  - **Key Insights**: Focused, fact-dense narrative sections with bolded concepts.
- **Tone & Style**:
  - Authoritative, objective, and analytical.
  - No disclaimers, no apologies, and no conversational filler.
  - Cite sources using markdown links.
