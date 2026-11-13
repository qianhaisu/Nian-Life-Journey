# Product: Nianlife V2 — 张年的人生档案

<!-- impeccable:product-schema 1 -->

> **Tagline:** Life is about a dream. 张年的人生档案。  
> **Normative Principles:** Derived from [docs/nianlife-product-principles.md](docs/nianlife-product-principles.md) and [AGENTS.md](AGENTS.md). Content, privacy, and editorial rules in those documents remain binding across all V2 surfaces.

## Platform

web

## Users

- **Primary Readers (Today):** Zhang Nian's close family members (parents, grandparents, caregivers) reading on mobile phones (`375px–390px`) and desktop browsers via private shared link. Their job is to stay connected to how Zhang Nian is doing recently, revisit meaningful chapters, and check health or travel context effortlessly without managing software.
- **Future Owner (Long-Term):** Zhang Nian himself at ages 5, 10, 18, and 30+. The archive belongs to him—held in trust by his family now and handed back to him later—so every surface must age gracefully into a personal life publication he will want to read as an adult.

## Product Purpose

Nianlife is a private, long-term personal life archive for Zhang Nian. It turns real family life materials—photographs, videos, chat excerpts, daily traces, health logs, and monthly reports—into an edited, chronological, and relational record of how one person grew up.

Success means:
1. A family member opening the homepage without clicking anything immediately understands how Zhang Nian is doing now, what happened recently, and what is worth keeping.
2. Memories resurface through real relationships (same age, one year ago, shared places/people, life milestones) rather than forcing parents to manually tag, sort, or post.
3. All original bytes and provenance remain permanently owned by the family and traceable back to source materials.

## Positioning

Traditional baby apps promise: *"Come record your baby every day."*  
Nianlife promises: **"You live life; Nianlife quietly keeps what is worth keeping."**

Nianlife is **explicitly NOT**:
- A parenting toolbox, feeding/diaper tracker, or daily check-in app;
- A parenting news/knowledge portal, recipe hub, or generic AI Q&A chatbot;
- A parent social community, e-commerce mall, or course marketplace;
- A "maternal & infant super-app" cluttered with red-dot badges, gamified tasks, or infantilizing cartoon visuals.

**Feature Gate Test:** Before building any new page, module, or entry point, ask: *"Does this help a person, many years from now, better understand how they grew up?"* If the answer is not a clear yes, do not build it.

## Operating Context

- **Automated Ingestion & Curation:** WeChat sync and family photo imports (stored permanently in Aliyun OSS; never R2 or temporary hotlinks) flow into an automated background Organizer (`v2/lib/organizer/`) and editorial review workflow (`docs/daily-editor.md`, `v2/scripts/editor/STYLE.zhang.md`).
- **Primary Reading Surfaces:** Equal-weight navigation across `首页` (`/`), `记忆` (`/memory` & `/events/[id]`), `健康` (`/health`, feature-flagged via `SECTIONS.health`), `旅行` (`/travel`), and `妈妈月报` (`/mom-reports`), plus search (`/memory/search`) and distraction-free film viewing (`/films/[id]`).
- **Manual Capture as Exception Path:** Manual capture/inbox routes (`/capture`, `/inbox`) exist as quiet administrative/exception paths and are intentionally kept out of primary family navigation so the archive never pressures families to "post."
- **Single Production Environment:** Only `main` branch and production deployment exist (no long-lived staging/preview environments).

## Capabilities and Constraints

### 1. Two Clocks Everywhere (两个时钟并存)
Every story, memory card, timeline entry, snapshot, and media viewer must simultaneously surface **both**:
- **Gregorian Calendar Time:** e.g., `2026.08.22` (never raw database timestamps like `00:00:00+00`);
- **Life Time (Age / Stage):** e.g., `张年 · 1 岁 7 个月` or pre-birth pregnancy stage (`出生前`).

Age is mandatory narrative context, not optional decoration.

### 2. Zero Counts in the Primary Reading Layer (主阅读层零计数)
The primary reading layer must **never** display engineering metadata, data-model terminology, or raw quantity counters as titles or summaries:
- **Forbidden in reading views:** `"32 张照片 / 8 条消息 / 4 个 LifeEvent"`, `"Quark 照片初始化 · 10 media"`, `MediaAsset`, `RawSource`, `provider`, `connector`, `task id`, `organizer run`, or sync/batch status banners.
- **Required instead:** Narrative headlines, representative quotes, curated photos, and qualitative monthly/annual reflections. Source provenance belongs strictly inside collapsible secondary disclosures (`当时留下的资料`), never in the primary story card.

### 3. Verified-Media-Only Rule (媒体背书与质量门禁)
No unverified, broken, or unvouched image may appear on family reading surfaces:
- **Provenance Privilege (`MediaPrivilege`):** Family album and day-photo surfaces only render media that is either `trusted` (from the family's own photo archive collection, e.g. Quark album originals) or `checked` (human-verified `media_subject_check` confirming it depicts this child). Story pages display only approved `storyDisplayMedia` pairs; `excluded` images are withheld from reading/album surfaces.
- **Explicit No-Photo Sentinel:** Events marked `heroMediaId === "none"` (`NO_HERO_MEDIA_ID`) render as intentional text-only stories without falling back to unreviewed attachments.
- **Deliverability & Resolution Floors:** Reading surfaces consume only deliverable OSS-backed assets (`deliverableMediaIds`) meeting minimum pixel thresholds (`HERO_MIN_SHORT_SIDE = 480`, `HERO_MIN_LONG_SIDE = 720` for hero slots; `THUMBNAIL_MIN_SIDE = 160` for gallery cells) so WeChat UI icons or tiny fragments never upscale into broken tiles.
- **Presentable Alt Text:** Raw filenames (`微信图片_...jpg`) and generic importer placeholders (`"WeChat image"`) are suppressed via `presentableAlt()` in favor of human descriptions or neutral contextual labels (`一张照片` / `一段视频`).

### 4. Child Privacy & Access Control (儿童隐私与访问边界)
- **Private Family Publication:** Children's photos, videos, health records, and family conversations are treated as sensitive personal data by default.
- **Search Engine Exclusion:** All pages set `robots: { index: false, follow: false }`, `robots.ts` disallows all crawlers (`Disallow: /`), and protected/redirected routes attach `X-Robots-Tag: noindex, nofollow`.
- **Visibility Gating:** Public/family reading queries enforce `visibility !== "private"` and publication quality-review gates (`isEventPublishable`, `isTracePublishable`, `isSnapshotPublishable`); draft/unreviewed rows never leak onto family reading surfaces. Medical/health materials remain `private` by default unless explicitly shared.
- **Permanent OSS Storage:** Original images, thumbnails, and web derivatives write permanently to Aliyun OSS only (R2 and temporary hotlinks are prohibited).
- **Zero Data Leakage in Docs:** Never copy child photos, personal health details, raw family chat text, or signed media URLs into tracked repository docs, design references, or public artifacts.

### 5. Health Disclaimer Rule (健康记录免责边界)
Health records (`/health`, `v2/app/health/health-view.tsx`) organize verified medical visits, illness spans, and follow-up observations chronologically to help parents recall history clearly. Every health view must display the explicit non-medical disclaimer:
> **"辅助整理，不是诊断，不能代替医生。"**

Health UI must distinguish verified illness spans from suspected/ongoing/unconfirmed spans visually without offering diagnostic claims or treatment recommendations.

### 6. Unequal Weight & Honest Gaps (生活不等权与留白)
- High-worthiness milestones (`memory_led` chapters/highlights) command visual prominence; ordinary daily traces (`text_led` / `photo_led`) stay compact or folded in collapsible disclosures.
- Empty or insufficient material never renders `"暂无"` placeholders or fabricated filler: if a resurface module or highlight has no genuine match, omit the module completely.

## Brand Commitments

- **Name & Motto:** `张年的人生档案` / `Life is about a dream`
- **Aesthetic Posture:** Warm, modern, and editorial—built for long-term dignity rather than infantilizing "cute baby" tropes. Visual tokens and UI mechanics are governed separately by [DESIGN.md](DESIGN.md).
- **Language:** Simplified Chinese primary copy with clean geometric Latin numerals/dates; grounded, truthful non-fiction tone (`v2/scripts/editor/STYLE.zhang.md`).

## Evidence on Hand

- Production V2 Next.js application in `v2/` backed by PostgreSQL + Drizzle ORM and Aliyun OSS media storage.
- Authoritative product principles in [docs/nianlife-product-principles.md](docs/nianlife-product-principles.md) and editorial guidelines in `docs/daily-editor.md`.
- Visual design system documented in [DESIGN.md](DESIGN.md).

## Product Principles

1. **Person First (人是第一层，不是功能):** Organize around Zhang Nian's life and chapters, never around software features or data tables.
2. **Two Clocks (两个时钟并存):** Pair Gregorian dates with Zhang Nian's age/stage on every memory, timeline, and media viewer.
3. **Media First, Metadata Back (媒体在前，元数据在后):** Zero counts, zero connector names, and zero technical jargon in primary reading views.
4. **Invisible Automation (后台自动整理):** Background ingestion and curation grow the archive silently; reading—not uploading—is the primary user action.
5. **The Family Owns Its Life (人生属于家庭):** Preserve raw originals and full source traceability permanently without vendor lock-in.

## Accessibility & Inclusion

- **Mobile-First Family Readability:** Designed for parents and older relatives reading one-handed on `375px–390px` phones as well as desktop screens, with `>= 44px` touch targets on all interactive controls.
- **Keyboard & Screen-Reader Parity:** Skip links (`#main-content`), semantic landmarks, distinguishable per-photo accessible labels (`打开第 N 张照片`), full modal focus management, and `prefers-reduced-motion` support.
- **Reliable Mainland China Access:** Zero external Google Fonts or blocked third-party CDN dependencies.
