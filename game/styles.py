"""Fighting styles: the stats and skills each fish is dealt for the week, and the rules for dealing them.

Players don't choose builds. Every fish has one style at a time; the weekly reset in engine.py deals every
fish a new one, and a fish that joins mid-week is dealt the least common style. A style's build is
percentages of the point pool (admin setting); its skills are ids from skills.py.

Changing a style here deploys like any other code change. Fish pick up the new numbers from their next
fight, since the engine reads a fish's build and skills from its style. Never reuse an id for a different
style: saved fish and past weeks refer to styles by id.
"""

import itertools
import random

# id, creature name, role, blurb (shown to players), build (health, regeneration, strength, aggression, defense,
# evasion; adds up to 100), skills.
_ROSTER = [
    ("octopus", "Octopus", "All-Rounder",
     "A bit of everything and no weak spots: even grabbing it hurts. It adapts to whatever it's up against.",
     (16, 13, 26, 15, 15, 15), ("crit", "relentless", "spikes")),
    ("walrus", "Walrus", "Bruiser",
     "Big, tough, and hits hard. Its tusks punch through armor, and it builds up steam with every blow.",
     (35, 5, 30, 5, 25, 0), ("piercing", "momentum")),
    ("mantis", "Mantis Shrimp", "Glass Cannon",
     "Fragile, but it punches harder and faster than anything in the tank. Wins fast or not at all.",
     (2, 5, 50, 38, 0, 5), ("crit", "last_stand", "desperation")),
    ("urchin", "Urchin", "Defensive",
     "Armored and spiny. Anything that hits it gets hurt back, and its venom wears opponents down.",
     (35, 6, 19, 10, 30, 0), ("spikes", "poison")),
    ("swordfish", "Swordfish", "Duelist",
     "Quick and slippery. It dodges attacks and answers with a counter-thrust.",
     (10, 5, 35, 30, 0, 20), ("riposte", "relentless")),
    ("starfish", "Starfish", "Regenerator",
     "Heals fast in and out of fights, and bounces back when it's badly hurt.",
     (15, 30, 30, 20, 0, 5), ("second_wind", "poison")),
]
STAT_ORDER = ("health", "regeneration", "strength", "aggression", "defense", "evasion")
STYLES = {sid: {"id": sid, "name": name, "role": role, "blurb": blurb,
                "build": dict(zip(STAT_ORDER, build)), "skills": list(skill_ids)}
          for sid, name, role, blurb, build, skill_ids in _ROSTER}
IDS = list(STYLES)
for _s in STYLES.values():
    assert sum(_s["build"].values()) == 100, _s["id"]

HISTORY_KEEP = 12  # past styles kept per monster, for the dealing rules and the "Recent styles" line


def _cost(history, style):
    """How much dealing `style` to a monster with these past styles (newest last) breaks the soft rules."""
    if history and history[-1] == style:
        return 10 ** 6  # hard rule: never last week's style again
    cost = 0.0
    # The monster's current "deck": the styles since it last had all of them. It gets every style once
    # before any comes back.
    seen = set()
    for past in history:
        seen.add(past)
        if len(seen) == len(IDS):
            seen = set()
    if style in seen:
        cost += 1000
    # Discourage a quick comeback where one deck ends and the next begins.
    for back, penalty in ((2, 100), (3, 30), (4, 5)):
        if len(history) >= back and history[-back] == style:
            cost += penalty
    return cost


def extras_of(styles_dealt):
    """The styles dealt one more time than the rest in a week, from that week's list of styles (one per
    monster). Empty when the monsters split evenly, or when there are fewer monsters than styles."""
    counts = {}
    for s in styles_dealt:
        if s in STYLES:
            counts[s] = counts.get(s, 0) + 1
    n = sum(counts.values())
    if n <= len(IDS) or n % len(IDS) == 0:
        return []
    return sorted(s for s, c in counts.items() if c > n // len(IDS))


def _extra_cost(past_extras, extra):
    """How much choosing `extra` as this week's extra copies breaks the rotation, given earlier weeks' extras
    (lists, newest last; see extras_of). Like a monster's styles, the extra copy goes to every style once
    before any style gets it again (cost 500, below a monster's own deck so it never forces a repeat there),
    and a style that had it last week or the week before is held back a little more (200 / 60)."""
    seen = set()
    for past in past_extras:
        seen.update(past)
        if len(seen) >= len(IDS):
            seen = set()
    cost = 0.0
    for s in extra:
        if s in seen:
            cost += 500
        for back, penalty in ((1, 200), (2, 60)):
            if len(past_extras) >= back and s in past_extras[-back]:
                cost += penalty
    return cost


def deal(histories, past_extras=(), rng=random):
    """A new style for every monster: {monster id: style id}, given {monster id: past styles, newest last}
    and the styles that got an extra copy in earlier weeks (lists, newest last; see extras_of).

    Hard rules: each style is dealt n // 6 or n // 6 + 1 times (so counts differ by at most one), and nobody
    gets last week's style. Within those, the deal that breaks the soft rules least (see _cost, and _extra_cost
    for which styles get the extra copies), found exactly:
    for every choice of which styles get the extra copies, a minimum-cost matching of monsters to style slots
    over subsets of slots. Fine for a few dozen monsters; ties are broken at random.
    """
    mids = list(histories)
    n = len(mids)
    if n == 0:
        return {}
    if n > 20:  # the exact matching is 2^n; past that, fall back to a random deal that keeps the hard rules
        return _deal_random(histories, rng)
    past_extras = [list(e) for e in past_extras]
    best, best_cost = None, None
    for extra in itertools.combinations(IDS, n % len(IDS)):
        slots = IDS * (n // len(IDS)) + list(extra)
        base = _extra_cost(past_extras, extra) if n > len(IDS) else 0.0
        cost = [[_cost(histories[m], s) + rng.random() * 1e-3 for s in slots] for m in mids]
        inf = float("inf")
        dp = [inf] * (1 << n)
        choice = [0] * (1 << n)
        dp[0] = 0.0
        for mask in range(1 << n):
            if dp[mask] == inf:
                continue
            i = bin(mask).count("1")
            if i == n:
                continue
            for j in range(n):
                if not mask >> j & 1:
                    v = dp[mask] + cost[i][j]
                    if v < dp[mask | 1 << j]:
                        dp[mask | 1 << j] = v
                        choice[mask | 1 << j] = j
        full = (1 << n) - 1
        if best_cost is None or base + dp[full] < best_cost:
            mask, pick = full, {}
            for i in range(n - 1, -1, -1):
                j = choice[mask]
                pick[mids[i]] = slots[j]
                mask ^= 1 << j
            best, best_cost = pick, base + dp[full]
    return best


def _deal_random(histories, rng):
    mids = list(histories)
    slots = []
    while len(slots) < len(mids):
        more = IDS[:]
        rng.shuffle(more)
        slots += more
    slots = slots[:len(mids)]
    for _ in range(200):
        rng.shuffle(slots)
        pick = dict(zip(mids, slots))
        if all(not histories[m] or histories[m][-1] != pick[m] for m in mids):
            return pick
    return pick


def least_used(current, rng=random):
    """The style for a monster joining mid-week: the one fewest monsters have now, ties at random."""
    counts = {s: 0 for s in IDS}
    for s in current:
        if s in counts:
            counts[s] += 1
    low = min(counts.values())
    return rng.choice([s for s in IDS if counts[s] == low])


def roll_form(swing, rng=random):
    """A monster's form for the day: a multiplier on all its stats, from 1 - swing to 1 + swing."""
    return round(rng.uniform(1 - swing, 1 + swing), 4) if swing > 0 else 1.0
