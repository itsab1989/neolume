# Notes for AI coding agents

Follow [CONTRIBUTING.md](CONTRIBUTING.md) (same folder). In short: every user-visible code change updates `docs/SPEC.md` in
the same commit, then run `npm run spec` (regenerates the generated parts of the spec, playbook, test plan, ports list,
website and design files) and `npm test`. New requirement ID → row in `docs/TEST-PLAN.md` `<!-- hand:test-steps -->`.
Changed requirement wording → check its dependent rows, then `npm run spec -- --ack <ID>`. Never edit `<!-- gen:… -->`
blocks by hand. The failure messages of `npm test` / `npm run spec:check` say exactly what to fix.
The starter prompt for porting agents is written only in `<!-- hand:prompt -->` of `docs/PORTING-WITH-AI.md`; `npm run spec`
copies it into the READMEs and the website. Where things are: [docs/README.md](docs/README.md).

Porting the app to another TV instead? Start with [docs/PORTING-WITH-AI.md](docs/PORTING-WITH-AI.md).
