# Building and rehearsing an employee survey and psychometric instrument with an AI agent

Eric Gladstone · research walkthrough · independent work · September 2026. The presentation's own header reads "People science · Survey and measurement".

A real Claude Code session, presented as it was worked through. The Claude Code console is on the left and my commentary is on the right.

A fictional company's leadership asks for an employee survey that will "identify the drivers of retention". Starting from that request, the session:
- reconstructs the decision behind it;
- defines the constructs;
- researches prior measures, using parallel research agents whose judgments are checked and overridden;
- installs and verifies the psychometric libraries;
- builds an item bank and an executable survey specification.

It then rehearses the instrument against synthetic employees whose underlying traits and response behavior are known:
- factor structure, reliability and construct overlap;
- measurement invariance;
- team-level reporting;
- nonresponse and survivorship;
- "driver" rankings.

Revisions are frozen before a reserved holdout is tested. The session ends at a pilot-ready candidate, rehearsed but not validated, with the cognitive-pretest and pilot gates that must come next.

- **Live:** https://surveymeasurement.eric-c-gladstone.workers.dev
- **Also at:** https://graystoneindustries.co/talks/ (embedded)

## What is verbatim and what is editorial

- **The questions are mine.** Five of them begin with one or two sentences I wrote during the session, after reading the previous reply. These are marked on screen as a researcher decision.
- **Claude's replies and tool output are verbatim,** including the research sub-agents' reports as they returned to Claude. They come from one continuous session (Claude Code 2.1.284, Opus 5.5), recorded 28–29 September 2026.
- **Sections 19–20 were recorded a second time,** from a saved state taken just before Section 19, so that my Section 19 decision could be included. Nothing before Section 19 changed.
- **Editorial:** timing, grouping into parts, focus, and the commentary on the right.

The company, its employees and its data are fictional, written for this demonstration; no real survey responses were used. The session ran in an isolated directory, and the account name and email are removed from the published data.

## Use

Open it and step with ← →. Use shift+← → to move between sections and space to play. A− / A+ (or the - and = keys) change the terminal text size.

URL options:
- `?s=<screen>&b=<part>` opens at a given point;
- `?play=1` autoplays;
- `?t=<px>` sets the terminal size;
- `?embed=1` fills its frame for embedding.

Run locally with any static server, for example `python3 -m http.server 4740 --directory public`.

## Files

`public/` is the whole site:
- `index.html`, `app.js`, `style.css`;
- `data/session.js` (the session, as the page plays it);
- `data/walkthrough.js` (the commentary);
- self-hosted Geist fonts;
- `vendor/marked.umd.js` (MIT) for rendering Markdown.

It makes no third-party requests.
