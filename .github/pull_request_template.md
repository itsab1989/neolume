## What does this change?

<!-- Short description. If users see the change, update docs/SPEC.md in the same pull request and run `npm run spec`. -->

## Checklist

- [ ] `npm test` is green (includes the spec check)
- [ ] User-visible change: `docs/SPEC.md` updated (requirement text and hand-written tables), `npm run spec` run
- [ ] New requirement: row in `docs/TEST-PLAN.md`; changed requirement wording: its test row checked, `npm run spec -- --ack <ID>` ([CONTRIBUTING.md](https://github.com/itsab1989/neolume/blob/main/CONTRIBUTING.md))
- [ ] Texts are friendly, correct and fit in German and English

## Adding a community port? (otherwise delete this section)

- [ ] One new entry in `ports.json` (format: `ports.schema.json`), `npm run spec` run – `PORTS.md` and `docs/index.html` are regenerated
- [ ] `specVersion` = the version at the top of `docs/SPEC.md` you built against; `features` filled for A1 – A19
- [ ] Link goes to the port's own repository/releases (no binaries in this repository)
- [ ] No "Plex" in the port's name or icon; no telemetry; tokens only go to the user's own server ([policy](https://github.com/itsab1989/neolume/blob/main/PORTS.md))
