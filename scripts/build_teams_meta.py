#!/usr/bin/env python3
"""
MundoMotor — Constructor de metadatos y estadísticas históricas de escuderías/constructores
(F1 1950–presente desde Jolpica + MotoGP/500cc 1949–presente desde el archivo local).

Genera data/teams_meta.json (compacto, sin dependencias externas).
"""

from __future__ import annotations

import json
import re
import time
import unicodedata
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from build_drivers_info import F1_NAT_MAP
from update_data import iso_to_flag

ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = ROOT / "data"
RACES_DIR = DATA_DIR / "races"
OUT_PATH = DATA_DIR / "teams_meta.json"

USER_AGENT = "MundoMotor/1.0 (+https://github.com)"
TIMEOUT = 15

F1_EXTRA_WIKI: dict[str, tuple[str, str, str]] = {
    "audi": ("DE", "Alemania", "https://en.wikipedia.org/wiki/Audi_in_Formula_One"),
    "cadillac": ("US", "Estados Unidos", "https://en.wikipedia.org/wiki/Cadillac_Formula_1_Team"),
    "racing bulls": ("IT", "Italia", "https://en.wikipedia.org/wiki/Racing_Bulls"),
    "rb f1 team": ("IT", "Italia", "https://en.wikipedia.org/wiki/Racing_Bulls"),
    "red bull": ("AT", "Austria", "https://en.wikipedia.org/wiki/Red_Bull_Racing"),
    "aston martin": ("GB", "Reino Unido", "https://en.wikipedia.org/wiki/Aston_Martin_in_Formula_One"),
    "alpine f1 team": ("FR", "Francia", "https://en.wikipedia.org/wiki/Alpine_F1_Team"),
    "haas f1 team": ("US", "Estados Unidos", "https://en.wikipedia.org/wiki/Haas_F1_Team"),
    "mercedes": ("DE", "Alemania", "https://en.wikipedia.org/wiki/Mercedes-Benz_in_Formula_One"),
}

MOTO_BRAND_META: dict[str, tuple[str, str, str]] = {
    "ducati": ("IT", "Italia", "https://en.wikipedia.org/wiki/Ducati_Corse"),
    "aprilia": ("IT", "Italia", "https://en.wikipedia.org/wiki/Aprilia"),
    "yamaha": ("JP", "Japón", "https://en.wikipedia.org/wiki/Yamaha_Motor_Racing"),
    "honda": ("JP", "Japón", "https://en.wikipedia.org/wiki/Honda_Racing_Corporation"),
    "ktm": ("AT", "Austria", "https://en.wikipedia.org/wiki/Red_Bull_KTM_Factory_Racing"),
    "suzuki": ("JP", "Japón", "https://en.wikipedia.org/wiki/Team_Suzuki_MotoGP"),
    "gresini": ("IT", "Italia", "https://en.wikipedia.org/wiki/Gresini_Racing"),
    "vr46": ("IT", "Italia", "https://en.wikipedia.org/wiki/VR46_Racing_Team"),
    "pramac": ("IT", "Italia", "https://en.wikipedia.org/wiki/Pramac_Racing"),
    "tech3": ("FR", "Francia", "https://en.wikipedia.org/wiki/Tech3"),
    "lcr": ("MC", "Mónaco", "https://en.wikipedia.org/wiki/Team_LCR"),
    "trackhouse": ("US", "Estados Unidos", "https://en.wikipedia.org/wiki/Trackhouse_Racing"),
    "mv agusta": ("IT", "Italia", "https://en.wikipedia.org/wiki/MV_Agusta"),
    "gilera": ("IT", "Italia", "https://en.wikipedia.org/wiki/Gilera"),
    "norton": ("GB", "Reino Unido", "https://en.wikipedia.org/wiki/Norton_Motorcycle_Company"),
    "cagiva": ("IT", "Italia", "https://en.wikipedia.org/wiki/Cagiva"),
    "kawasaki": ("JP", "Japón", "https://en.wikipedia.org/wiki/Kawasaki_Racing_Team"),
    "derbi": ("ES", "España", "https://en.wikipedia.org/wiki/Derbi"),
    "bultaco": ("ES", "España", "https://en.wikipedia.org/wiki/Bultaco"),
    "kreidler": ("DE", "Alemania", "https://en.wikipedia.org/wiki/Kreidler"),
    "garelli": ("IT", "Italia", "https://en.wikipedia.org/wiki/Garelli_Motorcycles"),
    "minarelli": ("IT", "Italia", "https://en.wikipedia.org/wiki/Motori_Minarelli"),
    "morbidelli": ("IT", "Italia", "https://en.wikipedia.org/wiki/Morbidelli"),
    "moto guzzi": ("IT", "Italia", "https://en.wikipedia.org/wiki/Moto_Guzzi"),
    "benelli": ("IT", "Italia", "https://en.wikipedia.org/wiki/Benelli_(motorcycles)"),
    "ajs": ("GB", "Reino Unido", "https://en.wikipedia.org/wiki/AJS"),
    "matchless": ("GB", "Reino Unido", "https://en.wikipedia.org/wiki/Matchless"),
    "gasgas": ("ES", "España", "https://en.wikipedia.org/wiki/GasGas"),
}


def norm_text(s: str) -> str:
    nfd = unicodedata.normalize("NFD", str(s or ""))
    no_acc = "".join(ch for ch in nfd if unicodedata.category(ch) != "Mn")
    cleaned = re.sub(r"[^a-z0-9\s]", " ", no_acc.lower())
    return re.sub(r"\s+", " ", cleaned).strip()


def fetch_json(url: str) -> Any:
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, "Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
        return json.loads(resp.read().decode("utf-8", errors="replace"))


def extract_brand_keys(series: str, team_name: str) -> list[tuple[str, str]]:
    """Devuelve lista de (norm_key, display_name) para contabilizar equipo y marca madre en MotoGP."""
    clean = (team_name or "").strip()
    if not clean:
        return []
    out: list[tuple[str, str]] = []
    k_full = norm_text(clean)
    if k_full:
        out.append((k_full, clean))
    if series == "motogp":
        # Si es formato "Equipo (Marca)" extraer también la marca
        m = re.search(r"\(([^)]+)\)\s*$", clean)
        if m:
            brand = m.group(1).strip()
            kb = norm_text(brand)
            if kb and kb != k_full:
                out.append((kb, brand))
        else:
            for b_key in MOTO_BRAND_META:
                if b_key in k_full and b_key != k_full:
                    out.append((b_key, b_key.title() if b_key != "ktm" and b_key != "mv agusta" and b_key != "ajs" else b_key.upper()))
                    break
    return out


def aggregate_team_stats(series: str) -> dict[str, dict[str, Any]]:
    stats: dict[str, dict[str, Any]] = {}
    seen_gp: dict[str, set[str]] = {}

    def add_row(ev_key: str, year: int, team_raw: str, pos: int, finished: bool) -> None:
        for k, display in extract_brand_keys(series, team_raw):
            rec = stats.setdefault(
                k,
                {"n": display, "gps": 0, "w": 0, "pod": 0, "first": year, "last": year},
            )
            rec["n"] = display
            if year < rec["first"]:
                rec["first"] = year
            if year > rec["last"]:
                rec["last"] = year
            gp_set = seen_gp.setdefault(k, set())
            if ev_key not in gp_set:
                gp_set.add(ev_key)
                rec["gps"] += 1
            if finished and pos == 1:
                rec["w"] += 1
            if finished and 1 <= pos <= 3:
                rec["pod"] += 1

    series_dir = RACES_DIR / series
    if series_dir.exists():
        for fpath in sorted(series_dir.glob("*.json")):
            try:
                payload = json.loads(fpath.read_text(encoding="utf-8"))
                yr = int(payload.get("y") or 0)
                for rc in payload.get("r", []):
                    ev_key = f"{yr}-{rc.get('rn')}"
                    for r in rc.get("res", []):
                        add_row(ev_key, yr, r.get("t", ""), int(r.get("p") or 0), r.get("f", 1) != 0)
            except Exception:
                continue

    ms_path = DATA_DIR / "motorsport.json"
    if ms_path.exists():
        try:
            ms = json.loads(ms_path.read_text(encoding="utf-8"))
            s_obj = ms.get(series) or {}
            yr = int(s_obj.get("season") or 0)
            for ev in s_obj.get("events", []):
                ev_key = f"{yr}-{ev.get('round')}"
                for r in ev.get("results", []):
                    add_row(
                        ev_key,
                        yr,
                        r.get("team", ""),
                        int(r.get("position") or 0),
                        r.get("finished", True) is not False,
                    )
        except Exception:
            pass

    return stats


def build_f1_teams() -> dict[str, dict[str, Any]]:
    print("[Constructores F1] Descargando catálogo histórico desde Jolpica...", flush=True)
    out = aggregate_team_stats("f1")

    offset = 0
    limit = 100
    total: int | None = None
    while total is None or offset < total:
        time.sleep(0.32)
        page = fetch_json(f"https://api.jolpi.ca/ergast/f1/constructors.json?limit={limit}&offset={offset}")
        mr = page.get("MRData", {})
        total = int(mr.get("total") or 0)
        cons = mr.get("ConstructorTable", {}).get("Constructors", [])
        if not cons:
            break
        for c in cons:
            name = c.get("name", "").strip()
            k = norm_text(name)
            if not k:
                continue
            rec = out.setdefault(k, {"n": name, "gps": 0, "w": 0, "pod": 0, "first": 0, "last": 0})
            rec["n"] = name
            nat_en = c.get("nationality", "")
            iso, nat_es, co_es = F1_NAT_MAP.get(nat_en, ("", nat_en, nat_en))
            if iso:
                rec["iso"] = iso
                rec["fl"] = iso_to_flag(iso)
            if co_es:
                rec["co"] = co_es
            if nat_es:
                rec["nat"] = nat_es
            if c.get("url"):
                rec["wiki"] = c["url"]
        offset += limit

    # Garantizar Wikipedia/país para escuderías activas de 2026 (ej. Audi, Cadillac, Racing Bulls)
    for fk, (iso, co_es, wiki) in F1_EXTRA_WIKI.items():
        rec = out.setdefault(fk, {"n": fk.title(), "gps": 0, "w": 0, "pod": 0, "first": 2026, "last": 2026})
        rec.setdefault("iso", iso)
        rec.setdefault("fl", iso_to_flag(iso))
        rec.setdefault("co", co_es)
        rec.setdefault("wiki", wiki)

    print(f"  ✓ Constructores F1: {len(out)}", flush=True)
    return out


def build_motogp_teams() -> dict[str, dict[str, Any]]:
    out = aggregate_team_stats("motogp")
    for b_key, (iso, co_es, wiki) in MOTO_BRAND_META.items():
        rec = out.setdefault(b_key, {"n": b_key.title(), "gps": 0, "w": 0, "pod": 0, "first": 0, "last": 0})
        rec.setdefault("iso", iso)
        rec.setdefault("fl", iso_to_flag(iso))
        rec.setdefault("co", co_es)
        rec.setdefault("wiki", wiki)
    for k, rec in out.items():
        for b_key, (iso, co_es, wiki) in MOTO_BRAND_META.items():
            if k == b_key or b_key in k:
                rec.setdefault("iso", iso)
                rec.setdefault("fl", iso_to_flag(iso))
                rec.setdefault("co", co_es)
                rec.setdefault("wiki", wiki)
                break
    print(f"  ✓ Equipos/Marcas MotoGP: {len(out)}", flush=True)
    return out


def main() -> int:
    f1_teams = build_f1_teams()
    mgp_teams = build_motogp_teams()
    payload = {
        "updatedAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "f1": f1_teams,
        "motogp": mgp_teams,
    }
    OUT_PATH.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    sz = OUT_PATH.stat().st_size / 1024
    print(f"Guardado {OUT_PATH.name}: {len(f1_teams)} F1 + {len(mgp_teams)} MotoGP ({sz:.1f} KB)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
