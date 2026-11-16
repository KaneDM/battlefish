# Battlefish

An idle game for the office. Everyone designs a fish, and the fish fight each other in an aquarium shown on a shared TV, all day, with no one at the controls. Each week the game deals every fish a new fighting style, and the week's strongest fish wears the crown for the next one.

It's a small Python program (Python 3.9 or newer, nothing else to install) that serves a few web pages: the aquarium for the TV, a workshop where players make their fish, a How to play page, and an admin page.

## Setting it up

This repository is meant to be handed to an AI coding agent, which interviews you about your network and then installs and configures the game for your office.

1. **People:** read [ADMIN-README.md](ADMIN-README.md) first. It explains the game, the admin controls, and what you'll need (mainly a server that can run Python as a background service).
2. **Your AI agent:** give it this repository and tell it to start with [START-HERE.md](START-HERE.md).

## What's here

| Path | What it is |
|---|---|
| [ADMIN-README.md](ADMIN-README.md) | The game and its admin page, for the person running it |
| [START-HERE.md](START-HERE.md) | The agent's instructions: order of work, setup interview, ground rules |
| [DESIGN.md](DESIGN.md) | The full design: every rule, formula, file, endpoint and page |
| [DEPLOY.md](DEPLOY.md) | Installing, running as a service, the TV, updating, backups |
| [WORKFLOWS.md](WORKFLOWS.md) | How to change the game safely once it's running |
| [game/](game/) | The game itself, ready to install as it is |

## Updates

New versions are listed in the changelog at the end of [game/README.md](game/README.md), which is also the game's How to play page. To update an installed copy, follow section 7 of [DEPLOY.md](DEPLOY.md). Your own `site.json`, any `ticker_adapter.py` and the `data/` folder are yours, and updates never include them.
