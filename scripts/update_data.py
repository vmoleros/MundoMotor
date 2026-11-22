#!/usr/bin/env python3
"""
MundoMotor — Actualizador de datos gratuito (F1 + MotoGP + Noticias RSS en español).
Usa únicamente la librería estándar de Python 3 (cero dependencias externas).
"""

from __future__ import annotations

import concurrent.futures
import email.utils
import html
import json
import re
import sys
import time
import urllib.error
import urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = ROOT / "data"
DATA_DIR.mkdir(parents=True, exist_ok=True)

USER_AGENT = "MundoMotor/1.0 (+https://github.com)"
TIMEOUT = 15

# Mapeo de nombres de países / GPs al español para una experiencia 100% en castellano
COUNTRY_TO_ISO: dict[str, str] = {
    "Australia": "AU",
    "China": "CN",
    "Japan": "JP",
    "Bahrain": "BH",
    "Saudi Arabia": "SA",
    "USA": "US",
    "United States": "US",
    "Italy": "IT",
    "Monaco": "MC",
    "Spain": "ES",
    "Canada": "CA",
    "Austria": "AT",
    "UK": "GB",
    "United Kingdom": "GB",
    "Great Britain": "GB",
    "Belgium": "BE",
    "Hungary": "HU",
    "Netherlands": "NL",
    "Azerbaijan": "AZ",
    "Singapore": "SG",
    "Mexico": "MX",
    "Brazil": "BR",
    "Qatar": "QA",
    "UAE": "AE",
    "United Arab Emirates": "AE",
    "Abu Dhabi": "AE",
    "Thailand": "TH",
    "Argentina": "AR",
    "France": "FR",
    "Germany": "DE",
    "Czech Republic": "CZ",
    "Czechia": "CZ",
    "San Marino": "SM",
    "Indonesia": "ID",
    "Malaysia": "MY",
    "Portugal": "PT",
    "Kazakhstan": "KZ",
    "India": "IN",
}

COUNTRY_ES: dict[str, str] = {
    "AU": "Australia",
    "CN": "China",
    "JP": "Japón",
    "BH": "Baréin",
    "SA": "Arabia Saudí",
    "US": "Estados Unidos",
    "IT": "Italia",
    "MC": "Mónaco",
    "ES": "España",
    "CA": "Canadá",
    "AT": "Austria",
    "GB": "Reino Unido",
    "BE": "Bélgica",
    "HU": "Hungría",
    "NL": "Países Bajos",
    "AZ": "Azerbaiyán",
    "SG": "Singapur",
    "MX": "México",
    "BR": "Brasil",
    "QA": "Catar",
    "AE": "Emiratos Árabes",
    "TH": "Tailandia",
    "AR": "Argentina",
    "FR": "Francia",
    "DE": "Alemania",
    "CZ": "República Checa",
    "SM": "San Marino",
    "ID": "Indonesia",
    "MY": "Malasia",
    "PT": "Portugal",
    "IN": "India",
    "NL": "Países Bajos",
}

F1_GP_ES: dict[str, str] = {
    "Australian Grand Prix": "GP de Australia",
    "Chinese Grand Prix": "GP de China",
    "Japanese Grand Prix": "GP de Japón",
    "Bahrain Grand Prix": "GP de Baréin",
    "Saudi Arabian Grand Prix": "GP de Arabia Saudí",
    "Miami Grand Prix": "GP de Miami",
    "Emilia Romagna Grand Prix": "GP de Emilia-Romaña",
    "Monaco Grand Prix": "GP de Mónaco",
    "Spanish Grand Prix": "GP de España",
    "Canadian Grand Prix": "GP de Canadá",
    "Austrian Grand Prix": "GP de Austria",
    "British Grand Prix": "GP de Gran Bretaña",
    "Belgian Grand Prix": "GP de Bélgica",
    "Hungarian Grand Prix": "GP de Hungría",
    "Dutch Grand Prix": "GP de Países Bajos",
    "Italian Grand Prix": "GP de Italia",
    "Madrid Grand Prix": "GP de Madrid",
    "Azerbaijan Grand Prix": "GP de Azerbaiyán",
    "Singapore Grand Prix": "GP de Singapur",
    "United States Grand Prix": "GP de Estados Unidos",
    "Mexico City Grand Prix": "GP de Ciudad de México",
    "São Paulo Grand Prix": "GP de São Paulo",
    "Brazilian Grand Prix": "GP de Brasil",
    "Las Vegas Grand Prix": "GP de Las Vegas",
    "Qatar Grand Prix": "GP de Catar",
    "Abu Dhabi Grand Prix": "GP de Abu Dabi",
}

MOTOGP_PLACE_ES: dict[str, str] = {
    "THAILAND": "Tailandia",
    "ARGENTINA": "Argentina",
    "THE AMERICAS": "las Américas",
    "AMERICAS": "las Américas",
    "QATAR": "Catar",
    "SPAIN": "España",
    "FRANCE": "Francia",
    "CATALUNYA": "Cataluña",
    "ITALY": "Italia",
    "GERMANY": "Alemania",
    "THE NETHERLANDS": "Países Bajos",
    "NETHERLANDS": "Países Bajos",
    "GREAT BRITAIN": "Gran Bretaña",
    "UNITED KINGDOM": "Gran Bretaña",
    "AUSTRIA": "Austria",
    "ARAGON": "Aragón",
    "ARAGÓN": "Aragón",
    "SAN MARINO": "San Marino",
    "SAN MARINO AND THE RIMINI RIVIERA": "San Marino",
    "EMILIA-ROMAGNA": "Emilia-Romaña",
    "INDONESIA": "Indonesia",
    "JAPAN": "Japón",
    "AUSTRALIA": "Australia",
    "MALAYSIA": "Malasia",
    "VALENCIA": "Valencia",
    "PORTUGAL": "Portugal",
    "BRAZIL": "Brasil",
    "CZECHIA": "República Checa",
    "CZECH REPUBLIC": "República Checa",
    "HUNGARY": "Hungría",
    "INDIA": "India",
}

F1_SESSION_ES: dict[str, str] = {
    "FirstPractice": "Libres 1",
    "SecondPractice": "Libres 2",
    "ThirdPractice": "Libres 3",
    "SprintQualifying": "Clasificación Sprint",
    "Sprint": "Carrera Sprint",
    "Qualifying": "Clasificación",
    "Race": "Carrera",
}

MOTOGP_SESSION_ES: dict[str, str] = {
    "FP": "Libres",
    "PR": "Práctica",
    "Q": "Clasificación Q",
    "SPR": "Carrera Sprint",
    "WUP": "Warm Up",
    "RAC": "Carrera",
}

RSS_FEEDS = [
    {
        "series": "f1",
        "source": "Motorsport.com",
        "url": "https://es.motorsport.com/rss/f1/news/",
    },
    {
        "series": "motogp",
        "source": "Motorsport.com",
        "url": "https://es.motorsport.com/rss/motogp/news/",
    },
    {
        "series": "f1",
        "source": "Marca Motor",
        "url": "https://e00-marca.uecdn.es/rss/motor/formula1.xml",
    },
    {
        "series": "motogp",
        "source": "Marca Motor",
        "url": "https://e00-marca.uecdn.es/rss/motor/motogp.xml",
    },
]


def fetch_text(url: str) -> str:
    req = urllib.request.Request(
        url,
        headers={
            "User-Agent": USER_AGENT,
            "Accept": "application/json, application/xml, text/xml, */*",
        },
    )
    with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
        return resp.read().decode("utf-8", errors="replace")


def fetch_json(url: str) -> Any:
    return json.loads(fetch_text(url))


def iso_to_flag(iso_code: str | None) -> str:
    if not iso_code or len(iso_code) != 2:
        return "🏁"
    code = iso_code.upper()
    return "".join(chr(0x1F1E6 + ord(c) - ord("A")) for c in code)


def translate_f1_gp(name: str) -> str:
    if name in F1_GP_ES:
        return F1_GP_ES[name]
    cleaned = re.sub(r"\s*Grand Prix$", "", name, flags=re.IGNORECASE).strip()
    return f"GP de {cleaned}" if cleaned else name


def translate_motogp_gp(name: str, country_iso: str) -> str:
    upper = name.upper()
    # Buscar patrones tipo "GRAND PRIX OF X" o "GRAN PREMIO DE X"
    m = re.search(r"GRAND PRIX OF\s+(.+)$", upper)
    if m:
        place = m.group(1).strip()
        if place in MOTOGP_PLACE_ES:
            return f"GP de {MOTOGP_PLACE_ES[place]}"
        return f"GP de {place.title()}"
    for key, val in MOTOGP_PLACE_ES.items():
        if key in upper:
            return f"GP de {val}"
    if country_iso in COUNTRY_ES:
        return f"GP de {COUNTRY_ES[country_iso]}"
    return name.title()


def combine_iso(date_str: str | None, time_str: str | None) -> str | None:
    if not date_str:
        return None
    if time_str:
        t = time_str if time_str.endswith("Z") or "+" in time_str else f"{time_str}Z"
        return f"{date_str}T{t}"
    return f"{date_str}T12:00:00Z"


def parse_iso_dt(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        v = value.replace("Z", "+00:00")
        dt = datetime.fromisoformat(v)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.astimezone(timezone.utc)
    except ValueError:
        return None


# ---------------------------------------------------------------------------
# 1. FÓRMULA 1 (Jolpica F1 API)
# ---------------------------------------------------------------------------

F1_STATUS_ES: dict[str, str] = {
    "Finished": "Meta",
    "Lapped": "Doblado",
    "Retired": "Abandono",
    "Accident": "Accidente",
    "Collision": "Colisión",
    "Collision damage": "Daños por colisión",
    "Spun off": "Salida de pista",
    "Engine": "Motor",
    "Power Unit": "Unidad de potencia",
    "Gearbox": "Caja de cambios",
    "Hydraulics": "Hidráulico",
    "Brakes": "Frenos",
    "Suspension": "Suspensión",
    "Puncture": "Pinchazo",
    "Disqualified": "Descalificado",
    "Did not start": "No salió",
    "Withdrew": "Retirado",
    "Mechanical": "Mecánico",
    "Electrical": "Eléctrico",
    "Electronics": "Electrónica",
    "Overheating": "Sobrecalentamiento",
    "Oil leak": "Fuga de aceite",
    "Water leak": "Fuga de agua",
    "Fuel pressure": "Presión de combustible",
    "Throttle": "Acelerador",
    "Exhaust": "Escape",
    "Wheel": "Rueda",
    "Wheel nut": "Tuerca de rueda",
    "Front wing": "Alerón delantero",
    "Rear wing": "Alerón trasero",
    "Undertray": "Fondo plano",
    "Damage": "Daños",
    "Illness": "Indisposición",
}


def translate_f1_status(status: str | None) -> str:
    raw = (status or "").strip()
    if not raw:
        return ""
    if raw in F1_STATUS_ES:
        return F1_STATUS_ES[raw]
    m_laps = re.match(r"^\+(\d+)\s+Laps?$", raw, flags=re.IGNORECASE)
    if m_laps:
        n = int(m_laps.group(1))
        return f"+{n} {'vuelta' if n == 1 else 'vueltas'}"
    return raw


def fetch_jolpica_json(url: str, label: str) -> dict[str, Any]:
    for attempt in range(3):
        try:
            time.sleep(0.35 if attempt == 0 else 1.5 * attempt)
            data = fetch_json(url)
            if isinstance(data, dict):
                return data
            return {}
        except urllib.error.HTTPError as exc:
            if exc.code == 429 and attempt < 2:
                continue
            print(f"[F1] Aviso al leer {label}: {exc}", file=sys.stderr)
            return {}
        except Exception as exc:
            print(f"[F1] Aviso al leer {label}: {exc}", file=sys.stderr)
            return {}
    return {}


def load_f1_data() -> dict[str, Any]:
    now_utc = datetime.now(timezone.utc)
    year = now_utc.year

    schedule_raw = fetch_json(f"https://api.jolpi.ca/ergast/f1/{year}.json")
    races_raw = schedule_raw.get("MRData", {}).get("RaceTable", {}).get("Races", [])
    if not races_raw:
        year -= 1
        schedule_raw = fetch_json(f"https://api.jolpi.ca/ergast/f1/{year}.json")
        races_raw = schedule_raw.get("MRData", {}).get("RaceTable", {}).get("Races", [])

    # Descargar clasificaciones del Mundial con pausa suave (límite Jolpica: ~4 req/s)
    results_map: dict[str, Any] = {
        "drivers": fetch_jolpica_json(f"https://api.jolpi.ca/ergast/f1/{year}/driverStandings.json", "drivers"),
        "constructors": fetch_jolpica_json(f"https://api.jolpi.ca/ergast/f1/{year}/constructorStandings.json", "constructors"),
    }

    # Descargar todos los puestos de todas las carreras disputadas del año (paginado de 100 en 100)
    results_by_round: dict[int, list[dict[str, Any]]] = {}
    seen_round_driver: set[tuple[int, str]] = set()
    offset = 0
    limit = 100
    total: int | None = None
    while total is None or offset < total:
        page_url = f"https://api.jolpi.ca/ergast/f1/{year}/results.json?limit={limit}&offset={offset}"
        page = fetch_jolpica_json(page_url, f"results@{offset}")
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
            for r0 in race.get("Results", []):
                count_in_page += 1
                drv = r0.get("Driver", {})
                con = r0.get("Constructor", {})
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
                time_str = time_obj.get("time") or status_es
                finished = pos_text.isdigit()
                fl_obj = r0.get("FastestLap") or {}
                is_fastest = str(fl_obj.get("rank") or "") == "1"
                fl_time = (fl_obj.get("Time") or {}).get("time", "")
                fl_speed = (fl_obj.get("AverageSpeed") or {}).get("speed", "")

                row_item: dict[str, Any] = {
                    "position": pos_num,
                    "positionText": pos_text,
                    "driver": driver_name,
                    "code": drv.get("code") or drv.get("familyName", "")[:3].upper(),
                    "number": str(r0.get("number") or drv.get("permanentNumber") or ""),
                    "team": con.get("name", ""),
                    "grid": int(r0.get("grid") or 0),
                    "laps": int(r0.get("laps") or 0),
                    "time": time_str,
                    "status": status_es,
                    "finished": finished,
                    "points": float(r0.get("points") or 0),
                }
                if is_fastest:
                    row_item["fastestLap"] = True
                    if fl_time:
                        row_item["fastestLapTime"] = fl_time
                    if fl_speed:
                        row_item["fastestLapSpeed"] = fl_speed

                results_by_round.setdefault(rnd, []).append(row_item)
        if count_in_page == 0:
            break
        offset += limit

    # Descargar resultados de Carreras Sprint de F1 del año (1-2 peticiones)
    sprints_by_round: dict[int, list[dict[str, Any]]] = {}
    seen_sprint_driver: set[tuple[int, str]] = set()
    s_offset = 0
    s_total: int | None = None
    while s_total is None or s_offset < s_total:
        s_url = f"https://api.jolpi.ca/ergast/f1/{year}/sprint.json?limit={limit}&offset={s_offset}"
        s_page = fetch_jolpica_json(s_url, f"sprint@{s_offset}")
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
            for r0 in race.get("SprintResults", []):
                s_count += 1
                drv = r0.get("Driver", {})
                con = r0.get("Constructor", {})
                driver_name = f"{drv.get('givenName', '')} {drv.get('familyName', '')}".strip()
                if (rnd, driver_name) in seen_sprint_driver:
                    continue
                seen_sprint_driver.add((rnd, driver_name))
                pos_num = int(r0.get("position") or 0)
                pos_text = str(r0.get("positionText") or pos_num)
                raw_status = str(r0.get("status") or "")
                status_es = translate_f1_status(raw_status)
                time_obj = r0.get("Time") or {}
                finished = pos_text.isdigit()
                sprints_by_round.setdefault(rnd, []).append(
                    {
                        "position": pos_num,
                        "positionText": pos_text,
                        "driver": driver_name,
                        "code": drv.get("code") or drv.get("familyName", "")[:3].upper(),
                        "number": str(r0.get("number") or drv.get("permanentNumber") or ""),
                        "team": con.get("name", ""),
                        "grid": int(r0.get("grid") or 0),
                        "laps": int(r0.get("laps") or 0),
                        "time": time_obj.get("time") or status_es if finished else status_es,
                        "status": status_es,
                        "finished": finished,
                        "points": float(r0.get("points") or 0),
                    }
                )
        if s_count == 0:
            break
        s_offset += limit
    for rnd in sprints_by_round:
        sprints_by_round[rnd].sort(key=lambda x: (x["position"] if x["position"] > 0 else 999))

    # Ordenar resultados por posición y extraer los podios
    podiums_by_round: dict[int, list[dict[str, Any]]] = {}
    for rnd, r_list in results_by_round.items():
        r_list.sort(key=lambda x: (x["position"] if x["position"] > 0 else 999))
        podiums_by_round[rnd] = [
            {
                "position": r["position"],
                "driver": r["driver"],
                "code": r["code"],
                "team": r["team"],
            }
            for r in r_list[:3]
        ]

    # Construir lista de eventos unificada
    events: list[dict[str, Any]] = []
    for race in races_raw:
        rnd = int(race["round"])
        circuit = race.get("Circuit", {})
        loc = circuit.get("Location", {})
        country_en = loc.get("country", "")
        iso = COUNTRY_TO_ISO.get(country_en, "")
        country_name = COUNTRY_ES.get(iso, country_en)

        sessions: list[dict[str, Any]] = []
        for s_key in (
            "FirstPractice",
            "SecondPractice",
            "ThirdPractice",
            "SprintQualifying",
            "Sprint",
            "Qualifying",
        ):
            s_obj = race.get(s_key)
            if isinstance(s_obj, dict) and s_obj.get("date"):
                start_iso = combine_iso(s_obj.get("date"), s_obj.get("time"))
                sessions.append(
                    {
                        "key": s_key,
                        "name": F1_SESSION_ES.get(s_key, s_key),
                        "start": start_iso,
                        "isMain": s_key in ("Qualifying", "Sprint"),
                    }
                )

        race_start = combine_iso(race.get("date"), race.get("time"))
        sessions.append(
            {
                "key": "Race",
                "name": "Carrera",
                "start": race_start,
                "isMain": True,
            }
        )
        sessions.sort(key=lambda s: s["start"] or "")

        race_dt = parse_iso_dt(race_start)
        race_results = results_by_round.get(rnd, [])
        sprint_results = sprints_by_round.get(rnd, [])
        podium = podiums_by_round.get(rnd, [])
        is_finished = bool(podium) or (race_dt is not None and (now_utc - race_dt).total_seconds() > 3 * 3600)

        start_date = (sessions[0]["start"] or race.get("date", ""))[:10]
        end_date = race.get("date", start_date)

        ev_obj: dict[str, Any] = {
            "id": f"f1-{year}-{rnd}",
            "series": "f1",
            "round": rnd,
            "name": translate_f1_gp(race.get("raceName", "")),
            "officialName": race.get("raceName", ""),
            "circuit": circuit.get("circuitName", ""),
            "locality": loc.get("locality", ""),
            "country": country_name,
            "countryIso": iso,
            "flag": iso_to_flag(iso),
            "dateStart": start_date,
            "dateEnd": end_date,
            "raceStart": race_start,
            "status": "FINISHED" if is_finished else "UPCOMING",
            "sessions": sessions,
            "podium": podium,
            "results": race_results,
        }
        if sprint_results:
            ev_obj["sprintResults"] = sprint_results
        events.append(ev_obj)

    # Clasificación de pilotos F1
    driver_standings: list[dict[str, Any]] = []
    d_lists = results_map.get("drivers", {}).get("MRData", {}).get("StandingsTable", {}).get("StandingsLists", [])
    if d_lists:
        for item in d_lists[0].get("DriverStandings", []):
            drv = item.get("Driver", {})
            cons = item.get("Constructors", [])
            driver_standings.append(
                {
                    "position": int(item.get("position") or 0),
                    "name": f"{drv.get('givenName', '')} {drv.get('familyName', '')}".strip(),
                    "code": drv.get("code") or drv.get("familyName", "")[:3].upper(),
                    "number": drv.get("permanentNumber", ""),
                    "team": cons[0].get("name", "") if cons else "",
                    "points": float(item.get("points") or 0),
                    "wins": int(item.get("wins") or 0),
                }
            )

    # Clasificación de constructores F1
    team_standings: list[dict[str, Any]] = []
    c_lists = results_map.get("constructors", {}).get("MRData", {}).get("StandingsTable", {}).get("StandingsLists", [])
    if c_lists:
        for item in c_lists[0].get("ConstructorStandings", []):
            con = item.get("Constructor", {})
            team_standings.append(
                {
                    "position": int(item.get("position") or 0),
                    "name": con.get("name", ""),
                    "points": float(item.get("points") or 0),
                    "wins": int(item.get("wins") or 0),
                }
            )

    return {
        "series": "f1",
        "label": "Fórmula 1",
        "season": year,
        "events": events,
        "standings": {
            "drivers": driver_standings,
            "teams": team_standings,
        },
    }


# ---------------------------------------------------------------------------
# 2. MOTOGP (API Pulselive)
# ---------------------------------------------------------------------------

def motogp_session_label(s_type: str | None, number: int | None) -> str:
    t = (s_type or "").upper()
    if t == "FP":
        return f"Libres {number}" if number else "Libres"
    if t == "Q":
        return f"Clasificación Q{number}" if number else "Clasificación"
    return MOTOGP_SESSION_ES.get(t, t or "Sesión")


def load_motogp_event_details(event: dict[str, Any], cat_id: str, round_num: int, season_year: int) -> dict[str, Any]:
    eid = event["id"]
    country_obj = event.get("country") or {}
    iso = (country_obj.get("iso") or "").upper()
    country_name = COUNTRY_ES.get(iso, country_obj.get("name", ""))
    circuit_obj = event.get("circuit") or {}

    sessions_raw: list[dict[str, Any]] = []
    try:
        sessions_raw = fetch_json(
            f"https://api.motogp.pulselive.com/motogp/v1/results/sessions?eventUuid={eid}&categoryUuid={cat_id}"
        )
    except Exception as exc:
        print(f"[MotoGP] Sesiones no disponibles para {event.get('name')}: {exc}", file=sys.stderr)

    sessions: list[dict[str, Any]] = []
    rac_session: dict[str, Any] | None = None
    spr_session: dict[str, Any] | None = None
    for s in sessions_raw:
        s_type = (s.get("type") or "").upper()
        if s_type not in ("FP", "PR", "Q", "SPR", "WUP", "RAC"):
            continue
        start_dt = parse_iso_dt(s.get("date"))
        start_iso = start_dt.strftime("%Y-%m-%dT%H:%M:%SZ") if start_dt else s.get("date")
        sessions.append(
            {
                "key": f"{s_type}{s.get('number') or ''}",
                "name": motogp_session_label(s_type, s.get("number")),
                "start": start_iso,
                "isMain": s_type in ("Q", "SPR", "RAC"),
            }
        )
        if s_type == "RAC":
            rac_session = s
        elif s_type == "SPR":
            spr_session = s

    sessions.sort(key=lambda x: x["start"] or "")

    def parse_motogp_session_rows(session_obj: dict[str, Any]) -> list[dict[str, Any]]:
        cl_raw = fetch_json(
            f"https://api.motogp.pulselive.com/motogp/v1/results/session/{session_obj['id']}/classification?test=false"
        )
        st_map = {
            "DNF": "Abandono",
            "RT": "Abandono",
            "NC": "No clasificado",
            "DSQ": "Descalificado",
            "DNS": "No salió",
        }
        rows_parsed: list[dict[str, Any]] = []
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

            team_name = team.get("name") or ""
            con_name = con.get("name") or ""
            full_team = (
                f"{team_name} ({con_name})"
                if team_name and con_name and con_name.lower() not in team_name.lower()
                else (team_name or con_name)
            )

            rows_parsed.append(
                {
                    "position": pos_num,
                    "positionText": pos_text,
                    "driver": rider.get("full_name", ""),
                    "code": str(rider.get("number") or ""),
                    "number": str(rider.get("number") or ""),
                    "team": full_team,
                    "laps": int(row.get("total_laps") or 0),
                    "time": time_str,
                    "status": status_es,
                    "finished": finished,
                    "points": float(row.get("points") or 0),
                }
            )
        return rows_parsed

    podium: list[dict[str, Any]] = []
    race_results: list[dict[str, Any]] = []
    sprint_results: list[dict[str, Any]] = []
    if rac_session and (event.get("status") == "FINISHED" or rac_session.get("status") == "FINISHED"):
        try:
            race_results = parse_motogp_session_rows(rac_session)
            podium = [
                {
                    "position": r["position"],
                    "driver": r["driver"],
                    "code": r["code"],
                    "team": r["team"],
                }
                for r in race_results
                if r["position"] in (1, 2, 3)
            ][:3]
        except Exception as exc:
            print(f"[MotoGP] Clasificación de carrera falló para {event.get('name')}: {exc}", file=sys.stderr)

    if spr_session and (event.get("status") == "FINISHED" or spr_session.get("status") == "FINISHED"):
        try:
            sprint_results = parse_motogp_session_rows(spr_session)
        except Exception as exc:
            print(f"[MotoGP] Sprint falló para {event.get('name')}: {exc}", file=sys.stderr)

    race_start = None
    for s in sessions:
        if s["key"] == "RAC":
            race_start = s["start"]
            break
    if not race_start and event.get("date_end"):
        race_start = f"{event['date_end'][:10]}T12:00:00Z"

    now_utc = datetime.now(timezone.utc)
    race_dt = parse_iso_dt(race_start)
    is_finished = (
        bool(podium)
        or event.get("status") == "FINISHED"
        or (race_dt is not None and (now_utc - race_dt).total_seconds() > 3 * 3600)
    )

    mgp_ev: dict[str, Any] = {
        "id": f"motogp-{season_year}-{round_num}",
        "series": "motogp",
        "round": round_num,
        "name": translate_motogp_gp(event.get("name", ""), iso),
        "officialName": event.get("sponsored_name") or event.get("name", ""),
        "circuit": circuit_obj.get("name", ""),
        "locality": circuit_obj.get("place", ""),
        "country": country_name,
        "countryIso": iso,
        "flag": iso_to_flag(iso),
        "dateStart": (event.get("date_start") or "")[:10],
        "dateEnd": (event.get("date_end") or "")[:10],
        "raceStart": race_start,
        "status": "FINISHED" if is_finished else "UPCOMING",
        "sessions": sessions,
        "podium": podium,
        "results": race_results,
    }
    if sprint_results:
        mgp_ev["sprintResults"] = sprint_results
    return mgp_ev


def load_motogp_data() -> dict[str, Any]:
    seasons = fetch_json("https://api.motogp.pulselive.com/motogp/v1/results/seasons")
    cur_season = next((s for s in seasons if s.get("current")), seasons[0])
    sid = cur_season["id"]
    season_year = int(cur_season["year"])

    cats = fetch_json(f"https://api.motogp.pulselive.com/motogp/v1/results/categories?seasonUuid={sid}")
    mgp_cat = next(c["id"] for c in cats if "MotoGP" in c.get("name", ""))

    events_raw = fetch_json(f"https://api.motogp.pulselive.com/motogp/v1/results/events?seasonUuid={sid}")
    gps_raw = [e for e in events_raw if not e.get("test")]
    gps_raw.sort(key=lambda e: e.get("date_start") or "")

    # Cargar sesiones y podios en paralelo
    events: list[dict[str, Any]] = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
        futs = [
            pool.submit(load_motogp_event_details, ev, mgp_cat, idx + 1, season_year)
            for idx, ev in enumerate(gps_raw)
        ]
        for fut in concurrent.futures.as_completed(futs):
            events.append(fut.result())
    events.sort(key=lambda e: e["round"])

    # Clasificación de pilotos MotoGP + agregación de equipos y marcas
    standings_raw = fetch_json(
        f"https://api.motogp.pulselive.com/motogp/v1/results/standings?seasonUuid={sid}&categoryUuid={mgp_cat}"
    )
    driver_standings: list[dict[str, Any]] = []
    team_totals: dict[str, float] = {}
    for row in standings_raw.get("classification", []):
        rider = row.get("rider") or {}
        team = row.get("team") or {}
        con = row.get("constructor") or {}
        pts = float(row.get("points") or 0)
        team_name = team.get("name") or con.get("name", "")
        con_name = con.get("name", "")
        driver_standings.append(
            {
                "position": int(row.get("position") or 0),
                "name": rider.get("full_name", ""),
                "code": str(rider.get("number") or ""),
                "number": str(rider.get("number") or ""),
                "team": f"{team_name} ({con_name})" if team_name and con_name and con_name not in team_name else (team_name or con_name),
                "constructor": con_name,
                "points": pts,
                "wins": int(row.get("race_wins") or 0),
                "podiums": int(row.get("podiums") or 0),
                "sprintWins": int(row.get("sprint_wins") or 0),
                "sprintPodiums": int(row.get("sprint_podiums") or 0),
            }
        )
        if team_name:
            team_totals[team_name] = team_totals.get(team_name, 0.0) + pts

    # Completar victorias en carrera de MotoGP a partir de los podios si la API no las informó
    wins_counter: dict[str, int] = {}
    for ev in events:
        if ev["podium"]:
            winner = ev["podium"][0]["driver"]
            wins_counter[winner] = wins_counter.get(winner, 0) + 1
    for d in driver_standings:
        if not d["wins"]:
            d["wins"] = wins_counter.get(d["name"], 0)

    team_standings = [
        {"position": idx + 1, "name": name, "points": pts, "wins": 0}
        for idx, (name, pts) in enumerate(sorted(team_totals.items(), key=lambda kv: (-kv[1], kv[0])))
    ]

    return {
        "series": "motogp",
        "label": "MotoGP",
        "season": season_year,
        "events": events,
        "standings": {
            "drivers": driver_standings,
            "teams": team_standings,
        },
    }


# ---------------------------------------------------------------------------
# 3. NOTICIAS EN ESPAÑOL (RSS)
# ---------------------------------------------------------------------------

TAG_RE = re.compile(r"<[^>]+>")
WS_RE = re.compile(r"\s+")


def clean_html_text(raw: str | None, max_len: int = 190) -> str:
    if not raw:
        return ""
    txt = html.unescape(TAG_RE.sub(" ", raw))
    txt = WS_RE.sub(" ", txt).strip()
    if len(txt) > max_len:
        txt = txt[: max_len - 1].rsplit(" ", 1)[0] + "…"
    return txt


def extract_rss_image(item: ET.Element) -> str | None:
    enc = item.find("enclosure")
    if enc is not None and enc.attrib.get("url"):
        return enc.attrib["url"]
    for child in item:
        tag_lower = child.tag.lower()
        if tag_lower.endswith("content") or tag_lower.endswith("thumbnail"):
            url = child.attrib.get("url")
            if url:
                return url
    return None


def parse_rss_feed(feed: dict[str, str]) -> list[dict[str, Any]]:
    items_out: list[dict[str, Any]] = []
    try:
        xml_txt = fetch_text(feed["url"])
        root = ET.fromstring(xml_txt)
    except Exception as exc:
        print(f"[RSS] Error al leer {feed['source']} ({feed['series']}): {exc}", file=sys.stderr)
        return items_out

    for item in root.findall(".//item")[:35]:
        title = clean_html_text(item.findtext("title"), max_len=160)
        link = (item.findtext("link") or "").strip()
        if not title or not link:
            continue
        desc = clean_html_text(item.findtext("description"), max_len=185)
        pub_raw = (item.findtext("pubDate") or "").strip()
        published_iso = None
        if pub_raw:
            try:
                dt = email.utils.parsedate_to_datetime(pub_raw)
                if dt.tzinfo is None:
                    dt = dt.replace(tzinfo=timezone.utc)
                published_iso = dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
            except Exception:
                published_iso = None

        items_out.append(
            {
                "series": feed["series"],
                "source": feed["source"],
                "title": title,
                "summary": desc,
                "url": link,
                "image": extract_rss_image(item),
                "publishedAt": published_iso,
            }
        )
    return items_out


def load_news_data() -> dict[str, Any]:
    all_items: list[dict[str, Any]] = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
        futs = [pool.submit(parse_rss_feed, f) for f in RSS_FEEDS]
        for fut in concurrent.futures.as_completed(futs):
            all_items.extend(fut.result())

    # Deduplicar por enlace y ordenar por fecha descendente
    seen_urls: set[str] = set()
    unique_items: list[dict[str, Any]] = []
    for art in all_items:
        key = art["url"].split("?")[0].rstrip("/")
        if key in seen_urls:
            continue
        seen_urls.add(key)
        unique_items.append(art)

    unique_items.sort(key=lambda a: a["publishedAt"] or "", reverse=True)
    return {
        "updatedAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "count": len(unique_items),
        "items": unique_items[:120],
    }


def main() -> int:
    print("Actualizando datos de MundoMotor...")
    updated_at = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

    motorsport_payload: dict[str, Any] = {
        "updatedAt": updated_at,
        "f1": None,
        "motogp": None,
    }

    with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
        f_f1 = pool.submit(load_f1_data)
        f_mgp = pool.submit(load_motogp_data)
        f_news = pool.submit(load_news_data)

        try:
            motorsport_payload["f1"] = f_f1.result()
            print(
                f"  ✓ F1 {motorsport_payload['f1']['season']}: "
                f"{len(motorsport_payload['f1']['events'])} GPs, "
                f"{len(motorsport_payload['f1']['standings']['drivers'])} pilotos"
            )
        except Exception as exc:
            print(f"  ✗ Error en F1: {exc}", file=sys.stderr)

        try:
            motorsport_payload["motogp"] = f_mgp.result()
            print(
                f"  ✓ MotoGP {motorsport_payload['motogp']['season']}: "
                f"{len(motorsport_payload['motogp']['events'])} GPs, "
                f"{len(motorsport_payload['motogp']['standings']['drivers'])} pilotos"
            )
        except Exception as exc:
            print(f"  ✗ Error en MotoGP: {exc}", file=sys.stderr)

        news_payload = f_news.result()
        print(f"  ✓ Noticias RSS: {news_payload['count']} titulares en español")

    # Conservar datos anteriores si alguna API falló temporalmente
    ms_path = DATA_DIR / "motorsport.json"
    if ms_path.exists():
        try:
            prev = json.loads(ms_path.read_text(encoding="utf-8"))
            if motorsport_payload["f1"] is None and prev.get("f1"):
                motorsport_payload["f1"] = prev["f1"]
            if motorsport_payload["motogp"] is None and prev.get("motogp"):
                motorsport_payload["motogp"] = prev["motogp"]
        except Exception:
            pass

    ms_path.write_text(json.dumps(motorsport_payload, ensure_ascii=False, indent=2), encoding="utf-8")

    news_path = DATA_DIR / "news.json"
    if news_payload["count"] > 0 or not news_path.exists():
        news_path.write_text(json.dumps(news_payload, ensure_ascii=False, indent=2), encoding="utf-8")

    # Archivar automáticamente temporadas pasadas que falten (ej. al cambiar a 2027)
    try:
        from build_history import sync_history

        active_f1_season = (motorsport_payload.get("f1") or {}).get("season")
        active_mgp_season = (motorsport_payload.get("motogp") or {}).get("season")
        max_archive = min(
            y for y in (active_f1_season, active_mgp_season, datetime.now(timezone.utc).year) if y
        ) - 1
        if max_archive >= 1950:
            sync_history(max_year=max_archive, verbose=False)
            from build_race_history import sync_race_history

            sync_race_history(max_year=max_archive, max_new_years=2, verbose=False)
    except Exception as exc:
        print(f"  [Histórico] Aviso al sincronizar: {exc}", file=sys.stderr)

    print("Datos guardados correctamente en data/motorsport.json y data/news.json")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
