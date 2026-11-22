# MundoMotor 🏎️🏍️

Aplicación web instalable (**PWA**) 100 % gratuita, sin dependencias externas y en español para seguir **Fórmula 1** y **MotoGP** desde Mac, iPhone o iPad.

## Qué incluye
- **Inicio:** cuenta atrás en vivo para el próximo GP de F1 y MotoGP, horarios en tu hora local, favoritos ★, agenda combinada de fin de semana, último podio clicable con clasificación completa y **Modo Sin Spoilers**.
- **Calendario:** temporada actual filtrable, resultados completos (Carrera + Sprint), parrilla (`↑/↓`), vuelta rápida (`⚡`), fichas de circuito y exportación `.ics` al Calendario de Apple.
- **Mundial:** clasificación en directo de la temporada en curso (Pilotos, Constructores/Equipos, victorias Sprint y marcado de favoritos ★).
- **Archivo (`1949–2026`):**
  - **Temporadas:** clasificaciones y carreras completas de F1 (`1950–2025`, con parrilla, vuelta rápida y Sprint `2021–2025`) y Motociclismo (`1949–2025`, incluidas todas las categorías `500cc/MotoGP`, `350cc`, `250cc/Moto2`, `125cc/Moto3`, `80cc` y `50cc`).
  - **Palmarés:** campeones históricos y récords de títulos (en categoría reina o sumando todas las cilindradas).
  - **Pilotos:** buscador universal con filtro por país, fotos oficiales, biografía en español, fecha de nacimiento/fallecimiento, estadísticas completas, insignia *MotoGP Legend* y otros títulos F1 (F2, F3, WEC…).
  - **Escuderías:** buscador de equipos actuales e históricos con logos oficiales, miniaturas SVG, dirección 2026, historial de motores/motos, victorias y noticias relacionadas.
  - **Circuitos:** planos oficiales de los trazados, longitud, curvas izq./der., recta más larga, récord de vuelta, mapa, historial de ganadores y cruce F1 ↔ MotoGP.
  - **Cara a cara:** comparador de dos pilotos con estadísticas y temporadas coincidiendo en pista.
- **Noticias en español:** titulares actualizados automáticamente desde Motorsport.com España y Marca Motor, con buscador y filtro anti-spoilers.

## Probar en tu Mac
1. Actualizar datos de temporada y noticias:
   ```bash
   python3 scripts/update_data.py
   ```
2. Abrir un servidor local:
   ```bash
   python3 -m http.server 8080
   ```
3. Abrir en el navegador: `http://localhost:8080`

## Publicar gratis en GitHub Pages (actualización automática cada 2 h)
1. Crea un repositorio público en GitHub (por ejemplo `MundoMotor`) y sube esta carpeta a la rama `main`.
2. En tu repositorio de GitHub entra en **Settings → Pages → Build and deployment → Source** y elige **GitHub Actions**.
3. En la pestaña **Actions**, ejecuta **Actualizar datos y publicar MundoMotor** (después se actualizará solo cada 2 horas).
4. Abre la URL de GitHub Pages en Safari desde tu iPhone/iPad y pulsa **Compartir → Añadir a pantalla de inicio**.
