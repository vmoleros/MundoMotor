#!/usr/bin/env python3
"""
MundoMotor — Constructor enriquecido de fichas de circuitos de F1 y MotoGP/500cc.
Combina:
  - Archivo local data/races/ + data/motorsport.json (GPs, años, pilotos y marcas con más victorias)
  - Jolpica F1 API (coordenadas y enlaces de Wikipedia de los 78 circuitos F1)
  - Pulselive MotoGP v1/events 2016–2026 (planos SVG oficiales, longitud, curvas izq./der., recta más larga, anchura, diseñador)
  - Wikipedia / Wikimedia Commons API gratuita (planos SVG/PNG con nombres de curvas, longitud, curvas, inauguración, sentido de giro, récord de vuelta y resumen en español)

Genera data/circuits_info.json (compacto, sin dependencias externas).
"""

from __future__ import annotations

import concurrent.futures
import html
import json
import math
import re
import sys
import time
import unicodedata
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from build_drivers_info import EXTRA_COUNTRY_ES
from build_history import canon_rider_name
from build_race_history import HIST_COUNTRY_TO_ISO
from build_teams_meta import MOTO_BRAND_META
from update_data import iso_to_flag

ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = ROOT / "data"
RACES_DIR = DATA_DIR / "races"
OUT_PATH = DATA_DIR / "circuits_info.json"

USER_AGENT = "MundoMotor/1.0 (https://github.com; contacto personal sin animo de lucro)"
TIMEOUT = 15


def norm_text(s: str) -> str:
    nfd = unicodedata.normalize("NFD", str(s or ""))
    no_acc = "".join(ch for ch in nfd if unicodedata.category(ch) != "Mn")
    cleaned = re.sub(r"[^a-z0-9\s]", " ", no_acc.lower())
    return re.sub(r"\s+", " ", cleaned).strip()


def fetch_json(url: str, retries: int = 3) -> Any:
    last_err: Exception | None = None
    for attempt in range(retries):
        try:
            req = urllib.request.Request(
                url,
                headers={"User-Agent": USER_AGENT, "Accept": "application/json"},
            )
            with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
                return json.loads(resp.read().decode("utf-8", errors="replace"))
        except Exception as exc:
            last_err = exc
            time.sleep(0.6 * (attempt + 1))
    if last_err:
        raise last_err
    return {}


def clean_wiki_value(raw: str) -> str:
    if not raw:
        return ""
    s = re.sub(r"<!--.*?-->", "", raw, flags=re.S)
    s = re.sub(r"<ref[^>]*/>", "", s, flags=re.I)
    s = re.sub(r"<ref[^>]*>.*?</ref>", "", s, flags=re.I | re.S)
    s = re.sub(r"<br\s*/?>", " ", s, flags=re.I)
    s = re.sub(r"<[^>]+>", " ", s)
    # Plantillas comunes
    s = re.sub(r"\{\{flagicon\|[^}]*\}\}", "", s, flags=re.I)
    s = re.sub(r"\{\{flag\|([^|}]+)[^}]*\}\}", r"\1", s, flags=re.I)
    s = re.sub(r"\{\{(?:nowrap|small|lang[^|]*)\|([^}]+)\}\}", r"\1", s, flags=re.I)
    s = re.sub(r"\{\{[^}]*\}\}", "", s)
    # Enlaces [[Destino|Texto]] -> Texto
    s = re.sub(r"\[\[[^|\]]*\|([^\]]+)\]\]", r"\1", s)
    s = re.sub(r"\[\[([^\]]+)\]\]", r"\1", s)
    s = s.replace("'''", "").replace("''", "")
    s = html.unescape(s)
    s = re.sub(r"\s+", " ", s).strip(" ,;·-|")
    return s


def extract_team_brand(series: str, team_raw: str) -> str:
    clean = (team_raw or "").strip()
    if not clean:
        return ""
    if series == "f1":
        return clean
    m = re.search(r"\(([^)]+)\)\s*$", clean)
    if m:
        return m.group(1).strip()
    kn = norm_text(clean)
    for b_key in MOTO_BRAND_META:
        if b_key in kn:
            return b_key.upper() if b_key in ("ktm", "mv agusta", "ajs") else b_key.title()
    return clean


def aggregate_circuit_history(series: str) -> dict[str, dict[str, Any]]:
    by_circuit: dict[str, dict[str, Any]] = {}

    def record(c_name: str, country: str, flag: str, year: int, gp_name: str, winner: str, team: str) -> None:
        k = norm_text(c_name)
        if not k:
            return
        rec = by_circuit.setdefault(
            k,
            {
                "name": c_name,
                "co": country,
                "fl": flag,
                "gps": 0,
                "first": year,
                "last": year,
                "wins": {},
                "team_wins": {},
                "recent": [],
            },
        )
        rec["name"] = c_name
        if country:
            rec["co"] = country
        if flag and flag != "🏁":
            rec["fl"] = flag
        rec["gps"] += 1
        if year < rec["first"]:
            rec["first"] = year
        if year > rec["last"]:
            rec["last"] = year
        if winner:
            w_canon = canon_rider_name(winner) if series == "motogp" else winner
            rec["wins"][w_canon] = rec["wins"].get(w_canon, 0) + 1
            rec["recent"].append([year, w_canon, team, gp_name])
            brand = extract_team_brand(series, team)
            if brand:
                rec["team_wins"][brand] = rec["team_wins"].get(brand, 0) + 1

    series_dir = RACES_DIR / series
    if series_dir.exists():
        for fpath in sorted(series_dir.glob("*.json")):
            try:
                payload = json.loads(fpath.read_text(encoding="utf-8"))
                yr = int(payload.get("y") or 0)
                for rc in payload.get("r", []):
                    res = rc.get("res") or []
                    w_row = next((r for r in res if r.get("p") == 1 and r.get("f", 1) != 0), None)
                    record(
                        rc.get("c", ""),
                        rc.get("co", ""),
                        rc.get("fl", "🏁"),
                        yr,
                        rc.get("n", ""),
                        w_row.get("d", "") if w_row else "",
                        w_row.get("t", "") if w_row else "",
                    )
            except Exception:
                continue

    ms_path = DATA_DIR / "motorsport.json"
    if ms_path.exists():
        try:
            ms = json.loads(ms_path.read_text(encoding="utf-8"))
            s_obj = ms.get(series) or {}
            yr = int(s_obj.get("season") or 0)
            for ev in s_obj.get("events", []):
                c_name = ev.get("circuit", "")
                k = norm_text(c_name)
                if not k:
                    continue
                if ev.get("podium"):
                    p1 = ev["podium"][0]
                    record(
                        c_name,
                        ev.get("country", ""),
                        ev.get("flag", "🏁"),
                        yr,
                        ev.get("name", ""),
                        p1.get("driver", ""),
                        p1.get("team", ""),
                    )
                else:
                    by_circuit.setdefault(
                        k,
                        {
                            "name": c_name,
                            "co": ev.get("country", ""),
                            "fl": ev.get("flag", "🏁"),
                            "loc": ev.get("locality", ""),
                            "gps": 0,
                            "first": yr,
                            "last": yr,
                            "wins": {},
                            "team_wins": {},
                            "recent": [],
                        },
                    )
                if ev.get("locality") and k in by_circuit and not by_circuit[k].get("loc"):
                    by_circuit[k]["loc"] = ev["locality"]
        except Exception:
            pass

    out: dict[str, dict[str, Any]] = {}
    for k, rec in by_circuit.items():
        top_winners = sorted(rec["wins"].items(), key=lambda kv: (-kv[1], kv[0]))[:6]
        top_teams = sorted(rec["team_wins"].items(), key=lambda kv: (-kv[1], kv[0]))[:5]
        recent = sorted(rec["recent"], key=lambda x: -x[0])[:10]
        entry: dict[str, Any] = {
            "n": rec["name"],
            "co": rec["co"],
            "fl": rec["fl"],
            "gps": rec["gps"],
            "first": rec["first"],
            "last": rec["last"],
            "top": [[w, cnt] for w, cnt in top_winners],
            "tt": [[t, cnt] for t, cnt in top_teams],
            "rec": recent,
        }
        if rec.get("loc"):
            entry["loc"] = rec["loc"]
        out[k] = entry
    return out


# ---------------------------------------------------------------------------
# 1. ENRIQUECIMIENTO F1 (Jolpica + Wikipedia / Wikimedia Commons)
# ---------------------------------------------------------------------------

def parse_infobox_fields(wikitext: str) -> dict[str, str]:
    fields: dict[str, str] = {}
    for line in wikitext.splitlines():
        m = re.match(r"^\s*\|\s*([a-zA-Z0-9_]+)\s*=\s*(.*)$", line)
        if m:
            k = m.group(1).lower()
            if k not in fields:
                fields[k] = m.group(2).strip()
    return fields


def extract_track_image_filename(fields: dict[str, str]) -> str | None:
    # Priorizar el plano del trazado (SVG o imagen principal del infobox)
    candidates = [
        fields.get("image", ""),
        fields.get("layout", ""),
        fields.get("map_image", ""),
        fields.get("image1", ""),
        fields.get("image2", ""),
    ]
    found_files: list[str] = []
    for raw in candidates:
        if not raw:
            continue
        m_file = re.search(r"(?:File|Image)\s*:\s*([^|\]]+)", raw, flags=re.I)
        if m_file:
            fname = m_file.group(1).strip()
            if fname:
                found_files.append(fname)
        elif re.search(r"\.(svg|png|jpg|jpeg)$", raw.strip(), flags=re.I) and "[[" not in raw:
            found_files.append(raw.strip())
    # Preferir SVG / planos sobre logos
    for f in found_files:
        if f.lower().endswith(".svg") and "logo" not in f.lower():
            return f
    for f in found_files:
        if "logo" not in f.lower():
            return f
    return found_files[0] if found_files else None


def resolve_commons_image(filename: str) -> tuple[str | None, str | None]:
    encoded = urllib.parse.quote(f"File:{filename}")
    url = (
        f"https://en.wikipedia.org/w/api.php?action=query&titles={encoded}"
        "&prop=imageinfo&iiprop=url&iiurlwidth=960&format=json"
    )
    data = fetch_json(url, retries=2)
    pages = (data.get("query") or {}).get("pages") or {}
    for p in pages.values():
        infos = p.get("imageinfo") or []
        if infos:
            info = infos[0]
            return info.get("thumburl") or info.get("url"), info.get("url")
    return None, None


def fetch_f1_wiki_enrichment(k: str, wiki_url: str) -> tuple[str, dict[str, Any]]:
    extra: dict[str, Any] = {}
    try:
        slug = wiki_url.rstrip("/").split("/wiki/")[-1]
        slug_decoded = urllib.parse.unquote(slug)
        api_url = (
            "https://en.wikipedia.org/w/api.php?action=parse"
            f"&page={urllib.parse.quote(slug_decoded)}"
            "&prop=wikitext|langlinks&section=0&redirects=1&lllang=es&format=json"
        )
        parsed = fetch_json(api_url, retries=2).get("parse") or {}
        wt = (parsed.get("wikitext") or {}).get("*", "")
        fields = parse_infobox_fields(wt)

        # Longitud en km
        len_raw = clean_wiki_value(fields.get("length_km", "") or fields.get("length", ""))
        m_len = re.search(r"(\d+(?:\.\d+)?)", len_raw.replace(",", "."))
        if m_len:
            val = float(m_len.group(1))
            if 0.5 <= val <= 35.0:
                extra["len"] = round(val, 3)

        # Curvas
        turns_raw = clean_wiki_value(fields.get("turns", ""))
        m_turns = re.search(r"(\d+)", turns_raw)
        if m_turns:
            tv = int(m_turns.group(1))
            if 2 <= tv <= 200:
                extra["turns"] = tv

        # Inauguración
        op_raw = fields.get("opened", "") or fields.get("built", "")
        m_yr = re.search(r"\b(18\d{2}|19\d{2}|20\d{2})\b", op_raw)
        if m_yr:
            extra["op"] = int(m_yr.group(1))

        # Sentido de giro
        dir_raw = clean_wiki_value(fields.get("direction", "")).lower()
        if "anti" in dir_raw or "counter" in dir_raw:
            extra["dir"] = "Antihorario"
        elif "clock" in dir_raw:
            extra["dir"] = "Horario"

        # Diseñador / Arquitecto
        des = clean_wiki_value(fields.get("architect", "") or fields.get("designer", ""))
        if des and len(des) <= 90:
            extra["des"] = des

        # Aforo
        cap = clean_wiki_value(fields.get("capacity", ""))
        m_cap = re.search(r"(\d[\d,\.]{2,})", cap)
        if m_cap:
            extra["cap"] = m_cap.group(1).replace(",", ".")

        # Récord de vuelta en carrera
        rec_t = clean_wiki_value(fields.get("record_time", ""))
        m_rt = re.search(r"(\d+:\d{2}\.\d{2,3})", rec_t)
        if m_rt:
            rec_obj: dict[str, Any] = {"t": m_rt.group(1)}
            rec_d = clean_wiki_value(fields.get("record_driver", ""))
            rec_c = clean_wiki_value(fields.get("record_car", ""))
            rec_y = clean_wiki_value(fields.get("record_year", ""))
            if rec_d:
                rec_obj["d"] = rec_d
            if rec_c:
                rec_obj["c"] = rec_c
            m_ry = re.search(r"\b(19\d{2}|20\d{2})\b", rec_y)
            if m_ry:
                rec_obj["y"] = int(m_ry.group(1))
            extra["recLap"] = rec_obj

        # Plano del trazado (SVG/PNG de Wikimedia Commons)
        fname = extract_track_image_filename(fields)
        if fname:
            thumb_u, full_u = resolve_commons_image(fname)
            if thumb_u:
                extra["map"] = thumb_u
                if full_u and full_u != thumb_u:
                    extra["mapFull"] = full_u

        # Resumen breve y enlace a Wikipedia en español si existe
        langlinks = parsed.get("langlinks") or []
        es_link = next((ll.get("*") for ll in langlinks if ll.get("lang") == "es"), None)
        if es_link:
            es_slug = urllib.parse.quote(es_link.replace(" ", "_"))
            extra["wiki"] = f"https://es.wikipedia.org/wiki/{es_slug}"
            try:
                es_sum = fetch_json(f"https://es.wikipedia.org/api/rest_v1/page/summary/{es_slug}", retries=2)
                extract = (es_sum.get("extract") or "").strip()
                if extract:
                    if len(extract) > 300:
                        cut = extract[:298].rsplit(".", 1)[0]
                        extract = (cut + ".") if len(cut) > 90 else (extract[:295].rsplit(" ", 1)[0] + "…")
                    extra["desc"] = extract
            except Exception:
                pass
    except Exception as exc:
        print(f"[Wiki F1] Aviso en {k}: {exc}", file=sys.stderr)
    return k, extra


def enrich_f1_circuits(f1_map: dict[str, dict[str, Any]], prev_f1: dict[str, dict[str, Any]] | None = None) -> None:
    print("[Circuitos F1] Descargando coordenadas, planos y fichas técnicas (Jolpica + Wikipedia)...", flush=True)
    raw = fetch_json("https://api.jolpi.ca/ergast/f1/circuits.json?limit=100")
    circuits = raw.get("MRData", {}).get("CircuitTable", {}).get("Circuits", [])
    wiki_targets: list[tuple[str, str]] = []
    cached = prev_f1 or {}

    for c in circuits:
        name = c.get("circuitName", "")
        k = norm_text(name)
        if not k:
            continue
        loc = c.get("Location") or {}
        country_en = loc.get("country", "")
        iso = HIST_COUNTRY_TO_ISO.get(country_en, "")
        co_es = EXTRA_COUNTRY_ES.get(iso, country_en)
        rec = f1_map.setdefault(
            k,
            {
                "n": name,
                "co": co_es,
                "fl": iso_to_flag(iso),
                "gps": 0,
                "first": 0,
                "last": 0,
                "top": [],
                "tt": [],
                "rec": [],
            },
        )
        if loc.get("locality"):
            rec["loc"] = loc["locality"]
        if co_es:
            rec["co"] = co_es
        if iso:
            rec["fl"] = iso_to_flag(iso)
        if loc.get("lat") and loc.get("long"):
            rec["lat"] = round(float(loc["lat"]), 5)
            rec["lon"] = round(float(loc["long"]), 5)
        if c.get("url"):
            rec["wiki"] = c["url"]
            prev_rec = cached.get(k) or {}
            # Conservar datos de Wikipedia ya descargados previamente para evitar repetir llamadas
            if prev_rec.get("map") or prev_rec.get("len"):
                for fld in ("map", "mapFull", "len", "turns", "op", "dir", "des", "cap", "recLap", "desc", "wiki"):
                    if fld in prev_rec:
                        rec[fld] = prev_rec[fld]
            else:
                wiki_targets.append((k, c["url"]))

    if wiki_targets:
        print(f"  Consultando Wikipedia para {len(wiki_targets)} circuitos faltantes (pausa suave)...", flush=True)
        for idx, (k, wurl) in enumerate(wiki_targets, start=1):
            time.sleep(0.55)
            _, extra = fetch_f1_wiki_enrichment(k, wurl)
            if extra and k in f1_map:
                f1_map[k].update(extra)
            if idx % 10 == 0 or idx == len(wiki_targets):
                print(f"  Wikipedia F1: {idx}/{len(wiki_targets)}", flush=True)


# ---------------------------------------------------------------------------
# 2. ENRIQUECIMIENTO MOTOGP (Pulselive v1/events 2016–2026)
# ---------------------------------------------------------------------------

def enrich_motogp_circuits(mgp_map: dict[str, dict[str, Any]]) -> None:
    print("[Circuitos MotoGP] Descargando planos SVG y fichas técnicas desde Pulselive (2016–2026)...", flush=True)
    pul_circuits: dict[str, dict[str, Any]] = {}

    def fetch_yr(yr: int) -> list[dict[str, Any]]:
        try:
            evs = fetch_json(f"https://api.motogp.pulselive.com/motogp/v1/events?seasonYear={yr}", retries=2)
            return evs if isinstance(evs, list) else []
        except Exception:
            return []

    years = list(range(2026, 2015, -1))
    with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool:
        for evs in pool.map(fetch_yr, years):
            for ev in evs:
                c = ev.get("circuit")
                if not isinstance(c, dict) or not c.get("name"):
                    continue
                ck = norm_text(c["name"])
                if ck in pul_circuits:
                    continue
                tracks = c.get("tracks") or []
                tr = next((t for t in tracks if t.get("is_active")), tracks[0] if tracks else None)
                spec: dict[str, Any] = {}
                if c.get("city"):
                    spec["loc"] = str(c["city"]).strip()
                if c.get("lat") and c.get("lng"):
                    try:
                        spec["lat"] = round(float(c["lat"]), 5)
                        spec["lon"] = round(float(c["lng"]), 5)
                    except ValueError:
                        pass
                if c.get("constructed"):
                    try:
                        spec["op"] = int(c["constructed"])
                    except ValueError:
                        pass
                if c.get("designer"):
                    spec["des"] = str(c["designer"]).strip()
                if c.get("capacity"):
                    spec["cap"] = str(c["capacity"]).strip()
                if isinstance(tr, dict):
                    len_m = (tr.get("lenght_units") or {}).get("meters") or tr.get("lenght")
                    if len_m:
                        try:
                            spec["len"] = round(float(len_m) / 1000.0, 3)
                        except ValueError:
                            pass
                    wid_m = (tr.get("width_units") or {}).get("meters") or tr.get("width")
                    if wid_m:
                        try:
                            spec["wid"] = int(round(float(wid_m)))
                        except ValueError:
                            pass
                    str_m = (tr.get("longest_straight_units") or {}).get("meters") or tr.get("longest_straight")
                    if str_m:
                        try:
                            spec["str"] = int(round(float(str_m)))
                        except ValueError:
                            pass
                    lc_raw = tr.get("left_corners")
                    rc_raw = tr.get("right_corners")
                    if lc_raw is not None and rc_raw is not None:
                        try:
                            lc_i = int(lc_raw)
                            rc_i = int(rc_raw)
                            if lc_i + rc_i > 0:
                                spec["lc"] = lc_i
                                spec["rc"] = rc_i
                                spec["turns"] = lc_i + rc_i
                        except ValueError:
                            pass
                    assets = tr.get("assets") or {}
                    info_path = (assets.get("info") or {}).get("path")
                    simple_path = (assets.get("simple") or {}).get("path")
                    if info_path:
                        spec["map"] = info_path
                        spec["mapFull"] = info_path
                    elif simple_path:
                        spec["map"] = simple_path
                        spec["mapFull"] = simple_path
                pul_circuits[ck] = spec

    matched = 0
    for k, rec in mgp_map.items():
        spec = pul_circuits.get(k)
        if not spec:
            # Coincidencia parcial segura (ej. "jerez" en "circuito de jerez angel nieto")
            for pk, ps in pul_circuits.items():
                if (len(k) >= 6 and k in pk) or (len(pk) >= 6 and pk in k):
                    spec = ps
                    break
        if spec:
            rec.update(spec)
            matched += 1
    print(f"  ✓ Circuitos MotoGP con plano y ficha técnica Pulselive: {matched}/{len(mgp_map)}", flush=True)


# ---------------------------------------------------------------------------
# 3. CRUCE F1 <-> MOTOGP (por nombre o proximidad geográfica < 2.5 km)
# ---------------------------------------------------------------------------

def haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    r = 6371.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = math.radians(lat2 - lat1)
    dl = math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))


def cross_link_circuits(f1_map: dict[str, dict[str, Any]], mgp_map: dict[str, dict[str, Any]]) -> None:
    linked = 0
    for fk, frec in f1_map.items():
        match_mk: str | None = fk if fk in mgp_map else None
        if not match_mk and frec.get("lat") is not None and frec.get("lon") is not None:
            for mk, mrec in mgp_map.items():
                if mrec.get("lat") is not None and mrec.get("lon") is not None:
                    if haversine_km(frec["lat"], frec["lon"], mrec["lat"], mrec["lon"]) < 2.5:
                        match_mk = mk
                        break
        if not match_mk:
            # Coincidencia por tokens icónicos (ej. "red bull ring", "imola", "monza", "jerez", "estoril", "spa francorchamps")
            for kw in ("red bull ring", "jerez", "imola", "monza", "estoril", "spa francorchamps", "sepang", "suzuka", "hockenheim", "zolder", "brands hatch", "assen"):
                if kw in fk:
                    hit = next((mk for mk in mgp_map if kw in mk), None)
                    if hit:
                        match_mk = hit
                        break
        if not match_mk:
            continue

        mrec = mgp_map[match_mk]
        frec["other"] = mrec["n"]
        mrec["other"] = frec["n"]

        # Compartir datos técnicos faltantes entre ambas fichas
        for field in ("lc", "rc", "str", "wid"):
            if field in mrec and field not in frec:
                frec[field] = mrec[field]
        for field in ("map", "mapFull", "desc", "wiki", "len", "turns", "op", "dir", "des", "cap", "lat", "lon", "loc"):
            if field in frec and field not in mrec:
                mrec[field] = frec[field]
        linked += 1
    print(f"  ✓ Circuitos compartidos F1 ↔ MotoGP vinculados: {linked}", flush=True)


def main() -> int:
    prev_f1: dict[str, dict[str, Any]] = {}
    if OUT_PATH.exists():
        try:
            prev_f1 = json.loads(OUT_PATH.read_text(encoding="utf-8")).get("f1") or {}
        except Exception:
            prev_f1 = {}

    f1_circuits = aggregate_circuit_history("f1")
    mgp_circuits = aggregate_circuit_history("motogp")

    enrich_f1_circuits(f1_circuits, prev_f1=prev_f1)
    enrich_motogp_circuits(mgp_circuits)
    cross_link_circuits(f1_circuits, mgp_circuits)

    payload = {
        "updatedAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "f1": f1_circuits,
        "motogp": mgp_circuits,
    }
    OUT_PATH.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    sz = OUT_PATH.stat().st_size / 1024
    f1_maps = sum(1 for v in f1_circuits.values() if v.get("map"))
    mgp_maps = sum(1 for v in mgp_circuits.values() if v.get("map"))
    print(
        f"Guardado {OUT_PATH.name}: {len(f1_circuits)} F1 ({f1_maps} con plano) + "
        f"{len(mgp_circuits)} MotoGP ({mgp_maps} con plano) [{sz:.1f} KB]"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
