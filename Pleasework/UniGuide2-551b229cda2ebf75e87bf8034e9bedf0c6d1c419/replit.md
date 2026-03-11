# UniGuide 🍁 — Canadian University Planning

## Overview
A static HTML/CSS/JS web app for Canadian high school students (Grades 9–12) to plan their university journey. No backend — all data is localStorage + optional Firebase cloud sync.

## Pages
| File | Purpose |
|------|---------|
| `index.html` | Landing page / home |
| `selections.html` | Combined Majors + Universities workspace (primary entry point) |
| `profile.html` | User Profile — personal info, quiz answers, background, settings, danger zone |
| `major.html` | Legacy Majors page (still functional, nav updated) |
| `universities.html` | Legacy Universities page (still functional, nav updated) |
| `saved.html` | My List — saved programs with 5-tab detail dashboards (Academics, EC, Application, **Essays**, Funding) |
| `scholarships.html` | Legacy scholarship page (functional but no longer in nav) |
| `essays.html` | Legacy essays page (functional but no longer in nav — content integrated into saved.html Essays tab) |
| `tracker.html` | Application tracker (2 tabs: Application Tracker, Decision Comparison) |
| `data.js` | All shared data: MAJORS (354 programs across 15 categories), UNIVERSITIES (100 schools), PROGRAM_DATA, SCHOLARSHIPS |
| `browsing.html` | Two-pane browse page — Majors tab (354 majors, 15 categories) + Universities tab (100 unis) + **Funding tab** (113 scholarships, Cost Calculator, OSAP & Provincial Aid). Contains INDIVIDUAL_MAJOR_DATA, UNI_SUPPLEMENT, and the SCHOLARSHIPS array. |
| `auth.js` | Auth layer + ugLoad/ugSave helpers (localStorage + Firebase fallback) |
| `style.css` | Global design system |

## Architecture
- Pure static HTML — served via `npx serve . -p 5000`
- No build step, no framework
- All data is in `data.js` (global constants)
- Auth and cloud sync handled by `auth.js`
- CSS variables for theming in `style.css`
- Firebase config generated at startup by `generate-config.js` from Replit secrets

## Key Features (browsing.html)
- **Major detail panel**: Merges `INDIVIDUAL_MAJOR_DATA` + `MAJOR_EXTRA_DATA` (103 entries) — uses `extra.schools` for Top Canadian Schools, `extra.skills`, `extra.related` for Related Majors, `extra.desc2` appended to description, `extra.degree` for degree-specific info, `extra.outlookNote` in Job Outlook panel
- **University detail panel**: Uses `sup.vibeExt` for extended About text; 7 enriched universities (UofT, UBC, McGill, Waterloo, McMaster, Queen's, Western) also have `researchNote`, `studentLife`, `knownFor` in `UNI_SUPPLEMENT`; Programs Offered is a collapsible `<details>` element
- **URL deep linking**: `browsing?tab=unis&uni={id}`, `browsing?tab=majors&cat={cat}&major={major}`, and `browsing?tab=funding` — handled on init via `initFromURL()`. Must use extension-less URL (`browsing` not `browsing.html`) — `serve` strips query strings when doing the `.html` redirect.
- **Funding tab** (`#bt-funding`): left panel = filterable scholarship list (type/province/area) with 2 pinned tool items (Cost Calculator, Provincial Aid); right panel = scholarship detail view or tool panel rendered dynamically. Functions: `renderFundingList()`, `selectSchol(idx)`, `selectFundingTool(tool)`, `renderCalcPanel()`, `renderOsapPanel()`, `calcCostInBrowse()`, `applyFundingFilters()`, `resetFundingFilters()`.

## Key Features (selections.html)
- **Browse buttons**: Each major item in `showMajorList()` has a ⤴ icon-link (stops propagation, navigates to `browsing?tab=majors&cat=…&major=…`). Each university card has a ⤴ link button next to "Website ↗" (navigates to `browsing?tab=unis&uni=…`)
- **Split workspace**: Majors picker (left) + Universities picker (right)
- **Majors panel**: Search 800+ programs, browse 17 categories (incl. "Law" and "Trades & Applied Technology"), discovery quiz, **single major selection** (auto-replaces if one already chosen)
- **Universities panel**: Search + 6 filters, university cards with:
  - **University Fit Quiz** (15 questions): co-op priority, campus environment, prestige, city size, French/Quebec openness, budget, class size, research, sports, social life, industry connections, exchange programs, residence, alumni network, campus size. Stored in `uqAnswers` (localStorage `uqAnswers`). Adds up to 30 bonus pts to Fit%.
  - **"— I'll choose my program later —"** as first option in every program dropdown; shows amber hint note if saved without a program choice
  - Fit score (0–100%) derived from program match + ranking + co-op + university quiz bonus. Shows quiz-only score (without major) when quiz taken.
  - Up to 2 reason badges (e.g. "offers Mech Eng", "co-op available", "requires Calculus")
  - Expandable program details dropdown: Degree type, Co-op, Target Avg, Deadline, Tuition, Competitiveness, Required HS Courses
  - Save to My List with format "University Name — Major"
  - Toast confirmation with Undo button
- **Shared state**: selectedMajors persists via localStorage
- **Microflow**: Banner after major selection guiding next step
- **Mobile**: Tab bar to switch between Majors and Universities panels

## Key Features (saved.html — My List)
- Full-detail dashboard for each saved program with 4 tabs: Academics, Extracurriculars, Application, Funding
- **Grade Averages card**: Large Gr11 + Gr12 input fields; Gr12 status line (on track / within range / gap) shown inline inside the Gr12 card
- **Auto-average**: Entering individual subject grades in the course section auto-computes and writes back to Gr11/Gr12 avg inputs
- **EC & Essay self-rating sliders** (0–100): Persisted as `ecScore` and `essayScore` in `clState`; these feed the Application Tracker
- **Prerequisites section**: Course requirement checklist per program using `PROGRAM_DATA` lookup with slug-normalization fallback
- **Academics % score**: Composite of avg component (60 pts) + prereq completion component (40 pts), stored as `academicsPct`
- **Summary bar**: Compact Academics % bar above snapshot grid

## Key Features (tracker.html)
- Data-driven from `savedPrograms` localStorage
- **4 Application Strength rows** per program:
  1. Academics — from `academicsPct` (avg + prereq score)
  2. Extracurriculars — from `ecScore` set in My List
  3. Essays & Interview — from `essayScore` set in My List
  4. Overall — weighted (Academics 50%, EC 30%, Essays 20%)
- Color-coded bars (green ≥70%, amber ≥40%, red <40%)
- Hint text "Rate in My List →" when EC/essay scores are 0
- Days until admission deadline, target average, your Gr12 average

## Key Features (scholarships.html — legacy, no longer in nav)
- Still accessible directly at `/scholarships.html` but removed from nav; superseded by `browsing.html` Funding tab
- Contains its own inline scholarship array and cost calculator (kept for reference)

## data.js Key Sections
- **MAJORS**: 17 categories including `"Law"` (30+ programs) and `"Trades & Applied Technology"` (33 programs); backward-compat `"Law & Legal Studies"` kept
- **UNIVERSITIES**: 60 Canadian universities with fit scoring data; campus `lat`/`lng` are street-address-level coordinates (not city center); corrected for UNB (3 Bailey Dr, Fredericton), ULaval (2325 Rue de l'Université, QC), UCalgary, UOttawa, UManitoba, Memorial, York, Concordia
- **PROGRAM_DATA**: 100+ entries keyed as `uniId__slug`; includes common variants: `uoft__mechanical-engineering`, `uoft__computer-science`, `uoft__life-sciences`, `mcmaster__health-sciences`, `mcmaster__engineering-i`, `queens__commerce`, `queens__engineering`, `western__ivey`, `mcgill__engineering`
- **SCHOLARSHIPS**: 50-entry array (also used internally); scholarships.html has its own inline 100+ array with `link` field

## PROGRAM_DATA Slug Normalization (saved.html)
`getProgramData(uniId, slug)` first tries exact key `uniId__slug`, then normalizes:
- Engineering variants → `uniId__engineering`
- CS variants → `uniId__computer-science`
- Science variants → `uniId__science`

## Navigation
All pages share nav: `Browse | Selections | My List | Essays | Tracker | [Log In] [Start YOUR plan]`
("Funding" removed from nav — now accessed via Browse → 💰 Funding tab)
When logged in: `… | [User Pill] [Profile] [Log Out] | [Start YOUR plan]`
- Clicking the user pill or "Profile" goes to `profile.html`
- "Start YOUR plan" → `selections.html`

## Profile Page (`profile.html`)
- **Auth gate**: redirects logged-out users to sign-in prompt (no redirect, shows inline)
- **Header**: avatar, name, email, member since, profile completion bar (5 fields: name, grade, province, ethnicity, intended major)
- **A. Account**: email (read-only), send password reset email
- **B. Personal Info**: display name, grade, province, city — saved via `ugSaveProfile`
- **C. Background**: ethnicity (optional, labelled) — saved via `ugSaveProfile`
- **D. Academic Goals**: intended major (editable), selected majors (read-only pills from localStorage)
- **E. Quiz Results**: shows saved quiz answers (stored under key `quizAnswers` via `ugSave`); link to retake
- **F. Settings**: notification toggle (future-ready, disabled), data sharing toggle, download data as JSON
- **G. Danger Zone**: clear all saved data, delete account

## Quiz Answer Persistence
`showResults()` in `selections.html` now calls `ugSave('quizAnswers', a)` to persist answers to localStorage/Firestore. Profile page reads and displays them in a human-readable grid.

## localStorage Keys (clState per program)
| Key | Description |
|-----|-------------|
| `gr11Avg` | Grade 11 average (manual or auto-computed) |
| `gr12Avg` | Grade 12 average (manual or auto-computed) |
| `ecScore` | Self-rated Extracurriculars strength (0–100) |
| `essayScore` | Self-rated Essays & Interview strength (0–100) |
| `academicsPct` | Computed academic score (0–100) |
| `academicsPctBreak` | JSON breakdown: avg, prereqDone, prereqTotal |
| `gr11_selected` | JSON array of Grade 11 optional courses + marks |
| `gr12_selected` | JSON array of Grade 12 optional courses + marks |
| `reqMarks_<code>` | Individual required course mark per course code |
