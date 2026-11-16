"""Balance check: every fighting style against every other, by the game's own fight rules.

Run it on a TEST COPY of the game folder, never the live one (it only reads files, but changes to styles.py or
skills.py should be tried in a copy first anyway):

    python tools/style_matrix.py                         # the copy this file sits in, default settings
    python tools/style_matrix.py --game PATH             # another copy
    python tools/style_matrix.py --config data/config.json --set elo_k=24 --set enrage_per_s=0
    python tools/style_matrix.py --skill-off poison      # as if Poison were switched off
    python tools/style_matrix.py --fights 2000           # tighter numbers (default 600)

It prints a table of row-beats-column win chances (fresh fighters, even Elo, average form, starting HP anywhere a
fish can be picked at, as matchmaking estimates it), each style's average against the field, and the most
lopsided pairings. At 600 fights a number is good to about +/-2 points; use 2000 before acting on small gaps.

Results describe how this game's styles match up, so treat them as admin-only: players shouldn't be handed the
counters. See WORKFLOWS.md (next to the game folder) for how this fits into changing styles and skills.
"""

import argparse
import importlib
import json
import os
import random
import sys


def main():
    here = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--game", default=here, help="game folder (default: the one this tool is in)")
    ap.add_argument("--config", help="a config.json of admin overrides to apply first")
    ap.add_argument("--set", action="append", default=[], metavar="KEY=VALUE", help="override one setting")
    ap.add_argument("--skill-off", action="append", default=[], metavar="ID", help="switch one skill off")
    ap.add_argument("--fights", type=int, default=600, help="simulated fights per pairing (default 600)")
    ap.add_argument("--seed", type=int, default=1, help="random seed, so runs can be compared (default 1)")
    args = ap.parse_args()

    sys.path.insert(0, os.path.abspath(args.game))
    engine = importlib.import_module("engine")
    skills = importlib.import_module("skills")
    styles = importlib.import_module("styles")

    cfg = dict(engine.DEFAULT_CONFIG)
    if args.config:
        with open(args.config, encoding="utf-8") as fh:
            cfg.update({k: v for k, v in json.load(fh).items() if k in cfg})
    for kv in args.set:
        key, _, value = kv.partition("=")
        if key not in cfg:
            sys.exit(f"Unknown setting: {key}")
        cfg[key] = float(value)
    for sid in args.skill_off:
        if sid not in skills.SKILLS:
            sys.exit(f"Unknown skill: {sid}")
        skills.SKILLS[sid].enabled = False

    ids = styles.IDS
    derived = {s: engine.derive(engine.build_points(styles.STYLES[s]["build"], cfg), cfg, styles.STYLES[s]["skills"])
               for s in ids}
    win = {}
    for i, a in enumerate(ids):
        for b in ids[i:]:
            random.seed(args.seed)
            p = engine.win_chance(derived[a], derived[b], cfg, fights=args.fights,
                                  skills_a=styles.STYLES[a]["skills"], skills_b=styles.STYLES[b]["skills"])
            win[a, b], win[b, a] = p, 1 - p
            if a == b:
                win[a, a] = 0.5

    names = {s: styles.STYLES[s]["name"] for s in ids}
    width = max(len(n) for n in names.values())
    print(f"Row beats column, % ({args.fights} fights per pairing; skills {'on' if cfg['skills_enabled'] else 'off'})")
    print(" " * width + "".join(f"{names[s][:9]:>10}" for s in ids) + f"{'Average':>10}")
    for a in ids:
        others = [win[a, b] for b in ids if b != a]
        row = "".join(f"{('--' if a == b else f'{100 * win[a, b]:.0f}'):>10}" for b in ids)
        print(f"{names[a]:<{width}}{row}{100 * sum(others) / len(others):>10.0f}")
    pairs = sorted(((max(win[a, b], win[b, a]), a, b) for i, a in enumerate(ids) for b in ids[i + 1:]), reverse=True)
    print("\nMost lopsided pairings:")
    for p, a, b in pairs[:5]:
        fav, dog = (a, b) if win[a, b] >= win[b, a] else (b, a)
        print(f"  {names[fav]} beats {names[dog]} {100 * p:.0f}% of the time")
    print(f"\nAverage favorite's win chance over all pairings: {100 * sum(p for p, _, _ in pairs) / len(pairs):.0f}%")


if __name__ == "__main__":
    main()
