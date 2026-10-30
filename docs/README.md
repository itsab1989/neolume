# Neolume documentation

Everything about Neolume in one place, sorted by what you want to do. New here and just want the app on your 2014 Samsung
TV? Start with the **[installation guide](INSTALL.md)** ([Deutsch](INSTALL.de.md)) – you don't need anything else on this
page. The same overview with pictures: the **[website](https://itsab1989.github.io/neolume/)**.

## Install and use Neolume

| Document | What it is for |
|---|---|
| [Installation guide](INSTALL.md) · [Installationsanleitung](INSTALL.de.md) | Every step from download to the first start on the TV, with drawings of the TV menus and troubleshooting |
| [FAQ](FAQ.md) · [Häufige Fragen](FAQ.de.md) | Which TVs work, Plex Pass, the optional helper, screensaver, where RETURN takes you, the new-content notice, privacy, updating and removing the app |
| [Changelog](../CHANGELOG.md) | What changed in each version |
| [Latest release](https://github.com/itsab1989/neolume/releases/latest) | The setup program for Windows, macOS and Linux (the TV app is inside) |

## Build it for another TV (with an AI coding agent)

Neolume runs only on 2014 Samsung TVs, but an AI coding agent can rebuild it for a newer TV. You only need the first row;
the agent reads the rest by itself.

| Document | What it is for |
|---|---|
| [Starter prompt and more prompts](PORTING-WITH-AI.md#prompts) | The prompt you paste into your agent – plus prompts to continue, test, update and share a port |
| [Porting playbook](PORTING-WITH-AI.md) | The workflow the agent follows, phase by phase, with the sources to read and the parts of this app it can reuse |
| [Product specification](SPEC.md) | What the app does, how it looks and how fast it must be – every requirement with an ID |
| [Acceptance test plan](TEST-PLAN.md) | One test per requirement for a person with a remote, a 10-minute smoke test, performance and privacy checks |
| [Design system](../design/README.md) | Colours, type, spacing, motion and layout values ([`tokens.json`](../design/tokens.json)) and the [icons](../design/icons/) |
| [Screenshots](screenshots/) | Reference pictures of every main screen (English; German ones in [`de/`](screenshots/de/)) |
| [Community ports](../PORTS.md) | Apps others built for their TVs, how to add yours and how to submit it for the collection |

## Develop and contribute

| Document | What it is for |
|---|---|
| [Contributing](../CONTRIBUTING.md) | Set-up, tests and the rule that the spec changes together with the code; a prompt for working with an AI agent |
| [Notes for AI coding agents](../CLAUDE.md) | The same rules in short, for an agent working in this repository |
| [README – For developers](../README.md#for-developers) | Build, package and test commands |
| [`spec-review.json`](spec-review.json) | Generated record of which requirement wordings were re-checked against their tests (`npm run spec -- --ack`) |
| [Third-party parts](../THIRD-PARTY.md) · [License](../LICENSE) | Licences of included parts; Neolume itself is MIT-licensed |

Not affiliated with Plex, Inc. or Samsung. "Plex" is a trademark of Plex, Inc.
