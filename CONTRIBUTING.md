# Contributing

Thank you for helping! This page explains the few rules that keep the app, its documentation and the porting material in
step – for people and for AI coding agents alike. Everything here is checked automatically by `npm test` and by CI on every
push and pull request, so you will get a clear message if something is missing.

## Set up once

```sh
npm ci            # Node 22 or newer
npm test          # build with all gates (ES5, CSS, texts) + unit tests + spec check
npm run hooks     # optional: checks before each commit (spec, < 1 s) and each push (npm test)
```

The setup program has its own tests: `python3 -m unittest discover -s tests/installer`.

Where is what? The [documentation overview](docs/README.md) lists every guide and reference document by purpose.

## Working with an AI coding agent

Agents that read `CLAUDE.md` (Claude Code and others) find the short version of these rules there automatically. For any
agent, start with:

```text
Read CLAUDE.md and CONTRIBUTING.md in this repository and follow them for every change. Then: <what you want to change>.
Run npm test before you finish and tell me which requirement IDs of docs/SPEC.md your change touches.
```

Want to build the app for a **different TV** instead? That is a separate project in a new folder – see the
[porting playbook](docs/PORTING-WITH-AI.md) and its starter prompt.

## Why the docs must follow the code

[`docs/SPEC.md`](docs/SPEC.md) is the product specification. Other people give it to their coding agent to rebuild the app
for a different TV, together with [`docs/PORTING-WITH-AI.md`](docs/PORTING-WITH-AI.md) (the playbook),
[`docs/TEST-PLAN.md`](docs/TEST-PLAN.md) (acceptance tests per requirement) and the design system in
[`design/`](design/README.md). If the code changes and these files don't, every port built from them inherits the mistake.
So they are part of every change:

1. **Change the code and the hand-written spec in the same commit.** Requirement text in `docs/SPEC.md`, and a row in the
   matching `<!-- hand:… -->` table for every new or renamed setting, screen, `setup.json` field, helper route or picture in
   `src/assets/`. Mark performance numbers as [M] measured or [T] target.
2. **Run `npm run spec`.** It rewrites every generated part from the code: the `<!-- gen:… -->` blocks in the spec, the
   playbook, the test plan, `PORTS.md`, the website, and the design files (`design/README.md`, accent palette, icon
   columns). Never edit generated parts by hand – your change would be overwritten.
3. **New requirement ID?** Add its row to `<!-- hand:test-steps -->` in `docs/TEST-PLAN.md`: either `human` (what to
   prepare, numbered steps for someone with a remote and no technical knowledge, what they should see, what to report) or
   `agent` (how an agent checks it). IDs are never reused; when you rename or remove one, fix the references in the
   playbook, the test plan and `PORTS.md`.
4. **Changed the wording of an existing requirement?** The check stops with "Requirement X was changed … since the rows
   that depend on it were last checked". Read the new wording, update its test row (and the reusable-part rows in the
   playbook that name it) if they no longer match, then confirm with `npm run spec -- --ack X` (several:
   `--ack X,Y`). The confirmation is stored in `docs/spec-review.json`; commit it with your change.
5. **New reusable logic module or moved file?** Update `<!-- hand:reuse -->` / `<!-- hand:sources -->` in the playbook.
6. **Design values** live only in `design/tokens.json` (every token with a description, every token used somewhere – a
   deliberately unused step of a scale gets `"reserved": true`) and `design/icons/<name>.svg` (append the name to
   `design/icons/order.json`). The CSS uses placeholders like `@c.text-1@`; a colour literal in `src/css/` fails the build.
7. **The starter prompt** for porting agents is written once, in the `<!-- hand:prompt -->` block at the top of
   `docs/PORTING-WITH-AI.md`. `npm run spec` copies it into `README.md`, `README.de.md` and the website
   (`docs/index.html`, `docs/port.html`); change it only there.
8. **Release:** set the same version in `package.json`, `package-lock.json`, `src/core/config.js`, `loader/config.xml` and
   `installer/neosetup/__init__.py` (the check compares them), then `npm run spec` – the version is the spec version that
   ports refer to.

## Other rules

- The TV app is plain ES5 without frameworks (the 2014 browser engine); the setup program uses only the Python standard
  library.
- Texts in the app, the setup program and the docs are friendly, beginner-friendly and correct, in German and English, and
  fit the length limits in `tools/i18n_rules.js`.
- No real IP addresses, names, tokens or titles from your own media library in commits – use `<TV-IP>`, `<PMS-IP>`,
  RFC 5737 examples (192.0.2.x) and invented demo titles.
- Community ports: one entry in [`ports.json`](ports.json) (format [`ports.schema.json`](ports.schema.json)); please read
  the policy in [`PORTS.md`](PORTS.md) first.
