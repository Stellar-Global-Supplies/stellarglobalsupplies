# Developer Guide: Creating Your `ai_context/` Folder

> Share this document with every team that owns a repo in the org.
> 30 minutes of work per repo. No tooling required. Just fill in markdown files using the prompts below.

---

## What This Is

Every repo that wants to appear in org-level AI-generated social posts needs an `ai_context/` folder at its root containing **4 markdown files**. A workflow reads only these files — nothing else in your repo is scanned. The better you fill them in, the better the posts.

```
your-repo/
└── ai_context/
    ├── overview.md          ← What it is, who it's for, current status
    ├── tech-stack.md        ← Full technology breakdown
    ├── features.md          ← Key capabilities with the tech behind each
    ├── engineering.md       ← Architecture, hard problems, metrics
    └── ui.md              ← UI pages description for image generation
```

**That's it. 5 files. Use the prompts below to fill them in fast.**

---

## How to Use These Prompts

1. Open Claude, ChatGPT, or any LLM
2. Copy the prompt for each file
3. Paste in your raw material (README, package.json, your own notes — whatever you have)
4. The AI fills in the template
5. You review, correct anything wrong, commit

You can also do all 4 files in one shot using the **combined prompt** at the bottom.

---

## File 1 — `overview.md`

**Copy this prompt:**

```
You are a technical writer documenting a software project for an engineer audience.
Using the raw material I provide, fill in this exact markdown template.
Be specific and concrete. If a field is unknown, write UNKNOWN rather than guessing.
Do not add sections. Do not remove sections. Output only the filled-in markdown.

TEMPLATE:
# Overview

## Project Name
[name]

## One-Liner
[Complete: "This project ___" in max 15 words. What it does, not what it is.]

## Problem It Solves
[Specific problem. Who has it. How painful it is. 2-3 sentences.]

## Solution
[How this project solves it. Mention the core mechanism. 2-3 sentences.]

## Who Uses It
[Specific audience. E.g. "Backend engineers at B2B SaaS startups" not "developers".]

## Status
[One of: Alpha / Beta / GA / Stable / Actively maintained / Maintenance mode / Archived]

## Repo URL
[https://github.com/org/repo]

## Live URL
[Public URL or NONE]

## Open Source?
[Yes — MIT / Yes — Apache 2.0 / No — Proprietary / No — BSL]

## Started
[Month Year]

---

RAW MATERIAL:
[PASTE YOUR README, ELEVATOR PITCH, OR NOTES HERE]
```

---

## File 2 — `tech-stack.md`

**Copy this prompt:**

```
You are a senior engineer documenting a project's technology choices.
Using the raw material I provide, fill in this exact markdown template.
Include version numbers wherever visible. List every meaningful dependency,
not just the top-level framework. Group accurately. Output only the markdown.

TEMPLATE:
# Tech Stack

## Language(s)
[e.g. TypeScript 5.4, Python 3.12, Go 1.22]

## Frontend
[Framework, component library, state management, build tool, CSS approach]
[e.g. Next.js 14 App Router · Tailwind CSS · shadcn/ui · Zustand · Vite]
[Write NONE if no frontend]

## Backend / API
[Runtime, framework, API style]
[e.g. Node.js 20 · Fastify v4 · REST + tRPC]

## Database & Storage
[Include type: relational / document / vector / cache / object storage]
[e.g. PostgreSQL 16 (Supabase) · Redis 7 (Upstash) · S3-compatible (R2)]

## AI / ML (if applicable)
[Models used, embedding providers, vector DBs, frameworks]
[e.g. GPT-4o (Azure OpenAI) · text-embedding-3-small · Pinecone · LangChain.js]
[Write NONE if not applicable]

## Infrastructure & Cloud
[Provider, compute type, CDN, IaC]
[e.g. AWS ECS Fargate · RDS · CloudFront · Terraform]

## CI/CD & Observability
[e.g. GitHub Actions · Docker · ArgoCD · Datadog APM · Sentry]

## Auth & Security
[e.g. Clerk · AWS Secrets Manager · JWT RS256]

## Key Third-Party Integrations
[APIs and SDKs your code calls]
[e.g. Stripe · Resend · Twilio · GitHub API · Slack API]

## Package Manager & Dev Tooling
[e.g. pnpm workspaces · ESLint · Prettier · Vitest · Playwright]

---

RAW MATERIAL (paste package.json, requirements.txt, Dockerfile, or describe your stack):
[YOUR CONTENT]
```

---

## File 3 — `features.md`

**Copy this prompt:**

```
You are a developer advocate writing about a technical project for senior engineers.
Using the raw material I provide, fill in this exact markdown template.
For every feature: name the specific technology that powers it and explain
WHY it is technically interesting or non-trivial. Avoid generic descriptions.
The audience can tell when posts are vague — be precise. Output only the markdown.

TEMPLATE:
# Features

## Core Features

[Repeat this block 5–8 times, one per significant feature]

### [Feature Name]
**What it does:** [One sentence. What the user/developer experiences.]
**Powered by:** [Specific library, service, algorithm, or pattern.]
**Why it's notable:** [What makes it hard, clever, or different from the naive approach.]

---

## Recently Shipped
[Bullet list. Format: - **[Month Year]**: Feature name — one sentence description.]
[If nothing recent, write NONE]

## In Progress / Coming Soon
[Bullet list of what's being built right now that a dev audience would care about.]
[If nothing to share, write NONE]

## Developer Experience Features
[CLI tools, SDKs, local dev setup, API design, webhooks, docs quality, etc.]

## Notable Performance Numbers
[Response times, bundle sizes, cold starts, throughput — real numbers only.]
[If none, write NONE]

---

RAW MATERIAL (paste changelog, feature list, product docs, or describe your features):
[YOUR CONTENT]
```

---

## File 4 — `engineering.md`

**Copy this prompt:**

```
You are a senior engineer writing technical content for a developer audience.
This content will be used for "how we built X" style social media posts.
Engineers can tell when posts are vague — use real library names, algorithm names,
pattern names, and numbers. Using the raw material I provide, fill in this template.
Output only the markdown.

TEMPLATE:
# Engineering

## Architecture Pattern
[High-level pattern: Monolith / Modular Monolith / Microservices / Serverless / Event-Driven / Edge-first / other]

## System Overview
[Describe the major components and how data flows between them.
A text diagram is great. What talks to what? 5-10 lines.]

## Key Architectural Decisions
[3-5 bullets. For each: what was decided AND why. The "why" is the interesting part.]
[e.g. - Chose CQRS to separate read/write paths because read load is 100x write load]

## Hard Problems Solved
[2-4 blocks. This is the most important section for social content.]

### [Problem Title]
**The problem:** [Why was this hard? Be specific.]
**What failed first:** [Approach that didn't work, if any. Honest is better.]
**The solution:** [What actually worked. Name the library/pattern/algorithm.]

### [Problem Title]
**The problem:**
**What failed first:**
**The solution:**

## Scale & Metrics
[Fill in everything you can. Approximations are fine. Unknown = UNKNOWN]
- Active users:
- Requests/day:
- Data volume:
- API p99 latency:
- Uptime:
- GitHub stars (if OSS):
- npm/Docker downloads (if applicable):
- Team size:

## Performance Wins
[Specific optimizations with before/after numbers, if any.]
[e.g. - Moved to Redis-first metering: cut DB writes by 94%, p99 dropped from 340ms to 60ms]

## What We'd Do Differently
[Optional but great for posts. 1-2 honest reflections.]

## Related Engineering Posts / Talks
[Links or titles if any exist. NONE if not.]

---

RAW MATERIAL (paste design docs, post-mortems, architecture notes, or describe freely):
[YOUR CONTENT]
```

---

---

## File 5 — `ui.md`

**Copy this prompt:**

```
You are a UI/UX designer documenting a software project's user interface for image generation.
Using the raw material I provide, fill in this exact markdown template.
Describe each page/screen in detail so an AI image generator can create accurate visuals.
Be specific about layout, colors, components, and user interactions.
Output only the filled-in markdown.

TEMPLATE:
# UI

## Pages

[Repeat this block for each significant page]

### [Page Name]
**Route:** [e.g. /login, /dashboard, /orders]
**Purpose:** [What this page does for the user in 1-2 sentences]
**Layout:** [Detailed description of the page structure, sections, and visual hierarchy]
**Key Components:** [List the main UI components: buttons, forms, cards, tables, etc.]
**Colors:** [Primary colors, background, accent colors, status colors]
**Mobile Behavior:** [How the page adapts to mobile screens]

---

## Design System

**Color Palette:**
- Primary: [main brand color]
- Secondary: [secondary color]
- Background: [background color(s)]
- Text: [text color(s)]
- Status: [success, warning, error colors]

**Typography:**
- Font family: [e.g. Inter, system fonts]
- Font sizes: [heading, body, small text sizes]

**Components:**
- Buttons: [style description]
- Forms: [input styles, validation]
- Cards: [shadow, border radius, padding]

---

RAW MATERIAL (paste screenshots, Figma links, or describe your UI):
[YOUR CONTENT]
```

---

## ⚡ Combined Prompt — All 5 Files at Once

If you're in a hurry, use this single prompt to generate all 5 files from whatever you have:

```
You are a technical writer and developer advocate creating structured documentation
for a software project. I will give you raw material and you will output all 5
ai_context files. Rules:
- Be specific: name real libraries, versions, patterns, algorithms
- Write for senior engineers, not for marketing
- If information is missing, add [TODO: what to put here] — never invent facts
- Output each file as a separate markdown section with the filename as an H1 heading

Output this structure exactly:
# overview.md
[full content]

# tech-stack.md
[full content]

# features.md
[full content]

# engineering.md
[full content]

# ui.md
[full content]

Here is everything about the project — paste your README, package.json,
architecture notes, changelog, or just describe it in your own words:

[YOUR CONTENT]
```

---

## ⚡ Combined Prompt — All 4 Files at Once

If you're in a hurry, use this single prompt to generate all 4 files from whatever you have:

```
You are a technical writer and developer advocate creating structured documentation
for a software project. I will give you raw material and you will output all 4
ai_context files. Rules:
- Be specific: name real libraries, versions, patterns, algorithms
- Write for senior engineers, not for marketing
- If information is missing, add [TODO: what to put here] — never invent facts
- Output each file as a separate markdown section with the filename as an H1 heading

Output this structure exactly:
# overview.md
[full content]

# tech-stack.md
[full content]

# features.md
[full content]

# engineering.md
[full content]

Here is everything about the project — paste your README, package.json,
architecture notes, changelog, or just describe it in your own words:

[YOUR CONTENT]
```

---

## ✅ Quality Bar — Read Before Committing

Good `ai_context/` files answer yes to all of these:

- [ ] Every feature names the **specific library or pattern** that powers it (not just "uses AI" or "uses our database")
- [ ] Tech stack has **version numbers** for major dependencies
- [ ] At least **2 hard problems** are documented with specific solutions
- [ ] At least **3 real metrics** exist (rough estimates are fine, UNKNOWN is fine, blank is not)
- [ ] Architecture section explains **why** decisions were made, not just what they are
- [ ] None of these words appear: *robust*, *seamless*, *cutting-edge*, *best-in-class*, *leverages*, *utilize*

The richer your input, the better the generated posts. A 10-minute fill-in produces mediocre output. A 30-minute fill-in produces posts your team will actually want to share.

---

## FAQ

**Do I need to keep these files updated?**
Update them when you ship something significant — new features, architecture changes, hitting a milestone. The workflow runs weekly so stale files produce stale posts.

**What if my repo is private or internal?**
The workflow uses a PAT that the platform team has configured. It can read private repos in the org. Your code is never sent to any external service — only the contents of `ai_context/*.md` are processed.

**What if my project has no metrics yet?**
Write UNKNOWN or rough estimates. "~100 active users in beta" is more useful than a blank field.

**Can I add extra files beyond the 4?**
Yes. Any `.md` file in `ai_context/` gets included. But the 4 files above cover 95% of what generates good posts.

**Who do I contact?**
[Platform team Slack channel / owner name here]