#!/usr/bin/env python3
"""
MundoMotor — Constructor de fichas biográficas y estadísticas de pilotos
(F1 1950–presente y Motociclismo 1949–presente).

Genera data/drivers_info.json (compacto, sin dependencias externas).
"""

from __future__ import annotations

import concurrent.futures
import json
import re
import sys
import time
import unicodedata
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from build_history import canon_rider_name
from build_race_history import HIST_COUNTRY_ES
from update_data import iso_to_flag

ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = ROOT / "data"
RACES_DIR = DATA_DIR / "races"
OUT_PATH = DATA_DIR / "drivers_info.json"

USER_AGENT = "MundoMotor/1.0 (+https://github.com)"
TIMEOUT = 15

# Mapa completo de nacionalidades de Jolpica F1 -> (ISO, gentilicio ES, país ES)
F1_NAT_MAP: dict[str, tuple[str, str, str]] = {
    "American": ("US", "Estadounidense", "Estados Unidos"),
    "American-Italian": ("US", "Estadounidense", "Estados Unidos"),
    "Argentine": ("AR", "Argentino", "Argentina"),
    "Argentine-Italian": ("AR", "Argentino", "Argentina"),
    "Australian": ("AU", "Australiano", "Australia"),
    "Austrian": ("AT", "Austriaco", "Austria"),
    "Belgian": ("BE", "Belga", "Bélgica"),
    "Brazilian": ("BR", "Brasileño", "Brasil"),
    "British": ("GB", "Británico", "Reino Unido"),
    "Canadian": ("CA", "Canadiense", "Canadá"),
    "Chilean": ("CL", "Chileno", "Chile"),
    "Chinese": ("CN", "Chino", "China"),
    "Colombian": ("CO", "Colombiano", "Colombia"),
    "Czech": ("CZ", "Checo", "República Checa"),
    "Danish": ("DK", "Danés", "Dinamarca"),
    "Dutch": ("NL", "Neerlandés", "Países Bajos"),
    "East German": ("DE", "Alemán", "Alemania"),
    "Finnish": ("FI", "Finlandés", "Finlandia"),
    "French": ("FR", "Francés", "Francia"),
    "German": ("DE", "Alemán", "Alemania"),
    "Hungarian": ("HU", "Húngaro", "Hungría"),
    "Indian": ("IN", "Indio", "India"),
    "Indonesian": ("ID", "Indonesio", "Indonesia"),
    "Irish": ("IE", "Irlandés", "Irlanda"),
    "Italian": ("IT", "Italiano", "Italia"),
    "Japanese": ("JP", "Japonés", "Japón"),
    "Liechtensteiner": ("LI", "Liechtensteiniano", "Liechtenstein"),
    "Malaysian": ("MY", "Malasio", "Malasia"),
    "Mexican": ("MX", "Mexicano", "México"),
    "Monegasque": ("MC", "Monegasco", "Mónaco"),
    "New Zealander": ("NZ", "Neozelandés", "Nueva Zelanda"),
    "Polish": ("PL", "Polaco", "Polonia"),
    "Portuguese": ("PT", "Portugués", "Portugal"),
    "Rhodesian": ("ZW", "Rodesiano", "Zimbabue / Rodesia"),
    "Russian": ("RU", "Ruso", "Rusia"),
    "South African": ("ZA", "Sudafricano", "Sudáfrica"),
    "Spanish": ("ES", "Español", "España"),
    "Swedish": ("SE", "Sueco", "Suecia"),
    "Swiss": ("CH", "Suizo", "Suiza"),
    "Thai": ("TH", "Tailandés", "Tailandia"),
    "Uruguayan": ("UY", "Uruguayo", "Uruguay"),
    "Venezuelan": ("VE", "Venezolano", "Venezuela"),
}

EXTRA_COUNTRY_ES: dict[str, str] = {
    **HIST_COUNTRY_ES,
    "GB": "Reino Unido",
    "IE": "Irlanda",
    "DK": "Dinamarca",
    "NO": "Noruega",
    "BE": "Bélgica",
    "PT": "Portugal",
    "AT": "Austria",
    "HU": "Hungría",
    "SK": "Eslovaquia",
    "SI": "Eslovenia",
    "RO": "Rumanía",
    "BG": "Bulgaria",
    "GR": "Grecia",
    "UA": "Ucrania",
    "EE": "Estonia",
    "LV": "Letonia",
    "LT": "Lituania",
    "IL": "Israel",
    "CO": "Colombia",
    "CL": "Chile",
    "UY": "Uruguay",
    "PE": "Perú",
    "EC": "Ecuador",
    "CR": "Costa Rica",
    "PA": "Panamá",
    "TW": "Taiwán",
    "HK": "Hong Kong",
    "SG": "Singapur",
    "PH": "Filipinas",
    "VN": "Vietnam",
    "KZ": "Kazajistán",
    "LI": "Liechtenstein",
    "AD": "Andorra",
    "SM": "San Marino",
    "MC": "Mónaco",
    "MX": "México",
    "CA": "Canadá",
    "AU": "Australia",
    "NZ": "Nueva Zelanda",
    "JP": "Japón",
    "CN": "China",
    "KR": "Corea del Sur",
    "TH": "Tailandia",
    "MY": "Malasia",
    "ID": "Indonesia",
    "IN": "India",
    "QA": "Catar",
    "AE": "Emiratos Árabes",
    "SA": "Arabia Saudí",
    "BH": "Baréin",
    "TR": "Turquía",
    "ZA": "Sudáfrica",
    "ZW": "Zimbabue",
    "NA": "Namibia",
    "KE": "Kenia",
    "MA": "Marruecos",
}


def norm_text(s: str) -> str:
    nfd = unicodedata.normalize("NFD", str(s or ""))
    no_acc = "".join(ch for ch in nfd if unicodedata.category(ch) != "Mn")
    cleaned = re.sub(r"[^a-z0-9\s]", " ", no_acc.lower())
    return re.sub(r"\s+", " ", cleaned).strip()


def fetch_json(url: str, retries: int = 4) -> Any:
    last_err: Exception | None = None
    for attempt in range(retries):
        try:
            req = urllib.request.Request(
                url,
                headers={"User-Agent": USER_AGENT, "Accept": "application/json"},
            )
            with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
                return json.loads(resp.read().decode("utf-8", errors="replace"))
        except urllib.error.HTTPError as exc:
            last_err = exc
            if exc.code == 429:
                time.sleep(2.0 * (attempt + 1))
                continue
            if exc.code >= 500:
                time.sleep(1.2 * (attempt + 1))
                continue
            raise
        except Exception as exc:
            last_err = exc
            time.sleep(0.8 * (attempt + 1))
    if last_err:
        raise last_err
    raise RuntimeError(f"Error al leer {url}")


def compute_local_race_stats(series: str) -> dict[str, dict[str, int]]:
    """Calcula GPs disputados, victorias y podios desde data/races/ y data/motorsport.json."""
    stats: dict[str, dict[str, int]] = {}
    seen_event_driver: set[tuple[str, str]] = set()

    def add_row(ev_key: str, raw_name: str, pos: int, finished: bool) -> None:
        name = canon_rider_name(raw_name) if series == "motogp" else (raw_name or "").strip()
        k = norm_text(name)
        if not k or (ev_key, k) in seen_event_driver:
            return
        seen_event_driver.add((ev_key, k))
        rec = stats.setdefault(k, {"gps": 0, "w": 0, "pod": 0})
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
                yr = payload.get("y")
                for rc in payload.get("r", []):
                    ev_key = f"{yr}-{rc.get('rn')}"
                    for r in rc.get("res", []):
                        add_row(ev_key, r.get("d", ""), int(r.get("p") or 0), r.get("f", 1) != 0)
            except Exception:
                continue

    ms_path = DATA_DIR / "motorsport.json"
    if ms_path.exists():
        try:
            ms = json.loads(ms_path.read_text(encoding="utf-8"))
            s_obj = ms.get(series) or {}
            yr = s_obj.get("season")
            for ev in s_obj.get("events", []):
                ev_key = f"{yr}-{ev.get('round')}"
                for r in ev.get("results", []):
                    add_row(
                        ev_key,
                        r.get("driver", ""),
                        int(r.get("position") or 0),
                        r.get("finished", True) is not False,
                    )
        except Exception:
            pass

    return stats


def build_f1_drivers() -> dict[str, dict[str, Any]]:
    print("[Pilotos F1] Descargando listado completo desde Jolpica...", flush=True)
    out: dict[str, dict[str, Any]] = {}
    offset = 0
    limit = 100
    total: int | None = None

    while total is None or offset < total:
        time.sleep(0.32)
        page = fetch_json(f"https://api.jolpi.ca/ergast/f1/drivers.json?limit={limit}&offset={offset}")
        mr = page.get("MRData", {})
        total = int(mr.get("total") or 0)
        drivers = mr.get("DriverTable", {}).get("Drivers", [])
        if not drivers:
            break
        for d in drivers:
            full_name = f"{d.get('givenName', '')} {d.get('familyName', '')}".strip()
            k = norm_text(full_name)
            if not k:
                continue
            nat_en = d.get("nationality", "")
            iso, nat_es, co_es = F1_NAT_MAP.get(nat_en, ("", nat_en, nat_en))
            rec: dict[str, Any] = {}
            if iso:
                rec["iso"] = iso
                rec["fl"] = iso_to_flag(iso)
            if co_es:
                rec["co"] = co_es
            if nat_es:
                rec["nat"] = nat_es
            if d.get("dateOfBirth"):
                rec["dob"] = d["dateOfBirth"]
            if d.get("permanentNumber"):
                rec["no"] = str(d["permanentNumber"])
            if d.get("code"):
                rec["code"] = d["code"]
            if d.get("url"):
                rec["wiki"] = d["url"]
            out[k] = rec
        offset += limit

    # Fusionar estadísticas de carrera calculadas localmente
    stats = compute_local_race_stats("f1")
    for k, st in stats.items():
        rec = out.setdefault(k, {})
        rec["gps"] = st["gps"]
        rec["w"] = st["w"]
        rec["pod"] = st["pod"]

    print(f"  ✓ F1: {len(out)} fichas de pilotos con nacionalidad y estadísticas", flush=True)
    return out


def build_motogp_drivers() -> dict[str, dict[str, Any]]:
    print("[Pilotos Motociclismo] Recopilando nacionalidades 1949–2026 desde Pulselive...", flush=True)
    seasons = fetch_json("https://api.motogp.pulselive.com/motogp/v1/results/seasons")
    valid_seasons = [s for s in seasons if 1949 <= int(s["year"]) <= datetime.now(timezone.utc).year]

    out: dict[str, dict[str, Any]] = {}
    uuid_by_key: dict[str, str] = {}
    priority_keys: set[str] = set()

    allowed_cats = {"motogp", "500cc", "350cc", "moto2", "250cc", "moto3", "125cc", "80cc", "50cc"}

    def fetch_season_riders(s: dict[str, Any]) -> list[tuple[str, str, str, str, bool]]:
        yr = int(s["year"])
        sid = s["id"]
        rows_out: list[tuple[str, str, str, str, bool]] = []
        try:
            cats = fetch_json(
                f"https://api.motogp.pulselive.com/motogp/v1/results/categories?seasonUuid={sid}",
                retries=3,
            )
            for c in cats:
                cname = (c.get("name") or "").replace("™", "").strip().lower()
                if cname not in allowed_cats:
                    continue
                is_premier = cname in ("motogp", "500cc")
                st = fetch_json(
                    f"https://api.motogp.pulselive.com/motogp/v1/results/standings?seasonUuid={sid}&categoryUuid={c['id']}",
                    retries=3,
                )
                for row in st.get("classification") or []:
                    rider = row.get("rider") or {}
                    name = canon_rider_name(rider.get("full_name") or "")
                    k = norm_text(name)
                    if not k:
                        continue
                    country = rider.get("country") or {}
                    iso = (country.get("iso") or "").upper()
                    co_en = country.get("name") or ""
                    ruuid = rider.get("riders_api_uuid") or rider.get("riders_id") or ""
                    pos = int(row.get("position") or 99)
                    is_priority = is_premier or pos <= 3 or yr >= 2025
                    rows_out.append((k, iso, co_en, ruuid, is_priority))
        except Exception:
            pass
        return rows_out

    with concurrent.futures.ThreadPoolExecutor(max_workers=10) as pool:
        for batch in pool.map(fetch_season_riders, valid_seasons):
            for k, iso, co_en, ruuid, is_prio in batch:
                rec = out.setdefault(k, {})
                if iso and "iso" not in rec:
                    rec["iso"] = iso
                    rec["fl"] = iso_to_flag(iso)
                    rec["co"] = EXTRA_COUNTRY_ES.get(iso, co_en)
                if ruuid and k not in uuid_by_key:
                    uuid_by_key[k] = ruuid
                if is_prio:
                    priority_keys.add(k)

    # Enriquecer pilotos prioritarios (categoría reina, campeones, podios de todas las cilindradas y parrilla actual)
    detail_targets = [(k, uuid_by_key[k]) for k in priority_keys if k in uuid_by_key]
    print(
        f"  ✓ Nacionalidades base: {len(out)} pilotos. Enriqueciendo {len(detail_targets)} perfiles (bio, ciudad, MotoGP Legends)...",
        flush=True,
    )

    def fetch_rider_detail(item: tuple[str, str]) -> tuple[str, dict[str, Any] | None]:
        k, ruuid = item
        try:
            d = fetch_json(f"https://api.motogp.pulselive.com/motogp/v1/riders/{ruuid}", retries=2)
            if not isinstance(d, dict):
                return k, None
            extra: dict[str, Any] = {}
            c_obj = d.get("country") or {}
            iso = (c_obj.get("iso") or "").upper()
            if iso:
                extra["iso"] = iso
                extra["fl"] = iso_to_flag(iso)
                extra["co"] = EXTRA_COUNTRY_ES.get(iso, c_obj.get("name") or "")
            if d.get("birth_date"):
                extra["dob"] = str(d["birth_date"])[:10]
            if d.get("birth_city"):
                extra["city"] = str(d["birth_city"]).strip()
            if d.get("legend"):
                extra["leg"] = 1
            if d.get("retired"):
                extra["ret"] = 1
                if d.get("retired_year"):
                    extra["ry"] = int(d["retired_year"])
            if d.get("nickname"):
                extra["nick"] = str(d["nickname"]).strip()
            phys = d.get("physical_attributes") or {}
            if phys.get("height"):
                extra["h"] = int(phys["height"])
            if phys.get("weight"):
                extra["wt"] = int(phys["weight"])
            # Foto oficial del piloto (prioridad: perfil más reciente -> retrato -> foto Legend)
            pic_url = None
            for c_row in d.get("career") or []:
                pics = (c_row or {}).get("pictures") or {}
                prof_main = (pics.get("profile") or {}).get("main")
                portrait = pics.get("portrait")
                if prof_main:
                    pic_url = prof_main
                    break
                if portrait:
                    pic_url = portrait
                    break
            if not pic_url and d.get("legend_picture"):
                pic_url = d["legend_picture"]
            if pic_url:
                extra["pic"] = str(pic_url).strip()
            return k, extra
        except Exception:
            return k, None

    enriched = 0
    with concurrent.futures.ThreadPoolExecutor(max_workers=16) as pool:
        for k, extra in pool.map(fetch_rider_detail, detail_targets):
            if extra:
                out.setdefault(k, {}).update(extra)
                enriched += 1

    # Fusionar estadísticas de categoría reina (MotoGP / 500cc) calculadas desde data/races/motogp/
    stats = compute_local_race_stats("motogp")
    for k, st in stats.items():
        rec = out.setdefault(k, {})
        rec["gps"] = st["gps"]
        rec["w"] = st["w"]
        rec["pod"] = st["pod"]

    print(
        f"  ✓ Motociclismo: {len(out)} pilotos ({enriched} perfiles ampliados con bio/ciudad/Legends)",
        flush=True,
    )
    return out


def main() -> int:
    f1_drivers = build_f1_drivers()
    mgp_drivers = build_motogp_drivers()
    payload = {
        "updatedAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "f1": f1_drivers,
        "motogp": mgp_drivers,
    }
    OUT_PATH.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    sz = OUT_PATH.stat().st_size / 1024
    print(f"Guardado {OUT_PATH.name}: {len(f1_drivers)} F1 + {len(mgp_drivers)} MotoGP ({sz:.1f} KB)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
