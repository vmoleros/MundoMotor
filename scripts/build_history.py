#!/usr/bin/env python3
"""
MundoMotor — Constructor del archivo histórico completo (F1 1950–presente, MotoGP/500cc 1949–presente).
Solo descarga las temporadas que falten en data/history.json (es incremental y reanudable).
Usa únicamente la librería estándar de Python 3.
"""

from __future__ import annotations

import concurrent.futures
import json
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = ROOT / "data"
DATA_DIR.mkdir(parents=True, exist_ok=True)
HISTORY_PATH = DATA_DIR / "history.json"
MOTO_CLASSES_PATH = DATA_DIR / "moto_classes_history.json"

USER_AGENT = "MundoMotor/1.0 (+https://github.com)"
TIMEOUT = 15

# Categorías adicionales clásicas del Mundial de Motociclismo (excluyendo MotoE y categoría reina)
LOWER_MOTO_CLASS_ORDER = ["350cc", "Moto2", "250cc", "Moto3", "125cc", "80cc", "50cc"]
LOWER_MOTO_CLASS_CANON = {c.lower(): c for c in LOWER_MOTO_CLASS_ORDER}

RIDER_NAME_ALIASES: dict[str, str] = {
    "daniel pedrosa": "Dani Pedrosa",
}


def canon_rider_name(name: str) -> str:
    clean = (name or "").strip()
    return RIDER_NAME_ALIASES.get(clean.lower(), clean)


def fim_points_scale(year: int) -> list[int]:
    if year == 1949:
        return [10, 8, 7, 6, 5]
    if year <= 1968:
        return [8, 6, 4, 3, 2, 1]
    if year <= 1987:
        return [15, 12, 10, 8, 6, 5, 4, 3, 2, 1]
    if year <= 1991:
        return [20, 17, 15, 13, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1]
    if year == 1992:
        return [20, 15, 12, 10, 8, 6, 4, 3, 2, 1]
    return [25, 20, 16, 13, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1]


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
                wait = 2.0 * (attempt + 1)
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


def load_existing_history() -> dict[str, Any]:
    if HISTORY_PATH.exists():
        try:
            data = json.loads(HISTORY_PATH.read_text(encoding="utf-8"))
            data.setdefault("f1", {})
            data.setdefault("motogp", {})
            return data
        except Exception:
            pass
    return {"updatedAt": "", "f1": {}, "motogp": {}}


def save_history(history: dict[str, Any]) -> None:
    history["updatedAt"] = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    # Compacto (sin indentación) para que todas las temporadas ocupen lo mínimo y carguen al instante
    HISTORY_PATH.write_text(
        json.dumps(history, ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )


def fetch_f1_season(year: int) -> dict[str, Any] | None:
    d_raw = fetch_json(f"https://api.jolpi.ca/ergast/f1/{year}/driverStandings.json?limit=100")
    d_lists = d_raw.get("MRData", {}).get("StandingsTable", {}).get("StandingsLists", [])
    if not d_lists:
        return None

    drivers = []
    for item in d_lists[0].get("DriverStandings", []):
        drv = item.get("Driver", {})
        cons = item.get("Constructors", [])
        pos_raw = item.get("position")
        pos = int(pos_raw) if pos_raw and str(pos_raw).isdigit() else len(drivers) + 1
        pts_val = float(item.get("points") or 0)
        pts = int(pts_val) if pts_val.is_integer() else round(pts_val, 1)
        drivers.append(
            {
                "p": pos,
                "n": f"{drv.get('givenName', '')} {drv.get('familyName', '')}".strip(),
                "t": cons[0].get("name", "") if cons else "",
                "pts": pts,
                "w": int(item.get("wins") or 0),
            }
        )

    teams = []
    if year >= 1958:
        time.sleep(0.28)
        try:
            c_raw = fetch_json(f"https://api.jolpi.ca/ergast/f1/{year}/constructorStandings.json?limit=100")
            c_lists = c_raw.get("MRData", {}).get("StandingsTable", {}).get("StandingsLists", [])
            if c_lists:
                for item in c_lists[0].get("ConstructorStandings", []):
                    con = item.get("Constructor", {})
                    pos_raw = item.get("position")
                    pos = int(pos_raw) if pos_raw and str(pos_raw).isdigit() else len(teams) + 1
                    pts_val = float(item.get("points") or 0)
                    pts = int(pts_val) if pts_val.is_integer() else round(pts_val, 1)
                    teams.append(
                        {
                            "p": pos,
                            "n": con.get("name", ""),
                            "pts": pts,
                            "w": int(item.get("wins") or 0),
                        }
                    )
        except Exception as exc:
            print(f"[Histórico F1] Constructores {year} no disponibles: {exc}", file=sys.stderr)

    return {"d": drivers, "c": teams}


def fetch_motogp_season_by_uuid(year: int, season_uuid: str) -> dict[str, Any] | None:
    cats = fetch_json(
        f"https://api.motogp.pulselive.com/motogp/v1/results/categories?seasonUuid={season_uuid}"
    )
    if not cats:
        return None
    # Categoría reina: MotoGP (desde 2002) o 500cc (1949–2001)
    premier = next(
        (c for c in cats if "MotoGP" in c.get("name", "") or "500" in c.get("name", "")),
        cats[0],
    )
    cat_name = premier.get("name", "").replace("™", "").strip()
    st_raw = fetch_json(
        f"https://api.motogp.pulselive.com/motogp/v1/results/standings?seasonUuid={season_uuid}&categoryUuid={premier['id']}"
    )
    classification = st_raw.get("classification") or []
    if not classification:
        return None

    drivers = []
    brand_totals: dict[str, float] = {}
    for idx, row in enumerate(classification):
        rider = row.get("rider") or {}
        team = row.get("team") or {}
        con = row.get("constructor") or {}
        pos = int(row.get("position") or (idx + 1))
        pts_val = float(row.get("points") or 0)
        pts = int(pts_val) if pts_val.is_integer() else round(pts_val, 1)
        team_name = (team.get("name") or "").strip()
        con_name = (con.get("name") or "").strip()
        if team_name and con_name and con_name.lower() not in team_name.lower():
            label = f"{team_name} ({con_name})"
        else:
            label = team_name or con_name
        drivers.append(
            {
                "p": pos,
                "n": (rider.get("full_name") or "").strip(),
                "t": label,
                "pts": pts,
                "w": 0,
            }
        )
        brand_key = con_name or team_name
        if brand_key:
            brand_totals[brand_key] = brand_totals.get(brand_key, 0.0) + pts_val

    teams = []
    for idx, (b_name, b_pts) in enumerate(sorted(brand_totals.items(), key=lambda kv: (-kv[1], kv[0]))):
        pts = int(b_pts) if b_pts.is_integer() else round(b_pts, 1)
        teams.append({"p": idx + 1, "n": b_name, "pts": pts, "w": 0})

    return {"cat": cat_name, "d": drivers, "c": teams}


def load_existing_moto_classes() -> dict[str, Any]:
    if MOTO_CLASSES_PATH.exists():
        try:
            data = json.loads(MOTO_CLASSES_PATH.read_text(encoding="utf-8"))
            data.setdefault("years", {})
            return data
        except Exception:
            pass
    return {"updatedAt": "", "years": {}}


def save_moto_classes(payload: dict[str, Any]) -> None:
    payload["updatedAt"] = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    MOTO_CLASSES_PATH.write_text(
        json.dumps(payload, ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )


def reconstruct_moto_class_from_races(
    year: int,
    season_uuid: str,
    cat_id: str,
    events_raw: list[dict[str, Any]],
) -> dict[str, Any] | None:
    """Si Pulselive devuelve standings vacíos para una categoría histórica, reconstruye la tabla desde sus carreras."""
    scale = fim_points_scale(year)
    gps = [e for e in events_raw if not e.get("test")]

    def fetch_ev(ev: dict[str, Any]) -> list[dict[str, Any]]:
        try:
            sess = fetch_json(
                f"https://api.motogp.pulselive.com/motogp/v1/results/sessions?eventUuid={ev['id']}&categoryUuid={cat_id}",
                retries=3,
            )
            rac = next((s for s in sess if (s.get("type") or "").upper() == "RAC"), None)
            if not rac:
                return []
            cl = fetch_json(
                f"https://api.motogp.pulselive.com/motogp/v1/results/session/{rac['id']}/classification?test=false",
                retries=3,
            )
            return cl.get("classification") or []
        except Exception:
            return []

    rider_stats: dict[str, dict[str, Any]] = {}
    brand_totals: dict[str, float] = {}

    with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
        for cl_rows in pool.map(fetch_ev, gps):
            for row in cl_rows:
                raw_pos = row.get("position")
                if raw_pos is None:
                    continue
                pos = int(raw_pos)
                if pos <= 0 or pos > len(scale):
                    continue
                pts = float(row.get("points") or 0) or float(scale[pos - 1])
                rider = row.get("rider") or {}
                team = row.get("team") or {}
                con = row.get("constructor") or {}
                r_name = canon_rider_name(rider.get("full_name") or "")
                if not r_name:
                    continue
                t_name = (team.get("name") or "").strip()
                c_name = (con.get("name") or "").strip()
                label = (
                    f"{t_name} ({c_name})"
                    if t_name and c_name and c_name.lower() not in t_name.lower()
                    else (t_name or c_name)
                )
                rec = rider_stats.setdefault(
                    r_name,
                    {"n": r_name, "t": label, "pts": 0.0, "w": 0, "best": 99},
                )
                rec["pts"] += pts
                if label:
                    rec["t"] = label
                if pos == 1:
                    rec["w"] += 1
                if pos < rec["best"]:
                    rec["best"] = pos
                b_key = c_name or t_name
                if b_key:
                    brand_totals[b_key] = brand_totals.get(b_key, 0.0) + pts

    if not rider_stats:
        return None

    ordered_riders = sorted(
        rider_stats.values(),
        key=lambda r: (-r["pts"], -r["w"], r["best"], r["n"]),
    )
    drivers = []
    for idx, r in enumerate(ordered_riders, start=1):
        pts_val = r["pts"]
        pts_fmt = int(pts_val) if pts_val.is_integer() else round(pts_val, 1)
        drivers.append({"p": idx, "n": r["n"], "t": r["t"], "pts": pts_fmt, "w": r["w"]})

    teams = []
    for idx, (b_name, b_pts) in enumerate(sorted(brand_totals.items(), key=lambda kv: (-kv[1], kv[0])), start=1):
        pts_fmt = int(b_pts) if b_pts.is_integer() else round(b_pts, 1)
        teams.append({"p": idx, "n": b_name, "pts": pts_fmt, "w": 0})

    return {"d": drivers, "c": teams}


def fetch_motogp_lower_classes_by_uuid(year: int, season_uuid: str) -> dict[str, Any]:
    cats = fetch_json(
        f"https://api.motogp.pulselive.com/motogp/v1/results/categories?seasonUuid={season_uuid}"
    )
    if not cats:
        return {}

    events_raw_cache: list[dict[str, Any]] | None = None
    year_classes: dict[str, Any] = {}
    for c in cats:
        raw_name = (c.get("name") or "").replace("™", "").strip()
        canon = LOWER_MOTO_CLASS_CANON.get(raw_name.lower())
        if not canon:
            continue
        st_raw = fetch_json(
            f"https://api.motogp.pulselive.com/motogp/v1/results/standings?seasonUuid={season_uuid}&categoryUuid={c['id']}"
        )
        classification = st_raw.get("classification") or []
        if not classification:
            if events_raw_cache is None:
                events_raw_cache = fetch_json(
                    f"https://api.motogp.pulselive.com/motogp/v1/results/events?seasonUuid={season_uuid}"
                )
            reconstructed = reconstruct_moto_class_from_races(year, season_uuid, c["id"], events_raw_cache)
            if reconstructed:
                year_classes[canon] = reconstructed
            continue

        drivers = []
        brand_totals: dict[str, float] = {}
        for idx, row in enumerate(classification):
            rider = row.get("rider") or {}
            team = row.get("team") or {}
            con = row.get("constructor") or {}
            pos = int(row.get("position") or (idx + 1))
            pts_val = float(row.get("points") or 0)
            pts = int(pts_val) if pts_val.is_integer() else round(pts_val, 1)
            team_name = (team.get("name") or "").strip()
            con_name = (con.get("name") or "").strip()
            if team_name and con_name and con_name.lower() not in team_name.lower():
                label = f"{team_name} ({con_name})"
            else:
                label = team_name or con_name
            drivers.append(
                {
                    "p": pos,
                    "n": canon_rider_name(rider.get("full_name") or ""),
                    "t": label,
                    "pts": pts,
                    "w": 0,
                }
            )
            brand_key = con_name or team_name
            if brand_key:
                brand_totals[brand_key] = brand_totals.get(brand_key, 0.0) + pts_val

        teams = []
        for idx, (b_name, b_pts) in enumerate(sorted(brand_totals.items(), key=lambda kv: (-kv[1], kv[0]))):
            pts = int(b_pts) if b_pts.is_integer() else round(b_pts, 1)
            teams.append({"p": idx + 1, "n": b_name, "pts": pts, "w": 0})

        year_classes[canon] = {"d": drivers, "c": teams}

    # Ordenar de mayor a menor cilindrada
    return {k: year_classes[k] for k in LOWER_MOTO_CLASS_ORDER if k in year_classes}


def sync_moto_lower_classes(
    seasons_mgp: list[dict[str, Any]] | None = None,
    max_year: int | None = None,
    force_years: set[int] | None = None,
    verbose: bool = True,
) -> dict[str, Any]:
    data = load_existing_moto_classes()
    now_year = datetime.now(timezone.utc).year
    target_max = max_year if max_year is not None else (now_year - 1)
    forced = force_years or set()

    try:
        if seasons_mgp is None:
            seasons_mgp = fetch_json("https://api.motogp.pulselive.com/motogp/v1/results/seasons")
        missing = [
            s
            for s in seasons_mgp
            if 1949 <= int(s["year"]) <= target_max
            and (str(s["year"]) not in data["years"] or int(s["year"]) in forced)
        ]
        if missing:
            if verbose:
                print(
                    f"[Categorías MotoGP/50-350cc] Descargando {len(missing)} temporadas...",
                    flush=True,
                )
            with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool:
                futs = {
                    pool.submit(fetch_motogp_lower_classes_by_uuid, int(s["year"]), s["id"]): int(s["year"])
                    for s in missing
                }
                done = 0
                for fut in concurrent.futures.as_completed(futs):
                    yr = futs[fut]
                    try:
                        res = fut.result()
                        if res:
                            data["years"][str(yr)] = res
                    except Exception as exc:
                        print(f"[Categorías MotoGP] Error en {yr}: {exc}", file=sys.stderr)
                    done += 1
                    if verbose and (done % 15 == 0 or done == len(missing)):
                        print(f"  Categorías inferiores: {done}/{len(missing)}", flush=True)
            save_moto_classes(data)
            if verbose:
                total_cls = sum(len(v) for v in data["years"].values())
                print(
                    f"  ✓ Categorías inferiores listas: {len(data['years'])} temporadas ({total_cls} campeonatos)",
                    flush=True,
                )
    except Exception as exc:
        print(f"[Categorías MotoGP] Aviso general: {exc}", file=sys.stderr)

    return data


def sync_history(max_year: int | None = None, verbose: bool = True) -> dict[str, Any]:
    history = load_existing_history()
    now_year = datetime.now(timezone.utc).year
    target_max = max_year if max_year is not None else (now_year - 1)
    seasons_mgp: list[dict[str, Any]] | None = None

    # 1. MotoGP / 500cc (1949..target_max) en paralelo
    try:
        seasons_mgp = fetch_json("https://api.motogp.pulselive.com/motogp/v1/results/seasons")
        missing_mgp = [
            s
            for s in seasons_mgp
            if 1949 <= int(s["year"]) <= target_max and str(s["year"]) not in history["motogp"]
        ]
        if missing_mgp:
            if verbose:
                print(f"[Histórico MotoGP] Descargando {len(missing_mgp)} temporadas...")
            with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool:
                futs = {
                    pool.submit(fetch_motogp_season_by_uuid, int(s["year"]), s["id"]): int(s["year"])
                    for s in missing_mgp
                }
                done = 0
                for fut in concurrent.futures.as_completed(futs):
                    yr = futs[fut]
                    try:
                        res = fut.result()
                        if res:
                            history["motogp"][str(yr)] = res
                    except Exception as exc:
                        print(f"[Histórico MotoGP] Error en {yr}: {exc}", file=sys.stderr)
                    done += 1
                    if verbose and done % 15 == 0:
                        print(f"  MotoGP: {done}/{len(missing_mgp)}")
            save_history(history)
            if verbose:
                print(f"  ✓ MotoGP histórico total: {len(history['motogp'])} temporadas")
    except Exception as exc:
        print(f"[Histórico MotoGP] Aviso general: {exc}", file=sys.stderr)

    # 1b. Categorías inferiores de motociclismo (350cc, Moto2/250cc, Moto3/125cc, 80cc, 50cc)
    sync_moto_lower_classes(seasons_mgp=seasons_mgp, max_year=target_max, verbose=verbose)

    # 2. Fórmula 1 (1950..target_max) respetando el rate-limit de Jolpica
    missing_f1 = [yr for yr in range(target_max, 1949, -1) if str(yr) not in history["f1"]]
    if missing_f1:
        if verbose:
            print(f"[Histórico F1] Descargando {len(missing_f1)} temporadas (con pausa suave para la API)...")
        for idx, yr in enumerate(missing_f1, start=1):
            try:
                res = fetch_f1_season(yr)
                if res:
                    history["f1"][str(yr)] = res
            except Exception as exc:
                print(f"[Histórico F1] Error en {yr}: {exc}", file=sys.stderr)
            time.sleep(0.32)
            # Guardado parcial cada 10 años para poder reanudar si hubiera cortes
            if idx % 10 == 0:
                save_history(history)
                if verbose:
                    print(f"  F1: {idx}/{len(missing_f1)} (último: {yr})")
        save_history(history)
        if verbose:
            print(f"  ✓ F1 histórico total: {len(history['f1'])} temporadas")

    return history


def main() -> int:
    history = sync_history(verbose=True)
    size_kb = HISTORY_PATH.stat().st_size / 1024 if HISTORY_PATH.exists() else 0
    print(
        f"Histórico listo: {len(history['f1'])} temporadas F1, "
        f"{len(history['motogp'])} temporadas MotoGP/500cc ({size_kb:.1f} KB)"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
