"""Game rules, saved state and the fight simulation for Battlefish.

All game changes happen in Game, under Game.lock. The web server calls into it,
and a background thread calls Game.tick() several times a second.

Naming: the code calls a player's fish a "monster" (m, monsters, monster ids, the "monsters" key in saves and API
replies). Players only ever see the word "fish". "fish" is also one of the body shapes, and has no separate plural,
so the code keeps a word of its own for the thing.
"""

import hashlib
import hmac
import json
import logging
import math
import os
import random
import re
import secrets
import shutil
import threading
import time
import uuid
from datetime import datetime, timedelta

import skills
import styles

log = logging.getLogger("battlefish")

VERSION = "1.0.0"  # keep in step with the changelog in README.md

STATS = [
    {"key": "health", "label": "Health", "blurb": "More hit points."},
    {"key": "regeneration", "label": "Regeneration", "blurb": "Recover HP faster, in and out of fights."},
    {"key": "strength", "label": "Strength", "blurb": "More damage per hit."},
    {"key": "aggression", "label": "Aggression", "blurb": "Attack more often."},
    {"key": "defense", "label": "Defense", "blurb": "Block part of every hit you take."},
    {"key": "evasion", "label": "Evasion", "blurb": "Chance to dodge a hit completely."},
]
STAT_KEYS = [s["key"] for s in STATS]
SHAPES = ["fish", "eel", "puffer", "squid", "seahorse", "cuttlefish", "prawn", "angler", "ray", "school"]

# (key, default, label, group, type, min, max). Admins can change these on the admin page.
CONFIG_FIELDS = [
    ("point_pool", 200, "Stat points every fighting style is spread over", "Styles", "int", 1, 100000),
    ("form_swing", 0.25, "Daily form: each fish's stats are multiplied by a random amount from 1 minus this to "
     "1 plus this, rolled every day at the reset hour and shown only once the week is over (0 = off)", "Styles",
     "float", 0, 0.9),
    ("elo_k", 16, "Elo K: how many Elo points an even fight moves", "Elo", "float", 0, 200),
    ("elo_handicap", 260, "Elo handicap: Elo above 1500 that halves a fish's stat points in fights, and below "
     "1500 that doubles them (0 = off). Players aren't told this number", "Elo", "float", 0, 100000),
    ("fight_interval_min_s", 30, "Shortest wait between fight starts (seconds)", "Fights", "int", 5, 86400),
    ("fight_interval_max_s", 45, "Longest wait between fight starts (seconds)", "Fights", "int", 5, 86400),
    ("max_fights", 3, "Most fights at once", "Fights", "int", 1, 20),
    ("approach_s", 5, "Seconds fish spend closing in before a fight", "Fights", "float", 0, 60),
    ("fight_slowdown", 2.0, "Fight slowdown: fights play out this many times slower, with the same hits and the same "
     "odds. Attack speed, Regeneration in fights, Enrage's ramp and Poison are divided by it; the time limit, Enrage's "
     "start and Last Stand / Second Wind durations are multiplied by it. The other fight settings here are at normal "
     "speed (1 = normal speed)", "Fights", "float", 0.25, 10),
    ("fight_timeout_s", 60, "Fight time limit (seconds); the higher HP % wins", "Fights", "int", 10, 3600),
    ("enrage_per_s", 0.02, "Enrage: how much harder both fish hit for every second a fight runs past the start "
     "below, as a fraction of normal damage, counted before Defense (0 = off)", "Fights", "float", 0, 1),
    ("enrage_after_s", 30, "Enrage: seconds into a fight before fish start hitting harder", "Fights", "int", 0,
     3600),
    ("min_hp_to_fight", 0.6, "Fish need at least this fraction of max HP to be picked", "Fights", "float", 0, 1),
    ("history_limit", 500, "Fights kept in history", "Fights", "int", 10, 100000),
    ("matchmaking_power", 0, "How strongly opponents are picked for an even fight (0 = any opponent equally "
     "likely; higher = closer matchups)", "Fights", "float", 0, 10),
    ("matchmaking_floor", 0, "How likely a one-sided matchup still is, compared with 1 for an even one",
     "Fights", "float", 0, 1),
    ("matchmaking_variety", 5, "Recent fights checked for repeat opponents: each fight against the same opponent "
     "in a fish's last this-many fights makes a rematch less likely (0 = off)", "Fights", "int", 0, 1000),
    ("base_hp", 100, "Base HP", "Stat formulas", "float", 1, 1e9),
    ("hp_per_point", 10, "HP per Health point", "Stat formulas", "float", 0, 1e9),
    ("base_damage", 10, "Base damage per hit", "Stat formulas", "float", 0, 1e9),
    ("damage_per_point", 1, "Damage per Strength point", "Stat formulas", "float", 0, 1e9),
    ("base_attack_rate", 0.5, "Base attacks per second", "Stat formulas", "float", 0.05, 100),
    ("attack_rate_per_point", 0.05, "Attacks per second per Aggression point", "Stat formulas", "float", 0, 100),
    ("defense_per_point", 1.0, "Damage blocked per hit per Defense point", "Stat formulas", "float", 0, 1e9),
    ("min_damage_fraction", 0.1, "Fraction of every hit that always gets through Defense", "Stat formulas",
     "float", 0, 1),
    ("evasion_cap", 0.6, "Highest possible dodge chance", "Stat formulas", "float", 0, 0.95),
    ("evasion_half_point", 10, "Evasion points that give half the highest dodge chance", "Stat formulas",
     "float", 1, 1e9),
    ("regen_combat_per_point", 0.5, "HP/s during fights per Regeneration point", "Stat formulas", "float", 0, 1e9),
    ("regen_idle_base_fraction", 0.005, "Base HP/s between fights, as a fraction of max HP", "Stat formulas",
     "float", 0, 1),
    ("regen_idle_per_point", 2.0, "Extra HP/s between fights per Regeneration point", "Stat formulas",
     "float", 0, 1e9),
    ("reset_hour", 7, "Hour of the day (0-23, the server's local time) when the daily form is rolled and, on "
     "Mondays, the week resets. Changing it moves the next reset and roll to the new hour", "Week", "int", 0, 23),
    ("skills_enabled", 1, "Skills switched on (1 = on, 0 = off: fish fight with their style's stats only)",
     "Skills", "int", 0, 1),
    ("size_per_elo", 100, "Elo difference that doubles a fish's size in the aquarium (smaller = a bigger size "
     "gap between high and low Elo; 0 = everyone the same size)", "Aquarium", "float", 0, 100000),
]
DEFAULT_CONFIG = {f[0]: f[1] for f in CONFIG_FIELDS}

RESET_WINDOW_S = 300  # from 5 minutes before, no new fights start; at 5 minutes after, any still running is dropped
FULL_TANK_BREATHER_S = 15  # when every fight slot was taken, wait this long after one ends before starting another
EVENT_KEEP_SECONDS = 5
DOT_EVENT_S = 2.0  # report damage over time (Poison) to the aquarium in lumps this many seconds apart
COUNTER_DELAY_S = 0.3  # the aquarium shows a counterattack (Riposte) this long after the attack it answers
SAVE_EVERY_SECONDS = 10
BACKUP_EVERY_SECONDS = 3600
NAME_MAX = 32
COLOR_RE = re.compile(r"^#[0-9a-fA-F]{6}$")
PIN_RE = re.compile(r"^\d{4,8}$")
PIN_MAX_TRIES = 5
PIN_LOCK_SECONDS = 15 * 60
HASH_ITERATIONS = 240_000
# Fighter details left out of public fight history. The style is public, but max HP and HP left would give away
# the Elo handicap and the daily form.
BUILD_KEYS = ("build",)
HP_KEYS = ("max_hp", "hp_left")
ELO_START = 1500
ODDS_FIGHTS = 200  # simulated fights behind each matchmaking estimate
ODDS_CACHE_MAX = 2000


class GameError(Exception):
    """A request the game refuses. The message is shown to the person who made it."""


def hash_secret(secret):
    """A salted PBKDF2 hash of a password or PIN, saved instead of the secret itself."""
    salt = secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac("sha256", secret.encode(), salt, HASH_ITERATIONS)
    return {"salt": salt.hex(), "hash": digest.hex(), "iterations": HASH_ITERATIONS}


def check_secret(secret, saved):
    digest = hashlib.pbkdf2_hmac("sha256", secret.encode(), bytes.fromhex(saved["salt"]), saved["iterations"])
    return hmac.compare_digest(digest.hex(), saved["hash"])


def clean_pin(value):
    pin = str(value or "").strip()
    if not PIN_RE.match(pin):
        raise GameError("A PIN must be 4 to 8 digits.")
    return pin


def percent(hp, max_hp):
    return round(100 * hp / max_hp, 1) if max_hp > 0 else 0.0


def slowdown(cfg):
    """How many times slower fights play out (the fight_slowdown setting). Every per-second combat rate is divided
    by it and every combat duration multiplied by it, so a fight has the same hits and odds, just stretched out.
    Skills apply it to their own timers through ctx["cfg"]."""
    return cfg.get("fight_slowdown") or 1.0


def combat_rates(cfg):
    """The per-second combat settings as players feel them, after the slowdown (for the editor and How to play)."""
    slow = slowdown(cfg)
    return {k: round(cfg[k] / slow, 6) for k in
            ("base_attack_rate", "attack_rate_per_point", "regen_combat_per_point", "enrage_per_s")}


def fight_timeout(cfg):
    """The fight time limit in real seconds: the setting is at normal speed, so it stretches with the slowdown."""
    return cfg["fight_timeout_s"] * slowdown(cfg)


def derive(allocation, cfg, skill_ids=()):
    """Turn stat points, and any passive skills, into the numbers combat uses."""
    a = {k: float(allocation.get(k, 0)) for k in STAT_KEYS}
    max_hp = cfg["base_hp"] + cfg["hp_per_point"] * a["health"]
    ev = a["evasion"]
    slow = slowdown(cfg)
    d = {
        "max_hp": max_hp,
        "damage": cfg["base_damage"] + cfg["damage_per_point"] * a["strength"],
        "attack_rate": max(0.05, cfg["base_attack_rate"] + cfg["attack_rate_per_point"] * a["aggression"]) / slow,
        "defense": cfg["defense_per_point"] * a["defense"],
        "evasion": cfg["evasion_cap"] * ev / (ev + cfg["evasion_half_point"]) if ev else 0.0,
        "regen_combat": cfg["regen_combat_per_point"] * a["regeneration"] / slow,
        "regen_idle": cfg["regen_idle_base_fraction"] * max_hp + cfg["regen_idle_per_point"] * a["regeneration"],
    }
    skills.apply_derive(skill_ids, d, cfg)
    return d


def elo_multiplier(elo, cfg):
    """How much a fish's stat points are scaled in fights: less above 1500 Elo, more below it."""
    half = cfg["elo_handicap"]
    return 0.5 ** ((elo - ELO_START) / half) if half else 1.0


def build_points(build, cfg, mult=1.0):
    """A build's stat points: its percentages of the point pool, scaled by mult. Fractions are kept."""
    return {k: cfg["point_pool"] * build.get(k, 0) / 100 * mult for k in STAT_KEYS}


def round_derived(d):
    return {
        "max_hp": round(d["max_hp"], 1),
        "damage": round(d["damage"], 2),
        "attack_rate": round(d["attack_rate"], 3),
        "defense": round(d["defense"], 2),
        "evasion": round(d["evasion"], 4),
        "regen_combat": round(d["regen_combat"], 2),
        "regen_idle": round(d["regen_idle"], 2),
    }


def hit_damage(raw, defense, cfg):
    """Damage one landed hit does: Defense blocks a flat amount, but never all of it."""
    return max(raw * cfg["min_damage_fraction"], raw - defense, 0.0)


# Shares of max HP this close at the time limit are a tie. Each step updates one fighter before the other, so an
# effect that ticks every step (Poison against full regen) would otherwise always settle a stalemate the same way.
TIE_MARGIN = 0.005


def timeout_loser(fa, fb):
    """Which fighter loses at the time limit, from their shares of max HP: 0, 1, or a coin flip for a tie."""
    if abs(fa - fb) <= TIE_MARGIN:
        return random.randrange(2)
    return 0 if fa < fb else 1


# The fight rules, shared by real fights (Game._advance_fight) and win_chance's quick ones, so the two can't
# drift apart. A side is one fighter's state for one fight; skills.py describes what its hooks can change.

def new_side(d, hp, skill_ids, cfg):
    # t: seconds into the fight, kept up to date by regen.
    return {"d": dict(d), "hp": hp, "next": None, "t": 0.0, "skills": skills.start(skill_ids, cfg)}


def regen(sides, dt):
    """Both fighters' combat regen, then both fighters' skill effects over time, for dt seconds.

    Both heal before either's effects tick, so neither fighter is always the one healed back to full after a hit.
    """
    for me in sides:
        me["t"] += dt
        me["hp"] = min(me["d"]["max_hp"], me["hp"] + me["d"]["regen_combat"] * dt)
    for me, them in (sides, sides[::-1]):
        if me["skills"]:
            skills.fire(me, them, "on_tick", dt)


def ticked_out(sides):
    """The index of a fighter a skill's over-time effect knocked out, or None. Without skills, nobody can be."""
    if not (sides[0]["skills"] or sides[1]["skills"]):
        return None
    for i, s in enumerate(sides):
        if s["hp"] <= 0:
            return i
    return None


def strike(att, tgt, cfg):
    """One attack: Evasion may dodge it, and Defense blocks part of a hit that lands. Returns the hit."""
    hit = {"damage": att["d"]["damage"], "defense": tgt["d"]["defense"], "evasion": tgt["d"]["evasion"],
           "mult": 1.0, "tags": []}
    slow = slowdown(cfg)
    over = att["t"] - cfg["enrage_after_s"] * slow
    if cfg["enrage_per_s"] and over > 0:
        # Enrage: long fights get harder hits, before Defense, so armor can't stall a fight to the time limit.
        hit["damage"] *= 1 + cfg["enrage_per_s"] / slow * over
    has_skills = att["skills"] or tgt["skills"]  # skipping the hooks keeps matchmaking odds quick without skills
    if has_skills:
        skills.fire(att, tgt, "on_attack", hit)
        skills.fire(tgt, att, "on_defend", hit)
    hit["dodged"] = random.random() < hit["evasion"]
    hit["dmg"] = 0.0 if hit["dodged"] else hit_damage(hit["damage"], hit["defense"], cfg) * hit["mult"]
    tgt["hp"] = max(0.0, tgt["hp"] - hit["dmg"])
    if has_skills:
        skills.fire(att, tgt, "after_attack", hit)
        skills.fire(tgt, att, "after_defend", hit)
    return hit


skills.strike = strike  # for skills that make an extra attack (Riposte)


def win_chance(da, db, cfg, fights=ODDS_FIGHTS, skills_a=(), skills_b=()):
    """Estimated chance that a fish with derived stats da (and skills skills_a) beats one with db.

    Plays quick fights by the same rules as Game._advance_fight, from a random starting HP anywhere a fish
    can be picked at. Both use new_side, regen and strike; keep the rest of the two in step.
    """
    wins = 0
    timeout = fight_timeout(cfg)
    for _ in range(fights):
        sides = []
        for d, ids in ((da, skills_a), (db, skills_b)):
            s = new_side(d, d["max_hp"] * random.uniform(cfg["min_hp_to_fight"], 1.0), ids, cfg)
            s["next"] = random.uniform(0.1, 1 / s["d"]["attack_rate"])
            sides.append(s)
        skills.fire(sides[0], sides[1], "on_fight_start")
        skills.fire(sides[1], sides[0], "on_fight_start")
        t = 0.0
        while True:
            i = 0 if sides[0]["next"] <= sides[1]["next"] else 1
            at = min(sides[i]["next"], timeout)
            regen(sides, at - t)
            t = at
            out = ticked_out(sides)
            if out is not None:
                wins += 1 if out == 1 else 0
                break
            if t >= timeout:
                wins += timeout_loser(*(s["hp"] / s["d"]["max_hp"] for s in sides))
                break
            me, them = sides[i], sides[1 - i]
            me["next"] += 1 / me["d"]["attack_rate"]
            strike(me, them, cfg)
            if them["hp"] <= 0:
                wins += 1 if i == 0 else 0
                break
            if me["hp"] <= 0:  # a skill hit back hard enough
                wins += 1 if i == 1 else 0
                break
    return wins / fights


def describe_stats(cfg):
    """Stat descriptions for the editor, worded from the current config."""
    half = cfg["evasion_half_point"]
    rates = combat_rates(cfg)
    per_point = {
        "health": f"+{cfg['hp_per_point']:g} max HP per point (base {cfg['base_hp']:g}).",
        "regeneration": (f"+{rates['regen_combat_per_point']:g} HP/s during fights and "
                         f"+{cfg['regen_idle_per_point']:g} HP/s between fights, per point."),
        "strength": f"+{cfg['damage_per_point']:g} damage per hit per point (base {cfg['base_damage']:g}).",
        "aggression": (f"+{rates['attack_rate_per_point']:g} attacks per second per point "
                       f"(base {rates['base_attack_rate']:g})."),
        "defense": (f"Blocks {cfg['defense_per_point']:g} damage from every hit per point, but at least "
                    f"{cfg['min_damage_fraction']:.0%} of each hit always gets through."),
        "evasion": (f"Dodge chance climbs toward {cfg['evasion_cap']:.0%} with diminishing returns: "
                    f"{half:g} points gives {cfg['evasion_cap'] / 2:.0%}."),
    }
    return [dict(s, per_point=per_point[s["key"]]) for s in STATS]


PLACEHOLDER_RE = re.compile(r"\{\{(\w+)\}\}")
NUMBER_WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"]


def fill_placeholders(text, values):
    """Replace each {{name}} in text with values[name]. Unknown names are left as they are, so they stand out."""
    return PLACEHOLDER_RE.sub(lambda mo: values.get(mo.group(1), mo.group(0)), text)


def help_values(cfg):
    """What the How to play page fills its {{placeholders}} with: every setting, plus wording built from them."""
    pct = lambda v: f"{round(v * 100, 2):g}%"
    pts = lambda v: f"{v:g} point" + ("" if v == 1 else "s")

    def seconds(lo, hi=None):
        hi = lo if hi is None else hi
        if lo >= 120 and lo % 60 == 0 and hi % 60 == 0:
            lo, hi, unit = lo // 60, hi // 60, "minute"
        else:
            unit = "second"
        return f"{lo:g} to {hi:g} {unit}s" if lo != hi else f"{lo:g} {unit}" + ("" if lo == 1 else "s")

    n = int(cfg["max_fights"])
    hour = int(cfg["reset_hour"])
    count = NUMBER_WORDS[n] if n < len(NUMBER_WORDS) else str(n)
    values = {k: f"{v:g}" for k, v in cfg.items()}
    rates = combat_rates(cfg)
    slow = slowdown(cfg)
    values.update({k: f"{v:g}" for k, v in rates.items()})  # players see the rates fights actually run at
    values.update({
        "fight_interval": seconds(cfg["fight_interval_min_s"], cfg["fight_interval_max_s"]),
        "fight_timeout": seconds(fight_timeout(cfg)),
        "min_hp_to_fight_pct": pct(cfg["min_hp_to_fight"]),
        "fights_at_once": ("One fight runs at a time, and the next one waits until it's over." if n == 1 else
                           f"Up to {count} fights can run at once. A new fight starts on time even if the last one "
                           "hasn't finished, between two fish that aren't already fighting."),
        "opponent": ("Its opponent is picked at random, but close matchups are more likely than one-sided ones."
                     if cfg["matchmaking_power"] > 0 else "Its opponent is picked at random.") + (
            " Opponents it has fought a lot recently are less likely." if cfg["matchmaking_variety"] > 0 else ""),
        "point_pool_points": pts(cfg["point_pool"]),
        "elo_start": f"{ELO_START}",
        # Says the adjustment exists, never how strong it is.
        "elo_adjust": ("\n\nIn fights, each fish's stats are adjusted by its Elo: the higher a fish's Elo, the "
                       "more its stats are scaled down, and the lower its Elo, the more they're scaled up. So a strong "
                       "fish still climbs, but has to work harder to stay near the top, and a fish on a losing "
                       "run gets a lift. The editor shows your fish's style before this adjustment."
                       if cfg["elo_handicap"] else ""),
        "regen_idle_base_pct": pct(cfg["regen_idle_base_fraction"]),
        "min_damage_pct": pct(cfg["min_damage_fraction"]),
        "enrage": (f" After {seconds(cfg['enrage_after_s'] * slow)}, both fish start hitting harder: every second "
                   f"adds {pct(rates['enrage_per_s'])} to their damage, before Defense, so even thick armor gives way "
                   "in the end." if cfg["enrage_per_s"] else ""),
        "evasion_cap_pct": pct(cfg["evasion_cap"]),
        "evasion_half_pct": pct(cfg["evasion_cap"] / 2),
        "reset_time": clock(hour),
        "reset_window": f"between {clock(hour, -RESET_WINDOW_S // 60)} and {clock(hour, RESET_WINDOW_S // 60)}",
        "reset_quiet_from": clock(hour, -RESET_WINDOW_S // 60),
    })
    return values


def clock(hour, minutes=0):
    """A time of day for players to read: clock(7) -> "7:00 AM", clock(7, -5) -> "6:55 AM", clock(0) -> "12:00 AM"."""
    t = datetime(2000, 1, 3, int(hour)) + timedelta(minutes=minutes)
    return f"{t.hour % 12 or 12}:{t.minute:02d} {'AM' if t.hour < 12 else 'PM'}"


def reset_slot(now, hour):
    """The weekly reset that `now` belongs to: the latest Monday at `hour` (local time) whose window has opened,
    so from 5 minutes before the hour on a Monday it's that day's. As a timestamp."""
    t = datetime.fromtimestamp(now + RESET_WINDOW_S)
    slot = (t - timedelta(days=t.weekday())).replace(hour=hour, minute=0, second=0, microsecond=0)
    if slot > t:
        slot -= timedelta(days=7)
    return slot.timestamp()


def form_day(now, hour):
    """The latest `hour` o'clock (local time) at or before `now`: the daily form roll that's in force. As a
    timestamp."""
    t = datetime.fromtimestamp(now)
    day = t.replace(hour=hour, minute=0, second=0, microsecond=0)
    if day > t:
        day -= timedelta(days=1)
    return day.timestamp()


def next_reset(slot, hour):
    """The weekly reset after the one at `slot`, at `hour`. Local wall-clock time, so it stays at the same hour
    across daylight saving changes."""
    d = datetime.fromtimestamp(slot) + timedelta(days=7)
    return d.replace(hour=hour, minute=0, second=0, microsecond=0).timestamp()


def clean_name(value, what):
    text = re.sub(r"\s+", " ", str(value or "")).strip()
    if not text:
        raise GameError(f"{what} can't be blank.")
    if len(text) > NAME_MAX:
        raise GameError(f"{what} must be {NAME_MAX} characters or fewer.")
    return text


RECENT_FIGHTS = 100  # the focus card's "last 100" win rate


def new_record():
    # vs maps opponent id -> [wins, losses] against them. recent is "W"/"L" per fight, oldest first.
    # elo_sum / elo_n is the average of the monster's Elo after each of its fights this week (the crown).
    return {"wins": 0, "losses": 0, "streak": 0, "best_streak": 0, "damage_dealt": 0.0, "vs": {}, "recent": "",
            "elo_sum": 0.0, "elo_n": 0}


def week_form(m):
    """m's form over the week: the geometric mean of its daily rolls (1.0 if none)."""
    forms = [f for _, f in m.get("forms", [])] or [m.get("form", 1.0)]
    return round(math.exp(sum(math.log(f) for f in forms) / len(forms)), 4)


def average_elo(record):
    return record["elo_sum"] / record["elo_n"] if record.get("elo_n") else None


class Game:
    def __init__(self, data_dir):
        self.data_dir = data_dir
        self.state_path = os.path.join(data_dir, "state.json")
        self.config_path = os.path.join(data_dir, "config.json")
        self.weeks_path = os.path.join(data_dir, "weeks.json")
        self.lock = threading.RLock()
        self.config = self._load_config()
        self.state = self._load_state()
        self.weeks = self._load_weeks()
        self.fights = {}  # id -> fight in progress; not saved, so a restart drops it
        self.hold_new_fights = False  # set while a code update waits for the running fights to end
        self.pin_failures = {}  # monster id -> (wrong guesses, locked until); a restart clears it
        self.odds = {}  # (build a, build b, settings) -> a's estimated win chance, for matchmaking
        now = time.time()
        self.last_tick = now
        self.last_save = 0.0
        self.last_backup = 0.0
        if not self.state.get("week"):
            self.state["week"] = {"started_at": now, "slot": reset_slot(now, self._hour()), "skip": False,
                                  "form_day": form_day(now, self._hour())}
        for m in self.state["monsters"].values():
            if m.get("style") not in styles.STYLES:  # a style removed from styles.py, or a hand-made save
                self._set_style(m, styles.least_used(self._current_styles(exclude=m["id"])), replace=True)
            else:
                self._set_style(m, m["style"], replace=True)  # pick up any change to the style in styles.py
        # Downtime doesn't count: whatever was scheduled, the next fight comes shortly after startup.
        self.state["next_fight_at"] = now + random.uniform(30, 60)

    # ---- persistence -------------------------------------------------------

    def _load_config(self):
        cfg = dict(DEFAULT_CONFIG)
        try:
            with open(self.config_path, encoding="utf-8") as fh:
                saved = json.load(fh)
            for key, value in saved.items():
                if key in cfg and isinstance(value, (int, float)) and not isinstance(value, bool):
                    cfg[key] = value
        except FileNotFoundError:
            pass
        except (OSError, ValueError):
            log.exception("Couldn't read %s; using default settings", self.config_path)
        return cfg

    def _load_weeks(self):
        try:
            with open(self.weeks_path, encoding="utf-8") as fh:
                weeks = json.load(fh)
            return weeks if isinstance(weeks, list) else []
        except FileNotFoundError:
            return []
        except (OSError, ValueError):
            log.exception("Couldn't read %s; past weeks are missing until it's fixed", self.weeks_path)
            if os.path.exists(self.weeks_path):
                stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
                shutil.copyfile(self.weeks_path, f"{self.weeks_path}.unreadable-{stamp}")
            return []

    def _save_weeks(self):
        self._write_json(self.weeks_path, self.weeks)

    def _save_config(self):
        overrides = {k: v for k, v in self.config.items() if v != DEFAULT_CONFIG[k]}
        self._write_json(self.config_path, overrides)

    def _load_state(self):
        for path in (self.state_path, self.state_path + ".bak"):
            try:
                with open(path, encoding="utf-8") as fh:
                    state = json.load(fh)
                if path != self.state_path:
                    log.warning("Loaded the backup %s because the main state file was unreadable", path)
                return self._normalize_state(state)
            except FileNotFoundError:
                continue
            except (OSError, ValueError):
                log.exception("Couldn't read %s", path)
                if os.path.exists(path):
                    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
                    shutil.copyfile(path, f"{path}.unreadable-{stamp}")
        return self._normalize_state({})

    @staticmethod
    def _normalize_state(state):
        state.setdefault("monsters", {})
        state.setdefault("history", [])
        state.setdefault("next_fight_id", 1)
        state.setdefault("paused", False)
        state.setdefault("last_result", None)
        state.setdefault("champion", None)  # {"id", "week"}: last week's champion, crowned this week
        for m in state["monsters"].values():
            m.setdefault("style_history", [])
            m.setdefault("form", 1.0)
            m.setdefault("forms", [])
            m.setdefault("record", new_record())
            for k, v in new_record().items():
                m["record"].setdefault(k, v)
            m.setdefault("elo", float(ELO_START))
            m.setdefault("colors", {"body": "#3a8fd8", "accent": "#ffb02e"})
            m.setdefault("shape", "fish")
            m.setdefault("last_fight_at", None)
        return state

    def _write_json(self, path, data):
        tmp = path + ".tmp"
        with open(tmp, "w", encoding="utf-8") as fh:
            json.dump(data, fh, indent=2)
        for attempt in range(5):
            try:
                os.replace(tmp, path)
                return
            except PermissionError:
                # Antivirus or a backup tool can hold the file for a moment.
                if attempt == 4:
                    raise
                time.sleep(0.2)

    def save(self):
        with self.lock:
            now = time.time()
            if os.path.exists(self.state_path) and now - self.last_backup >= BACKUP_EVERY_SECONDS:
                shutil.copyfile(self.state_path, self.state_path + ".bak")
                self.last_backup = now
            self._write_json(self.state_path, self.state)
            self.last_save = now

    # ---- simulation ---------------------------------------------------------

    def tick(self):
        with self.lock:
            now = time.time()
            # Cap the step so a stalled or sleeping server doesn't heal monsters for time it wasn't running.
            step = max(0.0, min(now - self.last_tick, 2.0))
            self.last_tick = now
            self._check_week(now)
            self._check_form(now)
            cfg = self.config
            fighting = self._fighting_ids()
            for m in self.state["monsters"].values():
                if m["id"] in fighting:
                    continue
                d = self._derive(m)
                m["hp"] = min(d["max_hp"], m["hp"] + d["regen_idle"] * step)

            for f in list(self.fights.values()):
                self._advance_fight(f, now, step)

            if (not self.state["paused"] and not self.hold_new_fights and not self._reset_due(now)
                    and len(self.fights) < cfg["max_fights"] and now >= self.state["next_fight_at"]):
                if not self._try_start_fight(now):
                    self.state["next_fight_at"] = now + 20

            if now - self.last_save >= SAVE_EVERY_SECONDS:
                try:
                    self.save()
                except OSError:
                    log.exception("Couldn't save state; will retry")
                    self.last_save = now

    # ---- the week -------------------------------------------------------------

    def _next_reset_at(self):
        return next_reset(self.state["week"]["slot"], self._hour())

    def _hour(self):
        return int(self.config["reset_hour"])

    def _reset_due(self, now):
        """True from 5 minutes before the weekly reset until it happens: no new fights start meanwhile."""
        week = self.state["week"]
        return not week.get("skip") and now >= next_reset(week["slot"], self._hour()) - RESET_WINDOW_S

    def _check_week(self, now):
        week = self.state["week"]
        due = next_reset(week["slot"], self._hour())
        if now < due - RESET_WINDOW_S:
            return
        if week.get("skip"):
            week["slot"], week["skip"] = due, False
            log.info("Skipped the weekly reset, as an admin asked; the week carries on")
            return
        if self.fights and now < due + RESET_WINDOW_S:
            return  # let the fights in progress finish; no new ones start
        # If the server was down past one or more resets, this reset stands for the latest of them.
        self._end_week(now, max(due, reset_slot(now, self._hour())))

    def _check_form(self, now):
        """Every day at the reset hour, every fish gets a new form. On a Monday the weekly reset rolls it instead,
        so nothing rolls while the reset is due. After downtime, one roll stands for the days missed."""
        week = self.state["week"]
        day = form_day(now, self._hour())
        if day <= week["form_day"] or self._reset_due(now):
            return
        week["form_day"] = day
        for m in self.state["monsters"].values():
            self._roll_form(m, now)
        log.info("Daily form rolled")

    def _roll_form(self, m, now, keep_hp_share=True):
        """A new form for m. Its HP stays the same share of its (new) max HP. A monster that's fighting keeps
        its old numbers until the fight ends."""
        share = m["hp"] / self._derive(m)["max_hp"] if keep_hp_share else None
        m["form"] = styles.roll_form(self.config["form_swing"])
        m.setdefault("forms", []).append([now, m["form"]])
        if share is not None and m["id"] not in self._fighting_ids():
            m["hp"] = share * self._derive(m)["max_hp"]

    def _end_week(self, now, slot):
        """The weekly reset: save the week, crown its champion, and start a new one."""
        self._archive_week(now)
        self._new_week(now, slot)
        log.info("Weekly reset: new week started, styles dealt")

    def _archive_week(self, now):
        """Save the week's final standings to weeks.json and crown the champion. A week nobody fought in isn't
        saved, and crowns nobody."""
        monsters = list(self.state["monsters"].values())
        fights = sorted(m["record"]["wins"] + m["record"]["losses"] for m in monsters)
        self.state["champion"] = None
        if not fights or fights[-1] == 0:
            return
        mid = len(fights) // 2
        median = fights[mid] if len(fights) % 2 else (fights[mid - 1] + fights[mid]) / 2
        min_fights = max(1, math.ceil(median / 2))
        rows = []
        for m in monsters:
            r = m["record"]
            avg = average_elo(r)
            rows.append({"id": m["id"], "name": m["name"], "player": m["player"], "shape": m["shape"],
                         "colors": dict(m["colors"]), "style": m.get("style"),
                         "form": week_form(m), "forms": [list(x) for x in m.get("forms", [])],
                         "elo": round(m["elo"], 1), "avg_elo": None if avg is None else round(avg, 1),
                         "wins": r["wins"], "losses": r["losses"], "best_streak": r["best_streak"],
                         "damage_dealt": r["damage_dealt"], "vs": {k: list(v) for k, v in r["vs"].items()}})
        ok = [x for x in rows if x["wins"] + x["losses"] >= min_fights and x["avg_elo"] is not None]
        champ = max(ok, key=lambda x: (x["avg_elo"], x["wins"] / (x["wins"] + x["losses"]), x["wins"],
                                       x["name"].lower()), default=None)
        week = {"id": (self.weeks[-1]["id"] + 1) if self.weeks else 1,
                "started_at": self.state["week"]["started_at"], "ended_at": now, "min_fights": min_fights,
                "champion": champ["id"] if champ else None, "monsters": rows}
        self.weeks.append(week)
        try:
            self._save_weeks()
        except OSError:
            log.exception("Couldn't save weeks.json; the week is kept in memory and saved with the next week")
        if champ:
            self.state["champion"] = {"id": champ["id"], "week": week["id"]}
            log.info("Week %d champion: %s (%s), average Elo %.1f", week["id"], champ["name"], champ["player"],
                     champ["avg_elo"])

    def _new_week(self, now, slot):
        """Clear progress and deal every monster a new style and the week's first daily form."""
        self.fights.clear()
        histories = {mid: m.get("style_history", []) for mid, m in self.state["monsters"].items()}
        picks = styles.deal(histories, self._past_extras())
        for mid, m in self.state["monsters"].items():
            m.update({"elo": float(ELO_START), "record": new_record(), "last_fight_at": None, "forms": []})
            self._roll_form(m, now, keep_hp_share=False)
            self._set_style(m, picks[mid])
            m["hp"] = self._derive(m)["max_hp"]
        self.state["history"] = []
        self.state["last_result"] = None
        self.state["week"] = {"started_at": now, "slot": slot, "skip": False, "form_day": max(form_day(now, self._hour()), slot)}
        self.state["next_fight_at"] = now + 60
        self.odds.clear()

    def _set_style(self, m, sid, replace=False):
        """Give m the style sid: its build and skills come from styles.py. replace: instead of a new week's
        style, it replaces this week's (an admin's change, or a refresh at startup)."""
        style = styles.STYLES[sid]
        hist = m.setdefault("style_history", [])
        if replace and hist:
            hist[-1] = sid
        else:
            hist.append(sid)
        del hist[:-styles.HISTORY_KEEP]
        m["style"] = sid
        m["build"] = dict(style["build"])
        m["skills"] = list(style["skills"])

    def _past_extras(self):
        """Which styles were dealt one more time than the rest in each saved week, oldest first, so the weekly
        deal can rotate the extra copy (styles.deal). Read from the archive: a week's styles as they stood
        when it ended."""
        return [styles.extras_of([r.get("style") for r in w.get("monsters", [])]) for w in self.weeks[-12:]]

    def _current_styles(self, exclude=None):
        return [m.get("style") for m in self.state["monsters"].values() if m["id"] != exclude]

    # ---- fighting numbers ---------------------------------------------------------

    def _derive(self, m, mult=None):
        """What monster m fights with: its style's build scaled by its Elo multiplier and daily form, unless
        mult is given."""
        if mult is None:
            mult = elo_multiplier(m["elo"], self.config) * m.get("form", 1.0)
        return derive(build_points(m["build"], self.config, mult), self.config, m.get("skills"))

    def _odds_mult(self, m):
        """m's Elo multiplier times its form, rounded to steps of about 2%, so matchmaking odds can be cached
        between fights."""
        q = round(math.log2(elo_multiplier(m["elo"], self.config) * m.get("form", 1.0)) * 35)
        return q, 2 ** (q / 35)

    def _fighting_ids(self):
        return {mid for f in self.fights.values() for mid in (f["a"], f["b"])}

    def _try_start_fight(self, now):
        cfg = self.config
        fighting = self._fighting_ids()
        eligible = [
            m for m in self.state["monsters"].values()
            if m["id"] not in fighting
            and m["hp"] >= cfg["min_hp_to_fight"] * self._derive(m)["max_hp"] - 1e-6
        ]
        if len(eligible) < 2:
            return False
        # The monster that has waited longest since it was last picked goes first, so fast healers and
        # quick winners don't get more than their share of fights. Never-picked monsters go first of all.
        random.shuffle(eligible)
        a = min(eligible, key=lambda m: m["last_fight_at"] or 0)
        rivals = [m for m in eligible if m is not a]
        last = self.state["last_result"]
        if last and a["id"] in (last["winner"]["id"], last["loser"]["id"]) and len(rivals) > 1:
            # Avoid an immediate rematch when there's anyone else to pick.
            rivals = [m for m in rivals if m["id"] not in (last["winner"]["id"], last["loser"]["id"])]
        # Favor opponents it has a close fight against, and ones it hasn't fought much lately: each recent
        # fight against an opponent divides that opponent's weight by one more.
        recent = self._recent_opponents(a["id"], int(cfg["matchmaking_variety"]))
        weights = [(cfg["matchmaking_floor"] + (1 - abs(2 * self._win_chance(a, b) - 1)) ** cfg["matchmaking_power"])
                   / (1 + recent.get(b["id"], 0)) for b in rivals]
        b = random.choices(rivals, weights)[0] if sum(weights) > 0 else random.choice(rivals)
        self._start_fight(a, b, now)
        return True

    def _recent_opponents(self, mid, limit):
        """How many times each opponent appears in monster mid's last `limit` fights in history."""
        counts = {}
        seen = 0
        for e in self.state["history"]:  # newest first
            if seen >= limit:
                break
            ids = (e["winner"]["id"], e["loser"]["id"])
            if mid in ids:
                opp = ids[1] if ids[0] == mid else ids[0]
                counts[opp] = counts.get(opp, 0) + 1
                seen += 1
        return counts

    def _win_chance(self, a, b):
        """Monster a's estimated chance of beating b, cached until either build or a setting changes."""
        (qa, ma), (qb, mb) = self._odds_mult(a), self._odds_mult(b)
        key = (tuple(a["build"][k] for k in STAT_KEYS), qa, tuple(b["build"][k] for k in STAT_KEYS), qb,
               skills.signature(a.get("skills"), self.config), skills.signature(b.get("skills"), self.config),
               tuple(sorted(self.config.items())))
        if key not in self.odds:
            if len(self.odds) >= ODDS_CACHE_MAX:
                self.odds.clear()
            self.odds[key] = win_chance(self._derive(a, ma), self._derive(b, mb), self.config,
                                        skills_a=a.get("skills"), skills_b=b.get("skills"))
        return self.odds[key]

    def _start_fight(self, a, b, now):
        fid = self.state["next_fight_id"]
        self.state["next_fight_id"] += 1
        sides = {}
        for m in (a, b):
            m["last_fight_at"] = now
            # The side's HP is set when the fight phase begins, and is the monster's real HP until the fight ends.
            sides[m["id"]] = dict(new_side(self._derive(m), None, m.get("skills"), self.config),
                                  build=dict(m["build"]), attacks=0, hits=0, dodges=0, damage=0.0)
        self.fights[fid] = {"id": fid, "a": a["id"], "b": b["id"], "phase": "approach",
                            "start": now + self.config["approach_s"], "sides": sides, "events": [], "seq": 0}
        cfg = self.config
        self.state["next_fight_at"] = now + random.uniform(cfg["fight_interval_min_s"], cfg["fight_interval_max_s"])
        log.info("Fight %d: %s vs %s (%.0f%% for %s)", fid, a["name"], b["name"], 100 * self._win_chance(a, b),
                 a["name"])

    def _advance_fight(self, f, now, step):
        monsters = self.state["monsters"]
        if f["a"] not in monsters or f["b"] not in monsters:
            del self.fights[f["id"]]
            return
        sides = f["sides"]
        other = {f["a"]: f["b"], f["b"]: f["a"]}
        if f["phase"] == "approach":
            if now < f["start"]:
                return
            f["phase"] = "fight"
            for mid, side in sides.items():
                side["hp"] = monsters[mid]["hp"]
                side["next"] = f["start"] + random.uniform(0.1, 1 / side["d"]["attack_rate"])
            for mid, side in sides.items():
                skills.fire(side, sides[other[mid]], "on_fight_start")

        regen([sides[f["a"]], sides[f["b"]]], step)
        self._skill_events(f, now)
        out = ticked_out([sides[f["a"]], sides[f["b"]]])
        if out is not None:
            loser = (f["a"], f["b"])[out]
            self._end_fight(f, other[loser], loser, "ko", now)
            return

        # Play out every attack due by now, in time order, so fast attackers get all their hits.
        while True:
            mid, side = min(sides.items(), key=lambda kv: kv[1]["next"])
            if side["next"] > now:
                break
            t = side["next"]
            side["next"] += 1 / side["d"]["attack_rate"]
            self._attack(f, mid, other[mid], t)
            if sides[other[mid]]["hp"] <= 0:
                self._end_fight(f, mid, other[mid], "ko", t)
                return
            if side["hp"] <= 0:  # a skill hit back hard enough
                self._end_fight(f, other[mid], mid, "ko", t)
                return

        if now - f["start"] >= fight_timeout(self.config):
            loser = (f["a"], f["b"])[timeout_loser(*(sides[mid]["hp"] / sides[mid]["d"]["max_hp"]
                                                     for mid in (f["a"], f["b"])))]
            self._end_fight(f, other[loser], loser, "timeout", now)
            return
        self._copy_hp(f)

    def _copy_hp(self, f):
        """Copy the fighters' HP from the fight to the monsters, for the aquarium and for after the fight."""
        for mid, side in f["sides"].items():
            if side["hp"] is not None:
                self.state["monsters"][mid]["hp"] = side["hp"]

    def _attack(self, f, by, to, t):
        hit = strike(f["sides"][by], f["sides"][to], self.config)
        self._record_hit(f, by, to, t, hit)
        for i, counter in enumerate(hit.get("counters", ()), 1):
            self._record_hit(f, to, by, t + COUNTER_DELAY_S * i, counter)
        self._skill_events(f, t)

    def _record_hit(self, f, by, to, t, hit):
        """Count one hit in the fighters' stats, and add its fight event for the aquarium."""
        a_side, t_side = f["sides"][by], f["sides"][to]
        a_side["attacks"] += 1
        if hit["dodged"]:
            t_side["dodges"] += 1
        else:
            a_side["hits"] += 1
            a_side["damage"] += hit["dmg"]
        event = {"t": round(t, 3), "by": by, "to": to, "dmg": round(hit["dmg"], 1),
                 "dodged": hit["dodged"], "hp": round(t_side["hp"], 1)}
        if hit["tags"]:
            event["tags"] = hit["tags"]
        if hit.get("spikes"):
            event["spikes"] = round(hit["spikes"], 1)
            event["by_hp"] = round(a_side["hp"], 1)
        self._event(f, event)

    def _skill_events(self, f, t):
        """Fight events for skill effects outside a hit's own event: skills that kicked in (skills.note), and
        damage over time, lumped into one event every DOT_EVENT_S seconds."""
        for mid, side in f["sides"].items():
            for n in side.pop("notes", ()):
                self._event(f, dict(n, kind="skill", t=round(t, 3), to=mid, hp=round(side["hp"], 1)))
            if side.get("dot", 0) > 0 and t - side.get("dot_at", f["start"]) >= DOT_EVENT_S:
                self._event(f, {"kind": "dot", "t": round(t, 3), "to": mid, "dmg": round(side.pop("dot"), 1),
                                "hp": round(max(0.0, side["hp"]), 1)})
                side["dot_at"] = t

    def _event(self, f, event):
        f["seq"] += 1
        f["events"].append(dict(event, seq=f["seq"]))
        while f["events"] and f["events"][0]["t"] < event["t"] - EVENT_KEEP_SECONDS:
            f["events"].pop(0)

    def _end_fight(self, f, winner_id, loser_id, reason, t):
        cfg = self.config
        self._copy_hp(f)
        if len(self.fights) >= cfg["max_fights"]:
            # The next fight was only waiting for a free slot, so don't start it the instant this one ends.
            self.state["next_fight_at"] = max(self.state["next_fight_at"], t + FULL_TANK_BREATHER_S)
        self.fights.pop(f["id"], None)
        w = self.state["monsters"][winner_id]
        l = self.state["monsters"][loser_id]
        expected = 1 / (1 + 10 ** ((l["elo"] - w["elo"]) / 400))
        change = cfg["elo_k"] * (1 - expected)
        w["elo"] += change
        l["elo"] -= change
        for m in (w, l):
            m["record"]["elo_sum"] += m["elo"]
            m["record"]["elo_n"] += 1
        if reason == "ko":
            l["hp"] = 0.0
        for m, opp, won in ((w, l, True), (l, w, False)):
            r = m["record"]
            if won:
                r["wins"] += 1
                r["streak"] = r["streak"] + 1 if r["streak"] > 0 else 1
            else:
                r["losses"] += 1
                r["streak"] = r["streak"] - 1 if r["streak"] < 0 else -1
            r["best_streak"] = max(r["best_streak"], r["streak"])
            r["damage_dealt"] = round(r["damage_dealt"] + f["sides"][m["id"]]["damage"], 1)
            vs = r["vs"].setdefault(opp["id"], [0, 0])
            vs[0 if won else 1] += 1
            r["recent"] = (r["recent"] + ("W" if won else "L"))[-RECENT_FIGHTS:]

        entry = {"id": f["id"], "ended_at": round(t, 1), "duration": round(t - f["start"], 1), "reason": reason,
                 "winner": self._fighter_summary(w, f), "loser": self._fighter_summary(l, f)}
        history = self.state["history"]
        history.insert(0, entry)
        del history[int(cfg["history_limit"]):]
        self.state["last_result"] = entry
        log.info("Fight %d: %s beat %s (%s, %.0fs)", f["id"], w["name"], l["name"], reason, entry["duration"])
        try:
            self.save()
        except OSError:
            log.exception("Couldn't save after fight %d", f["id"])

    @staticmethod
    def _fighter_summary(m, f):
        side = f["sides"][m["id"]]
        return {"id": m["id"], "name": m["name"], "player": m["player"], "shape": m["shape"],
                "colors": dict(m["colors"]), "hp_left": round(m["hp"], 1), "max_hp": side["d"]["max_hp"],
                "damage": round(side["damage"], 1), "attacks": side["attacks"], "hits": side["hits"],
                "dodges": side["dodges"], "build": side["build"], "elo": round(m["elo"]), "style": m.get("style")}

    # ---- views ----------------------------------------------------------------

    def _public_monster(self, m, fighting, detail=False):
        """A monster as players see it. Never its form, which stays hidden until the week is over."""
        d = self._derive(m)
        avg = average_elo(m["record"])
        out = {"id": m["id"], "player": m["player"], "name": m["name"], "shape": m["shape"],
               "colors": m["colors"], "elo": round(m["elo"]), "avg_elo": None if avg is None else round(avg, 1),
               "style": m.get("style"), "style_history": list(m.get("style_history", [])),
               "hp": round(m["hp"], 1), "max_hp": d["max_hp"], "in_fight": m["id"] in fighting,
               "record": {k: v for k, v in m["record"].items() if k not in ("elo_sum", "elo_n")}}
        if detail:
            # The style's numbers before the Elo adjustment and form, so the editor gives neither away.
            out["build"] = dict(m["build"])
            out["created_at"] = m.get("created_at")
            out["derived"] = round_derived(self._derive(m, 1.0))
        return out

    def _public_fight(self, entry):
        """A history entry for the aquarium page: without HP totals or builds (styles are shown instead)."""
        if entry is None:
            return entry
        hidden = HP_KEYS + BUILD_KEYS
        return dict(entry, **{side: {k: v for k, v in entry[side].items() if k not in hidden}
                              for side in ("winner", "loser")})

    def public_state(self):
        with self.lock:
            now = time.time()
            fighting = self._fighting_ids()
            fights = []
            for f in self.fights.values():
                # HP as a percentage, since max HP gives away how many points are in Health, and with a public
                # build, the Elo adjustment.
                events = [dict(e, hp=percent(e["hp"], f["sides"][e["to"]]["d"]["max_hp"]),
                               **({"by_hp": percent(e["by_hp"], f["sides"][e["by"]]["d"]["max_hp"])}
                                  if "by_hp" in e else {}))
                          for e in f["events"] if e["t"] >= now - 4]
                fights.append({"id": f["id"], "a": f["a"], "b": f["b"], "phase": f["phase"], "start": f["start"],
                               "events": events})
            monsters = [self._public_monster(m, fighting) for m in self.state["monsters"].values()]
            for out in monsters:
                out["hp"], out["max_hp"] = percent(out["hp"], out["max_hp"]), 100
            champion = self.state.get("champion")
            return {"version": VERSION, "server_time": now, "paused": self.state["paused"],
                    "next_fight_at": self.state["next_fight_at"], "fights": fights,
                    "size_per_elo": self.config["size_per_elo"],
                    "week": {"started_at": self.state["week"]["started_at"], "next_reset_at": self._next_reset_at()},
                    "champion": champion["id"] if champion else None,
                    "champion_week": champion["week"] if champion else None,
                    "last_result": self._public_fight(self.state["last_result"]),
                    "monsters": monsters}

    def list_monsters(self):
        with self.lock:
            ms = sorted(self.state["monsters"].values(), key=lambda m: m["player"].lower())
            return [{"id": m["id"], "player": m["player"], "name": m["name"]} for m in ms]

    def _monster(self, mid):
        m = self.state["monsters"].get(mid)
        if not m:
            raise GameError("That fish doesn't exist (an admin may have deleted it).")
        return m

    def get_monster(self, mid):
        """Everything about one monster, for its owner. The server checks the PIN login first."""
        with self.lock:
            return self._public_monster(self._monster(mid), self._fighting_ids(), detail=True)

    def history(self, monster_id=None, limit=50):
        with self.lock:
            out = []
            for e in self.state["history"]:
                if monster_id and monster_id not in (e["winner"]["id"], e["loser"]["id"]):
                    continue
                out.append(self._public_fight(e))
                if len(out) >= limit:
                    break
            return out

    def rules(self):
        with self.lock:
            sk = {s.id: {"id": s.id, "name": s.name, "blurb": s.blurb, "icon": s.icon} for s in skills.SKILLS.values()}
            return {"stats": describe_stats(self.config), "shapes": SHAPES,
                    "point_pool": self.config["point_pool"], "skills_enabled": bool(self.config["skills_enabled"]),
                    "styles": [dict(st, skills=[sk[i] for i in st["skills"] if i in sk])
                               for st in styles.STYLES.values()]}

    def past_weeks(self):
        """Every past week's final standings, oldest first. Form is included: it's revealed once a week ends."""
        with self.lock:
            return [dict(w) for w in self.weeks]

    def help_values(self):
        with self.lock:
            return help_values(self.config)

    # ---- player edits ---------------------------------------------------------

    def save_monster(self, payload):
        """Create a monster, or change one's name, shape or colors. Players don't choose builds: a new monster
        is dealt the least common style this week (see styles.py), and keeps it until the weekly reset."""
        player = clean_name(payload.get("player"), "Player name")
        name = clean_name(payload.get("name"), "Fish name")
        shape = payload.get("shape")
        if shape not in SHAPES:
            raise GameError("Pick a body shape.")
        colors = payload.get("colors") if isinstance(payload.get("colors"), dict) else {}
        for key in ("body", "accent"):
            if not COLOR_RE.match(str(colors.get(key, ""))):
                raise GameError("Colors must be hex values like #3a8fd8.")
        colors = {"body": colors["body"].lower(), "accent": colors["accent"].lower()}
        mid = payload.get("id") or None
        # Hashing is slow on purpose, so a new monster's PIN is hashed before taking the lock.
        pin = None if mid else hash_secret(clean_pin(payload.get("pin")))

        with self.lock:
            monsters = self.state["monsters"]
            for other in monsters.values():
                if other["id"] != mid and other["player"].lower() == player.lower():
                    raise GameError(f"{other['player']} already has a fish ({other['name']}). "
                                    "Pick that name from the list to edit it.")
            now = time.time()
            if mid:
                m = monsters.get(mid)
                if not m:
                    raise GameError("That fish no longer exists (an admin may have deleted it). Reload the page.")
            else:
                mid = uuid.uuid4().hex[:12]
                sid = styles.least_used(self._current_styles())
                m = monsters[mid] = {"id": mid, "elo": float(ELO_START), "created_at": now, "record": new_record(),
                                     "hp": 0.0, "pin": pin, "last_fight_at": None, "style_history": [],
                                     "forms": []}
                self._roll_form(m, now, keep_hp_share=False)
                self._set_style(m, sid)
                m["hp"] = self._derive(m)["max_hp"]
                log.info("New fish %s for %s, dealt %s", name, player, sid)
            m.update({"player": player, "name": name, "shape": shape, "colors": colors, "updated_at": now})
            self.save()
            return self._public_monster(m, self._fighting_ids(), detail=True)

    # ---- PINs -----------------------------------------------------------------------

    def pin_tag(self, mid):
        """Changes whenever the monster's PIN is set or cleared, so older logins stop working. None if no PIN."""
        with self.lock:
            m = self.state["monsters"].get(mid)
            return m["pin"]["salt"][:16] if m and m.get("pin") else None

    def has_pin(self, mid):
        with self.lock:
            return bool(self._monster(mid).get("pin"))

    def check_pin(self, mid, pin):
        """True if pin is the monster's PIN. Too many wrong guesses lock the monster for a while."""
        with self.lock:
            m = self._monster(mid)
            saved = m.get("pin")
            if not saved:
                raise GameError("This fish doesn't have a PIN yet. Set one to claim it.")
            now = time.time()
            tries, locked_until = self.pin_failures.get(mid, (0, 0.0))
            if locked_until > now:
                raise GameError("Too many wrong PINs. Try again in "
                                f"{math.ceil((locked_until - now) / 60)} minutes, or ask an admin to clear it.")
            # Count the guess before checking it, so a burst of guesses sent at once can't beat the limit.
            tries += 1
            if tries >= PIN_MAX_TRIES:
                self.pin_failures[mid] = (0, now + PIN_LOCK_SECONDS)
                log.warning("Too many wrong PINs for %s (%s); locked for a while", m["name"], m["player"])
            else:
                self.pin_failures[mid] = (tries, 0.0)
        if not check_secret(str(pin or "").strip(), saved):  # slow on purpose, so it runs outside the lock
            return False
        with self.lock:
            self.pin_failures.pop(mid, None)
        return True

    def set_pin(self, mid, pin, replace=False):
        """Set a monster's PIN and return its new tag. Only its owner may replace an existing PIN."""
        saved = hash_secret(clean_pin(pin))
        with self.lock:
            m = self._monster(mid)
            had_pin = bool(m.get("pin"))
            if had_pin and not replace:
                raise GameError("This fish already has a PIN. Enter it to edit the fish.")
            m["pin"] = saved
            self.pin_failures.pop(mid, None)
            self.save()
            log.info("PIN %s for %s (%s)", "changed" if had_pin else "set", m["name"], m["player"])
            return saved["salt"][:16]

    # ---- admin ---------------------------------------------------------------------

    def admin_overview(self):
        with self.lock:
            fighting = self._fighting_ids()
            return {"paused": self.state["paused"], "server_time": time.time(),
                    "next_fight_at": self.state["next_fight_at"], "fights_in_progress": len(self.fights),
                    "monsters": [dict(self._public_monster(m, fighting), has_pin=bool(m.get("pin")),
                                      elo_mult=round(elo_multiplier(m["elo"], self.config), 3),
                                      form=m.get("form", 1.0), forms=m.get("forms", []))
                                 for m in sorted(self.state["monsters"].values(), key=lambda m: m["player"].lower())],
                    "week": {"started_at": self.state["week"]["started_at"], "next_reset_at": self._next_reset_at(),
                             "skip": bool(self.state["week"].get("skip"))},
                    "champion": (self.state.get("champion") or {}).get("id"),
                    "weeks_saved": len(self.weeks),
                    "styles": [{"id": st["id"], "name": st["name"], "role": st["role"]}
                               for st in styles.STYLES.values()],
                    "config": [{"key": k, "default": dflt, "label": label, "group": group, "type": typ,
                                "min": lo, "max": hi, "value": self.config[k]}
                               for k, dflt, label, group, typ, lo, hi in CONFIG_FIELDS]}

    def admin_action(self, action, payload):
        with self.lock:
            now = time.time()
            if action == "pause":
                self.state["paused"] = True
            elif action == "resume":
                self.state["paused"] = False
                self.state["next_fight_at"] = min(self.state["next_fight_at"], now + 30)
            elif action == "fight_now":
                if len(self.fights) >= self.config["max_fights"]:
                    raise GameError(f"{len(self.fights)} fights are already in progress, the most allowed at once.")
                if not self._try_start_fight(now):
                    raise GameError("Need at least two fish with enough HP to fight.")
            elif action == "heal_all":
                for m in self.state["monsters"].values():
                    if m["id"] not in self._fighting_ids():
                        m["hp"] = self._derive(m)["max_hp"]
            elif action == "delete_monster":
                m = self.state["monsters"].pop(str(payload.get("id")), None)
                if not m:
                    raise GameError("No such fish.")
                for fid in [fid for fid, f in self.fights.items() if m["id"] in (f["a"], f["b"])]:
                    del self.fights[fid]
                log.info("Admin deleted %s (%s)", m["name"], m["player"])
            elif action == "clear_pin":
                m = self.state["monsters"].get(str(payload.get("id")))
                if not m:
                    raise GameError("No such fish.")
                m.pop("pin", None)
                self.pin_failures.pop(m["id"], None)
                log.info("Admin cleared the PIN for %s (%s)", m["name"], m["player"])
            elif action == "reshuffle":
                # New styles for this week, by the weekly rules, without resetting anything else. Each monster's
                # deal avoids the style it had last week, as at a reset.
                histories = {mid: m.get("style_history", [])[:-1] for mid, m in self.state["monsters"].items()}
                for mid, sid in styles.deal(histories, self._past_extras()).items():
                    self._set_style(self.state["monsters"][mid], sid, replace=True)
                self.odds.clear()
                log.info("Admin reshuffled this week's styles")
            elif action == "set_style":
                m = self.state["monsters"].get(str(payload.get("id")))
                sid = str(payload.get("style"))
                if not m:
                    raise GameError("No such fish.")
                if sid not in styles.STYLES:
                    raise GameError("No such style.")
                self._set_style(m, sid, replace=True)
                log.info("Admin set %s (%s) to %s for the rest of the week", m["name"], m["player"], sid)
            elif action == "skip_reset":
                self.state["week"]["skip"] = bool(payload.get("skip"))
                log.info("Admin %s the next weekly reset", "skipped" if self.state["week"]["skip"] else "restored")
            elif action == "reset_progress":
                # Ends the week now, exactly like the Monday reset. The next one is still the coming Monday's.
                self._end_week(now, reset_slot(now, self._hour()))
                log.info("Admin ended the week early")
            elif action == "reset_all":
                self.fights.clear()
                self.state["monsters"] = {}
                self.state["history"] = []
                self.state["last_result"] = None
                self.state["champion"] = None
                self.weeks = []
                self._save_weeks()
                log.info("Admin reset everything")
            elif action == "update_config":
                self._update_config(payload.get("values"))
            else:
                raise GameError(f"Unknown action: {action}")
            self.save()

    def _update_config(self, values):
        if not isinstance(values, dict):
            raise GameError("No settings sent.")
        fields = {f[0]: f for f in CONFIG_FIELDS}
        new = dict(self.config)
        for key, raw in values.items():
            if key not in fields:
                raise GameError(f"Unknown setting: {key}")
            _, _, label, _, typ, lo, hi = fields[key]
            try:
                value = float(raw)
            except (TypeError, ValueError):
                raise GameError(f"{label}: enter a number.")
            if not math.isfinite(value) or value < lo or value > hi:
                raise GameError(f"{label}: must be between {lo:g} and {hi:g}.")
            if typ == "int":
                if value != int(value):
                    raise GameError(f"{label}: must be a whole number.")
                value = int(value)
            new[key] = value
        if new["fight_interval_min_s"] > new["fight_interval_max_s"]:
            raise GameError("The shortest wait between fights can't be longer than the longest wait.")
        self.config = new
        self._save_config()
        log.info("Admin updated settings")
