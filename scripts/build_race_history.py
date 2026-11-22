#!/usr/bin/env python3
"""
MundoMotor — Constructor del archivo histórico de carreras y clasificaciones completas
(F1 1950–presente y MotoGP/500cc 1949–presente).

Guarda un archivo JSON compacto por temporada en:
  data/races/f1/<año>.json
  data/races/motogp/<año>.json

Es 100 % incremental y reanudable: solo descarga las temporadas que aún no existan.
Usa únicamente la librería estándar de Python 3 (cero dependencias externas).
"""

from __future__ import annotations

import argparse
import concurrent.futures
import json
import re
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from update_data import (
    COUNTRY_ES,
    COUNTRY_TO_ISO,
    F1_GP_ES,
    MOTOGP_PLACE_ES,
    iso_to_flag,
    translate_f1_status,
)

ROOT = Path(__file__).resolve().parent.parent
RACES_DIR = ROOT / "data" / "races"
USER_AGENT = "MundoMotor/1.0 (+https://github.com)"
TIMEOUT = 18

# Ampliación de países, circuitos y GPs históricos (1949–2025)
HIST_COUNTRY_TO_ISO: dict[str, str] = {
    **COUNTRY_TO_ISO,
    "South Africa": "ZA",
    "Switzerland": "CH",
    "Morocco": "MA",
    "Sweden": "SE",
    "Finland": "FI",
    "Yugoslavia": "HR",
    "Croatia": "HR",
    "Czechoslovakia": "CZ",
    "Venezuela": "VE",
    "Luxembourg": "LU",
    "East Germany": "DE",
    "West Germany": "DE",
    "Korea": "KR",
    "South Korea": "KR",
    "Turkey": "TR",
    "Russia": "RU",
    "Isle of Man": "IM",
    "Northern Ireland": "GB",
    "Rhodesia": "ZW",
    "New Zealand": "NZ",
    "Poland": "PL",
    "Soviet Union": "RU",
}

HIST_COUNTRY_ES: dict[str, str] = {
    **COUNTRY_ES,
    "ZA": "Sudáfrica",
    "CH": "Suiza",
    "MA": "Marruecos",
    "SE": "Suecia",
    "FI": "Finlandia",
    "HR": "Yugoslavia / Croacia",
    "VE": "Venezuela",
    "LU": "Luxemburgo",
    "KR": "Corea del Sur",
    "TR": "Turquía",
    "RU": "Rusia",
    "IM": "Isla de Man",
    "ZW": "Rodesia",
    "NZ": "Nueva Zelanda",
    "PL": "Polonia",
}

HIST_F1_GP_ES: dict[str, str] = {
    **F1_GP_ES,
    "South African Grand Prix": "GP de Sudáfrica",
    "Swiss Grand Prix": "GP de Suiza",
    "Moroccan Grand Prix": "GP de Marruecos",
    "Swedish Grand Prix": "GP de Suecia",
    "Argentine Grand Prix": "GP de Argentina",
    "French Grand Prix": "GP de Francia",
    "German Grand Prix": "GP de Alemania",
    "Portuguese Grand Prix": "GP de Portugal",
    "San Marino Grand Prix": "GP de San Marino",
    "European Grand Prix": "GP de Europa",
    "Pacific Grand Prix": "GP del Pacífico",
    "Luxembourg Grand Prix": "GP de Luxemburgo",
    "Detroit Grand Prix": "GP de Detroit",
    "Dallas Grand Prix": "GP de Dallas",
    "Caesars Palace Grand Prix": "GP de Caesars Palace",
    "United States Grand Prix West": "GP de EE. UU. Oeste",
    "Pescara Grand Prix": "GP de Pescara",
    "Indianapolis 500": "500 Millas de Indianápolis",
    "Malaysian Grand Prix": "GP de Malasia",
    "Turkish Grand Prix": "GP de Turquía",
    "Korean Grand Prix": "GP de Corea",
    "Indian Grand Prix": "GP de la India",
    "Russian Grand Prix": "GP de Rusia",
    "Styrian Grand Prix": "GP de Estiria",
    "70th Anniversary Grand Prix": "GP del 70.º Aniversario",
    "Tuscan Grand Prix": "GP de la Toscana",
    "Eifel Grand Prix": "GP de Eifel",
    "Sakhir Grand Prix": "GP de Sakhir",
}

HIST_MOTOGP_PLACE_ES: dict[str, str] = {
    **MOTOGP_PLACE_ES,
    "SOUTH AFRICA": "Sudáfrica",
    "SOUTH AFRICAN": "Sudáfrica",
    "SWITZERLAND": "Suiza",
    "SWISS": "Suiza",
    "SWEDEN": "Suecia",
    "SWEDISH": "Suecia",
    "FINLAND": "Finlandia",
    "FINNISH": "Finlandia",
    "YUGOSLAVIA": "Yugoslavia",
    "YUGOSLAVIAN": "Yugoslavia",
    "CZECHOSLOVAKIA": "Checoslovaquia",
    "CZECHOSLOVAKIAN": "Checoslovaquia",
    "VENEZUELA": "Venezuela",
    "VENEZUELAN": "Venezuela",
    "BELGIUM": "Bélgica",
    "BELGIAN": "Bélgica",
    "DUTCH": "Países Bajos (Assen)",
    "NETHERLANDS": "Países Bajos",
    "NATIONS": "las Naciones (Italia)",
    "ITALIAN": "Italia",
    "FRENCH": "Francia",
    "SPANISH": "España",
    "GERMAN": "Alemania",
    "WEST GERMANY": "Alemania Occidental",
    "EAST GERMANY": "Alemania Oriental",
    "AUSTRIAN": "Austria",
    "BRITISH": "Gran Bretaña",
    "ULSTER": "Úlster",
    "TOURIST TROPHY": "Isla de Man (TT)",
    "ISLE OF MAN": "Isla de Man (TT)",
    "ARGENTINIAN": "Argentina",
    "BRAZILIAN": "Brasil",
    "RIO": "Río de Janeiro",
    "JAPANESE": "Japón",
    "PACIFIC": "el Pacífico",
    "AUSTRALIAN": "Australia",
    "MALAYSIAN": "Malasia",
    "INDONESIAN": "Indonesia",
    "PORTUGUESE": "Portugal",
    "CHINESE": "China",
    "TURKISH": "Turquía",
    "TURKEY": "Turquía",
    "UNITED STATES": "Estados Unidos",
    "US": "Estados Unidos",
    "INDIANAPOLIS": "Indianápolis",
    "IMOLA": "Imola",
    "MADRID": "Madrid",
    "ANDALUCIA": "Andalucía",
    "STYRIA": "Estiria",
    "TERUEL": "Teruel",
    "ALGARVE": "el Algarve",
    "DOHA": "Doha",
    "EUROPE": "Europa",
    "EUROPEAN": "Europa",
    "CANADA": "Canadá",
    "CANADIAN": "Canadá",
    "EXPO 92": "Expo 92 (Jerez)",
    "FIM": "la FIM",
    "BADEN-WUERTTEMBERG": "Baden-Wurtemberg",
}


class RateLimitExhausted(RuntimeError):
    """Se lanza cuando la API devuelve 429 persistente tras varios reintentos."""


def fetch_json(url: str, retries: int = 5, base_backoff: float = 2.0) -> Any:
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
                if attempt == retries - 1:
                    raise RateLimitExhausted(f"HTTP 429 persistente en {url}") from exc
                wait = base_backoff * (attempt + 1) * 1.5
                time.sleep(wait)
                continue
            if exc.code >= 500:
                time.sleep(1.5 * (attempt + 1))
                continue
            raise
        except Exception as exc:
            last_err = exc
            time.sleep(1.0 * (attempt + 1))
    if last_err:
        raise last_err
    raise RuntimeError(f"No se pudo leer {url}")


def translate_f1_gp_hist(name: str) -> str:
    if name in HIST_F1_GP_ES:
        return HIST_F1_GP_ES[name]
    cleaned = re.sub(r"\s*Grand Prix$", "", name, flags=re.IGNORECASE).strip()
    return f"GP de {cleaned}" if cleaned else name


def translate_motogp_gp_hist(name: str, country_iso: str) -> str:
    upper = (name or "").upper().strip()
    if "TOURIST TROPHY" in upper or "ISLE OF MAN" in upper:
        return "TT Isla de Man"
    if "ULSTER" in upper:
        return "GP del Úlster"
    if "DUTCH" in upper or "ASSEN" in upper:
        return "GP de los Países Bajos (Assen)"
    if "NATIONS" in upper:
        return "GP de las Naciones"
    m = re.search(r"GRAND PRIX OF\s+(.+)$", upper)
    if m:
        place = m.group(1).strip()
        if place in HIST_MOTOGP_PLACE_ES:
            return f"GP de {HIST_MOTOGP_PLACE_ES[place]}"
        return f"GP de {place.title()}"
    for key, val in HIST_MOTOGP_PLACE_ES.items():
        if key in upper:
            return f"GP de {val}"
    if country_iso in HIST_COUNTRY_ES:
        return f"GP de {HIST_COUNTRY_ES[country_iso]}"
    return name.title() if name else "Gran Premio"


def format_pts(val: float) -> int | float:
    return int(val) if float(val).is_integer() else round(float(val), 1)


def season_file(series: str, year: int) -> Path:
    d = RACES_DIR / series
    d.mkdir(parents=True, exist_ok=True)
    return d / f"{year}.json"


def save_season_races(series: str, year: int, races: list[dict[str, Any]]) -> Path:
    path = season_file(series, year)
    payload = {"y": year, "s": series, "r": races}
    path.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    return path


# ---------------------------------------------------------------------------
# 1. FÓRMULA 1 (Jolpica F1 API — 1950..presente)
# ---------------------------------------------------------------------------

def fetch_f1_season_races(year: int, pause: float = 0.35) -> list[dict[str, Any]]:
    races_map: dict[int, dict[str, Any]] = {}
    seen_round_driver: set[tuple[int, str]] = set()
    offset = 0
    limit = 100
    total: int | None = None

    while total is None or offset < total:
        time.sleep(pause)
        url = f"https://api.jolpi.ca/ergast/f1/{year}/results.json?limit={limit}&offset={offset}"
        page = fetch_json(url, retries=5, base_backoff=3.0)
        mr = page.get("MRData", {})
        if not mr:
            break
        total = int(mr.get("total") or 0)
        races_page = mr.get("RaceTable", {}).get("Races", [])
        if not races_page:
            break

        count_in_page = 0
        for race in races_page:
            rnd = int(race["round"])
            if rnd not in races_map:
                circuit = race.get("Circuit") or {}
                loc = circuit.get("Location") or {}
                country_en = loc.get("country", "")
                iso = HIST_COUNTRY_TO_ISO.get(country_en, "")
                country_es = HIST_COUNTRY_ES.get(iso, country_en)
                races_map[rnd] = {
                    "rn": rnd,
                    "n": translate_f1_gp_hist(race.get("raceName", "")),
                    "c": circuit.get("circuitName", ""),
                    "co": country_es,
                    "fl": iso_to_flag(iso),
                    "d": race.get("date", ""),
                    "res": [],
                }

            for r0 in race.get("Results", []):
                count_in_page += 1
                drv = r0.get("Driver") or {}
                con = r0.get("Constructor") or {}
                driver_name = f"{drv.get('givenName', '')} {drv.get('familyName', '')}".strip()
                dedup_key = (rnd, driver_name)
                if dedup_key in seen_round_driver:
                    continue
                seen_round_driver.add(dedup_key)

                pos_num = int(r0.get("position") or 0)
                pos_text = str(r0.get("positionText") or pos_num)
                raw_status = str(r0.get("status") or "")
                status_es = translate_f1_status(raw_status)
                time_obj = r0.get("Time") or {}
                finished = pos_text.isdigit()
                time_str = time_obj.get("time") or status_es if finished else status_es
                pts_val = float(r0.get("points") or 0)
                num_str = str(r0.get("number") or drv.get("permanentNumber") or "")
                grid_num = int(r0.get("grid") or 0)
                fl_obj = r0.get("FastestLap") or {}
                is_fl = str(fl_obj.get("rank") or "") == "1"
                fl_time = (fl_obj.get("Time") or {}).get("time", "")
                fl_speed = (fl_obj.get("AverageSpeed") or {}).get("speed", "")

                entry: dict[str, Any] = {
                    "p": pos_num,
                    "pt": pos_text,
                    "d": driver_name,
                    "t": con.get("name", ""),
                    "tm": time_str,
                    "st": status_es,
                    "f": 1 if finished else 0,
                }
                if num_str:
                    entry["no"] = num_str
                if grid_num > 0:
                    entry["g"] = grid_num
                if is_fl:
                    entry["fl"] = 1
                    if fl_time:
                        entry["flt"] = fl_time
                    if fl_speed:
                        entry["fls"] = fl_speed
                if pts_val > 0:
                    entry["pts"] = format_pts(pts_val)
                races_map[rnd]["res"].append(entry)

        if count_in_page == 0:
            break
        offset += limit

    # Carreras Sprint de F1 (disponibles en Jolpica desde 2021)
    if year >= 2021 and races_map:
        s_offset = 0
        s_total: int | None = None
        seen_spr: set[tuple[int, str]] = set()
        while s_total is None or s_offset < s_total:
            time.sleep(pause)
            s_url = f"https://api.jolpi.ca/ergast/f1/{year}/sprint.json?limit={limit}&offset={s_offset}"
            try:
                s_page = fetch_json(s_url, retries=4, base_backoff=3.0)
            except RateLimitExhausted:
                raise
            except Exception:
                break
            s_mr = s_page.get("MRData", {})
            if not s_mr:
                break
            s_total = int(s_mr.get("total") or 0)
            s_races = s_mr.get("RaceTable", {}).get("Races", [])
            if not s_races:
                break
            s_count = 0
            for race in s_races:
                rnd = int(race["round"])
                if rnd not in races_map:
                    continue
                for r0 in race.get("SprintResults", []):
                    s_count += 1
                    drv = r0.get("Driver") or {}
                    con = r0.get("Constructor") or {}
                    driver_name = f"{drv.get('givenName', '')} {drv.get('familyName', '')}".strip()
                    if (rnd, driver_name) in seen_spr:
                        continue
                    seen_spr.add((rnd, driver_name))
                    pos_num = int(r0.get("position") or 0)
                    pos_text = str(r0.get("positionText") or pos_num)
                    raw_status = str(r0.get("status") or "")
                    status_es = translate_f1_status(raw_status)
                    time_obj = r0.get("Time") or {}
                    finished = pos_text.isdigit()
                    pts_val = float(r0.get("points") or 0)
                    num_str = str(r0.get("number") or drv.get("permanentNumber") or "")
                    grid_num = int(r0.get("grid") or 0)
                    s_entry: dict[str, Any] = {
                        "p": pos_num,
                        "pt": pos_text,
                        "d": driver_name,
                        "t": con.get("name", ""),
                        "tm": time_obj.get("time") or status_es if finished else status_es,
                        "st": status_es,
                        "f": 1 if finished else 0,
                    }
                    if num_str:
                        s_entry["no"] = num_str
                    if grid_num > 0:
                        s_entry["g"] = grid_num
                    if pts_val > 0:
                        s_entry["pts"] = format_pts(pts_val)
                    races_map[rnd].setdefault("spr", []).append(s_entry)
            if s_count == 0:
                break
            s_offset += limit

    ordered = [races_map[k] for k in sorted(races_map)]
    for rc in ordered:
        rc["res"].sort(key=lambda x: (x["p"] if x["p"] > 0 else 999))
        if rc.get("spr"):
            rc["spr"].sort(key=lambda x: (x["p"] if x["p"] > 0 else 999))
    return ordered


# ---------------------------------------------------------------------------
# 2. MOTOGP / 500cc (API Pulselive — 1949..presente)
# ---------------------------------------------------------------------------

def _fetch_motogp_single_event(ev: dict[str, Any], cat_id: str, round_num: int) -> dict[str, Any]:
    eid = ev["id"]
    country_obj = ev.get("country") or {}
    iso = (country_obj.get("iso") or "").upper()
    country_es = HIST_COUNTRY_ES.get(iso, country_obj.get("name", ""))
    circuit_obj = ev.get("circuit") or {}

    results: list[dict[str, Any]] = []
    try:
        sessions = fetch_json(
            f"https://api.motogp.pulselive.com/motogp/v1/results/sessions?eventUuid={eid}&categoryUuid={cat_id}",
            retries=3,
            base_backoff=1.0,
        )
        rac = next((s for s in sessions if (s.get("type") or "").upper() == "RAC"), None)
        if rac:
            cl_raw = fetch_json(
                f"https://api.motogp.pulselive.com/motogp/v1/results/session/{rac['id']}/classification?test=false",
                retries=3,
                base_backoff=1.0,
            )
            st_map = {
                "DNF": "Abandono",
                "RT": "Abandono",
                "NC": "No clasificado",
                "DSQ": "Descalificado",
                "DNS": "No salió",
            }
            for row in cl_raw.get("classification", []):
                rider = row.get("rider") or {}
                con = row.get("constructor") or {}
                team = row.get("team") or {}
                raw_pos = row.get("position")
                pos_num = int(raw_pos) if raw_pos is not None else 0
                raw_st = str(row.get("status") or "").upper()

                gap_obj = row.get("gap")
                time_str = ""
                if pos_num == 1 and row.get("time"):
                    time_str = str(row.get("time"))
                elif isinstance(gap_obj, dict):
                    first_gap = gap_obj.get("first")
                    lap_gap = gap_obj.get("lap")
                    if first_gap:
                        fg = str(first_gap)
                        time_str = fg if fg.startswith("+") else f"+{fg}"
                    elif lap_gap:
                        n_laps = int(lap_gap)
                        time_str = f"+{n_laps} {'vuelta' if n_laps == 1 else 'vueltas'}"
                elif isinstance(gap_obj, str) and gap_obj:
                    time_str = gap_obj if gap_obj.startswith("+") else f"+{gap_obj}"

                if pos_num == 0 or raw_st in st_map:
                    status_es = st_map.get(raw_st, "Abandono")
                    time_str = status_es
                    pos_text = raw_st if raw_st in st_map else "NC"
                    finished = False
                else:
                    status_es = "Meta"
                    pos_text = str(pos_num)
                    finished = True

                team_name = (team.get("name") or "").strip()
                con_name = (con.get("name") or "").strip()
                if team_name and con_name and con_name.lower() not in team_name.lower():
                    full_team = f"{team_name} ({con_name})"
                else:
                    full_team = team_name or con_name

                pts_val = float(row.get("points") or 0)
                num_str = str(rider.get("number") or "")
                entry: dict[str, Any] = {
                    "p": pos_num,
                    "pt": pos_text,
                    "d": (rider.get("full_name") or "").strip(),
                    "t": full_team,
                    "tm": time_str or status_es,
                    "st": status_es,
                    "f": 1 if finished else 0,
                }
                if num_str:
                    entry["no"] = num_str
                if pts_val > 0:
                    entry["pts"] = format_pts(pts_val)
                results.append(entry)
    except Exception as exc:
        print(f"[Carreras MotoGP] Aviso en {ev.get('name')}: {exc}", file=sys.stderr)

    return {
        "rn": round_num,
        "n": translate_motogp_gp_hist(ev.get("name", ""), iso),
        "c": circuit_obj.get("name", ""),
        "co": country_es,
        "fl": iso_to_flag(iso),
        "d": (ev.get("date_end") or ev.get("date_start") or "")[:10],
        "res": results,
    }


def fetch_motogp_season_races(season_uuid: str, max_workers: int = 8) -> list[dict[str, Any]]:
    cats = fetch_json(
        f"https://api.motogp.pulselive.com/motogp/v1/results/categories?seasonUuid={season_uuid}"
    )
    if not cats:
        return []
    premier = next(
        (c for c in cats if "MotoGP" in c.get("name", "") or "500" in c.get("name", "")),
        cats[0],
    )
    cat_id = premier["id"]
    events_raw = fetch_json(
        f"https://api.motogp.pulselive.com/motogp/v1/results/events?seasonUuid={season_uuid}"
    )
    gps_raw = [e for e in events_raw if not e.get("test")]
    gps_raw.sort(key=lambda e: e.get("date_start") or "")

    races: list[dict[str, Any]] = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=max_workers) as pool:
        futs = [
            pool.submit(_fetch_motogp_single_event, ev, cat_id, idx + 1)
            for idx, ev in enumerate(gps_raw)
        ]
        for fut in concurrent.futures.as_completed(futs):
            races.append(fut.result())
    races.sort(key=lambda r: r["rn"])
    return races


# ---------------------------------------------------------------------------
# SINCRONIZADOR INCREMENTAL
# ---------------------------------------------------------------------------

def sync_race_history(
    series: str = "all",
    min_year: int = 1949,
    max_year: int | None = None,
    max_new_years: int | None = None,
    force: bool = False,
    verbose: bool = True,
) -> dict[str, int]:
    now_year = datetime.now(timezone.utc).year
    target_max = max_year if max_year is not None else (now_year - 1)
    saved_counts = {"f1": 0, "motogp": 0}

    # 1. MotoGP / 500cc (1949..target_max)
    if series in ("all", "motogp"):
        try:
            seasons_mgp = fetch_json("https://api.motogp.pulselive.com/motogp/v1/results/seasons")
            missing_mgp = [
                s
                for s in seasons_mgp
                if max(1949, min_year) <= int(s["year"]) <= target_max
                and (force or not season_file("motogp", int(s["year"])).exists())
            ]
            missing_mgp.sort(key=lambda s: int(s["year"]), reverse=True)
            if max_new_years is not None:
                missing_mgp = missing_mgp[:max_new_years]

            if missing_mgp and verbose:
                print(f"[Carreras MotoGP] Descargando {len(missing_mgp)} temporadas...", flush=True)

            for idx, s in enumerate(missing_mgp, start=1):
                yr = int(s["year"])
                try:
                    races = fetch_motogp_season_races(s["id"])
                    if races:
                        save_season_races("motogp", yr, races)
                        saved_counts["motogp"] += 1
                except Exception as exc:
                    print(f"[Carreras MotoGP] Error en {yr}: {exc}", file=sys.stderr)
                if verbose and (idx % 10 == 0 or idx == len(missing_mgp)):
                    print(f"  MotoGP: {idx}/{len(missing_mgp)} (último: {yr})", flush=True)
        except Exception as exc:
            print(f"[Carreras MotoGP] Aviso general: {exc}", file=sys.stderr)

    # 2. Fórmula 1 (1950..target_max)
    if series in ("all", "f1"):
        start_f1 = max(1950, min_year)
        missing_f1 = [
            yr
            for yr in range(target_max, start_f1 - 1, -1)
            if force or not season_file("f1", yr).exists()
        ]
        if max_new_years is not None:
            missing_f1 = missing_f1[:max_new_years]

        if missing_f1 and verbose:
            print(f"[Carreras F1] Descargando {len(missing_f1)} temporadas (con pausa suave para Jolpica)...", flush=True)

        for idx, yr in enumerate(missing_f1, start=1):
            try:
                races = fetch_f1_season_races(yr)
                if races:
                    save_season_races("f1", yr, races)
                    saved_counts["f1"] += 1
            except RateLimitExhausted as exc:
                print(
                    f"[Carreras F1] Límite horario de Jolpica alcanzado en {yr}: {exc}. "
                    "Vuelve a ejecutar el script más tarde para continuar donde se quedó.",
                    file=sys.stderr,
                )
                break
            except Exception as exc:
                print(f"[Carreras F1] Error en {yr}: {exc}", file=sys.stderr)
            if verbose and (idx % 10 == 0 or idx == len(missing_f1)):
                print(f"  F1: {idx}/{len(missing_f1)} (último: {yr})", flush=True)

    return saved_counts


def main() -> int:
    parser = argparse.ArgumentParser(description="Descarga el histórico de carreras de F1 y MotoGP/500cc")
    parser.add_argument("--series", choices=("all", "f1", "motogp"), default="all")
    parser.add_argument("--min-year", type=int, default=1949)
    parser.add_argument("--max-year", type=int, default=None)
    parser.add_argument("--force", action="store_true", help="Re-descargar temporadas ya existentes")
    args = parser.parse_args()

    counts = sync_race_history(
        series=args.series,
        min_year=args.min_year,
        max_year=args.max_year,
        force=args.force,
        verbose=True,
    )
    f1_total = len(list((RACES_DIR / "f1").glob("*.json"))) if (RACES_DIR / "f1").exists() else 0
    mgp_total = len(list((RACES_DIR / "motogp").glob("*.json"))) if (RACES_DIR / "motogp").exists() else 0
    print(
        f"Archivo de carreras actualizado: +{counts['f1']} F1 (total {f1_total}), "
        f"+{counts['motogp']} MotoGP (total {mgp_total})"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
