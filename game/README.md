# Battlefish

Battlefish is an office aquarium full of fighting fish. Everyone gets one fish to design: its name, its shape, and its colors. The fish swim around the tank on the office TV, and every {{fight_interval}} two of them get into a scuffle. You never control the fights, and you don't choose how your fish fights either: each week it's dealt a **fighting style**. Your job is to give it a look, cheer it on, and see how it does.

## Making your fish

1. Open `{{site_url}}/editor` in a browser on your computer.
2. Under **Who are you?**, choose **I'm new here**. If you already have a fish, pick your name instead.
3. Enter your name, choose a PIN (4 to 8 digits), and enter a name for your fish. Then pick a body shape and two colors.
4. Click **Add to the tank**. Your fish is dealt its fighting style for the rest of the week, and shows up in the tank within a few seconds.

Each person can have one fish. You can come back any time to change its name, shape, or colors.

## Your PIN

Your PIN keeps your fish's editor to yourself, so nobody else can rename or recolor it.

- Your browser stays logged in to your fish for 30 days, so you won't need the PIN every time. Use **Log out** in the editor if you're on someone else's computer.
- Use **Change PIN** in the editor to pick a new one.
- After 5 wrong PINs in a row, the fish locks for 15 minutes.
- Forgot your PIN? Ask an admin to clear it, then set a new one the next time you open the editor.

## Fighting styles

A fighting style is a set of stats and skills that work together. Every fish has one, and every style gets the same number of stat points; the style decides how they're split. Your editor shows your fish's style, what it's good at, its stats, and its skills.

| Style | Role |
|-------|------|
| Octopus | All-Rounder |
| Walrus | Bruiser |
| Mantis Shrimp | Glass Cannon |
| Urchin | Defensive |
| Swordfish | Duelist |
| Starfish | Regenerator |

- **Styles are reshuffled every week** (see *The weekly reset*). The shuffle keeps things even: every style is in the tank each week, none of them more than once more than any other, and your fish never gets the same style two weeks running. When there are more fish than styles, the styles take turns being the one dealt twice. Over about six weeks, your fish gets a turn with each one.
- A fish that joins mid-week is dealt whichever style is least common that week.
- Everyone's style is public: it's shown on the leaderboard and on each fish's card.
- Each style beats some styles and struggles against others, so no style is the best at everything.
- Every fish also has a **form** each day. It's rolled fresh every morning at {{reset_time}}, so a fish is sharper some days than others, and nobody knows how sharp until the week is over. Each fish's form for every day of the week is revealed in that week's results once the week is over (see *Past weeks*).

## Stats

| Stat | What each point does | Starting value |
|------|----------------------|----------------|
| Health | +{{hp_per_point}} max HP | {{base_hp}} HP |
| Regeneration | +{{regen_combat_per_point}} HP per second during fights, and +{{regen_idle_per_point}} HP per second between fights | No healing during fights. Between fights, everyone heals {{regen_idle_base_pct}} of their max HP per second |
| Strength | +{{damage_per_point}} damage per hit | {{base_damage}} damage |
| Aggression | +{{attack_rate_per_point}} attacks per second | {{base_attack_rate}} attacks per second |
| Defense | Blocks {{defense_per_point}} damage from every hit you take. At least {{min_damage_pct}} of each hit always gets through | None |
| Evasion | A chance to dodge a hit completely. Each point adds less than the last, up to a {{evasion_cap_pct}} maximum; {{evasion_half_point}} points gives {{evasion_half_pct}} | None |

The admins can adjust these numbers. This page and the editor always show the current values.

## Skills

Skills are special moves that come with a fighting style, such as dodging and striking back, or poisoning an opponent. Each style has two or three. The editor lists your fish's skills with what each one does, and many of them show up in fights (see *Watching the aquarium*).

## Elo

Every fish has an Elo rating, shown on the leaderboard and at the top of your fish's Fighting style panel in the editor. Everyone starts each week at {{elo_start}}. Winning raises it and losing lowers it, by more when the result is a surprise: beating a fish with a much higher Elo gains a lot, and losing to one with a much lower Elo costs a lot.{{elo_adjust}}

## The weekly reset

Every Monday morning, at the first quiet moment {{reset_window}}, the week ends:

- This week's final standings are saved, along with every fish's record and style (see *Past weeks*).
- The champion is crowned (see *The crown*).
- Everyone's Elo goes back to {{elo_start}}, and records, streaks, head-to-head results, and the fight history are cleared.
- Every fish is dealt a new fighting style.

From {{reset_quiet_from}} no new fights start, so no fight is cut short. If the server is down at that time, the reset happens as soon as it's back.

## The crown

The week's champion is the fish with the **highest average Elo** over the week: its Elo after each of its fights, averaged. Averaging rewards the fish that was ahead all week, rather than whoever happened to be on top at the moment of the reset. To count, a fish needs at least half as many fights as the week's middle fish, so a fish that joins late in the week can't win on a handful of fights.

The champion wears a crown in the tank all the next week, and has a crown on the leaderboard.

## Fights

- Every {{fight_interval}}, a new fight starts. Fish need at least {{min_hp_to_fight_pct}} of their HP to be picked.
- The fish that has waited longest since its last fight goes first, so everyone gets a fair share of fights. {{opponent}}
- {{fights_at_once}}
- The two swim together and scuffle. Each one attacks at its own speed until one of them runs out of HP.{{enrage}}
- If nobody is knocked out within {{fight_timeout}}, the fish with the larger share of its HP left wins. If they're within half a percent of each other, it's a coin flip.
- Fish with a higher Elo are drawn bigger, and ones with a lower Elo smaller.

## Watching the aquarium

- The tank shows each fish's name and HP bar. During a fight you'll see damage numbers and "dodge!" pop up. Some skills have their own look:
  - **Critical Hit:** a bigger, red-orange damage number.
  - **Riposte:** the counterattack's damage is blue.
  - **Spikes** and **Poison:** smaller purple numbers. Spikes show on the attacker, and Poison every couple of seconds on the poisoned fish.
  - **Last Stand:** "Last Stand!" pops up and a gold ring pulses round the fish while it's invincible. Attacks on it show "immune".
  - **Second Wind:** "Second Wind!" pops up with the HP it heals, and a green ring pulses while its Regeneration is boosted.
- A fish that's badly hurt rolls belly-up and floats toward the top until it recovers; a champion's crown drifts off while it's belly-up and settles back when it rights itself.
{{ticker_help}}
- The side panel has two tabs, **Recent fights** and the **Leaderboard**. The version of the game that's running is shown next to the title. To give the tank the whole width, click the small arrow tab at the top right of the tank to hide the side panel, and click it again to bring the panel back. Your browser remembers which you chose.
- To browse it yourself, open `{{site_url}}/` on your own computer. Click a tab, or choose a fish under **Show** to see only that fish's fights. With a fish chosen, the leaderboard shows its card: its style, Elo, average Elo so far, record, streaks, damage dealt, record against each opponent this week, and its recent styles.
- The leaderboard ranks fish by Elo and shows each one's style under its name, its win percentage, and its wins and losses (wins on top). Last week's champion has a crown. When the side panel is narrow, the streak column is left out; it's still on a chosen fish's card.
- Around holidays the tank is decorated for the season, and now and then a visitor crosses the far background. The seasons are New Year's (Dec 30 – Jan 1), Valentine's (Feb 7–14), St Patrick's (Mar 10–17), Easter (the week of Good Friday), Independence Day (Jun 27 – Jul 4), Halloween (Oct 24–31), Thanksgiving (Thanksgiving week) and December, when a present appears under the tree each day until Christmas Eve. The decorations are just for show: they never change the fish or the fights.
- On your own computer, move the mouse over the tank and the fish swim after it. Click the water to make bubbles. Click a fish to startle it and show only its fights in the side panel; click it again to show everyone.

## Past weeks

Choose a week under **Week** on the leaderboard to see its final standings. Past weeks are ranked by average Elo, so the champion is always first, and they show each fish's style that week and its best streak. Choose a fish to see its card for that week, including its final Elo, its average form that week (hover it for each day's form), and its record against each opponent. A fish that didn't have enough fights to be crowned is listed at the bottom without a rank, and one that has since left the tank is marked "left".

## Suggestions

Got an idea, some feedback, or a bug to report? Click **Suggest an idea** at the top of the editor, type it in, and click **Send**. The admins read every suggestion when they plan changes to the game.

Suggestions go straight to the admins and aren't shown anywhere in the game. Each one is saved with the time, your computer's network address, and your name. If your fish is open in the editor, your name comes from it; otherwise you can type one, or leave it blank.

---

## For admins

The admin page is at `{{site_url}}/admin` and uses a shared password. From there you can:

- Pause or resume fights, start a fight right away, or heal every fish that isn't in a fight to full HP.
- Delete a fish. Its past fights and past weeks stay in the records.
- See every fish's style this week, its form today (hover it for this week's daily rolls), and its average Elo so far. Players never see form during the week. The champion is marked with a crown.
- **Reshuffle styles now:** deals every fish a new style by the same rules as the weekly reset, without resetting anything else.
- **Set a style** for one fish by hand, from its row in the fish table, for the rest of the week.
- **Skip the next weekly reset:** the current week carries on until the Monday after. Click it again to undo.
- See which fish have a PIN, and **Clear** a forgotten or wrongly claimed PIN. The next person to open that fish in the editor sets a new one, so tell its owner right away.
- See each fish's Elo, and in brackets how its stats are currently adjusted for it. Players never see the adjustment.
- Edit the ticker's items under **Ticker**, when the ticker is set up to be typed in on the admin page. With any other source, the section says where the items come from.
- Change any game setting: the point pool, Elo, fight timing, matchmaking, the reset hour, and every stat formula. Formula changes apply from each fish's next fight. **Elo handicap** sets how strongly Elo adjusts stats in fights; the admin page explains it, and 0 turns the adjustment off. Each fish's Elo still updates with it off. Set **How strongly opponents are picked for an even fight** to 0 to pick opponents completely at random, and **Recent fights checked for repeat opponents** to 0 to stop making rematches less likely. The server log shows each fight's estimated odds.
- **Fight slowdown** (under **Fights**) sets how many times slower fights play out than the base speed: fish attack less often, heal more slowly in fights, Enrage builds more slowly, and Poison, Last Stand and Second Wind are stretched to match, so each fight has the same hits and the same odds, just spread out. The time limit and Enrage start are entered at base speed and stretched by it too. 1 is the base speed.
- **Reset hour** (under **Week**) sets when the daily form is rolled and, on Mondays, when the week resets, in the server's local time.
- Set how much bigger a higher Elo draws a fish, under **Aquarium**. Lower numbers make a bigger size gap, and 0 draws every fish the same size. Open aquariums pick up the change within a second, with no reload.
- Choose the aquarium's seasonal decorations with **Seasonal aquarium decorations**, under **Aquarium**: **By date** (the default) shows each theme in its season, **Off** shows none, and choosing a theme shows it all the time, whatever the date. Open aquariums pick up the change within a second. To preview a theme in your own browser without changing anyone else's, add `?theme=` and a theme's name to the aquarium's address: `newyear`, `valentines`, `stpatricks`, `easter`, `july4`, `halloween`, `thanksgiving` or `december` (`?theme=off` hides them). For December, `&day=24` shows a given day's pile of presents.
- Switch skills off or on with **Skills**. With skills off, fish fight with their style's stats only.
- **End the week now:** ends the week right away, exactly like the Monday reset (standings saved, champion crowned, Elo and records cleared, styles dealt). The next reset is still the coming Monday's.
- **Reset everything:** deletes all fish, history, and past weeks.

To change the admin password, run `python server.py --set-admin-password` on the game server. All existing admin logins end whenever the server restarts, which includes the nightly restart and the one after each code update.

## Technical details

### How it fits together

One Python program (`server.py`) runs on the game server all the time. It:

- runs the simulation: healing, picking fights, playing them out, updating Elo, the daily form, and the weekly reset
- is the only thing that writes the game data, so edits from several people can't collide
- serves the web pages
- keeps the ticker's items, from the source set in `site.json`

| Page | Address |
|------|---------|
| Aquarium (full-screen on the TV) | `{{site_url}}/` |
| Editor | `{{site_url}}/editor` |
| How to play (this file) | `{{site_url}}/help` |
| Admin | `{{site_url}}/admin` |

Numbers in this file that come from the game's settings are written as a setting's name in double curly braces. The How to play page fills each one in with its current value, so the page stays right when an admin changes a setting. Some placeholders stand for a whole sentence worked out from several settings, and a few come from `site.json`. `help_values` in `engine.py` and `site_values` in `server.py` list them all, and a misspelled name shows up on the page as-is.

The TV and players' computers only need a browser. The simulation runs on the server, so fights keep going while the TV shows something else.

It uses only Python's standard library, so there's nothing to `pip install`. It needs Python 3.9 or newer.

### Running it

`python server.py` starts the server with the address, port and ticker in `site.json`; stop it with Ctrl+C. `python server.py --set-admin-password` sets the admin password. In normal use a service runs it instead: on Windows, `setup/install-windows.ps1` (run once in an Administrator PowerShell, from the server's own copy of the folder) opens the firewall port and registers a scheduled task that starts the server at boot, restarts it within a minute if it stops, and restarts it every night at 3:00 AM. Run it again with `-Uninstall` to remove them; game data is kept. Don't run the server by hand while the service is running, because both would try to use the same port.

### Updating the code

Copy the new files into the folder. Nothing else is needed:

- Changes to files in `web/` and to this README take effect on the next page load.
- When `server.py`, `engine.py`, `skills.py`, `styles.py`, `ticker_adapter.py` or `site.json` changes, the server restarts itself to load the new code, usually within 2 to 3 minutes. It waits until the files have stopped changing and the fights in progress have ended, and starts no new fights while it waits. If the new code doesn't load, the server keeps running the old version and writes the error to `data/server.log`.
- As a backup, the service also restarts the server every night.

Saved data isn't affected by a restart. A fight in progress during a nightly or manual restart is dropped without a result. The version that's running is written to `data/server.log` at startup.

### Files

| Path | What it is |
|------|------------|
| `server.py` | Web server, admin login, the ticker, and startup. Run with `--help` for options. |
| `engine.py` | Rules, stat formulas, fight simulation, the daily form, the weekly reset, and saving. `CONFIG_FIELDS` lists every setting and its default. `VERSION` is the game version. |
| `skills.py` | Skills. Each skill has its own on/off flag here, and the admin page's **Skills** setting switches the whole system. The file's docstring explains how skills hook into fights. |
| `styles.py` | The fighting styles: each one's name, role, blurb, stat split, and skills, and the weekly dealing rules. |
| `site.json` | What's particular to this office: the address players use, the port, and the ticker's source. |
| `ticker_adapter.py` | Only when the ticker's source is `adapter`: the code that turns this office's own data into ticker items. |
| `web/` | The web pages. `monster-art.js` draws the fish (and the crown) for both the aquarium and the editor. `themes.js` holds the aquarium's seasonal themes, each with its dates and its drawing. |
| `setup/install-windows.ps1` | Windows only: the firewall rule, and the two scheduled tasks: the server itself and its nightly restart. |
| `data/state.json` | Fish, this week's records, and fight history. Written every 10 seconds and after each fight. |
| `data/state.json.bak` | Hourly backup, used automatically if `state.json` can't be read. |
| `data/weeks.json` | Every past week's final standings: each fish's name and look at the time, style, daily forms, Elo, average Elo, record, streak, damage, and head-to-head. Written at each weekly reset. |
| `data/config.json` | Settings changed on the admin page. Only values that differ from the defaults are stored. |
| `data/ticker.json` | The ticker's items, when they're typed in on the admin page. |
| `data/admin.json` | The admin password, stored as a salted hash. The password itself is never saved. |
| `data/player-logins.key` | Secret key that signs players' editor logins. Created on first start. Deleting it logs everyone out of the editor. |
| `data/suggestions.md` | Players' suggestions from the editor, newest last. Created by the first suggestion. No page serves it; read it on the server. |
| `data/server.log` | Startup, fight results, weekly resets, admin actions, and errors. When it reaches 1 MB it's renamed to `server.log.1`, and the 3 newest old logs are kept. |

The `data/` folder is created the first time the server runs. Don't edit `state.json` while the server is running, because the server will overwrite it within 10 seconds. To fix data by hand, stop the server first.

### Known limits and ideas for later

- **Balance is tuned by simulation.** The styles, the point pool, the Elo handicap, and the daily form may need adjusting once real weeks have been played.
- **More customization:** a new body shape is one more drawing function in `web/monster-art.js`, plus its name in `SHAPES` in `engine.py`. Appendages could be drawn as add-on layers in the same file.
- **The style deal is exact up to 20 fish.** Past that, the weekly deal falls back to a random one that keeps the hard rules (even counts, no repeat of last week's style) but not the soft ones.

## Changelog

Versions use *major.minor.patch*. Patch releases fix bugs, minor releases add or change features, and major releases change the game in ways that need a reset. Every change that affects players gets an entry here.

### 1.1.0

- Seasonal decorations for the aquarium: New Year's, Valentine's, St Patrick's, Easter, Independence Day, Halloween, Thanksgiving and December, each with its own decorations and a visitor that crosses the far background now and then. In December a present appears under the tree each day until Christmas Eve. Holidays that usually close offices start a week early, so people see them on days they're in.
- The aquarium's side panel can be hidden: click the arrow tab at the top right of the tank, and click it again to bring the panel back. The tank fills the space, and your browser remembers your choice.

### 1.0.0

- First release: the aquarium with fights, fight history, leaderboard and past weeks; the editor; fighting styles and skills; daily form; the weekly reset and the crown; suggestions; the ticker; and the admin page.
