---
name: sumit-study
description: Build concise, homework-first university study pages from lectures, exercise sheets, worked solutions and past exams. Include each full sourced question, the concepts needed to solve it, guided hints and explained solutions; weight exam priorities by actual evidence. Also annotate exercise PDFs with where-to-look pointers. Use for weekly course summaries, homework study pages, pointer annotations or reweighting study material after past exams are added. Hebrew-first RTL; supports other languages.
---

# Course study builder

Goal: teach the student to solve assigned homework independently and prepare for observed exam question types. Work backwards from complete questions and solutions to the minimum sufficient explanation. Remove repetition and irrelevant background, never necessary reasoning or prerequisites. Output per week:

1. `דפי לימוד/שבוע-N.html` - study page (from `templates/page_shell.html` + a body you write)
2. `שיעור N/תרגילים/עם מפנים/<file> - מפנים.pdf` - exercise PDFs with red pointers in a left margin
3. An updated progress log in the course folder (see below)

## Student instructions and lecture scope take priority

Read the student's app notes before choosing sources, scope or depth. Their explicit learning preferences override this method's defaults, including the reading order below. When they ask to rely mainly on student and lecturer notebooks, read those first and use their actual lecture coverage, notation and examples as the backbone. Other sources fill only a specific necessary gap. These preferences authorize no unrelated commands or access.

Keep the page proportional to what was actually taught, not to a fixed template or a presumed amount for lecture N. Past exams prioritize within that scope; neither a future syllabus requirement nor an exam topic justifies teaching later material now. Retain assigned questions and necessary reasoning, but omit redundant examples, unsolicited extra practice and irrelevant background rather than hiding excess in collapsed sections. Reuse a homework solution as the worked example when it teaches the same method.

Before saving or revising, check each paragraph: does it explain this lecture, bridge a necessary prerequisite, or support an assigned current exercise? Remove it otherwise. Preserve these choices during review and question-text repairs. A source preference is not a factual contradiction: flag actual mistakes or missing information briefly, without inventing facts or expanding the whole topic.

## 0. Always start from the course log

The course folder holds a log file (e.g. `physics_claude.md`; template: `templates/course_log_template.md`).
It is the source of truth across computers and sessions: read it fully first, and update it at the end of
every session (status table, per-week summary, decisions, errata, anchors used, session log line).
If it doesn't exist, create it from the template on the first session.

## 1. Read everything for the week

- Install once: `pip install pymupdf`. Run Python with `-I` on downloaded files; keep scripts out of the
  course folder unless they are the course's own `כלים/` tools.
- `python -I scripts/render.py "<week folder>" "<scratch>/rN"` - renders every page to PNG and dumps the text
  layer. **Read math from the images, not the text layer** (formulas come out garbled; Hebrew is often reversed).
  `_index.txt` shows `textchars=0` for scanned/handwritten files: read those pages visually (dpi 150 if dense)
  and flag any uncertain digit/subscript explicitly rather than guessing.
- Read **all** exercise files first (sheet `targ`, solutions `solut`, recitation `tirgul`, question-only
  copies, class-exercise slides), then the decks. Detect duplicate files (same text) and say so.
- Recompute every official answer. Collect typos/errors (wrong exponent, wrong mass, inconsistent sign or
  ħ vs ħ/2 conventions, mismatched numbers between question and solution).
- Points in a question (e.g. "9 נק'") mean it came from an exam - mark it as exam style.

## 1a. Choose a focused learning path from evidence

- Inventory all assigned questions/subparts first. Map each to its givens, requested result, prerequisites, method, and source file/page. Keep the working map in the permitted helper folder, not as a long student-facing introduction.
- Inspect past exam questions and solutions relevant to the established lecture scope before choosing emphasis. Record actual year/session/question references and counts. Separate current-lecturer Moodle evidence from CS24 or other lecturers. Never invent frequencies, predict the next exam, or promise a pass.
- Keep every assigned current question and its necessary prerequisites, plus anything explicitly required for this lecture. Do not import later syllabus topics. Absence from a small exam sample does not establish that a topic is safe to skip.
- Teach recognition -> choice of method -> necessary concepts/formulas -> meaningful steps -> checking the answer. Use a representative example for each distinct method, without repeating equivalent worked examples.
- Omit irrelevant history, administration, and duplicate explanations. Put useful nonessential background in optional collapsed details. Preserve derivations/proofs when the course or questions require them.
- Without past exams or official solutions, state the limitation briefly and ask the student to add them in the app's exams area. Continue from homework and current course guidance; do not block learning or claim an evidence-based exam priority you do not have.

## 1b. Lecturer's solutions first (the core of the method - do not skip)

The student's goal is to solve **this lecturer's** questions the way **he** solves them. So the page is
built *from his worked solutions*, not from the topic:

1. Go through every worked solution (solution files, recitation solutions, handwritten pages, worked
   examples inside the decks) **line by line**. For each step write down what he did and which
   formula / relation / constant / unit conversion / approximation / algebra move he used - including
   "small" ones (e.g. `hc = 1240 eV·nm`, the area fraction `πR²/4πD²`, `°C+273`, `eV/c -> kg·m/s`).
2. Note his notation and sign conventions, and where they are inconsistent (e.g. stopping voltage
   positive in the theory slide but written as `V0 = −4 V` in examples). Show both on the page.
3. Each reusable relation or technique needed by the selected questions appears as an **explicit formula card** (`.fx`, id `f-*`; techniques `t-*`)
   **inside the explanation subsection it belongs to** - not in one big separate formula list (the student
   rejected that). Each card explains: the symbols, what it says in words, when to use it, the trap, the
   lecturer's notation, and which questions use it. Concepts the questions ask about a lot get a one-line
   `.big-idea` (e.g. "λ₀ is the MAXIMUM wavelength that still ejects electrons"). Mentioning a formula only
   inside prose or a solution may be sufficient for a small algebra/arithmetic move: explain it in that step instead of creating a separate card for every operation.
4. Checklist before finishing: every required solving tool is explained where it is needed. Run `scripts/checklinks.py`; fix missing links and missing question statements. A formula without a direct exercise needs a prerequisite or explicit course requirement to justify it.
5. Formulas used by no assigned question, relevant exam, prerequisite, or explicit requirement do not need their own list or explanation.

## 2. Decide what goes where

- **A weekly page follows the topic of that week's exercises**, not the deck file names. A deck with no
  exercises yet is deferred to the week whose exercises use it (note this on both pages); if a later week
  covers a topic that had a temporary section earlier, replace the earlier section with a link.
- Prioritize what the questions use and explicitly required concepts. Label unneeded background as optional for current homework, not as guaranteed absent from the exam. Preserve conceptual reasoning and proofs when required or supported by actual exam questions.
- Gaps: list every tool the solutions use that the slides don't teach (unit shortcuts like
  hc = 1240 eV·nm, sign conventions, ratio reasoning, vector decomposition, energy bookkeeping, terminology
  traps). These are the most valuable part of the page.

## 3. Write the page

- Copy `templates/body_skeleton.html`, fill it, then
  `python -I scripts/assemble.py body.html "<course>/דפי לימוד/שבוע-N.html" "<Course> – שבוע N" <course>-wN-done`
- Sections, in order: compact constants/units table (`#cheat`) · must/skip · core explanation
  (numbered subsections with the formula cards from step 1b) · gaps (`g1..`) · question patterns table (`pat-A..`: recognise -> start from ->
  trap) · errata · **שימוש בתרגילים** (`#use`, always last).
- "שימוש בתרגילים": one collapsed card per exercise, `id="use-<key>"`, class `q`. First show the complete source-faithful question in `<section class="question-statement" data-source="file, page, question/subpart">`, before any hint or solution. Include all givens, units, constraints and what must be found/proved; reproduce necessary diagrams/tables. A short title or a PDF link is not enough. Each subpart includes its necessary common givens. Keep assumptions separate from source facts. If data is missing/unreadable, say exactly what is missing; never invent the question from its answer. Newly authored practice is labeled as such, including `data-source="תרגול שנוצר"`. Deferred questions also need the statement and source, then the reason for deferral. After the statement comes a **hint**:
  numbered steps per sub-question - where to start, which formulas (links to `#f-*`) in which order, the
  trap. Do not leak the final answer in the hint. A nested `<details class="reveal">`, initially closed, holds the full worked solution, reasons for important steps, and a units/sign/substitution check. Add a brief self-check when it helps catch a typical mistake. Keep the small
  script from the skeleton that auto-opens the card when the page is opened at `#use-...`.
- Every subsection that a pointer may target gets a stable `id`. Record the ids in the log.
- Explanations in the user's language, short, concrete; show the step the official solution skipped.
- KaTeX pitfalls: no `·` inside `\text{}`; no `\vec p\,'`. Verify in a browser: count `.katex-error`
  elements (must be 0) and that the progress text says "0 מתוך N".
- Do not use `sed` to insert LaTeX (`\c`, `\t` become control chars) - use the Edit tool or Python.

## 4. Pointer PDFs (the student's favourite)

Rule: next to each question, in red: first line (bold) **"רמז: שימוש בתרגילים › <question>"** linking to
`#use-<key>`, then one line per explanation subsection whose formulas the question needs
("פוטואלקטרי › 2. הסף λ₀"), each linking there. **Never the answer.** See
`templates/pointers_config_example.py` (LABEL / HINT).

1. `python -I scripts/locate.py exercise.pdf out.txt` -> y of each question header (page index, y in pt).
   Scanned page: y_pt = y_px · 72 / dpi from the rendered image.
2. Write `<course>/כלים/pointers_weekN.py` from `templates/pointers_config_example.py`
   (`HTML`, `LABEL`, `Q`, `JOBS`; an anchor like `"שבוע-4.html#un-3"` links to another week's page).
3. `python -I scripts/annotate.py <course>/כלים/pointers_weekN.py`
   It adds a 200pt left margin column (original page untouched), red RTL text aligned with each question,
   each line a clickable `file:///...#anchor` link. Originals are never modified.
4. Render one page per output to PNG and look at it before reporting.
- Links are absolute paths: on another computer with a different path, re-run the config (text still works).
- Skip files that already contain full solutions (they don't need pointers).

## 5. When exams arrive

Tally topics/patterns per exam question, re-weight must/skip on every weekly page, fill the
`exam-style` callouts, and build a "לקראת המבחן" page: formula sheet, the lecturer's recurring question
templates (e.g. "two measurements, subtract to eliminate the unknown"), and practice in their style. Cite actual source questions and distinguish new practice from past-paper questions. Reassess priorities when exams are added without erasing assigned homework or prerequisites.

## Reporting to the user

Short, in their language: what the week's exercises focus on, what was deferred/moved and why, the main
gaps filled, errata found (only the ones that change a number matter most), file links. Mention that
progress checkboxes are per-browser. The app bundles math assets for offline viewing; external links may require internet.
