# Battlefish: a guide for admins

Battlefish is an office aquarium game. It runs on a server in your office, the aquarium plays on the office TV, and everyone can join from their own browser in about a minute. This guide explains what you're about to set up and what you can control. Your AI assistant has the technical details in `START-HERE.md` and `DESIGN.md`.

## The game in a minute

- **Everyone designs one fish:** a name, one of ten body shapes, and two colors. That's all a player controls. A PIN keeps each fish's editor private.
- **The fish fight on their own.** Every 30 to 45 seconds the game picks two fish, and they swim together and scuffle in the tank, with damage numbers, dodges and special moves on screen. Nobody presses anything. It's something to glance at, cheer at, and talk about.
- **Fighting styles are dealt, not chosen.** Every Monday morning each fish is dealt one of six styles: Octopus (all-rounder), Walrus (bruiser), Mantis Shrimp (glass cannon), Urchin (defensive), Swordfish (duelist) or Starfish (regenerator). Each style has its own stats and two or three skills, such as Poison, Riposte or Last Stand. The deal keeps the tank balanced and rotates each fish through every style over about six weeks, so nobody is stuck with a weak one.
- **Each fish has an Elo rating,** like chess. It resets every Monday. Winning against a stronger fish gains more. Fish near the top fight at a slight disadvantage, and fish near the bottom get a lift, so the leaderboard stays lively.
- **Daily form:** each fish is a little sharper or duller each day, at random. It's secret until the week ends, then revealed in the week's results.
- **The crown:** at the Monday reset the week's standings are saved, and the fish with the best average Elo over the week is crowned champion. It wears a crown in the tank for the next week.
- **A ticker** (optional) can scroll office news and stats along the bottom of the TV.
- **A suggestion box** in the editor lets players send ideas and bug reports to the admins.

The rules are built so that nobody can "solve" the game or win every week, and there's nothing to grind. It costs players a minute to join and nothing afterwards.

## The pages

| Page | For | What it does |
|---|---|---|
| Aquarium (`/`) | The TV and anyone curious | The tank, recent fights, the leaderboard, past weeks, each fish's card |
| Editor (`/editor`) | Players | Create a fish or change its look; see its style and skills; send a suggestion |
| How to play (`/help`) | Players | The rules, always showing the current settings |
| Admin (`/admin`) | You | Everything below, behind a shared password |

## What the admin page controls

- **Fights:** pause or resume, start a fight right now, or heal every fish to full.
- **This week:** see when the week started and when it resets; **skip** the next reset (the week runs on another seven days); **reshuffle** everyone's styles mid-week.
- **The fish table:** every fish with its player, style, today's secret form, Elo and how much its stats are adjusted for it, average Elo, HP, wins and losses, and PIN status. From here you can **change one fish's style** for the rest of the week, **clear a forgotten PIN** (the next person to open that fish sets a new one, so tell its owner straight away), or **delete** a fish.
- **Ticker:** if your ticker is set up to be typed in by hand, add, edit, reorder and remove its items here, each with a label, a value, a change, and whether up is good news (green) or bad (red). If it's fed from another system, this section says where from.
- **Settings:** every number in the game, grouped into tabs with a search box, each showing its default:
  - *Styles*: the stat-point pool, and how big the daily form swing is.
  - *Elo*: how fast Elo moves, and how strongly it adjusts stats (0 turns that off).
  - *Fights*: how often fights start and how many run at once, the time limit, how fast fights play out, Enrage (long fights hit harder over time so they don't stall), the HP a fish needs before it's picked, and how matchmaking picks opponents.
  - *Stat formulas*: what each stat point is worth.
  - *Week*: the **reset hour**, when the daily form rolls and the Monday reset happens (7 AM by default, server time).
  - *Skills*: switch all skills off or on.
  - *Aquarium*: how much bigger high-Elo fish are drawn.
- **Reset:** **End the week now** does the Monday reset early. **Reset everything** deletes every fish and all history, which is handy for clearing test fish before launch.

Changes take effect right away. The defaults are tuned, so the best first step is to launch as it is and adjust after a week or two of real play.

## What players can and can't see

Players see every fish's style, Elo, record and head-to-head results. They never see daily form until the week is over, how much Elo is adjusting anyone's stats, or anyone's exact HP. Only the admin page shows those. Suggestions are visible only to admins, on the server.

## What you'll need

Check these before you start, especially the first two. On a managed network they may need your IT team's sign-off.

- **A machine that can run Python.** The game is a Python program, so the server needs **Python 3.9 or newer**. Python is free (python.org) and often already installed on Linux. On Windows, install it **for all users** with python.org's standalone installer, not the default "Python install manager" download, which installs for one person's account only. Your assistant has the steps. The game uses only Python's built-in parts, so there are no extra packages or databases to install. If your IT policy doesn't allow installing Python on a server, raise it early: your assistant can suggest alternatives, such as running it in a container.
- **Permission to run it as a background service** on that machine, so it starts by itself and stays running. It should be always on, or at least on during working hours.
- **One network port** open from your office network to that machine (8765 by default), so players' computers and the TV can reach it.
- **A device for the TV** with a modern web browser, ideally a small PC that can start the browser full-screen by itself.
- **Players need only a web browser.** Nothing is installed on their computers.

## What setting it up involves

Your assistant will ask you about:

- **the server:** which always-on machine runs it, and where the game's folder goes
- **the network:** the address people will type, the port, and any firewall rules
- **the TV:** what device drives it, and making it start and stay on by itself
- **your office's rhythm:** your time zone, and when the week should reset
- **the ticker:** whether you want one, what it should show, and where that information comes from
- **administration:** who the admins are, who reads suggestions, and backups

The game itself is small: Python plus some web pages, with no database and nothing else to install. Expect an hour or two for setup, most of it on the network and the TV. After that it runs by itself: it saves constantly, restarts itself after updates, and resets the week every Monday.

## A few practical notes

- **Passwords:** you set the admin password on the server yourself. Don't paste it into a chat with your assistant.
- **The ticker is public:** anything on it shows on the TV and to anyone who opens the aquarium, so stick to office-wide news and totals.
- **Changing the game later:** your assistant should follow `WORKFLOWS.md`: test in a copy, keep a snapshot, then deploy. Players see a changelog on the How to play page.
