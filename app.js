(() => {
  "use strict";

  const STORAGE_KEYS = {
    spoiler: "mundomotor_spoiler_free",
    favorites: "mundomotor_favorites",
  };

  const state = {
    tab: "inicio",
    homeFilter: "all", // all | f1 | motogp
    calFilter: "all",
    calShowAll: true,
    expandedEventId: null,
    // Mundial (temporada actual)
    standingsSeries: "f1", // f1 | motogp
    standingsKind: "drivers", // drivers | teams
    standingsOnlyFavs: false,
    // Archivo (histórico 1949–2025 + fichas y comparador)
    archiveSection: "temporadas", // temporadas | palmares | pilotos | escuderias | circuitos | comparar
    archiveSeries: "f1", // f1 | motogp
    archiveYear: null, // number (defaults to currentSeason - 1)
    archiveKind: "drivers", // drivers | teams | races
    archiveMotoClass: "premier", // premier | 350cc | Moto2 | 250cc | Moto3 | 125cc | 80cc | 50cc
    palmaresMotoScope: "all", // all | premier
    driverQuery: "",
    driverSearchSeries: "all", // all | f1 | motogp
    driverCountryFilter: "all", // all | ES | IT | GB | BR ...
    teamSearchQuery: "",
    teamSearchSeries: "all", // all | f1 | motogp
    teamSearchScope: "all", // all | active
    circuitSearchQuery: "",
    circuitSearchSeries: "all", // all | f1 | motogp
    circuitCountryFilter: "all", // all | ES | IT | GB ...
    compareSeries: "f1", // f1 | motogp
    compareDriverA: "Ayrton Senna",
    compareDriverB: "Alain Prost",
    selectedDriver: null, // { series, name }
    archiveReturnTo: null, // { label, section, driver? }
    driverReturnTo: null, // { label, tab, section?, series?, year?, kind?, motoClass? }
    raceModalEventId: null,
    raceModalView: "race", // race | sprint
    // Noticias
    newsFilter: "all", // all | f1 | motogp
    newsQuery: "",
    // Preferencias
    spoilerFree: localStorage.getItem(STORAGE_KEYS.spoiler) === "1",
    revealedIds: new Set(),
    favorites: new Set(JSON.parse(localStorage.getItem(STORAGE_KEYS.favorites) || "[]")),
    // Datos
    motorsport: null,
    history: null,
    motoClasses: null,
    driversInfo: null,
    circuitsInfo: null,
    teamsMeta: null,
    teamsInfo: null,
    news: null,
    careerIndex: null,
    raceArchiveCache: new Map(), // `${series}:${year}` -> { status: 'loading'|'ready'|'error', events: [] }
    wikiSummaryCache: new Map(), // key -> { thumb, description, extract, wikibaseItem, url } | null
    wikidataCache: new Map(), // qId -> { deathDate, esWikiTitle } | null
    wikiOtherTitlesCache: new Map(), // slug -> [{ name, year }]
    countdownTimer: null,
  };

  const appEl = document.getElementById("app-content");
  const updatedEl = document.getElementById("last-updated");
  const refreshBtn = document.getElementById("refresh-btn");
  const spoilerBtn = document.getElementById("spoiler-toggle");
  const guideBtn = document.getElementById("guide-toggle");
  const guideModal = document.getElementById("guide-modal");
  const teamModal = document.getElementById("team-modal");
  const teamModalTitle = document.getElementById("team-modal-title");
  const teamModalBody = document.getElementById("team-modal-body");
  const raceModal = document.getElementById("race-modal");
  const raceModalTitle = document.getElementById("race-modal-title");
  const raceModalBody = document.getElementById("race-modal-body");
  const circuitModal = document.getElementById("circuit-modal");
  const circuitModalTitle = document.getElementById("circuit-modal-title");
  const circuitModalBody = document.getElementById("circuit-modal-body");
  const toastEl = document.getElementById("toast");

  const userTZ = Intl.DateTimeFormat().resolvedOptions().timeZone || "Hora local";

  function escapeHtml(str) {
    return String(str ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function normalizeText(str) {
    return String(str ?? "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  // Distancia de edición ligera para tolerar erratas (ej. "Caroos Sanz" -> "Carlos Sainz")
  function levenshtein(a, b) {
    if (a === b) return 0;
    if (!a.length) return b.length;
    if (!b.length) return a.length;
    const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
    for (let i = 1; i <= a.length; i++) {
      let corner = prev[0];
      prev[0] = i;
      for (let j = 1; j <= b.length; j++) {
        const upper = prev[j];
        const cost = a[i - 1] === b[j - 1] ? 0 : 1;
        prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, corner + cost);
        corner = upper;
      }
    }
    return prev[b.length];
  }

  function showToast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.add("show");
    clearTimeout(showToast._t);
    showToast._t = setTimeout(() => toastEl.classList.remove("show"), 2600);
  }

  function formatRelativeTime(iso) {
    if (!iso) return "";
    const diffSec = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
    if (diffSec < 60) return "Hace un momento";
    const mins = Math.floor(diffSec / 60);
    if (mins < 60) return `Hace ${mins} min`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `Hace ${hours} h`;
    const days = Math.floor(hours / 24);
    return `Hace ${days} d`;
  }

  function formatSessionTime(iso) {
    if (!iso) return "Por confirmar";
    const d = new Date(iso);
    const day = new Intl.DateTimeFormat("es-ES", {
      weekday: "short",
      day: "numeric",
      month: "short",
    }).format(d);
    const time = new Intl.DateTimeFormat("es-ES", {
      hour: "2-digit",
      minute: "2-digit",
    }).format(d);
    return `${capitalize(day)} · ${time}`;
  }

  function formatHourOnly(iso) {
    return new Intl.DateTimeFormat("es-ES", {
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(iso));
  }

  function formatDateRange(startStr, endStr) {
    if (!startStr) return "";
    const s = new Date(`${startStr}T12:00:00Z`);
    const e = endStr ? new Date(`${endStr}T12:00:00Z`) : s;
    const sameMonth = s.getUTCMonth() === e.getUTCMonth();
    const sDay = s.getUTCDate();
    const eDay = e.getUTCDate();
    const month = new Intl.DateTimeFormat("es-ES", { month: "short", timeZone: "UTC" }).format(e);
    if (startStr === endStr) return `${eDay} ${month}`;
    if (sameMonth) return `${sDay}–${eDay} ${month}`;
    const sMonth = new Intl.DateTimeFormat("es-ES", { month: "short", timeZone: "UTC" }).format(s);
    return `${sDay} ${sMonth} – ${eDay} ${month}`;
  }

  function formatFullDate(dateStr) {
    if (!dateStr) return "";
    const d = new Date(`${dateStr}T12:00:00Z`);
    if (Number.isNaN(d.getTime())) return dateStr;
    return new Intl.DateTimeFormat("es-ES", {
      day: "numeric",
      month: "short",
      year: "numeric",
      timeZone: "UTC",
    }).format(d);
  }

  function capitalize(s) {
    return s ? s.charAt(0).toUpperCase() + s.slice(1) : "";
  }

  function formatPoints(pts) {
    const n = Number(pts || 0);
    return Number.isInteger(n) ? String(n) : n.toFixed(1).replace(".", ",");
  }

  // -------------------------------------------------------------------------
  // PALETA DE EQUIPOS Y MINIATURAS SVG (F1 Y MOTOGP, ACTUALES E HISTÓRICOS)
  // -------------------------------------------------------------------------
  const F1_LIVERIES = [
    ["aston martin", { primary: "#229971", accent: "#cedc00", bar: "#229971" }],
    ["ferrari", { primary: "#dc0000", accent: "#facc15", bar: "#e10600" }],
    ["mercedes", { primary: "#b8c2cc", accent: "#27f4d2", bar: "#27f4d2" }],
    ["red bull", { primary: "#1e3a8a", accent: "#facc15", bar: "#3b82f6" }],
    ["mclaren", { primary: "#ff8000", accent: "#18181b", bar: "#ff8000" }],
    ["williams", { primary: "#005aff", accent: "#38bdf8", bar: "#2563eb" }],
    ["alpine", { primary: "#0093cc", accent: "#ff66b2", bar: "#0ea5e9" }],
    ["haas", { primary: "#e5e7eb", accent: "#e10600", bar: "#ef4444" }],
    ["audi", { primary: "#c8102e", accent: "#cbd5e1", bar: "#e11d48" }],
    ["cadillac", { primary: "#d4af37", accent: "#1f2937", bar: "#eab308" }],
    ["rb f1", { primary: "#2563eb", accent: "#f8fafc", bar: "#3b82f6" }],
    ["racing bulls", { primary: "#2563eb", accent: "#f8fafc", bar: "#3b82f6" }],
    ["alphatauri", { primary: "#1e293b", accent: "#f8fafc", bar: "#94a3b8" }],
    ["toro rosso", { primary: "#1d4ed8", accent: "#ef4444", bar: "#3b82f6" }],
    ["kick sauber", { primary: "#52e252", accent: "#111827", bar: "#22c55e" }],
    ["sauber", { primary: "#52e252", accent: "#111827", bar: "#22c55e" }],
    ["alfa romeo", { primary: "#991b1b", accent: "#f3f4f6", bar: "#b91c1c" }],
    ["renault", { primary: "#facc15", accent: "#18181b", bar: "#eab308" }],
    ["lotus", { primary: "#1f2937", accent: "#eab308", bar: "#eab308" }],
    ["benetton", { primary: "#0ea5e9", accent: "#22c55e", bar: "#38bdf8" }],
    ["jordan", { primary: "#facc15", accent: "#18181b", bar: "#facc15" }],
    ["brawn", { primary: "#f8fafc", accent: "#bef264", bar: "#bef264" }],
    ["force india", { primary: "#f472b6", accent: "#ffffff", bar: "#f472b6" }],
    ["racing point", { primary: "#f472b6", accent: "#ffffff", bar: "#f472b6" }],
    ["brabham", { primary: "#1d4ed8", accent: "#f8fafc", bar: "#3b82f6" }],
    ["tyrrell", { primary: "#1e40af", accent: "#93c5fd", bar: "#2563eb" }],
    ["ligier", { primary: "#2563eb", accent: "#ffffff", bar: "#3b82f6" }],
    ["prost", { primary: "#2563eb", accent: "#ffffff", bar: "#3b82f6" }],
    ["bmw", { primary: "#f8fafc", accent: "#1d4ed8", bar: "#60a5fa" }],
    ["toyota", { primary: "#f8fafc", accent: "#dc2626", bar: "#ef4444" }],
    ["honda", { primary: "#f8fafc", accent: "#dc2626", bar: "#ef4444" }],
    ["bar", { primary: "#f8fafc", accent: "#dc2626", bar: "#ef4444" }],
    ["jaguar", { primary: "#15803d", accent: "#facc15", bar: "#22c55e" }],
    ["cooper", { primary: "#15803d", accent: "#f8fafc", bar: "#22c55e" }],
    ["brm", { primary: "#15803d", accent: "#f97316", bar: "#22c55e" }],
    ["vanwall", { primary: "#15803d", accent: "#facc15", bar: "#22c55e" }],
    ["maserati", { primary: "#b91c1c", accent: "#e5e7eb", bar: "#dc2626" }],
    ["matra", { primary: "#0284c7", accent: "#ffffff", bar: "#0ea5e9" }],
    ["arrows", { primary: "#f97316", accent: "#18181b", bar: "#f97316" }],
    ["minardi", { primary: "#334155", accent: "#facc15", bar: "#94a3b8" }],
    ["march", { primary: "#06b6d4", accent: "#f8fafc", bar: "#06b6d4" }],
  ];

  const MOTOGP_LIVERIES = [
    ["vr46", { primary: "#d9f932", accent: "#111827", bar: "#d9f932" }],
    ["gresini", { primary: "#7dd3fc", accent: "#e11d48", bar: "#38bdf8" }],
    ["pramac", { primary: "#7c3aed", accent: "#2563eb", bar: "#8b5cf6" }],
    ["trackhouse", { primary: "#0ea5e9", accent: "#facc15", bar: "#38bdf8" }],
    ["tech3", { primary: "#ea580c", accent: "#1e3a8a", bar: "#f97316" }],
    ["gasgas", { primary: "#e11d48", accent: "#18181b", bar: "#e11d48" }],
    ["lcr", { primary: "#f8fafc", accent: "#16a34a", bar: "#22c55e" }],
    ["castrol", { primary: "#dc2626", accent: "#16a34a", bar: "#ef4444" }],
    ["repsol", { primary: "#ff6a00", accent: "#dc2626", bar: "#ff6a00" }],
    ["ducati", { primary: "#cc0000", accent: "#18181b", bar: "#dc2626" }],
    ["aprilia", { primary: "#27272a", accent: "#e11d48", bar: "#f43f5e" }],
    ["ktm", { primary: "#ff6600", accent: "#1e3a8a", bar: "#ff6600" }],
    ["yamaha", { primary: "#0047ab", accent: "#18181b", bar: "#2563eb" }],
    ["honda", { primary: "#dc2626", accent: "#1d4ed8", bar: "#ef4444" }],
    ["suzuki", { primary: "#0284c7", accent: "#e2e8f0", bar: "#0ea5e9" }],
    ["kawasaki", { primary: "#22c55e", accent: "#111827", bar: "#22c55e" }],
    ["cagiva", { primary: "#dc2626", accent: "#f8fafc", bar: "#ef4444" }],
    ["mv agusta", { primary: "#dc2626", accent: "#cbd5e1", bar: "#ef4444" }],
    ["gilera", { primary: "#dc2626", accent: "#cbd5e1", bar: "#ef4444" }],
    ["norton", { primary: "#cbd5e1", accent: "#18181b", bar: "#94a3b8" }],
  ];

  function getTeamLivery(series, teamName) {
    const norm = normalizeText(teamName);
    const list = series === "f1" ? F1_LIVERIES : MOTOGP_LIVERIES;
    for (const [key, livery] of list) {
      if (norm.includes(key)) return livery;
    }
    return series === "f1"
      ? { primary: "#64748b", accent: "#e10600", bar: "#e10600" }
      : { primary: "#64748b", accent: "#ff5c1a", bar: "#ff5c1a" };
  }

  function renderVehicleThumb(series, teamName, variant = false) {
    const { primary, accent } = getTeamLivery(series, teamName);
    const sizeClass = variant === true || variant === "compact" ? " compact" : variant === "large" ? " large" : "";
    const cls = `vehicle-thumb${sizeClass}`;
    const title = escapeHtml(teamName || (series === "f1" ? "F1" : "MotoGP"));

    if (series === "f1") {
      return `
        <span class="${cls} f1" title="${title}" aria-hidden="true">
          <svg viewBox="0 0 88 28" fill="none" xmlns="http://www.w3.org/2000/svg">
            <rect x="6" y="21" width="74" height="2.6" rx="1.3" fill="#0b0e14"/>
            <path d="M5 9H15L14 16H7Z" fill="${primary}" stroke="rgba(255,255,255,0.22)" stroke-width="0.6"/>
            <path d="M6 10.2H14.2" stroke="${accent}" stroke-width="1.6" stroke-linecap="round"/>
            <path d="M13 18L22 10.5H36L45 14H66L80 18.2L79 21H13Z" fill="${primary}" stroke="rgba(255,255,255,0.18)" stroke-width="0.6"/>
            <path d="M23 15.6H58L74 18.8H21Z" fill="${accent}"/>
            <path d="M37 14C39 10.6 45 10.5 48 13.8" stroke="#cbd5e1" stroke-width="1.4" stroke-linecap="round"/>
            <circle cx="42" cy="12.2" r="2.2" fill="#f8fafc"/>
            <path d="M74 18.5H84L82.5 21.2H73Z" fill="${accent}"/>
            <circle cx="21" cy="20" r="6" fill="#12161f" stroke="#475569" stroke-width="1.5"/>
            <circle cx="21" cy="20" r="2.3" fill="${accent}"/>
            <circle cx="66" cy="20" r="6" fill="#12161f" stroke="#475569" stroke-width="1.5"/>
            <circle cx="66" cy="20" r="2.3" fill="${accent}"/>
          </svg>
        </span>`;
    }

    return `
      <span class="${cls} motogp" title="${title}" aria-hidden="true">
        <svg viewBox="0 0 76 32" fill="none" xmlns="http://www.w3.org/2000/svg">
          <circle cx="17" cy="23" r="6.8" fill="#12161f" stroke="#475569" stroke-width="1.6"/>
          <circle cx="17" cy="23" r="3" fill="none" stroke="${accent}" stroke-width="1.4"/>
          <circle cx="59" cy="23" r="6.8" fill="#12161f" stroke="#475569" stroke-width="1.6"/>
          <circle cx="59" cy="23" r="3" fill="none" stroke="${accent}" stroke-width="1.4"/>
          <path d="M17 23L34 21L47 16L59 23" stroke="#64748b" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>
          <path d="M15 19.5L26 18" stroke="#cbd5e1" stroke-width="1.8" stroke-linecap="round"/>
          <path d="M12 12L25 14.5L32 14L44 8.5L58 10.5L65 15.5L54 19.5L34 20.5L23 16.5Z" fill="${primary}" stroke="rgba(255,255,255,0.2)" stroke-width="0.7"/>
          <path d="M35 14.5L56 12.2L61 15.4L39 18.2Z" fill="${accent}"/>
          <path d="M47 8.8L54 6.5L58.5 10.4Z" fill="#cbd5e1" fill-opacity="0.75"/>
          <path d="M23 13.8L33 13.8" stroke="#0f172a" stroke-width="2.2" stroke-linecap="round"/>
        </svg>
      </span>`;
  }

  // -------------------------------------------------------------------------
  // NOTAS HISTÓRICAS DE PUNTUACIÓN POR TEMPORADA
  // -------------------------------------------------------------------------
  function getScoringNote(series, year) {
    const y = Number(year);
    if (series === "f1") {
      if (y <= 1957) {
        return {
          title: `Sistema de puntuación F1 (${y}): 8 puntos por victoria`,
          detail: "Escala 8–6–4–3–2 (top 5) + 1 punto por vuelta rápida. Solo contaban los mejores resultados del año y aún no existía el Mundial de Constructores (empezó en 1958).",
        };
      }
      if (y <= 1959) {
        return {
          title: `Sistema de puntuación F1 (${y}): 8 puntos por victoria`,
          detail: "Escala 8–6–4–3–2 (top 5) + 1 punto por vuelta rápida. Solo contaban los mejores resultados de la temporada.",
        };
      }
      if (y === 1960) {
        return {
          title: `Sistema de puntuación F1 (${y}): 8 puntos por victoria`,
          detail: "Escala 8–6–4–3–2–1 (puntuaban los 6 primeros). Se eliminó el punto extra por vuelta rápida y solo contaban los mejores resultados.",
        };
      }
      if (y <= 1990) {
        return {
          title: `Sistema de puntuación F1 (${y}): 9 puntos por victoria`,
          detail: "Escala 9–6–4–3–2–1 (solo puntuaban los 6 primeros). Además existían descartes: solo contaban los mejores resultados del año, por eso las cifras totales eran mucho más bajas que hoy.",
        };
      }
      if (y <= 2002) {
        return {
          title: `Sistema de puntuación F1 (${y}): 10 puntos por victoria`,
          detail: "Escala 10–6–4–3–2–1 (top 6). A partir de 1991 empezaron a contar todas las carreras del campeonato sin descartes.",
        };
      }
      if (y <= 2009) {
        return {
          title: `Sistema de puntuación F1 (${y}): 10 puntos por victoria`,
          detail: "Escala 10–8–6–5–4–3–2–1 (se amplió la zona de puntos a los 8 primeros).",
        };
      }
      if (y <= 2018) {
        return {
          title: `Sistema de puntuación F1 (${y}): 25 puntos por victoria`,
          detail: "Escala moderna 25–18–15–12–10–8–6–4–2–1 (top 10). Este gran salto multiplicó las puntuaciones finales respecto a décadas anteriores.",
        };
      }
      if (y <= 2020) {
        return {
          title: `Sistema de puntuación F1 (${y}): 25 puntos por victoria (+1 vuelta rápida)`,
          detail: "Escala 25–18–15–12–10–8–6–4–2–1 (top 10) más 1 punto extra por vuelta rápida si se acababa entre los 10 primeros.",
        };
      }
      if (y === 2021) {
        return {
          title: `Sistema de puntuación F1 (${y}): 25 pts por GP + primeras Sprint`,
          detail: "Escala 25–18–15…1 (top 10) + 1 pt vuelta rápida + primeras carreras Sprint (3–2–1 pts en citas seleccionadas).",
        };
      }
      if (y <= 2024) {
        return {
          title: `Sistema de puntuación F1 (${y}): 25 pts por GP + Sprint (8 pts)`,
          detail: "Escala 25–18–15…1 (top 10) + 1 pt vuelta rápida + Sprint en GPs seleccionados (8–7–6–5–4–3–2–1).",
        };
      }
      return {
        title: `Sistema de puntuación F1 (${y}): 25 pts por GP + Sprint (8 pts)`,
        detail: "Escala 25–18–15–12–10–8–6–4–2–1 (top 10) + Sprint en GPs seleccionados (8–1, top 8). Sin punto extra por vuelta rápida.",
      };
    }

    // MotoGP / 500cc
    if (y === 1949) {
      return {
        title: `Sistema de puntuación 500cc (${y}): 10 puntos por victoria`,
        detail: "Primera temporada del Mundial. Escala 10–8–7–6–5 (top 5) + 1 punto por vuelta rápida; solo contaban los mejores resultados.",
      };
    }
    if (y <= 1968) {
      return {
        title: `Sistema de puntuación 500cc (${y}): 8 puntos por victoria`,
        detail: "Escala 8–6–4–3–2–1 (puntuaban los 6 primeros) con descartes de peores resultados y campeonatos de menos carreras.",
      };
    }
    if (y <= 1987) {
      return {
        title: `Sistema de puntuación 500cc (${y}): 15 puntos por victoria`,
        detail: "Categoría reina 500cc. Escala 15–12–10–8–6–5–4–3–2–1 (puntuaban los 10 primeros), por eso los campeones sumaban alrededor de 100–150 puntos.",
      };
    }
    if (y <= 1991) {
      return {
        title: `Sistema de puntuación 500cc (${y}): 20 puntos por victoria`,
        detail: "Categoría 500cc. Escala ampliada a los 15 primeros: 20–17–15–13–11–10–9–8–7–6–5–4–3–2–1.",
      };
    }
    if (y === 1992) {
      return {
        title: `Sistema de puntuación 500cc (${y}): 20 puntos por victoria`,
        detail: "Escala temporal de una sola temporada (top 10): 20–15–12–10–8–6–4–3–2–1.",
      };
    }
    if (y <= 2001) {
      return {
        title: `Sistema de puntuación 500cc (${y}): 25 puntos por victoria`,
        detail: "Última década de 500cc (2 tiempos). Escala 25–20–16–13–11–10–9–8–7–6–5–4–3–2–1 (top 15).",
      };
    }
    if (y <= 2022) {
      return {
        title: `Sistema de puntuación MotoGP (${y}): 25 puntos por victoria`,
        detail: "Era MotoGP (4 tiempos). Escala 25–20–16–13–11–10–9–8–7–6–5–4–3–2–1 (top 15) solo en la carrera del domingo.",
      };
    }
    return {
      title: `Sistema de puntuación MotoGP (${y}): 25 pts domingo + 12 pts Sprint`,
      detail: "Carrera domingo: 25–20–16…1 (top 15) + Carrera Sprint cada sábado: 12–9–7–6–5–4–3–2–1 (top 9). Hasta 37 puntos por GP, de ahí las cifras récord actuales.",
    };
  }

  // -------------------------------------------------------------------------
  // HELPERS DE DATOS (TEMPORADA ACTUAL + HISTÓRICO UNIFICADO)
  // -------------------------------------------------------------------------
  function getCurrentSeasonYear(series) {
    return Number(state.motorsport?.[series]?.season || new Date().getFullYear());
  }

  function getAvailableYears(series) {
    const years = new Set();
    const cur = getCurrentSeasonYear(series);
    if (cur) years.add(cur);
    const histObj = state.history?.[series] || {};
    Object.keys(histObj).forEach((y) => years.add(Number(y)));
    return Array.from(years).sort((a, b) => b - a);
  }

  const MOTO_CLASS_ORDER = ["MotoGP", "500cc", "350cc", "Moto2", "250cc", "Moto3", "125cc", "80cc", "50cc"];

  function motoClassRank(cat) {
    const idx = MOTO_CLASS_ORDER.indexOf(cat);
    return idx === -1 ? 99 : idx;
  }

  function formatTitleBreakdown(byCatObj) {
    const entries = Object.entries(byCatObj || {})
      .filter(([, count]) => count > 0)
      .sort((a, b) => motoClassRank(a[0]) - motoClassRank(b[0]));
    if (!entries.length) return "";
    return entries.map(([cat, count]) => `${count}× ${cat}`).join(" · ");
  }

  function getAvailableMotoClasses(year) {
    const y = Number(year);
    const cur = getCurrentSeasonYear("motogp");
    const premierLabel = y >= 2002 ? "MotoGP" : "500cc";
    const list = [{ key: "premier", label: premierLabel }];
    if (y === cur) return list;
    const extra = state.motoClasses?.years?.[String(y)];
    if (extra) {
      Object.keys(extra)
        .sort((a, b) => motoClassRank(a) - motoClassRank(b))
        .forEach((cls) => list.push({ key: cls, label: cls }));
    }
    return list;
  }

  function getSeasonStandings(series, year, motoClass = "premier") {
    const cur = getCurrentSeasonYear(series);
    if (Number(year) === cur && state.motorsport?.[series]?.standings) {
      const s = state.motorsport[series].standings;
      return {
        isCurrent: true,
        category: series === "f1" ? "Fórmula 1" : "MotoGP",
        drivers: s.drivers || [],
        teams: s.teams || [],
      };
    }
    if (series === "motogp" && motoClass && motoClass !== "premier") {
      const sub = state.motoClasses?.years?.[String(year)]?.[motoClass];
      if (!sub) return { isCurrent: false, category: motoClass, drivers: [], teams: [] };
      return {
        isCurrent: false,
        category: motoClass,
        drivers: (sub.d || []).map((r) => ({
          position: r.p,
          name: r.n,
          team: r.t || "",
          points: r.pts,
          wins: r.w || 0,
          number: "",
        })),
        teams: (sub.c || []).map((r) => ({
          position: r.p,
          name: r.n,
          points: r.pts,
          wins: r.w || 0,
        })),
      };
    }
    const h = state.history?.[series]?.[String(year)];
    if (!h) return { isCurrent: false, drivers: [], teams: [] };
    return {
      isCurrent: false,
      category: h.cat || (series === "f1" ? "Fórmula 1" : Number(year) >= 2002 ? "MotoGP" : "500cc"),
      drivers: (h.d || []).map((r) => ({
        position: r.p,
        name: r.n,
        team: r.t || "",
        points: r.pts,
        wins: r.w || 0,
        number: "",
      })),
      teams: (h.c || []).map((r) => ({
        position: r.p,
        name: r.n,
        points: r.pts,
        wins: r.w || 0,
      })),
    };
  }

  // Índice universal de todos los pilotos (F1 1950–actual + MotoGP/todas las categorías 1949–actual)
  function buildCareerIndex() {
    const map = new Map();

    const addSeason = (series, year, category, classKey, drivers) => {
      drivers.forEach((d) => {
        if (!d.name) return;
        const norm = normalizeText(d.name);
        const key = `${series}:${norm}`;
        if (!map.has(key)) {
          map.set(key, {
            key,
            series,
            name: d.name,
            norm,
            tokens: norm.split(" "),
            seasons: [],
          });
        }
        const entry = map.get(key);
        if (!entry.seasons.some((s) => s.year === year && s.category === category)) {
          entry.seasons.push({
            year,
            category,
            classKey,
            position: d.position,
            team: d.team || "",
            points: d.points,
            wins: d.wins || 0,
          });
        }
      });
    };

    ["f1", "motogp"].forEach((series) => {
      const years = getAvailableYears(series);
      years.forEach((yr) => {
        const st = getSeasonStandings(series, yr, "premier");
        const catLabel = series === "f1" ? "F1" : yr >= 2002 ? "MotoGP" : "500cc";
        addSeason(series, yr, catLabel, "premier", st.drivers);

        if (series === "motogp") {
          const extra = state.motoClasses?.years?.[String(yr)];
          if (extra) {
            Object.keys(extra)
              .sort((a, b) => motoClassRank(a) - motoClassRank(b))
              .forEach((cls) => {
                const subSt = getSeasonStandings("motogp", yr, cls);
                addSeason("motogp", yr, cls, cls, subSt.drivers);
              });
          }
        }
      });
    });

    const list = Array.from(map.values()).map((entry) => {
      entry.seasons.sort((a, b) => b.year - a.year || motoClassRank(a.category) - motoClassRank(b.category));
      const curYear = getCurrentSeasonYear(entry.series);
      const completedSeasons = entry.seasons.filter((s) => s.year < curYear);
      const titleSeasons = completedSeasons.filter((s) => s.position === 1);
      entry.titles = titleSeasons.length;
      entry.titlesByCat = {};
      titleSeasons.forEach((s) => {
        entry.titlesByCat[s.category] = (entry.titlesByCat[s.category] || 0) + 1;
      });
      entry.titleBreakdown = formatTitleBreakdown(entry.titlesByCat);
      entry.categories = Array.from(new Set(entry.seasons.map((s) => s.category))).sort(
        (a, b) => motoClassRank(a) - motoClassRank(b)
      );
      entry.bestPos = Math.min(...entry.seasons.map((s) => s.position || 999));
      entry.totalWins = entry.seasons.reduce((acc, s) => acc + (s.wins || 0), 0);
      entry.firstYear = entry.seasons[entry.seasons.length - 1]?.year;
      entry.lastYear = entry.seasons[0]?.year;
      entry.distinctYears = new Set(entry.seasons.map((s) => s.year)).size;
      const meta = getDriverMeta(entry.series, entry.name);
      entry.flag = meta?.fl || "";
      entry.countryIso = meta?.iso || "";
      entry.countryName = meta?.co || meta?.nat || "";
      entry.legend = Boolean(meta?.leg);
      return entry;
    });

    list.sort((a, b) => b.titles - a.titles || a.bestPos - b.bestPos || b.distinctYears - a.distinctYears);
    state.careerIndex = list;
  }

  function getDriverMeta(series, name) {
    if (!state.driversInfo || !name) return null;
    const norm = normalizeText(name);
    return state.driversInfo?.[series]?.[norm] || null;
  }

  function extractWikiSlug(wikiUrl) {
    if (!wikiUrl) return "";
    const parts = String(wikiUrl).split("/wiki/");
    return parts.length > 1 ? decodeURIComponent(parts[1].split("#")[0]) : "";
  }

  async function fetchWikiSummary(wikiUrl, fallbackTitle = "", forceLang = null) {
    const slug = extractWikiSlug(wikiUrl) || String(fallbackTitle || "").trim().replace(/\s+/g, "_");
    if (!slug) return null;
    const lang = forceLang || (wikiUrl && String(wikiUrl).includes("es.wikipedia.org") ? "es" : "en");
    const cacheKey = `${lang}:${slug.toLowerCase()}`;
    if (state.wikiSummaryCache.has(cacheKey)) {
      return state.wikiSummaryCache.get(cacheKey);
    }
    try {
      const res = await fetch(
        `https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(slug)}`
      );
      if (!res.ok) {
        state.wikiSummaryCache.set(cacheKey, null);
        return null;
      }
      const data = await res.json();
      const summary = {
        thumb: data?.thumbnail?.source || data?.originalimage?.source || null,
        description: String(data?.description || ""),
        extract: String(data?.extract || ""),
        wikibaseItem: data?.wikibase_item || null,
        pageUrl: data?.content_urls?.desktop?.page || "",
      };
      state.wikiSummaryCache.set(cacheKey, summary);
      return summary;
    } catch {
      state.wikiSummaryCache.set(cacheKey, null);
      return null;
    }
  }

  async function fetchWikidataExtras(qId) {
    if (!qId) return null;
    if (state.wikidataCache.has(qId)) return state.wikidataCache.get(qId);
    try {
      const res = await fetch(
        `https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${encodeURIComponent(qId)}&props=claims|sitelinks&sitefilter=eswiki&format=json&origin=*`
      );
      if (!res.ok) {
        state.wikidataCache.set(qId, null);
        return null;
      }
      const data = await res.json();
      const ent = data?.entities?.[qId];
      if (!ent) {
        state.wikidataCache.set(qId, null);
        return null;
      }
      let deathDate = null;
      const p570 = ent.claims?.P570;
      if (Array.isArray(p570) && p570.length) {
        const rawTime = p570[0]?.mainsnak?.datavalue?.value?.time || "";
        const m = rawTime.match(/^\+(\d{4})-(\d{2})-(\d{2})/);
        if (m) {
          deathDate = m[2] === "00" || m[3] === "00" ? m[1] : `${m[1]}-${m[2]}-${m[3]}`;
        }
      }
      const esWikiTitle = ent.sitelinks?.eswiki?.title || null;
      const out = { deathDate, esWikiTitle };
      state.wikidataCache.set(qId, out);
      return out;
    } catch {
      state.wikidataCache.set(qId, null);
      return null;
    }
  }

  function formatDeathDisplay(deathDateStr, dobStr = "") {
    if (!deathDateStr) return "";
    if (/^\d{4}$/.test(deathDateStr)) return deathDateStr;
    const formatted = formatFullDate(deathDateStr);
    if (!dobStr) return formatted;
    const dob = new Date(`${dobStr}T12:00:00Z`);
    const dod = new Date(`${deathDateStr}T12:00:00Z`);
    if (Number.isNaN(dob.getTime()) || Number.isNaN(dod.getTime())) return formatted;
    let age = dod.getUTCFullYear() - dob.getUTCFullYear();
    const mDiff = dod.getUTCMonth() - dob.getUTCMonth();
    if (mDiff < 0 || (mDiff === 0 && dod.getUTCDate() < dob.getUTCDate())) age -= 1;
    return age >= 15 && age <= 115 ? `${formatted} (${age} años)` : formatted;
  }

  function truncateSummaryEs(text, maxLen = 300) {
    const clean = String(text || "").replace(/\s+/g, " ").trim();
    if (!clean) return "";
    if (clean.length <= maxLen) return clean;
    const cut = clean.slice(0, maxLen).split(/(?<=[.!?])\s+/);
    if (cut.length > 1 && cut[0].length >= 80) return cut.slice(0, -1).join(" ");
    return clean.slice(0, maxLen - 1).replace(/\s+\S*$/, "") + "…";
  }

  function extractDeathYear(summary, metaDob = "") {
    if (!summary) return null;
    const desc = summary.description || "";
    const ext = summary.extract || "";
    const combined = `${desc} ${ext.slice(0, 220)}`.toLowerCase();
    const isMotorsport = /(racing|driver|motorcycle|racer|motorsport|formula|grand prix|motogp|piloto)/.test(combined);

    let birthYear = null;
    let deathYear = null;
    const mDesc = desc.match(/\((\d{4})\s*[–-]\s*(\d{4})\)/);
    if (mDesc) {
      birthYear = Number(mDesc[1]);
      deathYear = Number(mDesc[2]);
    } else {
      const mExt = ext.slice(0, 180).match(/\((?:[^)]*?)\b(18\d{2}|19\d{2}|20\d{2})\b[^)]*?[–-][^)]*?\b(19\d{2}|20\d{2})\b\)/);
      if (mExt) {
        birthYear = Number(mExt[1]);
        deathYear = Number(mExt[2]);
      }
    }

    if (!birthYear || !deathYear) return null;
    const curYr = new Date().getFullYear();
    if (deathYear < birthYear + 15 || deathYear > curYr) return null;

    if (metaDob) {
      const dobYr = Number(String(metaDob).slice(0, 4));
      if (dobYr && Math.abs(dobYr - birthYear) > 1) return null;
    } else if (!isMotorsport) {
      return null;
    }

    return deathYear;
  }

  function isLikelySameDriver(summary, metaDob = "") {
    if (!summary) return false;
    const combined = `${summary.description || ""} ${(summary.extract || "").slice(0, 260)}`.toLowerCase();
    if (/(racing|driver|motorcycle|racer|motorsport|formula|grand prix|motogp|piloto|motocicl)/.test(combined)) {
      return true;
    }
    if (metaDob) {
      const dobYr = String(metaDob).slice(0, 4);
      if (dobYr && combined.includes(dobYr)) return true;
    }
    return false;
  }

  function cleanWikiInline(raw) {
    return String(raw || "")
      .replace(/<!--[\s\S]*?-->/g, "")
      .replace(/<ref[^>]*\/>/gi, "")
      .replace(/<ref[^>]*>[\s\S]*?<\/ref>/gi, "")
      .replace(/\{\{(?:F2|FIAF3|GP2|GP3|WEC|FE|IndyCar|WRC|F1|FIAF4)\|([^|}]+)[^}]*\}\}/gi, "$1")
      .replace(/\{\{(?:nowrap|small)\|([^}]+)\}\}/gi, "$1")
      .replace(/\{\{[^}]*\}\}/g, "")
      .replace(/\[\[[^|\]]*\|([^\]]+)\]\]/g, "$1")
      .replace(/\[\[([^\]]+)\]\]/g, "$1")
      .replace(/'''?/g, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function splitWikiListBlock(raw) {
    if (!raw) return [];
    let body = String(raw).trim();
    // Desenvolver {{plainlist|...}} o {{ubl|...}} o {{unbulleted list|...}}
    const mPlain = body.match(/^\{\{(?:plainlist|flatlist)\s*\|([\s\S]*?)(?:\}\}\s*)?$/i);
    if (mPlain) body = mPlain[1];
    const mUbl = body.match(/^\{\{(?:ubl|unbulleted list|hlist)\s*\|([\s\S]*?)(?:\}\}\s*)?$/i);
    if (mUbl) {
      return mUbl[1]
        .replace(/\}\}\s*$/, "")
        .split("|")
        .map((s) => cleanWikiInline(s))
        .filter(Boolean);
    }
    if (/^\s*\*/m.test(body)) {
      return body
        .replace(/\}\}\s*$/, "")
        .split(/\r?\n/)
        .filter((l) => /^\s*\*/.test(l))
        .map((l) => cleanWikiInline(l.replace(/^\s*\*+\s*/, "")))
        .filter(Boolean);
    }
    return body
      .replace(/\}\}\s*$/, "")
      .split(/<br\s*\/?>|\r?\n/i)
      .map((s) => cleanWikiInline(s))
      .filter(Boolean);
  }

  function parseF1OtherTitlesFromWikitext(wt) {
    if (!wt) return [];
    const results = [];
    const seen = new Set();
    const pushItem = (name, year = "") => {
      const cleanName = String(name || "").trim();
      const cleanYear = String(year || "").trim();
      if (!cleanName || cleanName.length < 2 || /^\d+$/.test(cleanName)) return;
      if (/^formula one$/i.test(cleanName)) return;
      const key = `${cleanName.toLowerCase()}|${cleanYear}`;
      if (seen.has(key)) return;
      seen.add(key);
      results.push({ name: cleanName, year: cleanYear });
    };

    // 1) Otros campeonatos mundiales/mayores en submódulos (ej. WEC, Formula E, IndyCar)
    const champRe = /\|\s*championships\s*=\s*([^\n]+)/gi;
    let m;
    while ((m = champRe.exec(wt)) !== null) {
      const val = m[1];
      if (/\{\{F1\|/i.test(val) || /^0\b/.test(val.trim())) continue;
      const mWec = val.match(/\{\{WEC\|([^|}]+)/i);
      if (mWec) pushItem("Mundial de Resistencia (WEC)", mWec[1]);
      const mFe = val.match(/\{\{(?:FE|Formula E)\|([^|}]+)/i);
      if (mFe) pushItem("Fórmula E", mFe[1]);
      const mIndy = val.match(/\{\{(?:IndyCar|CART)\|([^|}]+)/i);
      if (mIndy) pushItem("IndyCar / CART", mIndy[1]);
    }

    // 2) Bloques | titles = ... y | title_years = ...
    const fieldRe = /\|\s*(titles|title_years)\s*=\s*([\s\S]*?)(?=\n\s*\||\n\s*\}\}|$)/gi;
    const titleBlocks = [];
    const yearBlocks = [];
    while ((m = fieldRe.exec(wt)) !== null) {
      const kind = m[1].toLowerCase();
      if (kind === "titles") titleBlocks.push(splitWikiListBlock(m[2]));
      else yearBlocks.push(splitWikiListBlock(m[2]));
    }
    titleBlocks.forEach((tList, idx) => {
      const yList = yearBlocks[idx] || [];
      tList.forEach((tName, i) => {
        pushItem(tName, yList[i] || "");
      });
    });

    return results.slice(0, 12);
  }

  async function fetchF1OtherTitles(wikiUrl, driverName) {
    const slug = extractWikiSlug(wikiUrl) || String(driverName || "").trim().replace(/\s+/g, "_");
    if (!slug) return [];
    const cacheKey = slug.toLowerCase();
    if (state.wikiOtherTitlesCache.has(cacheKey)) {
      return state.wikiOtherTitlesCache.get(cacheKey);
    }
    try {
      const res = await fetch(
        `https://en.wikipedia.org/w/api.php?action=parse&page=${encodeURIComponent(slug)}&prop=wikitext&section=0&redirects=1&format=json&origin=*`
      );
      if (!res.ok) {
        state.wikiOtherTitlesCache.set(cacheKey, []);
        return [];
      }
      const data = await res.json();
      const wt = data?.parse?.wikitext?.["*"] || "";
      const items = parseF1OtherTitlesFromWikitext(wt);
      state.wikiOtherTitlesCache.set(cacheKey, items);
      return items;
    } catch {
      state.wikiOtherTitlesCache.set(cacheKey, []);
      return [];
    }
  }

  async function hydrateDriverProfile(slotId, bioGridId, summaryId, wikiLinkId, otherTitlesId, series, driverName, meta) {
    const targetKey = `${series}:${normalizeText(driverName)}`;
    const summary = await fetchWikiSummary(meta?.wiki || "", driverName);
    if (!summary || !isLikelySameDriver(summary, meta?.dob || "")) return;

    if (!meta?.pic && summary.thumb) {
      const slot = document.getElementById(slotId);
      if (slot && slot.dataset.portraitTarget === targetKey) {
        slot.innerHTML = `<div class="driver-portrait-wrap"><img class="driver-portrait-img" src="${escapeHtml(summary.thumb)}" alt="Foto de ${escapeHtml(driverName)}" loading="lazy" onerror="this.parentElement.remove()"></div>`;
      }
    }

    // Consultar Wikidata (fecha exacta de fallecimiento P570 + enlace exacto a Wikipedia en español)
    let exactDeath = null;
    let esTitle = null;
    if (summary.wikibaseItem) {
      const wd = await fetchWikidataExtras(summary.wikibaseItem);
      if (wd) {
        exactDeath = wd.deathDate;
        esTitle = wd.esWikiTitle;
      }
    }

    const fallbackYear = extractDeathYear(summary, meta?.dob || "");
    const deathVal = exactDeath || (fallbackYear ? String(fallbackYear) : null);
    if (deathVal) {
      const bioGrid = document.getElementById(bioGridId);
      if (bioGrid && bioGrid.dataset.bioTarget === targetKey && !bioGrid.querySelector("[data-death-card]")) {
        bioGrid.hidden = false;
        const card = document.createElement("div");
        card.className = "driver-bio-item";
        card.dataset.deathCard = "1";
        card.innerHTML = `<small>Fallecimiento</small><strong>${escapeHtml(formatDeathDisplay(deathVal, meta?.dob || ""))}</strong>`;
        const birthNode = bioGrid.querySelector("[data-birth-card]");
        if (birthNode && birthNode.nextSibling) {
          bioGrid.insertBefore(card, birthNode.nextSibling);
        } else {
          bioGrid.appendChild(card);
        }
      }
    }

    // Resumen biográfico breve en español y enlace a es.wikipedia.org
    if (esTitle) {
      const esSum = await fetchWikiSummary("", esTitle, "es");
      const summaryEl = document.getElementById(summaryId);
      if (esSum?.extract && summaryEl && summaryEl.dataset.summaryTarget === targetKey) {
        summaryEl.textContent = truncateSummaryEs(esSum.extract, 310);
        summaryEl.hidden = false;
      }
      const wikiEl = document.getElementById(wikiLinkId);
      if (wikiEl && wikiEl.dataset.wikiTarget === targetKey) {
        const esUrl = esSum?.pageUrl || `https://es.wikipedia.org/wiki/${encodeURIComponent(esTitle.replace(/\s+/g, "_"))}`;
        wikiEl.href = esUrl;
        wikiEl.hidden = false;
      }
    }

    // Otros títulos fuera de F1 (F2, GP2, F3, WEC…) desde la infobox de Wikipedia
    if (series === "f1" && otherTitlesId) {
      const otherTitles = await fetchF1OtherTitles(meta?.wiki || "", driverName);
      const box = document.getElementById(otherTitlesId);
      if (otherTitles.length && box && box.dataset.otherTitlesTarget === targetKey) {
        box.innerHTML = `
          <div class="other-titles-head">🏅 Otros títulos (categorías inferiores y otras disciplinas)</div>
          <div class="other-titles-list">
            ${otherTitles
              .map(
                (t) =>
                  `<span class="other-title-chip"><strong>${escapeHtml(t.name)}</strong>${
                    t.year ? ` <span class="other-title-yr">${escapeHtml(t.year)}</span>` : ""
                  }</span>`
              )
              .join("")}
          </div>`;
        box.hidden = false;
      }
    }
  }

  async function hydrateTeamExtras(slotId, summaryId, wikiLinkId, teamKey, wikiUrl, fallbackTitle, hasEditorialSummary) {
    const summary = await fetchWikiSummary(wikiUrl || "", fallbackTitle);
    if (!summary) return;
    if (summary.thumb) {
      const slot = document.getElementById(slotId);
      if (slot && slot.dataset.logoTarget === teamKey) {
        slot.innerHTML = `<div class="team-logo-box"><img class="team-logo-img" src="${escapeHtml(summary.thumb)}" alt="Logo de ${escapeHtml(fallbackTitle)}" loading="lazy" onerror="this.parentElement.remove()"></div>`;
      }
    }
    if (summary.wikibaseItem) {
      const wd = await fetchWikidataExtras(summary.wikibaseItem);
      if (wd?.esWikiTitle) {
        const esUrl = `https://es.wikipedia.org/wiki/${encodeURIComponent(wd.esWikiTitle.replace(/\s+/g, "_"))}`;
        const wikiEl = document.getElementById(wikiLinkId);
        if (wikiEl && wikiEl.dataset.wikiTarget === teamKey) {
          wikiEl.href = esUrl;
          wikiEl.hidden = false;
        }
        if (!hasEditorialSummary) {
          const esSum = await fetchWikiSummary("", wd.esWikiTitle, "es");
          const sumEl = document.getElementById(summaryId);
          if (esSum?.extract && sumEl && sumEl.dataset.summaryTarget === teamKey) {
            sumEl.textContent = truncateSummaryEs(esSum.extract, 310);
            sumEl.hidden = false;
          }
        }
      }
    }
  }

  function renderDriverFlag(series, name) {
    const meta = getDriverMeta(series, name);
    if (!meta?.fl) return "";
    const title = meta.co || meta.nat || "";
    return `<span class="driver-flag" title="${escapeHtml(title)}">${meta.fl}</span>`;
  }

  function formatBirthInfo(dobStr, isRetired) {
    if (!dobStr) return "";
    const formatted = formatFullDate(dobStr);
    if (isRetired) return formatted;
    const dob = new Date(`${dobStr}T12:00:00Z`);
    if (Number.isNaN(dob.getTime())) return formatted;
    const now = new Date();
    let age = now.getUTCFullYear() - dob.getUTCFullYear();
    const mDiff = now.getUTCMonth() - dob.getUTCMonth();
    if (mDiff < 0 || (mDiff === 0 && now.getUTCDate() < dob.getUTCDate())) age -= 1;
    if (age >= 15 && age <= 58) return `${formatted} (${age} años)`;
    return formatted;
  }

  function getAvailableDriverCountries(seriesFilter) {
    if (!state.careerIndex) buildCareerIndex();
    const counts = new Map();
    const pool =
      seriesFilter === "all"
        ? state.careerIndex
        : state.careerIndex.filter((d) => d.series === seriesFilter);
    pool.forEach((d) => {
      if (!d.countryIso || !d.countryName) return;
      const cur = counts.get(d.countryIso) || { iso: d.countryIso, name: d.countryName, flag: d.flag || "", count: 0 };
      cur.count += 1;
      counts.set(d.countryIso, cur);
    });
    return Array.from(counts.values()).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, "es"));
  }

  function searchDrivers(query, seriesFilter, countryIso = "all") {
    if (!state.careerIndex) buildCareerIndex();
    const qNorm = normalizeText(query);
    let pool =
      seriesFilter === "all"
        ? state.careerIndex
        : state.careerIndex.filter((d) => d.series === seriesFilter);

    if (countryIso && countryIso !== "all") {
      pool = pool.filter((d) => d.countryIso === countryIso);
    }

    if (!qNorm) return pool.slice(0, countryIso && countryIso !== "all" ? 80 : 24);

    const qTokens = qNorm.split(" ").filter(Boolean);

    // 1) Coincidencia directa (subcadena en todos los tokens)
    const exact = pool.filter((d) => qTokens.every((t) => d.norm.includes(t)));
    if (exact.length > 0) return exact.slice(0, 40);

    // 2) Tolerancia a pequeñas erratas (ej. "Caroos Sanz" -> "Carlos Sainz")
    const fuzzy = [];
    for (const d of pool) {
      let totalDist = 0;
      let ok = true;
      for (const qt of qTokens) {
        const maxDist = qt.length <= 4 ? 1 : 2;
        let best = 99;
        for (const dt of d.tokens) {
          if (dt.includes(qt)) {
            best = 0;
            break;
          }
          const dist = levenshtein(qt, dt);
          if (dist < best) best = dist;
        }
        if (best > maxDist) {
          ok = false;
          break;
        }
        totalDist += best;
      }
      if (ok) fuzzy.push({ d, totalDist });
    }
    fuzzy.sort((a, b) => a.totalDist - b.totalDist || b.d.seasons.length - a.d.seasons.length);
    return fuzzy.slice(0, 30).map((x) => x.d);
  }

  function findCareerEntry(series, name) {
    if (!state.careerIndex) buildCareerIndex();
    let norm = normalizeText(name);
    if (series === "motogp" && norm === "daniel pedrosa") norm = "dani pedrosa";
    return state.careerIndex.find((d) => d.series === series && d.norm === norm) || null;
  }

  function getNextEvent(seriesData) {
    if (!seriesData || !seriesData.events) return null;
    const now = Date.now();
    const upcoming = seriesData.events.find((ev) => {
      if (ev.status !== "FINISHED") {
        const endRef = ev.raceStart
          ? new Date(ev.raceStart).getTime() + 3 * 3600 * 1000
          : new Date(`${ev.dateEnd}T23:59:59Z`).getTime();
        return endRef > now;
      }
      return false;
    });
    return upcoming || seriesData.events[seriesData.events.length - 1] || null;
  }

  function getLastFinishedEvent(seriesData) {
    if (!seriesData || !seriesData.events) return null;
    const finished = seriesData.events.filter((ev) => ev.podium && ev.podium.length > 0);
    return finished.length ? finished[finished.length - 1] : null;
  }

  function getPendingResultsEvent(seriesData) {
    if (!seriesData || !seriesData.events) return null;
    const finishedAll = seriesData.events.filter((ev) => ev.status === "FINISHED");
    if (!finishedAll.length) return null;
    const latest = finishedAll[finishedAll.length - 1];
    return !latest.podium || latest.podium.length === 0 ? latest : null;
  }

  function getNextSession(event) {
    if (!event || !event.sessions) return null;
    const now = Date.now();
    return event.sessions.find((s) => s.start && new Date(s.start).getTime() + 45 * 60 * 1000 > now) || null;
  }

  function isSpoilerMasked(id) {
    return state.spoilerFree && !state.revealedIds.has(id);
  }

  function updateSpoilerButton() {
    spoilerBtn.setAttribute("aria-pressed", String(state.spoilerFree));
    spoilerBtn.querySelector(".spoiler-icon").textContent = state.spoilerFree ? "🙈" : "👁️";
    spoilerBtn.querySelector(".spoiler-label").textContent = state.spoilerFree ? "Sin spoilers ON" : "Sin spoilers";
  }

  // Exportar un GP completo a archivo .ics para Apple Calendar / Google Calendar
  function downloadEventIcs(event) {
    const pad = (n) => String(n).padStart(2, "0");
    const toIcsUtc = (d) =>
      `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;

    const lines = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//MundoMotor//Calendario F1 y MotoGP//ES",
      "CALSCALE:GREGORIAN",
    ];

    const seriesLabel = event.series === "f1" ? "F1" : "MotoGP";
    const sessions = event.sessions && event.sessions.length ? event.sessions : [{ name: "Carrera", start: event.raceStart }];

    sessions.forEach((s, idx) => {
      if (!s.start) return;
      const start = new Date(s.start);
      const durationMin = s.name === "Carrera" ? 120 : 60;
      const end = new Date(start.getTime() + durationMin * 60 * 1000);
      lines.push(
        "BEGIN:VEVENT",
        `UID:${event.id}-${idx}@mundomotor`,
        `DTSTAMP:${toIcsUtc(new Date())}`,
        `DTSTART:${toIcsUtc(start)}`,
        `DTEND:${toIcsUtc(end)}`,
        `SUMMARY:${seriesLabel} · ${event.name} — ${s.name}`,
        `LOCATION:${event.circuit}${event.country ? ", " + event.country : ""}`,
        `DESCRIPTION:Sesión ${s.name} del ${event.name} (${seriesLabel})`,
        "BEGIN:VALARM",
        "TRIGGER:-PT15M",
        "ACTION:DISPLAY",
        `DESCRIPTION:En 15 min empieza ${seriesLabel}: ${s.name}`,
        "END:VALARM",
        "END:VEVENT"
      );
    });

    lines.push("END:VCALENDAR");
    const blob = new Blob([lines.join("\r\n")], { type: "text/calendar;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${event.id}.ics`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    showToast(`Calendario descargado para ${event.name}`);
  }

  // -------------------------------------------------------------------------
  // RENDERIZADO: INICIO
  // -------------------------------------------------------------------------
  function renderHeroCard(event, seriesData) {
    if (!event) return "";
    const isF1 = event.series === "f1";
    const nextSess = getNextSession(event);
    const now = Date.now();

    const countdownHtml = nextSess
      ? `
        <div class="countdown-box" data-countdown-target="${escapeHtml(nextSess.start)}">
          <div class="countdown-meta">
            Próxima sesión
            <strong>${escapeHtml(nextSess.name)}</strong>
          </div>
          <div class="countdown-digits">
            <div class="cd-unit"><span data-cd="d">--</span><small>días</small></div>
            <div class="cd-unit"><span data-cd="h">--</span><small>hrs</small></div>
            <div class="cd-unit"><span data-cd="m">--</span><small>min</small></div>
            <div class="cd-unit"><span data-cd="s">--</span><small>seg</small></div>
          </div>
        </div>`
      : `
        <div class="countdown-box">
          <div class="countdown-meta">
            Temporada ${seriesData.season}
            <strong>Gran Premio finalizado</strong>
          </div>
        </div>`;

    const sessionsHtml = (event.sessions || [])
      .map((s) => {
        const ts = s.start ? new Date(s.start).getTime() : 0;
        const isNext = nextSess && s.start === nextSess.start && s.name === nextSess.name;
        const isPast = ts > 0 && ts + 60 * 60 * 1000 < now;
        return `
          <div class="session-row ${isNext ? "is-next" : ""} ${isPast ? "is-past" : ""}">
            <span class="session-name">
              ${isNext ? '<span class="live-dot" aria-hidden="true"></span>' : ""}
              ${escapeHtml(s.name)}
            </span>
            <span class="session-time">${escapeHtml(formatSessionTime(s.start))}</span>
          </div>`;
      })
      .join("");

    return `
      <article class="gp-hero ${event.series}">
        <div class="gp-hero-top">
          <span class="series-badge ${event.series}">${isF1 ? "Fórmula 1" : "MotoGP"}</span>
          <span class="round-label">Ronda ${event.round} · ${escapeHtml(formatDateRange(event.dateStart, event.dateEnd))}</span>
        </div>
        <div class="gp-title-row">
          <span class="gp-flag" aria-hidden="true">${event.flag}</span>
          <div>
            <h2 class="gp-name">${escapeHtml(event.name)}</h2>
            <p class="gp-circuit">
              ${
                event.circuit
                  ? `<button class="circuit-link-btn" type="button" data-open-circuit="${escapeHtml(event.series)}|${escapeHtml(event.circuit)}" title="Ver ficha del circuito">${escapeHtml(event.circuit)}</button>`
                  : ""
              }${event.country ? " · " + escapeHtml(event.country) : ""}
            </p>
          </div>
        </div>
        ${countdownHtml}
        <div class="sessions-list">${sessionsHtml}</div>
        <div class="hero-actions">
          <button class="btn-secondary" type="button" data-download-ics="${escapeHtml(event.id)}">
            📅 Añadir al calendario
          </button>
        </div>
      </article>`;
  }

  function renderFavoritesSummary() {
    if (!state.favorites.size) return "";
    const revealKey = "home-favorites";
    const cards = [];

    ["f1", "motogp"].forEach((series) => {
      if (state.homeFilter !== "all" && state.homeFilter !== series) return;
      const st = state.motorsport?.[series]?.standings;
      if (!st) return;
      [...(st.drivers || []), ...(st.teams || [])].forEach((row) => {
        const key = `${series}:${row.name}`;
        if (!state.favorites.has(key)) return;
        const isDriver = Boolean(row.team !== undefined);
        cards.push({ series, row, isDriver });
      });
    });

    if (!cards.length) return "";

    const inner = isSpoilerMasked(revealKey)
      ? `<div class="spoiler-shield">
           <p>🙈 Posiciones de tus favoritos ocultas por el <strong>Modo Sin Spoilers</strong></p>
           <button class="btn-reveal" type="button" data-reveal="${revealKey}">Ver mis favoritos</button>
         </div>`
      : `<div class="fav-summary-grid">
           ${cards
             .map(
               ({ series, row, isDriver }) => {
                 const liveryTeam = isDriver ? row.team : row.name;
                 return `
                 <button class="fav-summary-card" type="button" ${
                   isDriver
                     ? `data-open-driver="${escapeHtml(series)}|${escapeHtml(row.name)}"`
                     : `data-go-standings="${escapeHtml(series)}"`
                 }>
                   <div style="text-align:left;min-width:0">
                     <div style="display:flex;align-items:center;gap:8px">
                       <span class="series-badge ${series}">${series === "f1" ? "F1" : "MotoGP"}</span>
                       ${renderVehicleThumb(series, liveryTeam, true)}
                     </div>
                     <div class="fav-summary-name">★ ${escapeHtml(row.name)}</div>
                     <div class="fav-summary-team">${escapeHtml(row.team || (series === "f1" ? "Constructor" : "Equipo"))}</div>
                   </div>
                   <div class="fav-summary-stat">
                     <div class="fav-summary-pos">${row.position}º</div>
                     <div class="fav-summary-pts">${formatPoints(row.points)} pts</div>
                   </div>
                 </button>`;
               }
             )
             .join("")}
         </div>`;

    return `
      <div class="section-head">
        <h2 class="section-title">Tus favoritos en el Mundial</h2>
        <button class="link-btn" type="button" data-tab="mundial">Gestionar ★</button>
      </div>
      ${inner}`;
  }

  function renderCombinedAgenda(f1, motogp) {
    const now = Date.now();
    const horizon = now + 12 * 24 * 3600 * 1000;
    const allSessions = [];

    const collect = (seriesData) => {
      if (!seriesData || !seriesData.events) return;
      seriesData.events.forEach((ev) => {
        if (state.homeFilter !== "all" && ev.series !== state.homeFilter) return;
        (ev.sessions || []).forEach((s) => {
          if (!s.start) return;
          const ts = new Date(s.start).getTime();
          if (ts >= now - 60 * 60 * 1000 && ts <= horizon) {
            allSessions.push({
              ts,
              start: s.start,
              sessionName: s.name,
              series: ev.series,
              gpName: ev.name,
              flag: ev.flag,
            });
          }
        });
      });
    };

    collect(f1);
    collect(motogp);
    allSessions.sort((a, b) => a.ts - b.ts);

    if (!allSessions.length) return "";

    const byDay = new Map();
    allSessions.forEach((item) => {
      const dayKey = new Intl.DateTimeFormat("es-ES", {
        weekday: "long",
        day: "numeric",
        month: "long",
      }).format(new Date(item.start));
      const label = capitalize(dayKey);
      if (!byDay.has(label)) byDay.set(label, []);
      byDay.get(label).push(item);
    });

    const daysHtml = Array.from(byDay.entries())
      .map(
        ([dayLabel, items]) => `
          <div class="agenda-day">
            <h3 class="agenda-day-title">${escapeHtml(dayLabel)}</h3>
            ${items
              .map(
                (it) => `
                  <div class="agenda-item">
                    <span class="agenda-hour">${escapeHtml(formatHourOnly(it.start))}</span>
                    <span class="series-badge ${it.series}">${it.series === "f1" ? "F1" : "MotoGP"}</span>
                    <div>
                      <strong>${escapeHtml(it.sessionName)}</strong>
                      <span class="agenda-gp">${it.flag} ${escapeHtml(it.gpName)}</span>
                    </div>
                  </div>`
              )
              .join("")}
          </div>`
      )
      .join("");

    return `
      <div class="section-head">
        <h2 class="section-title">Agenda cronológica (próximos días)</h2>
        <span class="section-sub">F1 y MotoGP juntos</span>
      </div>
      <section class="agenda-card">${daysHtml}</section>`;
  }

  function renderPodiumBlock(event, revealKey) {
    if (!event || !event.podium || !event.podium.length) return "";
    const masked = isSpoilerMasked(revealKey);
    const totalResults = event.results && event.results.length ? event.results.length : event.podium.length;
    const canOpenFull = !masked && totalResults > 0;

    const bodyHtml = masked
      ? `
        <div class="spoiler-shield">
          <p>🙈 Resultado oculto por el <strong>Modo Sin Spoilers</strong></p>
          <button class="btn-reveal" type="button" data-reveal="${escapeHtml(revealKey)}">Ver podio</button>
        </div>`
      : `
        <div class="podium-list">
          ${event.podium
            .map(
              (p) => `
                <div class="podium-row">
                  <span class="pos-medal pos-${p.position}">${p.position}º</span>
                  ${renderVehicleThumb(event.series, p.team, true)}
                  <div style="min-width:0">
                    <div class="podium-driver">${escapeHtml(p.driver)}</div>
                    <div class="podium-team">${escapeHtml(p.team)}</div>
                  </div>
                </div>`
            )
            .join("")}
        </div>
        <div class="podium-card-cta">
          <span>🏁 Ver clasificación completa${totalResults > 3 ? ` (${totalResults} pilotos)` : ""}</span>
          <span aria-hidden="true">→</span>
        </div>`;

    return `
      <article class="podium-card ${canOpenFull ? "is-clickable" : ""}" ${
        canOpenFull ? `data-open-race="${escapeHtml(event.id)}" role="button" tabindex="0" aria-label="Ver clasificación completa de ${escapeHtml(event.name)}"` : ""
      }>
        <div class="gp-hero-top">
          <span class="series-badge ${event.series}">${event.series === "f1" ? "Fórmula 1" : "MotoGP"}</span>
          <span class="round-label">Ronda ${event.round}</span>
        </div>
        <div class="gp-title-row">
          <span class="gp-flag" aria-hidden="true">${event.flag}</span>
          <div>
            <h3 class="gp-name" style="font-size:1.04rem">${escapeHtml(event.name)}</h3>
            <p class="gp-circuit">${escapeHtml(formatDateRange(event.dateStart, event.dateEnd))}</p>
          </div>
        </div>
        ${bodyHtml}
      </article>`;
  }

  function renderInicio() {
    const { f1, motogp } = state.motorsport;
    const showF1 = state.homeFilter === "all" || state.homeFilter === "f1";
    const showMoto = state.homeFilter === "all" || state.homeFilter === "motogp";

    const nextF1 = showF1 ? getNextEvent(f1) : null;
    const nextMoto = showMoto ? getNextEvent(motogp) : null;
    const lastF1 = showF1 ? getLastFinishedEvent(f1) : null;
    const lastMoto = showMoto ? getLastFinishedEvent(motogp) : null;

    const pendingEvents = [
      showF1 ? getPendingResultsEvent(f1) : null,
      showMoto ? getPendingResultsEvent(motogp) : null,
    ].filter(Boolean);

    const pendingBannerHtml = pendingEvents.length
      ? pendingEvents
          .map(
            (ev) => `
              <div class="pending-results-banner">
                <span aria-hidden="true">⏳</span>
                <div>
                  <strong>${escapeHtml(ev.name)}</strong> (${ev.series === "f1" ? "Fórmula 1" : "MotoGP"}, Ronda ${ev.round}) ya ha finalizado, pero la API oficial aún no ha publicado la clasificación. Se actualizará automáticamente en cuanto esté disponible.
                </div>
              </div>`
          )
          .join("")
      : "";

    appEl.innerHTML = `
      <div class="toolbar">
        <div class="pills" role="tablist" aria-label="Filtrar competición">
          <button class="pill ${state.homeFilter === "all" ? "active" : ""}" data-home-filter="all">Todo</button>
          <button class="pill f1 ${state.homeFilter === "f1" ? "active" : ""}" data-home-filter="f1">Fórmula 1</button>
          <button class="pill motogp ${state.homeFilter === "motogp" ? "active" : ""}" data-home-filter="motogp">MotoGP</button>
        </div>
        <span class="tz-chip">🕒 Horarios en tu zona (${escapeHtml(userTZ)})</span>
      </div>

      <div class="section-head">
        <h2 class="section-title">Próximo Gran Premio</h2>
        <span class="section-sub">Temporada ${f1?.season || motogp?.season || ""}</span>
      </div>
      <section class="hero-grid">
        ${nextF1 ? renderHeroCard(nextF1, f1) : ""}
        ${nextMoto ? renderHeroCard(nextMoto, motogp) : ""}
      </section>

      ${renderFavoritesSummary()}
      ${renderCombinedAgenda(f1, motogp)}

      <div class="section-head">
        <h2 class="section-title">Último podio disputado</h2>
        <span class="section-sub">Pulsa para ver todos los puestos</span>
      </div>
      ${pendingBannerHtml}
      <section class="podium-grid">
        ${lastF1 ? renderPodiumBlock(lastF1, `home-podium-${lastF1.id}`) : ""}
        ${lastMoto ? renderPodiumBlock(lastMoto, `home-podium-${lastMoto.id}`) : ""}
      </section>
    `;

    startCountdowns();
  }

  function startCountdowns() {
    clearInterval(state.countdownTimer);
    const tick = () => {
      const boxes = document.querySelectorAll("[data-countdown-target]");
      const now = Date.now();
      boxes.forEach((box) => {
        const target = new Date(box.dataset.countdownTarget).getTime();
        const diff = Math.max(0, Math.floor((target - now) / 1000));
        const d = Math.floor(diff / 86400);
        const h = Math.floor((diff % 86400) / 3600);
        const m = Math.floor((diff % 3600) / 60);
        const s = diff % 60;
        const set = (k, v) => {
          const el = box.querySelector(`[data-cd="${k}"]`);
          if (el) el.textContent = k === "d" ? String(v) : String(v).padStart(2, "0");
        };
        set("d", d);
        set("h", h);
        set("m", m);
        set("s", s);
      });
    };
    tick();
    state.countdownTimer = setInterval(tick, 1000);
  }

  // -------------------------------------------------------------------------
  // RENDERIZADO: CALENDARIO
  // -------------------------------------------------------------------------
  function renderCalendario() {
    clearInterval(state.countdownTimer);
    const { f1, motogp } = state.motorsport;
    const nextF1Id = getNextEvent(f1)?.id;
    const nextMotoId = getNextEvent(motogp)?.id;

    let events = [...(f1?.events || []), ...(motogp?.events || [])];
    if (state.calFilter !== "all") {
      events = events.filter((e) => e.series === state.calFilter);
    }
    if (!state.calShowAll) {
      events = events.filter((e) => e.status !== "FINISHED");
    }
    events.sort((a, b) => (a.dateEnd || a.dateStart).localeCompare(b.dateEnd || b.dateStart));

    const cardsHtml = events.length
      ? events
          .map((ev) => {
            const isNext = ev.id === nextF1Id || ev.id === nextMotoId;
            const isExpanded = state.expandedEventId === ev.id || isNext;
            const statusTag =
              ev.status === "FINISHED"
                ? '<span class="status-tag done">Finalizado</span>'
                : isNext
                ? '<span class="status-tag next">Próximo</span>'
                : '<span class="status-tag soon">Pendiente</span>';

            const revealKey = `cal-podium-${ev.id}`;
            let detailsHtml = "";
            if (isExpanded) {
              const podiumPart =
                ev.podium && ev.podium.length
                  ? isSpoilerMasked(revealKey)
                    ? `<div class="spoiler-shield"><p>🙈 Podio oculto por Modo Sin Spoilers</p><button class="btn-reveal" type="button" data-reveal="${escapeHtml(revealKey)}">Ver podio</button></div>`
                    : `<div class="podium-list">${ev.podium
                        .map(
                          (p) => `
                            <div class="podium-row">
                              <span class="pos-medal pos-${p.position}">${p.position}º</span>
                              ${renderVehicleThumb(ev.series, p.team, true)}
                              <div style="min-width:0">
                                <div class="podium-driver">${escapeHtml(p.driver)}</div>
                                <div class="podium-team">${escapeHtml(p.team)}</div>
                              </div>
                            </div>`
                        )
                        .join("")}</div>`
                  : "";

              const sessionsPart = (ev.sessions || []).length
                ? `<div class="sessions-list">${ev.sessions
                    .map(
                      (s) => `
                        <div class="session-row">
                          <span class="session-name">${escapeHtml(s.name)}</span>
                          <span class="session-time">${escapeHtml(formatSessionTime(s.start))}</span>
                        </div>`
                    )
                    .join("")}</div>`
                : "";

              const hasFullResults = ev.results && ev.results.length > 0 && !isSpoilerMasked(revealKey);
              const fullResultsBtn = hasFullResults
                ? `<button class="btn-primary-soft" type="button" data-open-race="${escapeHtml(ev.id)}">
                     🏁 Ver clasificación completa (${ev.results.length})
                   </button>`
                : "";

              detailsHtml = `
                <div class="cal-details">
                  ${podiumPart}
                  ${sessionsPart}
                  <div class="hero-actions" style="flex-wrap:wrap">
                    ${
                      ev.circuit
                        ? `<button class="btn-secondary" type="button" data-open-circuit="${escapeHtml(ev.series)}|${escapeHtml(ev.circuit)}">
                             🏟️ Ficha del circuito
                           </button>`
                        : ""
                    }
                    ${fullResultsBtn}
                    <button class="btn-secondary" type="button" data-download-ics="${escapeHtml(ev.id)}">
                      📅 Añadir al calendario (.ics)
                    </button>
                  </div>
                </div>`;
            }

            return `
              <article class="cal-card ${isNext ? "is-next-gp" : ""}">
                <button class="cal-card-summary" type="button" data-toggle-event="${escapeHtml(ev.id)}" aria-expanded="${isExpanded}">
                  <div class="cal-left">
                    <span class="gp-flag" aria-hidden="true">${ev.flag}</span>
                    <div>
                      <div class="cal-title">
                        <span class="series-badge ${ev.series}">${ev.series === "f1" ? "F1" : "MotoGP"}</span>
                        <span>${escapeHtml(ev.name)}</span>
                      </div>
                      <div class="cal-meta">Ronda ${ev.round} · ${escapeHtml(ev.circuit)}</div>
                    </div>
                  </div>
                  <div class="cal-right">
                    <div class="cal-date">${escapeHtml(formatDateRange(ev.dateStart, ev.dateEnd))}</div>
                    ${statusTag}
                  </div>
                </button>
                ${detailsHtml}
              </article>`;
          })
          .join("")
      : `<div class="empty-state">No hay Grandes Premios pendientes para este filtro.</div>`;

    appEl.innerHTML = `
      <div class="toolbar">
        <div class="pills">
          <button class="pill ${state.calFilter === "all" ? "active" : ""}" data-cal-filter="all">Todo</button>
          <button class="pill f1 ${state.calFilter === "f1" ? "active" : ""}" data-cal-filter="f1">Fórmula 1</button>
          <button class="pill motogp ${state.calFilter === "motogp" ? "active" : ""}" data-cal-filter="motogp">MotoGP</button>
        </div>
        <div class="pills">
          <button class="pill ${!state.calShowAll ? "active" : ""}" data-cal-scope="upcoming">Próximos</button>
          <button class="pill ${state.calShowAll ? "active" : ""}" data-cal-scope="all">Temporada completa</button>
        </div>
      </div>
      <section class="calendar-list">${cardsHtml}</section>
    `;
  }

  // -------------------------------------------------------------------------
  // RENDERIZADO: MUNDIAL (TABLA POR AÑO + PALMARÉS + BUSCADOR DE PILOTOS)
  // -------------------------------------------------------------------------
  function expandArchiveSeason(rawPayload) {
    const series = rawPayload.s;
    const year = Number(rawPayload.y);
    const mapRow = (r) => ({
      position: Number(r.p || 0),
      positionText: String(r.pt || r.p || "NC"),
      driver: r.d || "",
      number: r.no || "",
      team: r.t || "",
      grid: Number(r.g || 0),
      fastestLap: Boolean(r.fl),
      fastestLapTime: r.flt || "",
      fastestLapSpeed: r.fls || "",
      time: r.tm || r.st || "",
      status: r.st || "",
      finished: r.f !== 0,
      points: Number(r.pts || 0),
    });
    return (rawPayload.r || []).map((rc) => {
      const results = (rc.res || []).map(mapRow);
      const sprintResults = (rc.spr || []).map(mapRow);
      const podium = results
        .filter((r) => r.finished && r.position >= 1 && r.position <= 3)
        .slice(0, 3)
        .map((r) => ({
          position: r.position,
          driver: r.driver,
          team: r.team,
        }));
      return {
        id: `hist-${series}-${year}-${rc.rn}`,
        series,
        season: year,
        round: Number(rc.rn),
        name: rc.n || `Ronda ${rc.rn}`,
        circuit: rc.c || "",
        country: rc.co || "",
        flag: rc.fl || "🏁",
        dateStart: rc.d || "",
        dateEnd: rc.d || "",
        status: "FINISHED",
        podium,
        results,
        sprintResults,
      };
    });
  }

  async function ensureHistoricalRacesLoaded(series, year) {
    const key = `${series}:${year}`;
    const cached = state.raceArchiveCache.get(key);
    if (cached && (cached.status === "loading" || cached.status === "ready")) return;

    state.raceArchiveCache.set(key, { status: "loading", events: [] });
    try {
      const res = await fetch(`./data/races/${series}/${year}.json`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const raw = await res.json();
      const events = expandArchiveSeason(raw);
      state.raceArchiveCache.set(key, { status: "ready", events });
    } catch (err) {
      state.raceArchiveCache.set(key, { status: "error", events: [] });
    }

    if (
      state.tab === "archivo" &&
      state.archiveSection === "temporadas" &&
      state.archiveKind === "races" &&
      state.archiveSeries === series &&
      Number(state.archiveYear) === Number(year)
    ) {
      renderArchivo();
    }
  }

  function renderSeasonRacesBody(series, year, isCurrent, revealKey) {
    if (isCurrent && isSpoilerMasked(revealKey)) {
      return `
        <div class="spoiler-shield">
          <p>🙈 Los resultados de las carreras de ${year} están ocultos por el <strong>Modo Sin Spoilers</strong>.</p>
          <button class="btn-reveal" type="button" data-reveal="${escapeHtml(revealKey)}">Mostrar carreras</button>
        </div>`;
    }

    let events = [];
    if (isCurrent) {
      events = (state.motorsport?.[series]?.events || []).map((ev) => ({ ...ev, season: year }));
    } else {
      const key = `${series}:${year}`;
      const cached = state.raceArchiveCache.get(key);
      if (!cached || cached.status === "loading") {
        if (!cached) ensureHistoricalRacesLoaded(series, year);
        return `
          <div class="loading-state">
            <div class="spinner"></div>
            <p>Cargando los Grandes Premios de ${year}…</p>
          </div>`;
      }
      if (cached.status === "error" || !cached.events.length) {
        return `
          <div class="empty-state">
            <p>Aún no están descargadas las carreras de <strong>${series === "f1" ? "Fórmula 1" : "MotoGP / 500cc"} ${year}</strong>.</p>
            <p style="font-size:0.82rem;margin-top:6px">Ejecuta <code>python3 scripts/build_race_history.py</code> para completar el archivo de carreras.</p>
          </div>`;
      }
      events = cached.events;
    }

    if (!events.length) {
      return `<div class="empty-state">No hay carreras registradas para ${year}.</div>`;
    }

    return `
      <div class="section-head" style="margin-top:4px">
        <h3 class="section-title">${events.length} Grandes Premios en ${year}</h3>
        <span class="section-sub">Pulsa cualquier carrera para ver todos los puestos</span>
      </div>
      <section class="hist-races-list">
        ${events
          .map((ev) => {
            const totalRows = ev.results && ev.results.length ? ev.results.length : (ev.podium || []).length;
            const hasResults = totalRows > 0;
            const dateLabel = isCurrent
              ? formatDateRange(ev.dateStart, ev.dateEnd)
              : formatFullDate(ev.dateEnd || ev.dateStart);
            const podiumHtml =
              ev.podium && ev.podium.length
                ? `<div class="hist-race-podium">
                     ${ev.podium
                       .map(
                         (p) => `
                           <span class="hist-podium-pill">
                             <span class="pos-medal pos-${p.position}" style="width:20px;height:20px;font-size:0.68rem">${p.position}º</span>
                             <strong>${escapeHtml(p.driver)}</strong>
                             ${p.team ? `<span class="hist-podium-team">· ${escapeHtml(p.team)}</span>` : ""}
                           </span>`
                       )
                       .join("")}
                   </div>`
                : `<div class="hist-race-podium"><span class="section-sub">${
                    ev.status === "FINISHED" ? "⏳ Esperando clasificación oficial" : "📅 Carrera pendiente de disputar"
                  }</span></div>`;

            const footHtml = hasResults
              ? `<div class="hist-race-foot">
                   <span>🏁 Ver clasificación completa (${totalRows} pilotos)</span>
                   <span aria-hidden="true">→</span>
                 </div>`
              : "";

            return `
              <article class="hist-race-card ${hasResults ? "is-clickable" : ""}" ${
                hasResults
                  ? `data-open-race="${escapeHtml(ev.id)}" role="button" tabindex="0" aria-label="Ver clasificación completa de ${escapeHtml(ev.name)} ${year}"`
                  : ""
              }>
                <div class="hist-race-head">
                  <div class="hist-race-left">
                    <span class="gp-flag" aria-hidden="true">${ev.flag || "🏁"}</span>
                    <div style="min-width:0">
                      <div class="hist-race-name">
                        <span class="hist-race-round">R${ev.round}</span>
                        <span>${escapeHtml(ev.name)}</span>
                      </div>
                      <div class="hist-race-circuit">${
                        ev.circuit
                          ? `<button class="circuit-link-btn" type="button" data-open-circuit="${escapeHtml(ev.series)}|${escapeHtml(ev.circuit)}" title="Ver ficha e historial del circuito">${escapeHtml(ev.circuit)}</button>`
                          : "Circuito histórico"
                      }${
                        ev.country ? ` · ${escapeHtml(ev.country)}` : ""
                      }</div>
                    </div>
                  </div>
                  <span class="hist-race-date">${escapeHtml(dateLabel)}</span>
                </div>
                ${podiumHtml}
                ${footHtml}
              </article>`;
          })
          .join("")}
      </section>`;
  }

  function renderStandingsRowsHtml({ series, year, isCurrent, kind, rowsRaw, onlyFavs, revealKey }) {
    const maxPts = rowsRaw.length ? Math.max(...rowsRaw.map((r) => Number(r.points || 0)), 1) : 1;
    const rows =
      isCurrent && onlyFavs
        ? rowsRaw.filter((r) => state.favorites.has(`${series}:${r.name}`))
        : rowsRaw;

    if (isCurrent && isSpoilerMasked(revealKey)) {
      return `
        <div class="spoiler-shield">
          <p>🙈 La clasificación de ${year} está oculta por el <strong>Modo Sin Spoilers</strong>.</p>
          <button class="btn-reveal" type="button" data-reveal="${escapeHtml(revealKey)}">Mostrar clasificación</button>
        </div>`;
    }
    if (!rows.length) {
      let emptyMsg = "Sin datos de clasificación para esta temporada.";
      if (isCurrent && onlyFavs) {
        emptyMsg = "Aún no has marcado ningún favorito con la estrella ★.";
      } else if (series === "f1" && kind === "teams" && year < 1958) {
        emptyMsg = "El Mundial de Constructores de Fórmula 1 se inauguró en 1958.";
      }
      return `<div class="empty-state">${emptyMsg}</div>`;
    }

    return `
      <section class="standings-card">
        ${rows
          .map((r) => {
            const favKey = `${series}:${r.name}`;
            const isFav = isCurrent && state.favorites.has(favKey);
            const pct = Math.max(3, Math.round((Number(r.points || 0) / maxPts) * 100));
            const gap = Number(r.points || 0) - maxPts;
            const posClass = r.position <= 3 ? `top${r.position}` : "";
            const winsTxt = r.wins > 0 ? ` · ${r.wins} ${r.wins === 1 ? "victoria" : "victorias"}` : "";
            const sprintTxt =
              r.sprintWins > 0
                ? ` · <span class="sprint-tag" title="Victorias en Carrera Sprint">⚡ ${r.sprintWins} Sprint</span>`
                : "";
            const flagHtml = kind === "drivers" ? renderDriverFlag(series, r.name) : "";
            const nameEl =
              kind === "drivers"
                ? `${flagHtml}<button class="st-name-btn" type="button" data-open-driver="${escapeHtml(series)}|${escapeHtml(r.name)}" title="Ver trayectoria completa">${escapeHtml(r.name)}</button>`
                : `<button class="st-name-btn" type="button" data-open-team="${escapeHtml(series)}|${escapeHtml(r.name)}|${year}" title="Ver ficha de la escudería">${escapeHtml(r.name)}</button>`;

            const liveryKey = kind === "drivers" ? r.team : r.name;
            const livery = getTeamLivery(series, liveryKey);
            const subTeamHtml =
              kind === "drivers" && r.team
                ? `<button class="team-link-btn" type="button" data-open-team="${escapeHtml(series)}|${escapeHtml(r.team)}|${year}" title="Ver ficha del equipo">${escapeHtml(r.team)}</button>${winsTxt}${sprintTxt}`
                : `${escapeHtml(r.team || (series === "f1" ? "Constructor F1" : "Marca / Equipo"))}${winsTxt}${sprintTxt}`;

            return `
              <div class="standing-row ${isCurrent ? "" : "no-fav"} ${isFav ? "is-fav" : ""}">
                <div class="st-pos ${posClass}">${r.position}</div>
                ${renderVehicleThumb(series, liveryKey)}
                <div class="st-main">
                  <div class="st-name">
                    ${nameEl}
                    ${r.number ? `<span class="st-number">#${escapeHtml(r.number)}</span>` : ""}
                  </div>
                  <div class="st-team">${subTeamHtml}</div>
                  <div class="st-bar-track">
                    <div class="st-bar-fill" style="width:${pct}%;background:${livery.bar}"></div>
                  </div>
                </div>
                <div class="st-pts">
                  <strong>${formatPoints(r.points)}</strong>
                  <small>${gap === 0 ? "Líder" : `${formatPoints(gap)} pts`}</small>
                </div>
                ${
                  isCurrent
                    ? `<button class="fav-btn ${isFav ? "active" : ""}" type="button" data-fav="${escapeHtml(favKey)}" title="Marcar favorito" aria-label="Favorito">
                         ${isFav ? "★" : "☆"}
                       </button>`
                    : ""
                }
              </div>`;
          })
          .join("")}
      </section>`;
  }

  // -------------------------------------------------------------------------
  // RENDERIZADO: MUNDIAL (EXCLUSIVO TEMPORADA EN CURSO)
  // -------------------------------------------------------------------------
  function renderMundial() {
    clearInterval(state.countdownTimer);
    const series = state.standingsSeries;
    const year = getCurrentSeasonYear(series);
    const kind = state.standingsKind === "teams" ? "teams" : "drivers";
    state.standingsKind = kind;
    const seasonData = getSeasonStandings(series, year, "premier");
    const revealKey = `standings-${series}-${year}-${kind}`;
    const scoring = getScoringNote(series, year);
    const rowsRaw = kind === "drivers" ? seasonData.drivers : seasonData.teams;

    const bodyHtml = renderStandingsRowsHtml({
      series,
      year,
      isCurrent: true,
      kind,
      rowsRaw,
      onlyFavs: state.standingsOnlyFavs,
      revealKey,
    });

    appEl.innerHTML = `
      <div class="toolbar">
        <div class="pills">
          <button class="pill f1 ${series === "f1" ? "active" : ""}" data-st-series="f1">Fórmula 1</button>
          <button class="pill motogp ${series === "motogp" ? "active" : ""}" data-st-series="motogp">MotoGP</button>
        </div>
        <div class="pills">
          <button class="pill ${kind === "drivers" ? "active" : ""}" data-st-kind="drivers">Pilotos</button>
          <button class="pill ${kind === "teams" ? "active" : ""}" data-st-kind="teams">${series === "f1" ? "Constructores" : "Equipos"}</button>
          <button class="pill ${state.standingsOnlyFavs ? "active" : ""}" data-st-favs="toggle">★ Favoritos</button>
        </div>
      </div>

      <div class="section-head" style="margin-top:0">
        <h2 class="section-title">Mundial ${series === "f1" ? "Fórmula 1" : "MotoGP"} ${year}</h2>
        <button class="link-btn" type="button" data-tab="archivo">Ver archivo 1949–${year - 1} →</button>
      </div>

      <div class="era-banner">
        <span class="era-banner-icon" aria-hidden="true">ℹ️</span>
        <div>
          <strong>${escapeHtml(scoring.title)}</strong>
          <span class="era-scale">${escapeHtml(scoring.detail)}</span>
        </div>
      </div>

      ${bodyHtml}
    `;
  }

  // -------------------------------------------------------------------------
  // RENDERIZADO: ARCHIVO (TEMPORADAS 1949–2025, PALMARÉS, FICHAS Y COMPARADOR)
  // -------------------------------------------------------------------------
  function renderArchivoTemporadas() {
    const series = state.archiveSeries;
    const curYear = getCurrentSeasonYear(series);
    const histYears = getAvailableYears(series).filter((y) => y < curYear);
    if (!histYears.length) {
      return `<div class="empty-state">Aún no se ha cargado el archivo histórico.</div>`;
    }
    if (!state.archiveYear || !histYears.includes(Number(state.archiveYear))) {
      state.archiveYear = histYears[0];
    }
    const year = Number(state.archiveYear);

    const motoClasses = series === "motogp" ? getAvailableMotoClasses(year) : [];
    let activeMotoClass = "premier";
    if (series === "motogp" && state.archiveKind !== "races") {
      if (motoClasses.some((c) => c.key === state.archiveMotoClass)) {
        activeMotoClass = state.archiveMotoClass;
      } else {
        state.archiveMotoClass = "premier";
      }
    }

    const seasonData = getSeasonStandings(series, year, activeMotoClass);
    const scoring = getScoringNote(series, year);
    const activeCatLabel =
      series === "motogp" && activeMotoClass !== "premier" ? activeMotoClass : null;
    const bannerTitle = activeCatLabel
      ? scoring.title.replace(/MotoGP|500cc/, activeCatLabel)
      : scoring.title;
    const eraBannerHtml = `
      <div class="era-banner">
        <span class="era-banner-icon" aria-hidden="true">ℹ️</span>
        <div>
          <strong>${escapeHtml(bannerTitle)}</strong>
          <span class="era-scale">${escapeHtml(scoring.detail)}</span>
        </div>
      </div>`;

    const motoClassBarHtml =
      series === "motogp" && motoClasses.length > 1 && state.archiveKind !== "races"
        ? `
          <div class="toolbar" style="margin-top:-6px;margin-bottom:12px">
            <div class="pills" role="tablist" aria-label="Categoría del Mundial de Motociclismo">
              ${motoClasses
                .map(
                  (c) => `
                    <button class="pill motogp ${activeMotoClass === c.key ? "active" : ""}" data-arch-motoclass="${escapeHtml(c.key)}">
                      ${escapeHtml(c.label)}
                    </button>`
                )
                .join("")}
            </div>
            <span class="section-sub">Categorías disputadas en ${year}</span>
          </div>`
        : "";

    let bodyHtml = "";
    if (state.archiveKind === "races") {
      bodyHtml = renderSeasonRacesBody(series, year, false, `hist-races-${series}-${year}`);
    } else {
      const rowsRaw = state.archiveKind === "drivers" ? seasonData.drivers : seasonData.teams;
      bodyHtml = renderStandingsRowsHtml({
        series,
        year,
        isCurrent: false,
        kind: state.archiveKind,
        rowsRaw,
        onlyFavs: false,
        revealKey: "",
      });
    }

    const yearOptions = histYears
      .map((y) => `<option value="${y}" ${y === year ? "selected" : ""}>${y}</option>`)
      .join("");

    const returnBarHtml = state.archiveReturnTo
      ? `
        <div class="return-bar">
          <button class="btn-return" type="button" data-archivo-back>
            ${escapeHtml(state.archiveReturnTo.label)}
          </button>
          <span class="section-sub">Viendo ${series === "f1" ? "F1" : activeCatLabel || (year >= 2002 ? "MotoGP" : "500cc")} ${year}</span>
        </div>`
      : "";

    return `
      ${returnBarHtml}
      <div class="toolbar">
        <div class="toolbar-group">
          <div class="pills">
            <button class="pill f1 ${series === "f1" ? "active" : ""}" data-arch-series="f1">Fórmula 1</button>
            <button class="pill motogp ${series === "motogp" ? "active" : ""}" data-arch-series="motogp">Motociclismo</button>
          </div>
          <select id="season-select" class="year-select" aria-label="Elegir temporada histórica">
            ${yearOptions}
          </select>
        </div>
        <div class="pills">
          <button class="pill ${state.archiveKind === "drivers" ? "active" : ""}" data-arch-kind="drivers">Pilotos</button>
          <button class="pill ${state.archiveKind === "teams" ? "active" : ""}" data-arch-kind="teams">${series === "f1" ? "Constructores" : "Marcas"}</button>
          <button class="pill ${state.archiveKind === "races" ? "active" : ""}" data-arch-kind="races">🏁 Carreras</button>
        </div>
      </div>
      ${motoClassBarHtml}
      ${eraBannerHtml}
      ${bodyHtml}
    `;
  }

  function renderArchivoPalmares() {
    const series = state.archiveSeries;
    const curYear = getCurrentSeasonYear(series);
    const years = getAvailableYears(series).filter((y) => y < curYear);

    if (!years.length) {
      return `<div class="empty-state">Aún no se ha cargado el archivo histórico.</div>`;
    }

    const useAllMotoClasses = series === "motogp" && state.palmaresMotoScope === "all";
    const champions = [];
    const titleCounts = new Map();

    const registerChamp = (name, yr, catLabel) => {
      const key = normalizeText(name);
      if (!titleCounts.has(key)) {
        titleCounts.set(key, { name, titles: 0, years: [], byCat: {} });
      }
      const rec = titleCounts.get(key);
      rec.titles += 1;
      rec.years.push(yr);
      rec.byCat[catLabel] = (rec.byCat[catLabel] || 0) + 1;
    };

    years.forEach((yr) => {
      const st = getSeasonStandings(series, yr, "premier");
      const champ = st.drivers[0];
      const teamChamp = st.teams[0];
      const premierCat = series === "f1" ? "F1" : yr >= 2002 ? "MotoGP" : "500cc";
      const classChamps = [];

      if (champ) {
        registerChamp(champ.name, yr, premierCat);
        classChamps.push({ cat: premierCat, classKey: "premier", champ });
      }

      if (useAllMotoClasses) {
        const extra = state.motoClasses?.years?.[String(yr)];
        if (extra) {
          Object.keys(extra)
            .sort((a, b) => motoClassRank(a) - motoClassRank(b))
            .forEach((cls) => {
              const subSt = getSeasonStandings("motogp", yr, cls);
              const subChamp = subSt.drivers[0];
              if (subChamp) {
                registerChamp(subChamp.name, yr, cls);
                classChamps.push({ cat: cls, classKey: cls, champ: subChamp });
              }
            });
        }
      }

      if (classChamps.length) {
        champions.push({ year: yr, champ, teamChamp, classChamps });
      }
    });

    const topLegends = Array.from(titleCounts.values())
      .sort((a, b) => b.titles - a.titles || b.years[0] - a.years[0])
      .slice(0, useAllMotoClasses ? 12 : 8);

    const scopeBarHtml =
      series === "motogp"
        ? `
          <div class="pills">
            <button class="pill ${state.palmaresMotoScope === "all" ? "active" : ""}" data-palmares-scope="all">🏆 Todas las categorías</button>
            <button class="pill ${state.palmaresMotoScope === "premier" ? "active" : ""}" data-palmares-scope="premier">Solo MotoGP / 500cc</button>
          </div>`
        : "";

    const rowsHtml = champions
      .map(({ year, champ, teamChamp, classChamps }) => {
        if (useAllMotoClasses) {
          return `
            <div class="palmares-row">
              <div class="palmares-year">${year}</div>
              <div class="palmares-multi-list">
                ${classChamps
                  .map(
                    ({ cat, classKey, champ: c }) => `
                      <span class="palmares-cat-chip">
                        <span class="cat-tag ${classKey === "premier" ? "is-premier" : ""}">${escapeHtml(cat)}</span>
                        <button class="st-name-btn" type="button" data-open-driver="motogp|${escapeHtml(c.name)}">${escapeHtml(c.name)}</button>
                      </span>`
                  )
                  .join("")}
              </div>
              <button class="btn-secondary" type="button" data-jump-season="motogp|${year}|premier">
                Ver ${year}
              </button>
            </div>`;
        }

        return `
          <div class="palmares-row">
            <div class="palmares-year">${year}</div>
            <div>
              <button class="st-name-btn" type="button" data-open-driver="${escapeHtml(series)}|${escapeHtml(champ.name)}">
                🏆 ${escapeHtml(champ.name)}
              </button>
              <div class="st-team">
                ${
                  champ.team
                    ? `<button class="team-link-btn" type="button" data-open-team="${escapeHtml(series)}|${escapeHtml(champ.team)}|${year}">${escapeHtml(champ.team)}</button>`
                    : ""
                } · ${formatPoints(champ.points)} pts${
                  teamChamp && series === "f1"
                    ? ` · Constructores: <button class="team-link-btn" type="button" data-open-team="f1|${escapeHtml(teamChamp.name)}|${year}">${escapeHtml(teamChamp.name)}</button>`
                    : ""
                }
              </div>
            </div>
            <button class="btn-secondary" type="button" data-jump-season="${escapeHtml(series)}|${year}|premier">
              Ver ${year}
            </button>
          </div>`;
      })
      .join("");

    return `
      <div class="toolbar">
        <div class="pills">
          <button class="pill f1 ${series === "f1" ? "active" : ""}" data-arch-series="f1">Fórmula 1 (1950–${curYear - 1})</button>
          <button class="pill motogp ${series === "motogp" ? "active" : ""}" data-arch-series="motogp">Motociclismo (1949–${curYear - 1})</button>
        </div>
        ${scopeBarHtml}
      </div>

      <div class="section-head" style="margin-top:0">
        <h2 class="section-title">Pilotos con más títulos${useAllMotoClasses ? " (todas las categorías)" : ""}</h2>
        <span class="section-sub">Pulsa un piloto para ver su trayectoria</span>
      </div>
      <section class="leaders-grid">
        ${topLegends
          .map((l) => {
            const breakdown = useAllMotoClasses ? formatTitleBreakdown(l.byCat) : "";
            const titleLabel =
              useAllMotoClasses && normalizeText(l.name) === "angel nieto" && l.titles === 13
                ? "🏆 12+1 títulos"
                : `🏆 ${l.titles} ${l.titles === 1 ? "título" : "títulos"}`;
            return `
              <button class="leader-chip" type="button" data-open-driver="${escapeHtml(series)}|${escapeHtml(l.name)}">
                <div class="leader-titles">${titleLabel}</div>
                <div class="leader-name">${escapeHtml(l.name)}</div>
                ${breakdown ? `<div class="leader-breakdown">${escapeHtml(breakdown)}</div>` : ""}
                <div class="leader-years">${l.years[l.years.length - 1]}–${l.years[0]}</div>
              </button>`;
          })
          .join("")}
      </section>

      <div class="section-head">
        <h2 class="section-title">Campeones año a año</h2>
        <span class="section-sub">${champions.length} temporadas completas</span>
      </div>
      <section class="standings-card">
        ${rowsHtml}
      </section>
    `;
  }

  function findTeamMeta(series, rawTeamName, profile = null) {
    const map = state.teamsMeta?.[series];
    if (!map) return null;
    const norm = normalizeText(rawTeamName);
    if (norm && map[norm]) return map[norm];
    if (profile?.keys) {
      for (const k of profile.keys) {
        const kn = normalizeText(k);
        if (kn && map[kn]) return map[kn];
      }
      // Buscar coincidencia parcial más larga con keys editoriales (ej. "ferrari" -> "ferrari")
      for (const k of profile.keys) {
        const kn = normalizeText(k);
        if (!kn) continue;
        const hitKey = Object.keys(map).find((mk) => mk === kn || (mk.includes(kn) && map[mk].w > 0));
        if (hitKey) return map[hitKey];
      }
    }
    return null;
  }

  function buildTeamsExplorerList() {
    const out = [];
    const seen = new Set();

    ["f1", "motogp"].forEach((series) => {
      const curYear = getCurrentSeasonYear(series);
      // 1) Fichas editoriales (activas 2026 + leyendas históricas)
      (state.teamsInfo?.[series] || []).forEach((prof) => {
        const key = `${series}:${normalizeText(prof.name)}`;
        if (seen.has(key)) return;
        seen.add(key);
        const meta = findTeamMeta(series, prof.name, prof) || {};
        if (meta.n) seen.add(`${series}:${normalizeText(meta.n)}`);
        (prof.keys || []).forEach((k) => seen.add(`${series}:${normalizeText(k)}`));
        out.push({
          series,
          name: prof.name,
          rawName: prof.name,
          flag: prof.flag || meta.fl || "",
          country: prof.hq || prof.country || meta.co || "",
          active: Boolean(prof.active),
          editorial: true,
          wins: Number(meta.w || 0),
          podiums: Number(meta.pod || 0),
          gps: Number(meta.gps || 0),
          firstYear: meta.first || 0,
          lastYear: prof.active ? curYear : meta.last || 0,
          era: prof.era || "",
          norm: normalizeText(`${prof.name} ${prof.country || ""} ${prof.hq || ""} ${(prof.keys || []).join(" ")}`),
        });
      });

      // 2) Constructores y marcas históricas del catálogo completo (teams_meta.json)
      Object.entries(state.teamsMeta?.[series] || {}).forEach(([k, meta]) => {
        if (!meta?.n) return;
        // En MotoGP evitar ruido de nombres patrocinados de un solo año con 0 podios
        if (series === "motogp" && (meta.pod || 0) === 0 && (meta.gps || 0) < 12) return;
        const dupKey = `${series}:${k}`;
        if (seen.has(dupKey)) return;
        // Evitar duplicar una ficha editorial ya incluida
        const prof = findTeamProfile(series, meta.n);
        if (prof && seen.has(`${series}:${normalizeText(prof.name)}`) && (series === "f1" || k === normalizeText(prof.keys?.[0] || ""))) {
          return;
        }
        seen.add(dupKey);
        out.push({
          series,
          name: meta.n,
          rawName: meta.n,
          flag: meta.fl || "",
          country: meta.co || meta.nat || "",
          active: Number(meta.last || 0) >= curYear,
          editorial: false,
          wins: Number(meta.w || 0),
          podiums: Number(meta.pod || 0),
          gps: Number(meta.gps || 0),
          firstYear: meta.first || 0,
          lastYear: meta.last || curYear,
          era: "",
          norm: normalizeText(`${meta.n} ${meta.co || ""} ${meta.nat || ""}`),
        });
      });
    });

    out.sort(
      (a, b) =>
        Number(b.active) - Number(a.active) ||
        b.wins - a.wins ||
        b.podiums - a.podiums ||
        b.gps - a.gps ||
        a.name.localeCompare(b.name, "es")
    );
    return out;
  }

  function buildCircuitsExplorerList() {
    const out = [];
    ["f1", "motogp"].forEach((series) => {
      Object.values(state.circuitsInfo?.[series] || {}).forEach((c) => {
        if (!c?.n) return;
        out.push({
          series,
          name: c.n,
          flag: c.fl || "🏟️",
          country: c.co || "",
          locality: c.loc || "",
          gps: Number(c.gps || 0),
          first: Number(c.first || 0),
          last: Number(c.last || 0),
          topWinner: c.top?.[0] || null,
          norm: normalizeText(`${c.n} ${c.loc || ""} ${c.co || ""}`),
        });
      });
    });
    out.sort((a, b) => b.gps - a.gps || b.last - a.last || a.name.localeCompare(b.name, "es"));
    return out;
  }

  function renderSearchBox({ id, value, placeholder, ariaLabel, clearTarget }) {
    const clearBtn = value
      ? `<button class="search-clear-btn" type="button" data-clear-search="${escapeHtml(clearTarget)}" aria-label="Borrar búsqueda" title="Borrar búsqueda">✕</button>`
      : "";
    return `
      <div class="search-box">
        <input id="${escapeHtml(id)}" class="search-input" type="search" placeholder="${escapeHtml(placeholder)}" value="${escapeHtml(value)}" aria-label="${escapeHtml(ariaLabel)}">
        ${clearBtn}
      </div>`;
  }

  function renderExplorerCompare() {
    if (!state.careerIndex) buildCareerIndex();
    const series = state.compareSeries;
    const pool = state.careerIndex.filter((d) => d.series === series);
    if (pool.length < 2) {
      return `<div class="empty-state">Aún no hay suficientes pilotos cargados para comparar.</div>`;
    }

    const presets =
      series === "f1"
        ? [
            ["Ayrton Senna", "Alain Prost"],
            ["Michael Schumacher", "Lewis Hamilton"],
            ["Fernando Alonso", "Max Verstappen"],
            ["Juan Fangio", "Jim Clark"],
            ["Niki Lauda", "James Hunt"],
          ]
        : [
            ["Valentino Rossi", "Marc Marquez"],
            ["Giacomo Agostini", "Angel Nieto"],
            ["Mick Doohan", "Kevin Schwantz"],
            ["Jorge Lorenzo", "Dani Pedrosa"],
            ["Casey Stoner", "Valentino Rossi"],
          ];

    let entryA = findCareerEntry(series, state.compareDriverA) || pool[0];
    let entryB = findCareerEntry(series, state.compareDriverB) || pool[1];
    if (entryA.norm === entryB.norm) {
      entryB = pool.find((d) => d.norm !== entryA.norm) || pool[1];
    }
    state.compareDriverA = entryA.name;
    state.compareDriverB = entryB.name;

    const metaA = getDriverMeta(series, entryA.name) || {};
    const metaB = getDriverMeta(series, entryB.name) || {};

    const statsOf = (entry, meta) => {
      const gps = Number(meta.gps || 0);
      const wins = series === "f1" ? Math.max(Number(meta.w || 0), entry.totalWins || 0) : Number(meta.w || 0);
      const pods = Number(meta.pod || 0);
      const winPct = gps > 0 ? Math.round((wins / gps) * 1000) / 10 : 0;
      const isNieto = series === "motogp" && entry.norm === "angel nieto" && entry.titles === 13;
      return {
        titles: entry.titles,
        titlesTxt: isNieto ? "12+1" : String(entry.titles),
        gps,
        wins,
        pods,
        winPct,
        bestPos: entry.bestPos,
        seasons: entry.distinctYears || entry.seasons.length,
      };
    };

    const sA = statsOf(entryA, metaA);
    const sB = statsOf(entryB, metaB);

    const compareRows = [
      { label: "Títulos", a: sA.titles, b: sB.titles, aTxt: sA.titlesTxt, bTxt: sB.titlesTxt, higherWins: true },
      { label: series === "f1" ? "Victorias F1" : "Victorias MotoGP/500cc", a: sA.wins, b: sB.wins, aTxt: String(sA.wins), bTxt: String(sB.wins), higherWins: true },
      { label: series === "f1" ? "Podios F1" : "Podios MotoGP/500cc", a: sA.pods, b: sB.pods, aTxt: String(sA.pods), bTxt: String(sB.pods), higherWins: true },
      { label: "GPs disputados", a: sA.gps, b: sB.gps, aTxt: String(sA.gps), bTxt: String(sB.gps), higherWins: true },
      { label: "% Victorias", a: sA.winPct, b: sB.winPct, aTxt: `${String(sA.winPct).replace(".", ",")}%`, bTxt: `${String(sB.winPct).replace(".", ",")}%`, higherWins: true },
      { label: "Mejor puesto", a: sA.bestPos, b: sB.bestPos, aTxt: `${sA.bestPos}º`, bTxt: `${sB.bestPos}º`, higherWins: false },
      { label: "Temporadas", a: sA.seasons, b: sB.seasons, aTxt: String(sA.seasons), bTxt: String(sB.seasons), higherWins: true },
    ];

    // Temporadas en común en la misma categoría
    const mapB = new Map();
    entryB.seasons.forEach((s) => mapB.set(`${s.year}:${s.category}`, s));
    const shared = [];
    let aheadA = 0;
    let aheadB = 0;
    entryA.seasons.forEach((sa) => {
      const sb = mapB.get(`${sa.year}:${sa.category}`);
      if (!sb) return;
      if (sa.position < sb.position) aheadA += 1;
      else if (sb.position < sa.position) aheadB += 1;
      shared.push({ year: sa.year, category: sa.category, a: sa, b: sb });
    });

    const optsPool = pool.slice(0, 260);
    const makeOptions = (selectedName) => {
      const list = optsPool.some((d) => d.name === selectedName)
        ? optsPool
        : [findCareerEntry(series, selectedName), ...optsPool].filter(Boolean);
      return list
        .map(
          (d) =>
            `<option value="${escapeHtml(d.name)}" ${d.name === selectedName ? "selected" : ""}>${d.flag ? d.flag + " " : ""}${escapeHtml(d.name)}${d.titles > 0 ? ` (🏆 ${d.titles})` : ""}</option>`
        )
        .join("");
    };

    const sharedHtml = shared.length
      ? `
        <div class="section-head" style="margin-top:20px">
          <h3 class="section-title">Temporadas coincidiendo en pista (${shared.length})</h3>
          <span class="section-sub">Por delante en el Mundial: <strong>${escapeHtml(entryA.name)} ${aheadA}</strong> – <strong>${aheadB} ${escapeHtml(entryB.name)}</strong></span>
        </div>
        <div class="career-list">
          ${shared
            .map(
              (sh) => `
                <div class="compare-shared-row">
                  <div class="compare-shared-side left ${sh.a.position < sh.b.position ? "is-win" : ""}">
                    <strong>${sh.a.position}º</strong> <span class="section-sub">(${formatPoints(sh.a.points)} pts)</span>
                  </div>
                  <div class="compare-shared-yr">${sh.year}${series === "motogp" ? ` · ${escapeHtml(sh.category)}` : ""}</div>
                  <div class="compare-shared-side right ${sh.b.position < sh.a.position ? "is-win" : ""}">
                    <strong>${sh.b.position}º</strong> <span class="section-sub">(${formatPoints(sh.b.points)} pts)</span>
                  </div>
                </div>`
            )
            .join("")}
        </div>`
      : `<p class="section-sub" style="margin-top:16px;text-align:center">Estos dos pilotos compitieron en épocas distintas y no coincidieron en ninguna temporada.</p>`;

    return `
      <div class="toolbar">
        <div class="pills">
          <button class="pill f1 ${series === "f1" ? "active" : ""}" data-cmp-series="f1">Fórmula 1</button>
          <button class="pill motogp ${series === "motogp" ? "active" : ""}" data-cmp-series="motogp">Motociclismo</button>
        </div>
        <span class="section-sub">Duelos clásicos en un clic o elige a cualquiera</span>
      </div>

      <div class="compare-presets">
        ${presets
          .map(
            ([pa, pb]) => `
              <button class="compare-preset-btn" type="button" data-cmp-preset="${escapeHtml(pa)}|${escapeHtml(pb)}">
                ⚔️ ${escapeHtml(pa.split(" ").slice(-1)[0])} vs. ${escapeHtml(pb.split(" ").slice(-1)[0])}
              </button>`
          )
          .join("")}
      </div>

      <div class="compare-pickers">
        <select id="compare-select-a" class="year-select" aria-label="Primer piloto">
          ${makeOptions(entryA.name)}
        </select>
        <span class="compare-vs-badge">VS</span>
        <select id="compare-select-b" class="year-select" aria-label="Segundo piloto">
          ${makeOptions(entryB.name)}
        </select>
      </div>

      <article class="compare-card">
        <div class="compare-heads">
          <div class="compare-side left">
            <div id="cmp-portrait-a" data-portrait-target="${escapeHtml(series)}:${escapeHtml(entryA.norm)}">${
              metaA.pic
                ? `<div class="driver-portrait-wrap"><img class="driver-portrait-img" src="${escapeHtml(metaA.pic)}" alt="${escapeHtml(entryA.name)}" onerror="this.parentElement.remove()"></div>`
                : ""
            }</div>
            <div style="min-width:0">
              <button class="st-name-btn" style="font-size:1rem" type="button" data-open-driver="${escapeHtml(series)}|${escapeHtml(entryA.name)}">
                ${entryA.flag ? `${entryA.flag} ` : ""}${escapeHtml(entryA.name)}
              </button>
              <div class="st-team">${entryA.firstYear}–${entryA.lastYear}${entryA.titleBreakdown && series === "motogp" ? ` · ${escapeHtml(entryA.titleBreakdown)}` : ""}</div>
            </div>
          </div>

          <div class="compare-side right">
            <div id="cmp-portrait-b" data-portrait-target="${escapeHtml(series)}:${escapeHtml(entryB.norm)}">${
              metaB.pic
                ? `<div class="driver-portrait-wrap"><img class="driver-portrait-img" src="${escapeHtml(metaB.pic)}" alt="${escapeHtml(entryB.name)}" onerror="this.parentElement.remove()"></div>`
                : ""
            }</div>
            <div style="min-width:0">
              <button class="st-name-btn" style="font-size:1rem" type="button" data-open-driver="${escapeHtml(series)}|${escapeHtml(entryB.name)}">
                ${entryB.flag ? `${entryB.flag} ` : ""}${escapeHtml(entryB.name)}
              </button>
              <div class="st-team">${entryB.firstYear}–${entryB.lastYear}${entryB.titleBreakdown && series === "motogp" ? ` · ${escapeHtml(entryB.titleBreakdown)}` : ""}</div>
            </div>
          </div>
        </div>

        <div class="compare-stat-list">
          ${compareRows
            .map((row) => {
              const aWin = row.higherWins ? row.a > row.b : row.a < row.b;
              const bWin = row.higherWins ? row.b > row.a : row.b < row.a;
              return `
                <div class="compare-stat-row">
                  <div class="compare-stat-val left ${aWin ? "is-win" : ""}">${escapeHtml(row.aTxt)}</div>
                  <div class="compare-stat-label">${escapeHtml(row.label)}</div>
                  <div class="compare-stat-val right ${bWin ? "is-win" : ""}">${escapeHtml(row.bTxt)}</div>
                </div>`;
            })
            .join("")}
        </div>

        ${sharedHtml}
      </article>
    `;
  }

  function renderExplorerTeams() {
    const all = buildTeamsExplorerList();
    const q = normalizeText(state.teamSearchQuery);
    const filtered = all.filter((t) => {
      if (state.teamSearchSeries !== "all" && t.series !== state.teamSearchSeries) return false;
      if (state.teamSearchScope === "active" && !t.active) return false;
      if (q && !t.norm.includes(q)) return false;
      return true;
    });
    const shown = filtered.slice(0, 60);

    const listHtml = shown.length
      ? `<div class="search-results-list">
           ${shown
             .map((t) => {
               const span =
                 t.era ||
                 (t.firstYear && t.lastYear
                   ? t.firstYear === t.lastYear
                     ? String(t.firstYear)
                     : `${t.firstYear}–${t.lastYear}`
                   : "");
               const statMain =
                 t.wins > 0
                   ? `🏆 ${t.wins} ${t.wins === 1 ? "victoria" : "victorias"}`
                   : t.podiums > 0
                   ? `${t.podiums} ${t.podiums === 1 ? "podio" : "podios"}`
                   : t.gps > 0
                   ? `${t.gps} GPs`
                   : "Ficha";
               return `
                 <button class="driver-hit" type="button" data-open-team="${escapeHtml(t.series)}|${escapeHtml(t.rawName)}|${t.lastYear || getCurrentSeasonYear(t.series)}">
                   <div style="display:flex;align-items:center;gap:12px;min-width:0">
                     ${renderVehicleThumb(t.series, t.name)}
                     <div style="min-width:0">
                       <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">
                         <span class="series-badge ${t.series}">${t.series === "f1" ? "F1" : "MotoGP"}</span>
                         ${t.active ? `<span class="status-tag next" style="margin-top:0">2026</span>` : ""}
                       </div>
                       <div style="font-weight:750;font-size:0.95rem;margin-top:4px">${t.flag ? `${t.flag} ` : ""}${escapeHtml(t.name)}</div>
                       <div class="st-team">${escapeHtml([t.country, span].filter(Boolean).join(" · ") || "Escudería histórica")}</div>
                     </div>
                   </div>
                   <div class="st-pts">
                     <strong>${statMain}</strong>
                     <small>Ver ficha →</small>
                   </div>
                 </button>`;
             })
             .join("")}
         </div>`
      : `<div class="empty-state">No encontré ninguna escudería con "${escapeHtml(state.teamSearchQuery)}". Prueba con <em>Ferrari, McLaren, Lotus, Ducati, Yamaha, MV Agusta…</em></div>`;

    return `
      <div class="toolbar">
        <div class="toolbar-group">
          <div class="pills">
            <button class="pill ${state.teamSearchSeries === "all" ? "active" : ""}" data-ts-series="all">F1 y MotoGP</button>
            <button class="pill f1 ${state.teamSearchSeries === "f1" ? "active" : ""}" data-ts-series="f1">Solo F1</button>
            <button class="pill motogp ${state.teamSearchSeries === "motogp" ? "active" : ""}" data-ts-series="motogp">Solo MotoGP</button>
          </div>
          <div class="pills">
            <button class="pill ${state.teamSearchScope === "all" ? "active" : ""}" data-ts-scope="all">Todas (${filtered.length})</button>
            <button class="pill ${state.teamSearchScope === "active" ? "active" : ""}" data-ts-scope="active">Activas 2026</button>
          </div>
        </div>
        ${renderSearchBox({
          id: "team-search",
          value: state.teamSearchQuery,
          placeholder: "Busca escudería o marca (ej. Ferrari, Lotus, Ducati…)",
          ariaLabel: "Buscar escudería",
          clearTarget: "team",
        })}
      </div>
      ${listHtml}
    `;
  }

  function renderExplorerCircuits() {
    const all = buildCircuitsExplorerList();
    const poolSeries =
      state.circuitSearchSeries === "all" ? all : all.filter((c) => c.series === state.circuitSearchSeries);

    const countryMap = new Map();
    poolSeries.forEach((c) => {
      if (!c.country) return;
      const cur = countryMap.get(c.country) || { name: c.country, flag: c.flag, count: 0 };
      cur.count += 1;
      countryMap.set(c.country, cur);
    });
    const countries = Array.from(countryMap.values()).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, "es"));
    if (state.circuitCountryFilter !== "all" && !countryMap.has(state.circuitCountryFilter)) {
      state.circuitCountryFilter = "all";
    }

    const q = normalizeText(state.circuitSearchQuery);
    const filtered = poolSeries.filter((c) => {
      if (state.circuitCountryFilter !== "all" && c.country !== state.circuitCountryFilter) return false;
      if (q && !c.norm.includes(q)) return false;
      return true;
    });
    const shown = filtered.slice(0, 70);

    const countryOpts = [
      `<option value="all">🌍 Todos los países (${poolSeries.length})</option>`,
      ...countries.map(
        (c) =>
          `<option value="${escapeHtml(c.name)}" ${state.circuitCountryFilter === c.name ? "selected" : ""}>${c.flag ? c.flag + " " : ""}${escapeHtml(c.name)} (${c.count})</option>`
      ),
    ].join("");

    const listHtml = shown.length
      ? `<div class="search-results-list">
           ${shown
             .map((c) => {
               const span = c.first && c.last ? (c.first === c.last ? String(c.first) : `${c.first}–${c.last}`) : "";
               const recTxt = c.topWinner ? ` · Récord: ${c.topWinner[0]} (${c.topWinner[1]})` : "";
               return `
                 <button class="driver-hit" type="button" data-open-circuit="${escapeHtml(c.series)}|${escapeHtml(c.name)}">
                   <div style="min-width:0">
                     <span class="series-badge ${c.series}">${c.series === "f1" ? "F1" : "MotoGP / 500cc"}</span>
                     <div style="font-weight:750;font-size:0.96rem;margin-top:5px">${c.flag} ${escapeHtml(c.name)}</div>
                     <div class="st-team">${escapeHtml([c.locality, c.country, span].filter(Boolean).join(" · "))}${escapeHtml(recTxt)}</div>
                   </div>
                   <div class="st-pts">
                     <strong>${c.gps > 0 ? `${c.gps} GPs` : "Nuevo"}</strong>
                     <small>Ver circuito →</small>
                   </div>
                 </button>`;
             })
             .join("")}
         </div>`
      : `<div class="empty-state">No encontré ningún circuito con "${escapeHtml(state.circuitSearchQuery)}". Prueba con <em>Jerez, Kyalami, Monza, Silverstone, Assen…</em></div>`;

    return `
      <div class="toolbar">
        <div class="toolbar-group">
          <div class="pills">
            <button class="pill ${state.circuitSearchSeries === "all" ? "active" : ""}" data-cs-series="all">F1 y MotoGP</button>
            <button class="pill f1 ${state.circuitSearchSeries === "f1" ? "active" : ""}" data-cs-series="f1">Solo F1</button>
            <button class="pill motogp ${state.circuitSearchSeries === "motogp" ? "active" : ""}" data-cs-series="motogp">Solo MotoGP</button>
          </div>
          <select id="circuit-country-select" class="year-select" aria-label="Filtrar circuitos por país">
            ${countryOpts}
          </select>
        </div>
        ${renderSearchBox({
          id: "circuit-search",
          value: state.circuitSearchQuery,
          placeholder: "Busca circuito o ciudad (ej. Jerez, Monza, Kyalami…)",
          ariaLabel: "Buscar circuito",
          clearTarget: "circuit",
        })}
      </div>
      ${listHtml}
    `;
  }

  function renderArchivoPilotos() {
    let bodyHtml = "";

    if (state.selectedDriver) {
      const entry = findCareerEntry(state.selectedDriver.series, state.selectedDriver.name);
      if (entry) {
        const curYear = getCurrentSeasonYear(entry.series);
        const rowsHtml = entry.seasons
          .map((s) => {
            const isCur = s.year === curYear;
            const posBadge =
              s.position === 1 && !isCur
                ? `<span style="color:var(--gold);font-weight:800">🏆 1º</span>`
                : `<span style="font-weight:800;color:${s.position <= 3 ? "var(--text)" : "var(--text-muted)"}">${s.position}º</span>`;
            const catCls =
              entry.series === "f1"
                ? "is-f1"
                : s.classKey === "premier"
                ? "is-premier"
                : "";
            return `
              <button class="career-season-row" type="button" data-jump-season="${escapeHtml(entry.series)}|${s.year}|${escapeHtml(s.classKey || "premier")}" title="Ver clasificación completa de ${s.category} ${s.year}">
                <span style="font-weight:800">${s.year}${isCur ? "*" : ""}</span>
                <span class="cat-tag ${catCls}">${escapeHtml(s.category || (entry.series === "f1" ? "F1" : "MotoGP"))}</span>
                <span>${posBadge}</span>
                <span class="career-team-cell">
                  ${renderVehicleThumb(entry.series, s.team, true)}
                  <span style="color:var(--text-muted);font-size:0.84rem">${escapeHtml(s.team || "—")}</span>
                </span>
                <span style="font-weight:700;font-variant-numeric:tabular-nums">${formatPoints(s.points)} pts</span>
              </button>`;
          })
          .join("");

        const isAngelNieto = entry.series === "motogp" && entry.norm === "angel nieto" && entry.titles === 13;
        const titlesDisplay = isAngelNieto ? "12+1" : String(entry.titles);
        const catsSubtitle =
          entry.series === "motogp" && entry.categories?.length
            ? ` · Categorías: ${entry.categories.join(", ")}`
            : "";

        const meta = getDriverMeta(entry.series, entry.name) || {};
        const isActiveNow = entry.lastYear === curYear && !meta.ret;

        const bioItems = [];
        if (meta.co || meta.nat) {
          const natVal =
            meta.nat && meta.co && meta.nat.toLowerCase() !== meta.co.toLowerCase()
              ? `${meta.fl ? meta.fl + " " : ""}${meta.nat} (${meta.co})`
              : `${meta.fl ? meta.fl + " " : ""}${meta.co || meta.nat}`;
          bioItems.push({ label: "Nacionalidad", value: natVal });
        }
        if (meta.dob) {
          const dobLabel = formatBirthInfo(meta.dob, !isActiveNow);
          bioItems.push({
            label: "Nacimiento",
            value: meta.city ? `${dobLabel} · ${meta.city}` : dobLabel,
          });
        } else if (meta.city) {
          bioItems.push({ label: "Ciudad natal", value: meta.city });
        }
        if (meta.h || meta.wt) {
          const parts = [];
          if (meta.h) parts.push(`${meta.h} cm`);
          if (meta.wt) parts.push(`${meta.wt} kg`);
          bioItems.push({ label: "Físico", value: parts.join(" · ") });
        }
        if (meta.ret) {
          bioItems.push({ label: "Estado", value: meta.ry ? `Retirado (${meta.ry})` : "Retirado" });
        } else if (isActiveNow) {
          bioItems.push({ label: "Estado", value: `En activo (${curYear})` });
        }

        const bioHtml = `<div id="driver-bio-grid" class="driver-bio-grid" data-bio-target="${escapeHtml(entry.series)}:${escapeHtml(entry.norm)}" ${bioItems.length ? "" : "hidden"}>
               ${bioItems
                 .map(
                   (b) => `
                     <div class="driver-bio-item" ${b.label === "Nacimiento" ? 'data-birth-card="1"' : ""}>
                       <small>${escapeHtml(b.label)}</small>
                       <strong>${escapeHtml(b.value)}</strong>
                     </div>`
                 )
                 .join("")}
             </div>`;

        const careerActionsHtml = state.driverReturnTo
          ? `
            <div class="career-actions">
              <button class="btn-return" type="button" data-driver-back>${escapeHtml(state.driverReturnTo.label)}</button>
              <button class="btn-secondary" type="button" data-clear-driver>🔍 Buscar otro piloto</button>
            </div>`
          : `<button class="btn-secondary" type="button" data-clear-driver>← Volver a la búsqueda</button>`;

        const statGps = Number(meta.gps || 0);
        const statWins = entry.series === "f1" ? Math.max(Number(meta.w || 0), entry.totalWins || 0) : Number(meta.w || 0);
        const statPodiums = Number(meta.pod || 0);
        const winsLabel = entry.series === "f1" ? "Victorias F1" : "Victorias MotoGP/500cc";
        const podLabel = entry.series === "f1" ? "Podios F1" : "Podios MotoGP/500cc";
        const gpsLabel = entry.series === "f1" ? "GPs disputados" : "GPs MotoGP/500cc";

        const directPortraitHtml = meta.pic
          ? `<div class="driver-portrait-wrap"><img class="driver-portrait-img" src="${escapeHtml(meta.pic)}" alt="Foto de ${escapeHtml(entry.name)}" loading="lazy" onerror="this.parentElement.remove()"></div>`
          : "";

        bodyHtml = `
          <article class="career-card">
            <div class="career-head">
              <div class="career-identity">
                <div id="driver-portrait-slot" data-portrait-target="${escapeHtml(entry.series)}:${escapeHtml(entry.norm)}">${directPortraitHtml}</div>
                <div style="min-width:0">
                  <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
                    <span class="series-badge ${entry.series}">${entry.series === "f1" ? "Fórmula 1" : "Mundial de Motociclismo"}</span>
                    ${meta.leg ? `<span class="legend-badge">🏛️ MotoGP Legend</span>` : ""}
                    ${meta.no ? `<span class="st-number">#${escapeHtml(meta.no)}</span>` : ""}
                    <a id="driver-wiki-link" class="wiki-link-btn" data-wiki-target="${escapeHtml(entry.series)}:${escapeHtml(entry.norm)}" href="${escapeHtml(meta.wiki || "#")}" target="_blank" rel="noopener noreferrer" ${meta.wiki ? "" : "hidden"}>📖 Wikipedia ↗</a>
                  </div>
                  <h2 class="career-name">${meta.fl ? `${meta.fl} ` : ""}${escapeHtml(entry.name)}${
                    meta.nick ? ` <span style="font-size:0.78em;color:var(--text-muted);font-weight:600">«${escapeHtml(meta.nick)}»</span>` : ""
                  }</h2>
                  <span class="section-sub">En activo en archivo: ${entry.firstYear}–${entry.lastYear}${escapeHtml(catsSubtitle)} · Pulsa cualquier año para ver la tabla completa</span>
                </div>
              </div>
              ${careerActionsHtml}
            </div>

            ${bioHtml}
            <p id="driver-bio-summary" class="team-summary-text" data-summary-target="${escapeHtml(entry.series)}:${escapeHtml(entry.norm)}" style="margin-bottom:14px" hidden></p>
            <div id="driver-other-titles" class="other-titles-box" data-other-titles-target="${escapeHtml(entry.series)}:${escapeHtml(entry.norm)}" hidden></div>

            <div class="career-kpis">
              <div class="kpi-box">
                <strong>${titlesDisplay}</strong>
                <span>${entry.titles === 1 ? "Título mundial" : "Títulos mundiales"}</span>
                ${entry.series === "motogp" && entry.titleBreakdown ? `<small class="kpi-breakdown">${escapeHtml(entry.titleBreakdown)}</small>` : ""}
              </div>
              ${statGps > 0 ? `<div class="kpi-box"><strong>${statGps}</strong><span>${gpsLabel}</span></div>` : ""}
              ${statWins > 0 || entry.series === "f1" ? `<div class="kpi-box"><strong>${statWins}</strong><span>${winsLabel}</span></div>` : ""}
              ${statPodiums > 0 ? `<div class="kpi-box"><strong>${statPodiums}</strong><span>${podLabel}</span></div>` : ""}
              <div class="kpi-box">
                <strong>${entry.bestPos}º</strong>
                <span>Mejor posición final</span>
              </div>
              <div class="kpi-box">
                <strong>${entry.distinctYears || entry.seasons.length}</strong>
                <span>Temporadas</span>
              </div>
            </div>

            <div class="career-list">${rowsHtml}</div>
          </article>`;
      }
    } else {
      const countries = getAvailableDriverCountries(state.driverSearchSeries);
      if (state.driverCountryFilter !== "all" && !countries.some((c) => c.iso === state.driverCountryFilter)) {
        state.driverCountryFilter = "all";
      }
      const hits = searchDrivers(state.driverQuery, state.driverSearchSeries, state.driverCountryFilter);
      bodyHtml = hits.length
        ? `<div class="search-results-list">
             ${hits
               .map((d) => {
                 const isNieto = d.series === "motogp" && d.norm === "angel nieto" && d.titles === 13;
                 const badgeTxt = d.series === "f1" ? "F1" : (d.categories?.slice(0, 3).join(" · ") || "MotoGP");
                 const titleHit =
                   d.titles > 0
                     ? isNieto
                       ? "🏆 12+1"
                       : `🏆 ${d.titles}`
                     : `Mejor: ${d.bestPos}º`;
                 return `
                   <button class="driver-hit" type="button" data-open-driver="${escapeHtml(d.series)}|${escapeHtml(d.name)}">
                     <div>
                       <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">
                         <span class="series-badge ${d.series}">${escapeHtml(badgeTxt)}</span>
                         ${d.legend ? `<span class="legend-badge" style="font-size:0.65rem;padding:2px 7px">🏛️ Legend</span>` : ""}
                       </div>
                       <div style="font-weight:750;font-size:0.96rem;margin-top:5px">${d.flag ? `${d.flag} ` : ""}${escapeHtml(d.name)}</div>
                       <div class="st-team">${d.countryName ? `${escapeHtml(d.countryName)} · ` : ""}${d.firstYear}–${d.lastYear} · ${d.distinctYears || d.seasons.length} ${(d.distinctYears || d.seasons.length) === 1 ? "temporada" : "temporadas"}${
                         d.series === "motogp" && d.titleBreakdown ? ` · ${escapeHtml(d.titleBreakdown)}` : ""
                       }</div>
                     </div>
                     <div class="st-pts">
                       <strong>${titleHit}</strong>
                       <small>Ver historial →</small>
                     </div>
                   </button>`;
               })
               .join("")}
           </div>`
        : `<div class="empty-state">No encontré ningún piloto con esos filtros. Prueba con otro apellido o selecciona <em>Todos los países</em>.</div>`;
    }

    const countriesList = getAvailableDriverCountries(state.driverSearchSeries);
    const countryOptions = [
      `<option value="all">🌍 Todos los países</option>`,
      ...countriesList.map(
        (c) =>
          `<option value="${escapeHtml(c.iso)}" ${state.driverCountryFilter === c.iso ? "selected" : ""}>${c.flag ? c.flag + " " : ""}${escapeHtml(c.name)} (${c.count})</option>`
      ),
    ].join("");

    return `
      <div class="toolbar">
        <div class="toolbar-group">
          <div class="pills">
            <button class="pill ${state.driverSearchSeries === "all" ? "active" : ""}" data-ds-series="all">F1 y MotoGP</button>
            <button class="pill f1 ${state.driverSearchSeries === "f1" ? "active" : ""}" data-ds-series="f1">Solo F1</button>
            <button class="pill motogp ${state.driverSearchSeries === "motogp" ? "active" : ""}" data-ds-series="motogp">Solo MotoGP</button>
          </div>
          <select id="driver-country-select" class="year-select" aria-label="Filtrar pilotos por país">
            ${countryOptions}
          </select>
        </div>
        ${renderSearchBox({
          id: "driver-search",
          value: state.driverQuery,
          placeholder: "Busca cualquier piloto (ej. Senna, Ángel Nieto, Pedrosa…)",
          ariaLabel: "Buscar piloto histórico",
          clearTarget: "driver",
        })}
      </div>
      ${bodyHtml}
    `;
  }

  function renderArchivo() {
    clearInterval(state.countdownTimer);
    let inner = "";
    if (state.archiveSection === "temporadas") inner = renderArchivoTemporadas();
    else if (state.archiveSection === "palmares") inner = renderArchivoPalmares();
    else if (state.archiveSection === "escuderias") inner = renderExplorerTeams();
    else if (state.archiveSection === "circuitos") inner = renderExplorerCircuits();
    else if (state.archiveSection === "comparar") inner = renderExplorerCompare();
    else inner = renderArchivoPilotos();

    appEl.innerHTML = `
      <div class="toolbar" style="margin-bottom:12px">
        <div class="pills" role="tablist" aria-label="Secciones del Archivo">
          <button class="pill ${state.archiveSection === "temporadas" ? "active" : ""}" data-arch-section="temporadas">📅 Temporadas</button>
          <button class="pill ${state.archiveSection === "palmares" ? "active" : ""}" data-arch-section="palmares">🏆 Palmarés</button>
          <button class="pill ${state.archiveSection === "pilotos" ? "active" : ""}" data-arch-section="pilotos">👤 Pilotos</button>
          <button class="pill ${state.archiveSection === "escuderias" ? "active" : ""}" data-arch-section="escuderias">🏎️ Escuderías</button>
          <button class="pill ${state.archiveSection === "circuitos" ? "active" : ""}" data-arch-section="circuitos">🏟️ Circuitos</button>
          <button class="pill ${state.archiveSection === "comparar" ? "active" : ""}" data-arch-section="comparar">⚔️ Cara a cara</button>
        </div>
      </div>
      ${inner}
    `;

    const sel = document.getElementById("season-select");
    if (sel) {
      sel.addEventListener("change", (e) => {
        state.archiveYear = Number(e.target.value);
        renderArchivo();
      });
    }

    const cSel = document.getElementById("driver-country-select");
    if (cSel) {
      cSel.addEventListener("change", (e) => {
        state.driverCountryFilter = e.target.value;
        state.selectedDriver = null;
        renderArchivo();
      });
    }

    const cirSel = document.getElementById("circuit-country-select");
    if (cirSel) {
      cirSel.addEventListener("change", (e) => {
        state.circuitCountryFilter = e.target.value;
        renderArchivo();
      });
    }

    const dInput = document.getElementById("driver-search");
    if (dInput) {
      dInput.addEventListener("input", (e) => {
        state.driverQuery = e.target.value;
        state.selectedDriver = null;
        const pos = e.target.selectionStart;
        renderArchivo();
        const nextIn = document.getElementById("driver-search");
        if (nextIn) {
          nextIn.focus();
          nextIn.setSelectionRange(pos, pos);
        }
      });
    }

    const tInput = document.getElementById("team-search");
    if (tInput) {
      tInput.addEventListener("input", (e) => {
        state.teamSearchQuery = e.target.value;
        const pos = e.target.selectionStart;
        renderArchivo();
        const nextIn = document.getElementById("team-search");
        if (nextIn) {
          nextIn.focus();
          nextIn.setSelectionRange(pos, pos);
        }
      });
    }

    const cirInput = document.getElementById("circuit-search");
    if (cirInput) {
      cirInput.addEventListener("input", (e) => {
        state.circuitSearchQuery = e.target.value;
        const pos = e.target.selectionStart;
        renderArchivo();
        const nextIn = document.getElementById("circuit-search");
        if (nextIn) {
          nextIn.focus();
          nextIn.setSelectionRange(pos, pos);
        }
      });
    }

    const cmpA = document.getElementById("compare-select-a");
    if (cmpA) {
      cmpA.addEventListener("change", (e) => {
        state.compareDriverA = e.target.value;
        renderArchivo();
      });
    }
    const cmpB = document.getElementById("compare-select-b");
    if (cmpB) {
      cmpB.addEventListener("change", (e) => {
        state.compareDriverB = e.target.value;
        renderArchivo();
      });
    }

    // Cargar foto, fecha exacta de fallecimiento (Wikidata), biografía ES y otros títulos F1
    if (state.archiveSection === "pilotos" && state.selectedDriver) {
      const entry = findCareerEntry(state.selectedDriver.series, state.selectedDriver.name);
      if (entry) {
        const meta = getDriverMeta(entry.series, entry.name) || {};
        hydrateDriverProfile(
          "driver-portrait-slot",
          "driver-bio-grid",
          "driver-bio-summary",
          "driver-wiki-link",
          "driver-other-titles",
          entry.series,
          entry.name,
          meta
        );
      }
    } else if (state.archiveSection === "comparar") {
      [
        ["cmp-portrait-a", state.compareDriverA],
        ["cmp-portrait-b", state.compareDriverB],
      ].forEach(([slotId, dName]) => {
        const meta = getDriverMeta(state.compareSeries, dName) || {};
        if (!meta.pic) {
          fetchWikiSummary(meta.wiki || "", dName).then((sum) => {
            if (!sum?.thumb || !isLikelySameDriver(sum, meta.dob || "")) return;
            const slot = document.getElementById(slotId);
            if (slot && slot.dataset.portraitTarget === `${state.compareSeries}:${normalizeText(dName)}`) {
              slot.innerHTML = `<div class="driver-portrait-wrap"><img class="driver-portrait-img" src="${escapeHtml(sum.thumb)}" alt="${escapeHtml(dName)}" onerror="this.parentElement.remove()"></div>`;
            }
          });
        }
      });
    }
  }

  // -------------------------------------------------------------------------
  // RENDERIZADO: NOTICIAS EN ESPAÑOL
  // -------------------------------------------------------------------------
  function renderNoticias() {
    clearInterval(state.countdownTimer);
    const itemsRaw = state.news?.items || [];
    const q = normalizeText(state.newsQuery);
    const now = Date.now();

    const filtered = itemsRaw.filter((it) => {
      if (state.newsFilter !== "all" && it.series !== state.newsFilter) return false;
      if (q) {
        const hay = normalizeText(`${it.title} ${it.summary} ${it.source}`);
        if (!hay.includes(q)) return false;
      }
      return true;
    });

    const cardsHtml = filtered.length
      ? filtered
          .map((art, idx) => {
            const artKey = `news-${idx}-${art.url}`;
            const isRecent = art.publishedAt && now - new Date(art.publishedAt).getTime() < 48 * 3600 * 1000;
            const blurred = isRecent && isSpoilerMasked(artKey);

            return `
              <article class="news-card ${blurred ? "is-blurred" : ""}">
                <a href="${escapeHtml(art.url)}" target="_blank" rel="noopener noreferrer" ${blurred ? 'tabindex="-1"' : ""}>
                  ${
                    art.image
                      ? `<div class="news-thumb-wrap"><img class="news-thumb" src="${escapeHtml(art.image)}" alt="" loading="lazy" onerror="this.parentElement.remove()"></div>`
                      : ""
                  }
                  <div class="news-body">
                    <div class="news-meta">
                      <span class="series-badge ${art.series}">${art.series === "f1" ? "F1" : "MotoGP"}</span>
                      <span>${escapeHtml(art.source)} · ${escapeHtml(formatRelativeTime(art.publishedAt))}</span>
                    </div>
                    <h3 class="news-title">${escapeHtml(art.title)}</h3>
                    ${art.summary ? `<p class="news-summary">${escapeHtml(art.summary)}</p>` : ""}
                  </div>
                </a>
                ${
                  blurred
                    ? `<div class="news-body" style="padding-top:0">
                         <div class="news-spoiler-overlay">
                           <span>🙈 Titular reciente oculto</span>
                           <button class="btn-reveal" type="button" data-reveal="${escapeHtml(artKey)}">Ver noticia</button>
                         </div>
                       </div>`
                    : ""
                }
              </article>`;
          })
          .join("")
      : `<div class="empty-state">No hay noticias que coincidan con tu búsqueda.</div>`;

    appEl.innerHTML = `
      <div class="toolbar">
        <div class="pills">
          <button class="pill ${state.newsFilter === "all" ? "active" : ""}" data-news-filter="all">Todas</button>
          <button class="pill f1 ${state.newsFilter === "f1" ? "active" : ""}" data-news-filter="f1">Fórmula 1</button>
          <button class="pill motogp ${state.newsFilter === "motogp" ? "active" : ""}" data-news-filter="motogp">MotoGP</button>
        </div>
        ${renderSearchBox({
          id: "news-search",
          value: state.newsQuery,
          placeholder: "Buscar piloto, equipo o circuito…",
          ariaLabel: "Buscar noticias",
          clearTarget: "news",
        })}
      </div>
      <section class="news-grid">${cardsHtml}</section>
    `;

    const input = document.getElementById("news-search");
    if (input) {
      input.addEventListener("input", (e) => {
        state.newsQuery = e.target.value;
        const pos = e.target.selectionStart;
        renderNoticias();
        const nextInput = document.getElementById("news-search");
        if (nextInput) {
          nextInput.focus();
          nextInput.setSelectionRange(pos, pos);
        }
      });
    }
  }

  // -------------------------------------------------------------------------
  // ROUTER Y EVENTOS
  // -------------------------------------------------------------------------
  function render() {
    if (!state.motorsport) return;

    document.querySelectorAll("[data-tab]").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.tab === state.tab);
    });

    if (state.tab === "inicio") renderInicio();
    else if (state.tab === "calendario") renderCalendario();
    else if (state.tab === "mundial") renderMundial();
    else if (state.tab === "archivo") renderArchivo();
    else if (state.tab === "noticias") renderNoticias();
  }

  function findEventById(id) {
    const all = [
      ...(state.motorsport?.f1?.events || []),
      ...(state.motorsport?.motogp?.events || []),
    ];
    const direct = all.find((e) => e.id === id);
    if (direct) return direct;
    for (const cached of state.raceArchiveCache.values()) {
      if (cached.status === "ready") {
        const hit = cached.events.find((e) => e.id === id);
        if (hit) return hit;
      }
    }
    return null;
  }

  function syncBodyScroll() {
    const anyOpen = !guideModal.hidden || !teamModal.hidden || !raceModal.hidden || !circuitModal.hidden;
    document.body.style.overflow = anyOpen ? "hidden" : "";
  }

  function openGuide() {
    guideModal.hidden = false;
    syncBodyScroll();
  }

  function closeGuide() {
    guideModal.hidden = true;
    syncBodyScroll();
  }

  function findTeamProfile(series, rawTeamName) {
    const list = state.teamsInfo?.[series] || [];
    const norm = normalizeText(rawTeamName);
    if (!norm) return null;
    let best = null;
    let bestScore = -1;
    for (const item of list) {
      for (const k of item.keys || []) {
        const kn = normalizeText(k);
        if (kn && norm.includes(kn) && kn.length > bestScore) {
          best = item;
          bestScore = kn.length;
        }
      }
    }
    return best;
  }

  function getTeamArchiveInfo(series, rawTeamName, profile, year) {
    const targetNorm = normalizeText(rawTeamName);
    const matchKeys = profile?.keys?.map((k) => normalizeText(k)) || [targetNorm];
    const isExactMatch = (candidate) => {
      const cn = normalizeText(candidate);
      if (!cn) return false;
      if (cn === targetNorm || cn.includes(targetNorm) || targetNorm.includes(cn)) return true;
      return matchKeys.some((k) => k && cn.includes(k));
    };

    const stYear = getSeasonStandings(series, year);
    const yearDrivers = stYear.drivers.filter((d) => {
      if (!d.team) return false;
      const dn = normalizeText(d.team);
      // En MotoGP evitar mezclar equipos satélite (Gresini/VR46) al abrir el equipo oficial Ducati
      if (series === "motogp" && profile) {
        const driverProfile = findTeamProfile(series, d.team);
        if (driverProfile && driverProfile.name !== profile.name) return false;
      }
      return isExactMatch(dn);
    });

    const years = getAvailableYears(series);
    const curYear = getCurrentSeasonYear(series);
    let seasonsCount = 0;
    let titlesCount = 0;
    let firstYear = null;
    let lastYear = null;

    years.forEach((yr) => {
      const st = getSeasonStandings(series, yr);
      const matchedTeam = st.teams.find((t) => {
        if (series === "motogp" && profile) {
          const tp = findTeamProfile(series, t.name);
          if (tp && tp.name !== profile.name) return false;
        }
        return isExactMatch(t.name);
      });
      const hasDrivers =
        matchedTeam ||
        st.drivers.some((d) => {
          if (series === "motogp" && profile) {
            const dp = findTeamProfile(series, d.team);
            if (dp && dp.name !== profile.name) return false;
          }
          return isExactMatch(d.team);
        });

      if (hasDrivers) {
        seasonsCount += 1;
        if (!lastYear || yr > lastYear) lastYear = yr;
        if (!firstYear || yr < firstYear) firstYear = yr;
      }
      if (matchedTeam && matchedTeam.position === 1 && yr < curYear) {
        titlesCount += 1;
      }
    });

    return { yearDrivers, seasonsCount, titlesCount, firstYear, lastYear };
  }

  function openTeamModal(series, rawTeamName, year) {
    const profile = findTeamProfile(series, rawTeamName);
    const meta = findTeamMeta(series, rawTeamName, profile);
    const livery = getTeamLivery(series, rawTeamName);
    const curYear = getCurrentSeasonYear(series);
    const displayYear = Number(year || curYear);
    const isCurYear = displayYear === curYear;
    const stats = getTeamArchiveInfo(series, rawTeamName, profile, displayYear);

    const displayName = profile?.name || meta?.n || rawTeamName;
    const displayFlag = profile?.flag || meta?.fl || "";
    teamModalTitle.textContent = displayName;

    const metaCards = [];
    if (profile?.hq) {
      metaCards.push({ label: "País y sede", value: `${displayFlag} ${profile.hq}`.trim() });
    } else if (meta?.co || meta?.nat) {
      metaCards.push({ label: "País", value: `${displayFlag} ${meta.co || meta.nat}`.trim() });
    }
    if (profile?.machine) {
      metaCards.push({ label: series === "f1" ? "Motor (ref. 2026)" : "Moto (ref. 2026)", value: profile.machine });
    } else if (profile?.era) {
      metaCards.push({ label: "Etapa en el Mundial", value: profile.era });
    }
    if (stats.seasonsCount > 0) {
      const span = stats.firstYear === stats.lastYear ? `${stats.firstYear}` : `${stats.firstYear}–${stats.lastYear}`;
      metaCards.push({ label: "En el archivo", value: `${stats.seasonsCount} temp. (${span})` });
    } else if (meta?.first && meta?.last) {
      metaCards.push({ label: "Años en el archivo", value: meta.first === meta.last ? String(meta.first) : `${meta.first}–${meta.last}` });
    }
    if (series === "f1" && stats.titlesCount > 0) {
      metaCards.push({ label: "Mundiales Constructores", value: `🏆 ${stats.titlesCount}` });
    }
    if (meta?.w > 0) {
      metaCards.push({ label: "Victorias en GP", value: `🏁 ${meta.w}` });
    }
    if (meta?.pod > 0) {
      metaCards.push({ label: "Podios en GP", value: String(meta.pod) });
    }

    const peopleHtml = [];
    if (profile?.leadership2026?.length) {
      peopleHtml.push(`
        <section class="guide-section">
          <h3>Personas clave · Dirección actual (2026)</h3>
          <div class="team-people-list">
            ${profile.leadership2026
              .map(
                (p) => `
                  <div class="team-person-row">
                    <strong>${escapeHtml(p.name)}</strong>
                    <span class="team-person-role">${escapeHtml(p.role)}</span>
                  </div>`
              )
              .join("")}
          </div>
        </section>`);
    }
    if (profile?.engineHistory?.length) {
      peopleHtml.push(`
        <section class="guide-section">
          <h3>${series === "f1" ? "Historial de motores" : "Historial de motos / fábricas"}</h3>
          <div class="engine-history-list">
            ${profile.engineHistory
              .map(
                (eh, idx) =>
                  `<span class="engine-chip ${idx === profile.engineHistory.length - 1 ? "is-latest" : ""}">${escapeHtml(eh)}</span>`
              )
              .join('<span class="engine-arrow" aria-hidden="true">→</span>')}
          </div>
        </section>`);
    }
    if (profile?.founders) {
      peopleHtml.push(`
        <section class="guide-section">
          <h3>${profile.active ? "Origen e historia" : "Figuras históricas y fundación"}</h3>
          <p class="team-summary-text">${escapeHtml(profile.founders)}</p>
        </section>`);
    }

    const hideCurrentPoints = isCurYear && state.spoilerFree;
    const rosterHtml = stats.yearDrivers.length
      ? `
        <section class="guide-section">
          <h3>Pilotos en ${displayYear}</h3>
          <div class="team-roster-list">
            ${stats.yearDrivers
              .map(
                (d) => `
                  <button class="team-roster-chip" type="button" data-open-driver="${escapeHtml(series)}|${escapeHtml(d.name)}">
                    <span>${escapeHtml(d.name)}</span>
                    ${
                      hideCurrentPoints
                        ? ""
                        : `<span style="color:var(--text-muted);font-weight:600">${d.position}º · ${formatPoints(d.points)} pts</span>`
                    }
                  </button>`
              )
              .join("")}
          </div>
        </section>`
      : "";

    let newsHtml = "";
    if (profile?.active && profile.newsKeywords?.length && state.news?.items?.length && !state.spoilerFree) {
      const kws = profile.newsKeywords.map((k) => normalizeText(k));
      const matchedNews = state.news.items
        .filter((it) => {
          if (it.series !== series) return false;
          const hay = normalizeText(`${it.title} ${it.summary}`);
          return kws.some((kw) => kw && hay.includes(kw));
        })
        .slice(0, 4);

      if (matchedNews.length) {
        newsHtml = `
          <section class="guide-section">
            <h3>Últimas noticias relacionadas</h3>
            <div class="team-news-list">
              ${matchedNews
                .map(
                  (n) => `
                    <a class="team-news-item" href="${escapeHtml(n.url)}" target="_blank" rel="noopener noreferrer">
                      <strong>${escapeHtml(n.title)}</strong>
                      <small>${escapeHtml(n.source)} · ${escapeHtml(formatRelativeTime(n.publishedAt))}</small>
                    </a>`
                )
                .join("")}
            </div>
          </section>`;
      }
    }

    const teamLogoKey = `${series}:${normalizeText(displayName)}`;
    teamModalBody.innerHTML = `
      <div class="team-hero-banner" style="--team-accent:${livery.bar}">
        <div id="team-logo-slot" data-logo-target="${escapeHtml(teamLogoKey)}"></div>
        ${renderVehicleThumb(series, rawTeamName, "large")}
        <div style="min-width:0;flex:1">
          <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap">
            <span class="series-badge ${series}">${series === "f1" ? "Fórmula 1" : "MotoGP / 500cc"}</span>
            <a id="team-wiki-link" class="wiki-link-btn" data-wiki-target="${escapeHtml(teamLogoKey)}" href="${escapeHtml(meta?.wiki || "#")}" target="_blank" rel="noopener noreferrer" ${meta?.wiki ? "" : "hidden"}>📖 Wikipedia ↗</a>
          </div>
          <div style="font-weight:800;font-size:1.08rem;margin-top:5px">${displayFlag ? `${displayFlag} ` : ""}${escapeHtml(displayName)}</div>
          <div class="st-team">${escapeHtml(profile?.type || (series === "f1" ? "Constructor histórico F1" : "Equipo / Marca"))}</div>
        </div>
      </div>

      ${profile?.summary ? `<p class="team-summary-text">${escapeHtml(profile.summary)}</p>` : `<p id="team-wiki-summary" class="team-summary-text" data-summary-target="${escapeHtml(teamLogoKey)}" hidden></p>`}

      ${
        metaCards.length
          ? `<div class="team-meta-grid">
               ${metaCards
                 .map(
                   (m) => `
                     <div class="team-meta-box">
                       <small>${escapeHtml(m.label)}</small>
                       <strong>${escapeHtml(m.value)}</strong>
                     </div>`
                 )
                 .join("")}
             </div>`
          : ""
      }

      ${peopleHtml.join("")}
      ${rosterHtml}
      ${newsHtml}
    `;

    teamModal.hidden = false;
    syncBodyScroll();
    hydrateTeamExtras(
      "team-logo-slot",
      "team-wiki-summary",
      "team-wiki-link",
      teamLogoKey,
      meta?.wiki || "",
      displayName,
      Boolean(profile?.summary)
    );
  }

  function closeTeamModal() {
    teamModal.hidden = true;
    syncBodyScroll();
  }

  function openRaceModal(eventId, view = "race") {
    const ev = findEventById(eventId);
    if (!ev) return;

    state.raceModalEventId = eventId;
    const hasSprint = Boolean(ev.sprintResults && ev.sprintResults.length);
    const activeView = view === "sprint" && hasSprint ? "sprint" : "race";
    state.raceModalView = activeView;

    const results =
      activeView === "sprint"
        ? ev.sprintResults
        : ev.results && ev.results.length
        ? ev.results
        : ev.podium || [];
    const curYear = getCurrentSeasonYear(ev.series);
    const seasonYear = Number(ev.season || curYear);
    const isHistorical = seasonYear < curYear;
    const isF1 = ev.series === "f1";
    const classifiedCount = results.filter((r) => r.finished !== false && r.position > 0).length;
    const dateLabel = isHistorical
      ? formatFullDate(ev.dateEnd || ev.dateStart)
      : formatDateRange(ev.dateStart, ev.dateEnd);

    raceModalTitle.textContent = isHistorical ? `${ev.name} ${seasonYear}` : ev.name;

    const rowsHtml = results.length
      ? results
          .map((r) => {
            const isClassified = r.finished !== false && r.position > 0;
            const posNum = Number(r.position || 0);
            const posText = String(r.positionText || posNum || "NC");
            const isFav = state.favorites.has(`${ev.series}:${r.driver}`);

            let posBadge = "";
            if (isClassified && posNum >= 1 && posNum <= 3) {
              posBadge = `<span class="pos-medal pos-${posNum}">${posNum}º</span>`;
            } else if (isClassified) {
              posBadge = `<span class="race-pos-num">${posNum}º</span>`;
            } else {
              const dnfCode =
                posText === "R"
                  ? "RET"
                  : posText === "D" || posText === "DSQ"
                  ? "DSQ"
                  : posText === "DNS" || posText === "W"
                  ? "DNS"
                  : "NC";
              posBadge = `<span class="race-pos-num dnf">${escapeHtml(dnfCode)}</span>`;
            }

            const timeLabel = !isClassified
              ? r.status || "Abandono"
              : r.time || r.status || "Meta";
            const ptsNum = Number(r.points || 0);
            const ptsHtml = ptsNum > 0 ? `<span class="race-pts-pill">+${formatPoints(ptsNum)} pts</span>` : "";

            let gridBadge = "";
            const gridPos = Number(r.grid || 0);
            if (isF1 && gridPos > 0 && isClassified && posNum > 0) {
              const delta = gridPos - posNum;
              if (delta > 0) {
                gridBadge = `<span class="grid-delta up" title="Salió ${gridPos}º en parrilla">↑+${delta}</span>`;
              } else if (delta < 0) {
                gridBadge = `<span class="grid-delta down" title="Salió ${gridPos}º en parrilla">↓${delta}</span>`;
              }
            }

            const flSpeedTxt = r.fastestLapSpeed ? ` · ${String(r.fastestLapSpeed).replace(".", ",")} km/h` : "";
            const flBadge = r.fastestLap
              ? `<span class="fl-badge" title="Vuelta rápida de carrera${r.fastestLapTime ? ": " + r.fastestLapTime : ""}${flSpeedTxt}">⚡ V. rápida${r.fastestLapTime ? " " + escapeHtml(r.fastestLapTime) : ""}${escapeHtml(flSpeedTxt)}</span>`
              : "";

            return `
              <div class="race-result-row ${isFav ? "is-fav" : ""} ${!isClassified ? "is-dnf" : ""}">
                <div class="race-pos-cell">${posBadge}</div>
                ${renderVehicleThumb(ev.series, r.team, true)}
                <div class="race-driver-cell">
                  <div class="race-driver-name">
                    ${renderDriverFlag(ev.series, r.driver)}
                    <button class="st-name-btn" type="button" data-open-driver="${escapeHtml(ev.series)}|${escapeHtml(r.driver)}" title="Ver trayectoria completa">
                      ${isFav ? "★ " : ""}${escapeHtml(r.driver)}
                    </button>
                    ${r.number ? `<span class="st-number">#${escapeHtml(r.number)}</span>` : ""}
                    ${gridBadge}
                    ${flBadge}
                  </div>
                  <div class="st-team">
                    ${
                      r.team
                        ? `<button class="team-link-btn" type="button" data-open-team="${escapeHtml(ev.series)}|${escapeHtml(r.team)}|${seasonYear}" title="Ver ficha de la escudería">${escapeHtml(r.team)}</button>`
                        : "—"
                    }
                  </div>
                </div>
                <div class="race-time-cell">
                  <span class="race-time-main">${escapeHtml(timeLabel)}</span>
                  ${ptsHtml}
                </div>
              </div>`;
          })
          .join("")
      : `<div class="empty-state">Todavía no hay resultados oficiales publicados para este Gran Premio.</div>`;

    const sprintTabsHtml = hasSprint
      ? `
        <div class="race-modal-tabs">
          <div class="pills" role="tablist" aria-label="Sesión del Gran Premio">
            <button class="pill ${activeView === "race" ? "active" : ""}" type="button" data-race-view="race">🏁 Carrera (${(ev.results || []).length})</button>
            <button class="pill ${activeView === "sprint" ? "active" : ""}" type="button" data-race-view="sprint">⚡ Sprint (${ev.sprintResults.length})</button>
          </div>
          <span class="section-sub">${activeView === "sprint" ? "Carrera corta del sábado" : "Carrera principal"}</span>
        </div>`
      : "";

    raceModalBody.innerHTML = `
      <div class="race-hero-banner ${ev.series}">
        <div class="gp-hero-top" style="margin-bottom:6px">
          <span class="series-badge ${ev.series}">${isF1 ? "Fórmula 1" : seasonYear >= 2002 ? "MotoGP" : "500cc"}</span>
          <span class="round-label">Ronda ${ev.round} · ${escapeHtml(dateLabel)}</span>
        </div>
        <div class="gp-title-row">
          <span class="gp-flag" aria-hidden="true">${ev.flag}</span>
          <div>
            <div style="font-weight:800;font-size:1.08rem">${escapeHtml(ev.name)}</div>
            <div class="gp-circuit">
              ${
                ev.circuit
                  ? `<button class="circuit-link-btn" type="button" data-open-circuit="${escapeHtml(ev.series)}|${escapeHtml(ev.circuit)}" title="Ver ficha e historial del circuito">${escapeHtml(ev.circuit)}</button>`
                  : ""
              }${ev.country ? " · " + escapeHtml(ev.country) : ""}
            </div>
          </div>
        </div>
        ${
          results.length
            ? `<div class="section-sub" style="margin-top:8px">${results.length} pilotos en parrilla · ${classifiedCount} clasificados · Pulsa piloto, equipo o circuito para ver su ficha</div>`
            : ""
        }
      </div>
      ${sprintTabsHtml}
      <div class="race-results-list">${rowsHtml}</div>
    `;

    raceModal.hidden = false;
    syncBodyScroll();
  }

  function closeRaceModal() {
    raceModal.hidden = true;
    syncBodyScroll();
  }

  function openCircuitModal(series, circuitName) {
    const key = normalizeText(circuitName);
    const info =
      state.circuitsInfo?.[series]?.[key] ||
      state.circuitsInfo?.[series === "f1" ? "motogp" : "f1"]?.[key] ||
      null;

    const displayName = info?.n || circuitName;
    circuitModalTitle.textContent = displayName;

    const mapsUrl =
      info?.lat && info?.lon
        ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${info.lat},${info.lon}`)}`
        : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${displayName} ${info?.co || ""}`.trim())}`;

    const otherSeries = series === "f1" ? "motogp" : "f1";
    const otherBtnHtml = info?.other
      ? `<button class="wiki-link-btn" type="button" data-open-circuit="${otherSeries}|${escapeHtml(info.other)}">
           🔁 Ver en ${otherSeries === "f1" ? "F1" : "MotoGP"}
         </button>`
      : "";

    const mapHtml = info?.map
      ? `
        <a class="circuit-map-card" href="${escapeHtml(info.mapFull || info.map)}" target="_blank" rel="noopener noreferrer" title="Abrir plano del trazado a tamaño completo">
          <img class="circuit-map-img" src="${escapeHtml(info.map)}" alt="Plano del trazado de ${escapeHtml(displayName)}" loading="lazy" onerror="this.parentElement.remove()">
          <span class="circuit-map-caption">Plano del trazado · Pulsa para ampliar a tamaño completo ↗</span>
        </a>`
      : "";

    const metaCards = [];
    if (info?.len) {
      metaCards.push({
        label: "Longitud",
        value: `${Number(info.len).toFixed(3).replace(".", ",")} km`,
      });
    }
    if (info?.turns) {
      const lrTxt =
        info.lc !== undefined && info.rc !== undefined
          ? ` (${info.lc} izq. · ${info.rc} der.)`
          : "";
      metaCards.push({ label: "Curvas", value: `${info.turns}${lrTxt}` });
    }
    if (info?.str) {
      metaCards.push({ label: "Recta más larga", value: `${info.str} m` });
    }
    if (info?.wid) {
      metaCards.push({ label: "Anchura pista", value: `${info.wid} m` });
    }
    if (info?.dir) {
      metaCards.push({
        label: "Sentido de giro",
        value: info.dir === "Antihorario" ? "↺ Antihorario" : "↻ Horario",
      });
    }
    if (info?.op) {
      metaCards.push({ label: "Inauguración", value: String(info.op) });
    }
    if (info?.des) {
      metaCards.push({ label: "Diseñador", value: info.des });
    }
    if (info?.cap) {
      metaCards.push({ label: "Aforo", value: `${info.cap} esp.` });
    }
    if (info?.gps > 0) {
      const span = info.first && info.last ? (info.first === info.last ? ` (${info.first})` : ` (${info.first}–${info.last})`) : "";
      metaCards.push({
        label: `GPs en archivo (${series === "f1" ? "F1" : "MotoGP/500cc"})`,
        value: `${info.gps}${span}`,
      });
    }

    const recordHtml = info?.recLap?.t
      ? `
        <div class="circuit-record-box">
          <div>
            <div style="font-size:0.74rem;font-weight:800;text-transform:uppercase;letter-spacing:0.05em;color:#d8b4fe">⚡ Récord de vuelta en carrera</div>
            <div class="circuit-record-meta">${escapeHtml(
              [info.recLap.d, info.recLap.c, info.recLap.y].filter(Boolean).join(" · ")
            )}</div>
          </div>
          <div class="circuit-record-time">${escapeHtml(info.recLap.t)}</div>
        </div>`
      : "";

    const topTeamsHtml =
      info?.tt && info.tt.length
        ? `
          <section class="guide-section">
            <h3>${series === "f1" ? "Escuderías" : "Marcas"} con más victorias aquí</h3>
            <div class="team-roster-list">
              ${info.tt
                .map(
                  ([tm, cnt]) => `
                    <button class="team-roster-chip" type="button" data-open-team="${escapeHtml(series)}|${escapeHtml(tm)}|${info.last || getCurrentSeasonYear(series)}">
                      ${renderVehicleThumb(series, tm, true)}
                      <span>${escapeHtml(tm)}</span>
                      <span style="color:var(--gold);font-weight:800">🏆 ${cnt}</span>
                    </button>`
                )
                .join("")}
            </div>
          </section>`
        : "";

    const topWinnersHtml =
      info?.top && info.top.length
        ? `
          <section class="guide-section">
            <h3>Pilotos con más victorias aquí</h3>
            <div class="team-roster-list">
              ${info.top
                .map(
                  ([drv, cnt]) => `
                    <button class="team-roster-chip" type="button" data-open-driver="${escapeHtml(series)}|${escapeHtml(drv)}">
                      ${renderDriverFlag(series, drv)}
                      <span>${escapeHtml(drv)}</span>
                      <span style="color:var(--gold);font-weight:800">🏆 ${cnt}</span>
                    </button>`
                )
                .join("")}
            </div>
          </section>`
        : "";

    const curYr = getCurrentSeasonYear(series);
    const visibleRec = (info?.rec || []).filter(([yr]) => !(state.spoilerFree && Number(yr) === curYr));
    const recentHtml =
      visibleRec.length
        ? `
          <section class="guide-section">
            <h3>Últimos ganadores en este circuito</h3>
            <div class="circuit-winners-list">
              ${visibleRec
                .map(
                  ([yr, drv, tm]) => `
                    <div class="circuit-winner-row">
                      <span style="font-weight:800;font-variant-numeric:tabular-nums">${yr}</span>
                      <div style="min-width:0">
                        <div style="display:flex;align-items:center;gap:6px">
                          ${renderDriverFlag(series, drv)}
                          <button class="st-name-btn" type="button" data-open-driver="${escapeHtml(series)}|${escapeHtml(drv)}">${escapeHtml(drv)}</button>
                        </div>
                        ${tm ? `<div class="st-team">${escapeHtml(tm)}</div>` : ""}
                      </div>
                      <button class="btn-secondary" type="button" data-jump-season="${escapeHtml(series)}|${yr}|premier" style="padding:4px 9px;font-size:0.74rem">
                        Ver ${yr}
                      </button>
                    </div>`
                )
                .join("")}
            </div>
          </section>`
        : "";

    circuitModalBody.innerHTML = `
      <div class="race-hero-banner ${series}">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap;margin-bottom:8px">
          <span class="series-badge ${series}">${series === "f1" ? "Circuito F1" : "Circuito MotoGP / 500cc"}</span>
          <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">
            ${otherBtnHtml}
            <a class="wiki-link-btn" href="${escapeHtml(mapsUrl)}" target="_blank" rel="noopener noreferrer">🗺️ Ver mapa ↗</a>
            ${info?.wiki ? `<a class="wiki-link-btn" href="${escapeHtml(info.wiki)}" target="_blank" rel="noopener noreferrer">📖 Wikipedia ↗</a>` : ""}
          </div>
        </div>
        <div class="gp-title-row">
          <span class="gp-flag" aria-hidden="true">${info?.fl || "🏟️"}</span>
          <div>
            <div style="font-weight:800;font-size:1.08rem">${escapeHtml(displayName)}</div>
            <div class="gp-circuit">${escapeHtml([info?.loc, info?.co].filter(Boolean).join(" · ") || "Trazado del Mundial")}</div>
          </div>
        </div>
      </div>

      ${mapHtml}
      ${info?.desc ? `<p class="team-summary-text">${escapeHtml(info.desc)}</p>` : ""}

      ${
        metaCards.length
          ? `<div class="team-meta-grid">
               ${metaCards
                 .map(
                   (m) => `
                     <div class="team-meta-box">
                       <small>${escapeHtml(m.label)}</small>
                       <strong>${escapeHtml(m.value)}</strong>
                     </div>`
                 )
                 .join("")}
             </div>`
          : ""
      }

      ${recordHtml}
      ${topTeamsHtml}
      ${topWinnersHtml}
      ${recentHtml}
    `;

    circuitModal.hidden = false;
    syncBodyScroll();
  }

  function closeCircuitModal() {
    circuitModal.hidden = true;
    syncBodyScroll();
  }

  guideBtn.addEventListener("click", openGuide);

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      if (!circuitModal.hidden) closeCircuitModal();
      else if (!teamModal.hidden) closeTeamModal();
      else if (!raceModal.hidden) closeRaceModal();
      else if (!guideModal.hidden) closeGuide();
      return;
    }
    if ((e.key === "Enter" || e.key === " ") && e.target.matches("[data-open-race][role='button']")) {
      e.preventDefault();
      openRaceModal(e.target.dataset.openRace);
    }
  });

  document.addEventListener("click", (e) => {
    if (e.target.closest("[data-close-guide]")) {
      closeGuide();
      return;
    }

    if (e.target.closest("[data-close-team]")) {
      closeTeamModal();
      return;
    }

    if (e.target.closest("[data-close-race]")) {
      closeRaceModal();
      return;
    }

    if (e.target.closest("[data-close-circuit]")) {
      closeCircuitModal();
      return;
    }

    const openCircuit = e.target.closest("[data-open-circuit]");
    if (openCircuit) {
      e.stopPropagation();
      if (!raceModal.hidden) closeRaceModal();
      const [series, circuitName] = openCircuit.dataset.openCircuit.split("|");
      openCircuitModal(series, circuitName);
      return;
    }

    const raceViewBtn = e.target.closest("[data-race-view]");
    if (raceViewBtn && state.raceModalEventId) {
      openRaceModal(state.raceModalEventId, raceViewBtn.dataset.raceView);
      return;
    }

    const openRace = e.target.closest("[data-open-race]");
    if (openRace) {
      openRaceModal(openRace.dataset.openRace, "race");
      return;
    }

    const openTeam = e.target.closest("[data-open-team]");
    if (openTeam) {
      if (!raceModal.hidden) closeRaceModal();
      if (!circuitModal.hidden) closeCircuitModal();
      const [series, teamName, yearStr] = openTeam.dataset.openTeam.split("|");
      openTeamModal(series, teamName, Number(yearStr) || getCurrentSeasonYear(series));
      return;
    }

    const tabBtn = e.target.closest("[data-tab]");
    if (tabBtn) {
      state.tab = tabBtn.dataset.tab;
      state.archiveReturnTo = null;
      window.scrollTo({ top: 0, behavior: "smooth" });
      render();
      return;
    }

    const homeFilter = e.target.closest("[data-home-filter]");
    if (homeFilter) {
      state.homeFilter = homeFilter.dataset.homeFilter;
      renderInicio();
      return;
    }

    const calFilter = e.target.closest("[data-cal-filter]");
    if (calFilter) {
      state.calFilter = calFilter.dataset.calFilter;
      renderCalendario();
      return;
    }

    const calScope = e.target.closest("[data-cal-scope]");
    if (calScope) {
      state.calShowAll = calScope.dataset.calScope === "all";
      renderCalendario();
      return;
    }

    const toggleEv = e.target.closest("[data-toggle-event]");
    if (toggleEv) {
      const id = toggleEv.dataset.toggleEvent;
      state.expandedEventId = state.expandedEventId === id ? null : id;
      renderCalendario();
      return;
    }

    const archSection = e.target.closest("[data-arch-section]");
    if (archSection) {
      state.archiveSection = archSection.dataset.archSection;
      state.archiveReturnTo = null;
      if (state.archiveSection !== "pilotos") state.selectedDriver = null;
      renderArchivo();
      return;
    }

    const archivoBack = e.target.closest("[data-archivo-back]");
    if (archivoBack && state.archiveReturnTo) {
      const ret = state.archiveReturnTo;
      state.archiveReturnTo = null;
      state.archiveSection = ret.section;
      if (ret.driver) state.selectedDriver = ret.driver;
      window.scrollTo({ top: 0, behavior: "smooth" });
      renderArchivo();
      return;
    }

    const driverBack = e.target.closest("[data-driver-back]");
    if (driverBack && state.driverReturnTo) {
      const ret = state.driverReturnTo;
      state.driverReturnTo = null;
      state.selectedDriver = null;
      state.tab = ret.tab;
      if (ret.tab === "mundial") {
        if (ret.series) state.standingsSeries = ret.series;
        if (ret.kind) state.standingsKind = ret.kind;
      } else if (ret.tab === "archivo") {
        state.archiveSection = ret.section || "temporadas";
        if (ret.series) state.archiveSeries = ret.series;
        if (ret.year) state.archiveYear = ret.year;
        if (ret.kind) state.archiveKind = ret.kind;
        if (ret.motoClass) state.archiveMotoClass = ret.motoClass;
      }
      window.scrollTo({ top: 0, behavior: "smooth" });
      render();
      return;
    }

    const stSeries = e.target.closest("[data-st-series]");
    if (stSeries) {
      state.standingsSeries = stSeries.dataset.stSeries;
      renderMundial();
      return;
    }

    const stKind = e.target.closest("[data-st-kind]");
    if (stKind) {
      state.standingsKind = stKind.dataset.stKind;
      renderMundial();
      return;
    }

    const stFavs = e.target.closest("[data-st-favs]");
    if (stFavs) {
      state.standingsOnlyFavs = !state.standingsOnlyFavs;
      renderMundial();
      return;
    }

    const archSeries = e.target.closest("[data-arch-series]");
    if (archSeries) {
      state.archiveSeries = archSeries.dataset.archSeries;
      state.archiveMotoClass = "premier";
      renderArchivo();
      return;
    }

    const archKind = e.target.closest("[data-arch-kind]");
    if (archKind) {
      state.archiveKind = archKind.dataset.archKind;
      if (state.archiveKind === "races") state.archiveMotoClass = "premier";
      renderArchivo();
      return;
    }

    const archMotoClass = e.target.closest("[data-arch-motoclass]");
    if (archMotoClass) {
      state.archiveMotoClass = archMotoClass.dataset.archMotoclass;
      if (state.archiveKind === "races") state.archiveKind = "drivers";
      renderArchivo();
      return;
    }

    const palScope = e.target.closest("[data-palmares-scope]");
    if (palScope) {
      state.palmaresMotoScope = palScope.dataset.palmaresScope;
      renderArchivo();
      return;
    }

    const dsSeries = e.target.closest("[data-ds-series]");
    if (dsSeries) {
      state.driverSearchSeries = dsSeries.dataset.dsSeries;
      state.selectedDriver = null;
      renderArchivo();
      return;
    }

    const tsSeries = e.target.closest("[data-ts-series]");
    if (tsSeries) {
      state.teamSearchSeries = tsSeries.dataset.tsSeries;
      renderArchivo();
      return;
    }

    const tsScope = e.target.closest("[data-ts-scope]");
    if (tsScope) {
      state.teamSearchScope = tsScope.dataset.tsScope;
      renderArchivo();
      return;
    }

    const clearSearch = e.target.closest("[data-clear-search]");
    if (clearSearch) {
      const target = clearSearch.dataset.clearSearch;
      let focusId = null;
      if (target === "driver") {
        state.driverQuery = "";
        state.selectedDriver = null;
        focusId = "driver-search";
        renderArchivo();
      } else if (target === "team") {
        state.teamSearchQuery = "";
        focusId = "team-search";
        renderArchivo();
      } else if (target === "circuit") {
        state.circuitSearchQuery = "";
        focusId = "circuit-search";
        renderArchivo();
      } else if (target === "news") {
        state.newsQuery = "";
        focusId = "news-search";
        renderNoticias();
      }
      if (focusId) {
        const el = document.getElementById(focusId);
        if (el) el.focus();
      }
      return;
    }

    const csSeries = e.target.closest("[data-cs-series]");
    if (csSeries) {
      state.circuitSearchSeries = csSeries.dataset.csSeries;
      renderArchivo();
      return;
    }

    const cmpSeries = e.target.closest("[data-cmp-series]");
    if (cmpSeries) {
      state.compareSeries = cmpSeries.dataset.cmpSeries;
      if (state.compareSeries === "f1") {
        state.compareDriverA = "Ayrton Senna";
        state.compareDriverB = "Alain Prost";
      } else {
        state.compareDriverA = "Valentino Rossi";
        state.compareDriverB = "Marc Marquez";
      }
      renderArchivo();
      return;
    }

    const cmpPreset = e.target.closest("[data-cmp-preset]");
    if (cmpPreset) {
      const [pa, pb] = cmpPreset.dataset.cmpPreset.split("|");
      state.compareDriverA = pa;
      state.compareDriverB = pb;
      renderArchivo();
      return;
    }

    const openDriver = e.target.closest("[data-open-driver]");
    if (openDriver) {
      if (!teamModal.hidden) closeTeamModal();
      if (!raceModal.hidden) closeRaceModal();
      if (!circuitModal.hidden) closeCircuitModal();

      if (state.tab === "inicio") {
        state.driverReturnTo = { label: "← Volver a Inicio", tab: "inicio" };
      } else if (state.tab === "calendario") {
        state.driverReturnTo = { label: "← Volver al Calendario", tab: "calendario" };
      } else if (state.tab === "mundial") {
        const yr = getCurrentSeasonYear(state.standingsSeries);
        state.driverReturnTo = {
          label: `← Volver a Mundial ${state.standingsSeries === "f1" ? "F1" : "MotoGP"} ${yr}`,
          tab: "mundial",
          series: state.standingsSeries,
          kind: state.standingsKind,
        };
      } else if (state.tab === "archivo" && state.archiveSection === "temporadas") {
        const yr = Number(state.archiveYear || getCurrentSeasonYear(state.archiveSeries) - 1);
        const catLbl =
          state.archiveSeries === "f1"
            ? "F1"
            : state.archiveMotoClass && state.archiveMotoClass !== "premier"
            ? state.archiveMotoClass
            : yr >= 2002
            ? "MotoGP"
            : "500cc";
        state.driverReturnTo = {
          label: `← Volver a ${catLbl} ${yr}`,
          tab: "archivo",
          section: "temporadas",
          series: state.archiveSeries,
          year: yr,
          kind: state.archiveKind,
          motoClass: state.archiveMotoClass,
        };
      } else if (state.tab === "archivo" && state.archiveSection === "palmares") {
        state.driverReturnTo = {
          label: "← Volver al Palmarés",
          tab: "archivo",
          section: "palmares",
          series: state.archiveSeries,
        };
      } else if (state.tab === "archivo" && state.archiveSection === "comparar") {
        state.driverReturnTo = {
          label: "← Volver a Cara a cara",
          tab: "archivo",
          section: "comparar",
        };
      } else {
        state.driverReturnTo = null;
      }

      const [series, name] = openDriver.dataset.openDriver.split("|");
      state.tab = "archivo";
      state.archiveSection = "pilotos";
      state.archiveReturnTo = null;
      state.selectedDriver = { series, name };
      window.scrollTo({ top: 0, behavior: "smooth" });
      render();
      return;
    }

    const clearDriver = e.target.closest("[data-clear-driver]");
    if (clearDriver) {
      state.selectedDriver = null;
      state.driverReturnTo = null;
      renderArchivo();
      return;
    }

    const jumpSeason = e.target.closest("[data-jump-season]");
    if (jumpSeason) {
      if (!circuitModal.hidden) closeCircuitModal();
      const [series, yearStr, classKey] = jumpSeason.dataset.jumpSeason.split("|");
      const targetYear = Number(yearStr);
      const curYear = getCurrentSeasonYear(series);

      if (targetYear === curYear) {
        state.tab = "mundial";
        state.standingsSeries = series;
        state.standingsKind = "drivers";
        state.standingsOnlyFavs = false;
      } else {
        if (state.tab === "archivo" && state.archiveSection === "pilotos" && state.selectedDriver) {
          state.archiveReturnTo = {
            label: `← Volver a ${state.selectedDriver.name}`,
            section: "pilotos",
            driver: { ...state.selectedDriver },
          };
        } else if (state.tab === "archivo" && state.archiveSection === "palmares") {
          state.archiveReturnTo = {
            label: "← Volver al Palmarés",
            section: "palmares",
          };
        } else {
          state.archiveReturnTo = null;
        }
        state.tab = "archivo";
        state.archiveSection = "temporadas";
        state.archiveSeries = series;
        state.archiveYear = targetYear;
        state.archiveKind = "drivers";
        state.archiveMotoClass = classKey || "premier";
      }
      window.scrollTo({ top: 0, behavior: "smooth" });
      render();
      return;
    }

    const goStandings = e.target.closest("[data-go-standings]");
    if (goStandings) {
      state.tab = "mundial";
      state.standingsSeries = goStandings.dataset.goStandings;
      state.standingsKind = "teams";
      window.scrollTo({ top: 0, behavior: "smooth" });
      render();
      return;
    }

    const favBtn = e.target.closest("[data-fav]");
    if (favBtn) {
      const key = favBtn.dataset.fav;
      if (state.favorites.has(key)) state.favorites.delete(key);
      else state.favorites.add(key);
      localStorage.setItem(STORAGE_KEYS.favorites, JSON.stringify([...state.favorites]));
      renderMundial();
      return;
    }

    const newsFilter = e.target.closest("[data-news-filter]");
    if (newsFilter) {
      state.newsFilter = newsFilter.dataset.newsFilter;
      renderNoticias();
      return;
    }

    const revealBtn = e.target.closest("[data-reveal]");
    if (revealBtn) {
      state.revealedIds.add(revealBtn.dataset.reveal);
      render();
      return;
    }

    const icsBtn = e.target.closest("[data-download-ics]");
    if (icsBtn) {
      const ev = findEventById(icsBtn.dataset.downloadIcs);
      if (ev) downloadEventIcs(ev);
    }
  });

  async function refreshLiveData() {
    if (!refreshBtn) return;
    refreshBtn.classList.add("is-spinning");
    refreshBtn.disabled = true;
    try {
      const bust = `?v=${Date.now()}`;
      const [msRes, newsRes] = await Promise.all([
        fetch(`./data/motorsport.json${bust}`, { cache: "no-store" }),
        fetch(`./data/news.json${bust}`, { cache: "no-store" }).catch(() => null),
      ]);
      if (msRes.ok) state.motorsport = await msRes.json();
      if (newsRes && newsRes.ok) state.news = await newsRes.json();
      state.raceArchiveCache.clear();
      buildCareerIndex();
      const upd = state.motorsport?.updatedAt || state.news?.updatedAt;
      updatedEl.textContent = upd ? `Actualizado ${formatRelativeTime(upd).toLowerCase()}` : "Datos listos";
      render();
      showToast("Datos y noticias actualizados");
    } catch {
      showToast("Sin conexión: mostrando datos en caché");
    } finally {
      refreshBtn.classList.remove("is-spinning");
      refreshBtn.disabled = false;
    }
  }

  if (refreshBtn) {
    refreshBtn.addEventListener("click", refreshLiveData);
  }

  spoilerBtn.addEventListener("click", () => {
    state.spoilerFree = !state.spoilerFree;
    state.revealedIds.clear();
    localStorage.setItem(STORAGE_KEYS.spoiler, state.spoilerFree ? "1" : "0");
    updateSpoilerButton();
    showToast(state.spoilerFree ? "Modo Sin Spoilers activado" : "Modo Sin Spoilers desactivado");
    render();
  });

  async function init() {
    updateSpoilerButton();

    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("./sw.js").catch(() => {});
    }

    try {
      const cacheBust = `?v=${Math.floor(Date.now() / 60000)}`;
      const [msRes, histRes, motoClassesRes, driversRes, circuitsRes, teamsMetaRes, teamsRes, newsRes] = await Promise.all([
        fetch(`./data/motorsport.json${cacheBust}`),
        fetch(`./data/history.json${cacheBust}`).catch(() => null),
        fetch(`./data/moto_classes_history.json${cacheBust}`).catch(() => null),
        fetch(`./data/drivers_info.json${cacheBust}`).catch(() => null),
        fetch(`./data/circuits_info.json${cacheBust}`).catch(() => null),
        fetch(`./data/teams_meta.json${cacheBust}`).catch(() => null),
        fetch(`./data/teams_info.json${cacheBust}`).catch(() => null),
        fetch(`./data/news.json${cacheBust}`).catch(() => null),
      ]);
      if (!msRes.ok) throw new Error("No se encontraron los datos de competición.");
      state.motorsport = await msRes.json();
      state.history = histRes && histRes.ok ? await histRes.json() : { f1: {}, motogp: {} };
      state.motoClasses = motoClassesRes && motoClassesRes.ok ? await motoClassesRes.json() : { years: {} };
      state.driversInfo = driversRes && driversRes.ok ? await driversRes.json() : { f1: {}, motogp: {} };
      state.circuitsInfo = circuitsRes && circuitsRes.ok ? await circuitsRes.json() : { f1: {}, motogp: {} };
      state.teamsMeta = teamsMetaRes && teamsMetaRes.ok ? await teamsMetaRes.json() : { f1: {}, motogp: {} };
      state.teamsInfo = teamsRes && teamsRes.ok ? await teamsRes.json() : { f1: [], motogp: [] };
      state.news = newsRes && newsRes.ok ? await newsRes.json() : { items: [] };
      state.archiveYear = getCurrentSeasonYear(state.archiveSeries) - 1;
      buildCareerIndex();

      const upd = state.motorsport.updatedAt || state.news.updatedAt;
      updatedEl.textContent = upd ? `Actualizado ${formatRelativeTime(upd).toLowerCase()}` : "Datos listos";
      render();
    } catch (err) {
      appEl.innerHTML = `
        <div class="empty-state">
          <p><strong>No se pudieron cargar los datos todavía.</strong></p>
          <p>Ejecuta <code>python3 scripts/update_data.py</code> para generar la primera descarga.</p>
        </div>`;
      updatedEl.textContent = "Sin datos";
    }
  }

  init();
})();
