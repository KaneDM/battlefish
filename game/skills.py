"""Skills: optional abilities that change how a fish fights, kept apart from the fight rules in engine.py.

Two kinds of switch decide what takes effect:

- The skills_enabled setting (admin page, Skills) turns the whole system on or off. While it's off, fish
  fight exactly as if skills didn't exist.
- Each skill has its own enabled flag in this file. A skill only takes effect when both are on.

Every skill registered here belongs to a fighting style (styles.py), so all are switched on (see the end of this
file). A new skill being tried out should stay off until a style uses it: a simulation imports a test copy of the
game and calls switch_on(game.config) there. Changing a flag in the live folder deploys like any other code change
(the server restarts onto it).

A fish's skill ids are in m["skills"], copied from its style. Ids that aren't registered, or are switched
off, are ignored, so removing a skill never breaks a save.

Defining a skill
----------------
Skill(id, name, blurb, icon=..., params=..., hooks...):

- id: short lowercase name used in saves (letters, digits, underscores). Never reuse one for a different skill.
- name and blurb: what players see in the editor. The blurb says what the skill does in a sentence.
- icon: the inside of an SVG drawn on a 24x24 grid, made of path, circle, ellipse, line, polyline, polygon and
  rect elements. The editor wraps it in <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
  stroke-width="2" stroke-linecap="round" stroke-linejoin="round">, so it's a single-color line drawing.
- params: the numbers to tune (chances, multipliers), read by the hooks as ctx["p"] (p for on_derive), so a
  simulation can try other values without changing the code.

Hooks
-----
A skill is a set of hook functions, each called at one point of a fight. Fight hooks are called as
hook(ctx, me, them, ...), where:

- ctx is this skill's own context for the fight: ctx["p"] is the skill's params, ctx["mem"] a dict it can keep
  anything in until the fight ends, ctx["cfg"] the game settings.
- me and them are the two fighters' sides: side["d"] is the fighter's derived stats for this fight only (a
  copy, so a hook can change them for the rest of the fight), side["hp"] is current HP, side["next"] is
  when it next attacks, and side["t"] is how many seconds the fight has run. me is always the skill's owner.

on_derive(p, d)                   Passive change to derived stats (see derive in engine.py), in and out of fights.
                                  Changing max_hp doesn't change regen_idle; adjust both if it should.
on_fight_start(ctx, me, them)     Once, when the fight phase begins.
on_tick(ctx, me, them, dt)        After combat regen, dt seconds since the last call. A fighter left at 0 HP or
                                  less here is knocked out.
on_attack(ctx, me, them, hit)     The owner is about to attack. Change hit before the dodge roll.
on_defend(ctx, me, them, hit)     The owner is about to be attacked. Change hit before the dodge roll.
after_attack(ctx, me, them, hit)  The owner's attack is resolved and its damage applied.
after_defend(ctx, me, them, hit)  An attack on the owner is resolved. The knockout check comes after this,
                                  so raising me["hp"] here can save the owner.

hit is a dict. Before the roll: damage (raw damage), defense and evasion (the target's, for this hit only),
mult (multiplies damage after Defense, 1.0 by default) and tags (a list of words for the fight's event, such
as "crit", for the aquarium to show). After the roll: dodged, and dmg (the damage dealt).

What the aquarium shows
-----------------------
The engine turns each attack into a fight event, which the aquarium (web/tank.js) plays. Besides the tags:

- hit["spikes"]: damage a skill dealt back to the attacker during this hit. The event reports it and the
  attacker's HP.
- hit["counters"]: a list of hits a skill made in reply (Riposte's counterattack). Each becomes its own event,
  a moment after this one, and counts toward the counterattacker's damage dealt.
- side["dot"]: damage over time (Poison) a fighter has taken. The engine reports it every DOT_EVENT_S seconds.
- note(side, skill, **info): a once-in-a-while skill kicked in for side (Last Stand, Second Wind). It becomes
  an event of its own, whether a hit or a tick set it off. info is passed along, such as seconds (how long the
  effect lasts) or heal.

A skill the aquarium has no styling for still works; its tag or note is just not shown.

Conventions every skill follows:

- A side with side["immune"] set takes no damage. Attacks against it are blocked by the immune skill's own
  hooks; a skill that deals damage outside an attack (in on_tick, or back at an attacker in after_defend) must
  check them.get("immune") first.
- Damage outside an attack can knock out either fighter: the engine checks both fighters after on_tick and
  after every attack, so a hook only has to lower side["hp"].
- Per-fight state goes in ctx["mem"] (or, for flags other skills read, a key on the side such as "immune").
  Use random.random() for chances, so simulations can replay fights.

The engine runs hooks the same way in real fights and in win_chance's quick ones, so matchmaking odds take
skills into account.

Example (not part of the game):

    def lucky_attack(ctx, me, them, hit):
        if random.random() < ctx["p"]["chance"]:
            hit["mult"] *= ctx["p"]["mult"]
            hit["tags"].append("crit")

    register(Skill("lucky", "Lucky", "Sometimes hits twice as hard.",
                   icon='<path d="M12 3l2.6 5.6 6 .7-4.5 4.1 1.2 6L12 16.4 6.7 19.4l1.2-6L3.4 9.3l6-.7z"/>',
                   params={"chance": 0.1, "mult": 2.0}, on_attack=lucky_attack))
"""

import random  # noqa: F401  (for skills' hooks)

HOOKS = ("on_derive", "on_fight_start", "on_tick", "on_attack", "on_defend", "after_attack", "after_defend")
strike = None  # engine.strike, handed over by engine.py, for skills that make an extra attack: strike(me, them, cfg)


class Skill:
    """One skill: how players see it, its tuning params, and its hooks."""

    def __init__(self, id, name, blurb, icon="", params=None, enabled=False, **hooks):
        unknown = set(hooks) - set(HOOKS)
        if unknown:
            raise ValueError(f"Skill {id}: unknown hooks {sorted(unknown)}")
        self.id = id
        self.name = name
        self.blurb = blurb
        self.icon = icon
        self.params = dict(params or {})
        self.enabled = enabled
        self.hooks = hooks


SKILLS = {}  # id -> Skill, in the order registered, which is also the order their hooks run in


def register(skill):
    if skill.id in SKILLS:
        raise ValueError(f"Skill {skill.id} is registered twice")
    SKILLS[skill.id] = skill
    return skill


def switch_on(cfg, *ids):
    """For simulations: turn on the system in the settings cfg, and the given skills (all of them if none given)."""
    cfg["skills_enabled"] = 1
    for i in ids or SKILLS:
        SKILLS[i].enabled = True


def active(ids, cfg):
    """The skills among ids that take effect now, in registration order. Empty while the system is off."""
    if not cfg.get("skills_enabled") or not ids:
        return ()
    ids = set(ids)
    return tuple(s for s in SKILLS.values() if s.enabled and s.id in ids)


def signature(ids, cfg):
    """Identifies the active skills and their params, so cached fight odds are redone when either changes."""
    return tuple((s.id, repr(sorted(s.params.items()))) for s in active(ids, cfg))


def apply_derive(ids, d, cfg):
    for s in active(ids, cfg):
        if "on_derive" in s.hooks:
            s.hooks["on_derive"](s.params, d)


def slowdown(ctx):
    """The fight_slowdown setting (see engine.slowdown): skill params are at normal speed, so a skill divides its
    per-second rates by this and multiplies its durations by it."""
    return ctx["cfg"].get("fight_slowdown") or 1.0


def start(ids, cfg):
    """A fighter's skills for one fight: (skill, ctx) pairs, kept in its side as side["skills"]."""
    return tuple((s, {"p": s.params, "mem": {}, "cfg": cfg}) for s in active(ids, cfg))


def fire(me, them, hook, *args):
    """Run one hook for each of me's skills that has it."""
    for s, ctx in me["skills"]:
        fn = s.hooks.get(hook)
        if fn:
            fn(ctx, me, them, *args)


def note(side, skill, **info):
    """Tell the aquarium that skill just kicked in for side (see "What the aquarium shows")."""
    side.setdefault("notes", []).append(dict(info, skill=skill))


# ---- the skills -----------------------------------------------------------------------------------------

def crit_attack(ctx, me, them, hit):
    p = ctx["p"]
    # neutral: normal hits shrink so average damage stays the same, and crits only add swing.
    scale = 1 / (1 + p["chance"] * (p["mult"] - 1)) if p["neutral"] else 1.0
    if random.random() < p["chance"]:
        if p["before_defense"]:
            hit["damage"] *= p["mult"]
            hit["mult"] *= scale
        else:
            hit["mult"] *= p["mult"] * scale
        hit["tags"].append("crit")
    else:
        hit["mult"] *= scale


def crit_untag_dodged(ctx, me, them, hit):
    if hit["dodged"] and "crit" in hit["tags"]:
        hit["tags"].remove("crit")


register(Skill("crit", "Critical Hit", "Some attacks land extra hard.",
               icon='<path d="M13.5 1.6L14.6 8.2L19.4 7.6L16.6 11.6L21.8 15.7L15.2 15.3L14.9 21L11.4 16.6L7.3 19'
                    'L8 14.3L1.5 12.9L7.7 10.4L5.6 5.3L10.6 7.6z"/>',
               params={"chance": 0.15, "mult": 2.0, "before_defense": 0, "neutral": 0},
               on_attack=crit_attack, after_attack=crit_untag_dodged))


# Sets side["immune"], which Poison and Spikes check (see "Conventions" above).

def last_stand_tick(ctx, me, them, dt):
    mem = ctx["mem"]
    if mem.get("left", 0) > 0:
        mem["left"] -= dt
        if mem["left"] <= 0:
            me["immune"] = False
    elif not mem.get("used") and 0 < me["hp"] <= ctx["p"]["threshold"] * me["d"]["max_hp"]:
        last_stand_start(ctx, me, ctx["p"]["immune"])  # pushed under the threshold by something other than a hit


def last_stand_start(ctx, me, immune):
    ctx["mem"]["used"] = True
    seconds = ctx["p"]["seconds"] * slowdown(ctx)
    if immune:
        ctx["mem"]["left"] = seconds
        me["immune"] = True
    note(me, "last_stand", seconds=seconds if immune else 0)


def last_stand_defend(ctx, me, them, hit):
    ctx["mem"]["hp_before"] = me["hp"]
    if me.get("immune"):
        hit["mult"] = 0.0
        hit["tags"].append("immune")


def last_stand_hurt(ctx, me, them, hit):
    mem, p = ctx["mem"], ctx["p"]
    if mem.get("used") or hit["dodged"]:
        return
    line = p["threshold"] * me["d"]["max_hp"]
    if 0 < me["hp"] <= line:
        last_stand_start(ctx, me, p["immune"])
    elif me["hp"] <= 0 and p["catch"] and mem["hp_before"] > line:
        me["hp"] = 1.0  # one hit jumped from above the threshold to a knockout
        last_stand_start(ctx, me, p["catch_immune"])


# immune: reaching the threshold starts the immunity. catch: a single hit from above the threshold that would
# knock it out leaves it at 1 HP instead; catch_immune: and starts the immunity too. Once per fight either way.
register(Skill("last_stand", "Last Stand", "Once per fight when near death, become invincible for a few seconds.",
               icon='<path d="M12 2.5l8 3v6c0 5-3.4 8.6-8 10-4.6-1.4-8-5-8-10v-6z"/><line x1="12" y1="7.5" x2="12" y2="12.5"/>'
                    '<line x1="12" y1="16.5" x2="12" y2="16.6"/>',
               params={"threshold": 0.1, "seconds": 3.0, "immune": 1, "catch": 0, "catch_immune": 0},
               on_tick=last_stand_tick, on_defend=last_stand_defend, after_defend=last_stand_hurt))


def piercing_attack(ctx, me, them, hit):
    hit["defense"] *= 1 - ctx["p"]["ignore"]


register(Skill("piercing", "Piercing", "Attacks ignore part of the target's Defense.",
               icon='<line x1="3" y1="12" x2="20" y2="12"/><polyline points="15 7 20 12 15 17"/>'
                    '<line x1="10" y1="3" x2="10" y2="8.5"/><line x1="10" y1="15.5" x2="10" y2="21"/>',
               params={"ignore": 0.15}, on_attack=piercing_attack))


def poison_hit(ctx, me, them, hit):
    if hit["dmg"] > 0 and not ctx["mem"].get("on"):
        ctx["mem"]["on"] = True
        hit["tags"].append("poison")


def poison_tick(ctx, me, them, dt):
    p = ctx["p"]
    if (ctx["mem"].get("on") or not p["on_hit"]) and not them.get("immune"):
        lost = p["per_second"] / slowdown(ctx) * them["d"]["max_hp"] * dt
        them["hp"] -= lost
        them["dot"] = them.get("dot", 0.0) + lost


register(Skill("poison", "Poison", "The first attack applies poison, causing the target to gradually take damage for the rest of the fight.",
               icon='<path d="M12 3c3 4.2 6 7.6 6 11a6 6 0 0 1-12 0c0-3.4 3-6.8 6-11z"/>'
                    '<line x1="9.5" y1="13" x2="14.5" y2="17"/><line x1="14.5" y1="13" x2="9.5" y2="17"/>',
               params={"per_second": 0.005, "on_hit": 1},
               after_attack=poison_hit, on_tick=poison_tick))


def spikes_hurt(ctx, me, them, hit):
    if hit["dmg"] <= 0 or them.get("immune"):
        return
    p, cfg = ctx["p"], ctx["cfg"]
    back = p["fraction"] * hit["dmg"] + p["flat"]
    if not p["ignore_defense"]:  # the same rule as a hit: Defense blocks a flat amount, never all of it
        back = max(back * cfg["min_damage_fraction"], back - them["d"]["defense"], 0.0)
    them["hp"] -= back
    hit["spikes"] = hit.get("spikes", 0.0) + back
    hit["tags"].append("spikes")


register(Skill("spikes", "Spikes", "Reflects a portion of damage back to the attacker.",
               icon='<path d="M2.5 20.5h19"/><path d="M3 20.5L5.3 9l2.2 11.5L9.8 4l2.2 16.5L14.2 4l2.3 16.5L18.7 9 21 20.5"/>',
               params={"fraction": 0.15, "flat": 0.0, "ignore_defense": 1}, after_defend=spikes_hurt))


def second_wind_check(ctx, me):
    mem, p = ctx["mem"], ctx["p"]
    if not mem.get("used") and 0 < me["hp"] <= p["threshold"] * me["d"]["max_hp"]:
        slow = slowdown(ctx)
        mem.update(used=True, left=p["seconds"] * slow, base=me["d"]["regen_combat"])
        before = me["hp"]
        # regen_combat is already slowed, so heal_seconds x slow of it heals the same HP at any slowdown
        me["hp"] = min(me["d"]["max_hp"], me["hp"] + p["heal_seconds"] * slow * mem["base"])
        me["d"]["regen_combat"] = mem["base"] * p["mult"]
        note(me, "second_wind", heal=round(me["hp"] - before, 1), seconds=p["seconds"] * slow)
        return True
    return False


def second_wind_tick(ctx, me, them, dt):
    mem = ctx["mem"]
    if mem.get("left", 0) > 0:
        mem["left"] -= dt
        if mem["left"] <= 0:
            me["d"]["regen_combat"] = mem["base"]
    else:
        second_wind_check(ctx, me)


def second_wind_hurt(ctx, me, them, hit):
    second_wind_check(ctx, me)


register(Skill("second_wind", "Second Wind", "Once per fight when badly hurt, heal and temporarily boost Regeneration.",
               icon='<path d="M3 8h10.5a3 3 0 1 0-3-3"/><path d="M3 12h15.5a3 3 0 1 1-3 3"/><path d="M3 16h6"/>',
               params={"threshold": 0.2, "mult": 3.0, "seconds": 5.0, "heal_seconds": 5.0},
               on_tick=second_wind_tick, after_defend=second_wind_hurt))


def relentless_attack(ctx, me, them, hit):
    p = ctx["p"]
    hit["evasion"] *= (1 - p["base"]) * (1 - p["per_miss"]) ** ctx["mem"].get("misses", 0)


def relentless_after(ctx, me, them, hit):
    ctx["mem"]["misses"] = ctx["mem"].get("misses", 0) + 1 if hit["dodged"] else 0


register(Skill("relentless", "Relentless", "Attacks become increasingly harder to dodge, resetting after a successful hit.",
               icon='<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="2.5"/><line x1="12" y1="1.5" x2="12" y2="5.5"/>'
                    '<line x1="12" y1="18.5" x2="12" y2="22.5"/><line x1="1.5" y1="12" x2="5.5" y2="12"/>'
                    '<line x1="18.5" y1="12" x2="22.5" y2="12"/>',
               params={"base": 0.2, "per_miss": 0.35}, on_attack=relentless_attack, after_attack=relentless_after))


# Riposte makes a real attack with the engine's own strike, which engine.py hands over as skills.strike. A
# counterattack can't itself be countered, so two Riposte fish can't trade counters forever.

def riposte_defend(ctx, me, them, hit):
    if hit["dodged"] and not them.get("riposting") and me["hp"] > 0 and strike:
        me["riposting"] = True
        hit.setdefault("counters", []).append(strike(me, them, ctx["cfg"]))
        me["riposting"] = False
        hit["tags"].append("riposte")


def riposte_attack(ctx, me, them, hit):
    if me.get("riposting"):
        hit["damage"] *= ctx["p"]["damage"]
        hit["tags"].append("counter")


register(Skill("riposte", "Riposte", "When dodging an attack, strike back with a weaker attack.",
               icon='<line x1="4" y1="4" x2="15" y2="15"/><line x1="20" y1="4" x2="9" y2="15"/>'
                    '<line x1="12.5" y1="17.5" x2="17.5" y2="12.5"/><line x1="6.5" y1="12.5" x2="11.5" y2="17.5"/>'
                    '<line x1="16" y1="16" x2="20" y2="20"/><line x1="8" y1="16" x2="4" y2="20"/>',
               params={"damage": 0.75}, on_attack=riposte_attack, after_defend=riposte_defend))


def desperation_attack(ctx, me, them, hit):
    missing = 1 - max(0.0, me["hp"]) / me["d"]["max_hp"]
    if missing > 0:
        hit["mult"] *= 1 + ctx["p"]["max_bonus"] * missing


register(Skill("desperation", "Desperation", "Attack damage scales with missing HP.",
               icon='<path d="M12 20.5S3 15 3 8.8A4.8 4.8 0 0 1 12 6.3a4.8 4.8 0 0 1 9 2.5c0 6.2-9 11.7-9 11.7z"/>'
                    '<polyline points="12 6.3 10 10.5 13.5 12.5 11.5 16.5"/>',
               params={"max_bonus": 0.35}, on_attack=desperation_attack))


def momentum_attack(ctx, me, them, hit):
    stacks = ctx["mem"].get("stacks", 0)
    if stacks:
        hit["mult"] *= 1 + ctx["p"]["per_stack"] * stacks


def momentum_after(ctx, me, them, hit):
    p, mem = ctx["p"], ctx["mem"]
    stacks = mem.get("stacks", 0)
    if hit["dmg"] > 0:
        mem["stacks"] = min(p["max_stacks"], stacks + 1)
    else:  # dodged or blocked: on_miss 0 wipes the streak, 1 halves it
        mem["stacks"] = stacks // 2 if p["on_miss"] else 0


register(Skill("momentum", "Momentum", "Attacks grow stronger with each consecutive hit, resetting after a miss.",
               icon='<polyline points="3.5 10 5.5 12 3.5 14"/><polyline points="9.25 8.25 13 12 9.25 15.75"/>'
                    '<polyline points="15 6.5 20.5 12 15 17.5"/>',
               params={"per_stack": 0.08, "max_stacks": 5, "on_miss": 0},
               on_attack=momentum_attack, after_attack=momentum_after))


# Every skill above belongs to a fighting style (styles.py), so all are on. Switch one off here to take it out of
# the game (its styles then fight without it).
for _skill in SKILLS.values():
    _skill.enabled = True
