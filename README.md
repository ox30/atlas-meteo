# Atlas Météo

Visualisation animée de prévisions météo, alimentée par Open-Meteo, RainViewer, OSRM et SunCalc. Deux modes : observation d'une ville avec scrubber temporel, et planification d'itinéraire multi-étapes avec voiture animée et gestion des pauses.

## Fonctionnalités

### Mode Ville
- Météo actuelle + prévisions 7 jours (avec passage de jour cliquable pour scrubber)
- Scrubber temporel court (12h passé / 2h futur) ou long (7 jours forward)
- Couches animées : radar pluie, nuages satellite, terminator solaire
- Cycle UI jour/nuit dynamique selon position du soleil

### Mode Itinéraire
- **Étapes multiples** avec drag&drop (Sortable.js)
- **Pauses configurables** par étape (heures + minutes)
- Animation voiture qui suit la route, s'immobilise pendant les pauses
- Picto météo aux jalons selon l'heure d'arrivée
- Lever / coucher de soleil sur la timeline avec icônes
- Zones de pause matérialisées sur la barre temporelle
- Détection soleil rasant face à la voiture

### Communs
- **Sélection sur carte** : bouton 📍 dans chaque champ pour cliquer directement la position
- **Tooltip au survol** de la timeline (heure + mini-picto météo + température)
- **Graphiques sous la timeline** activables : pression, précipitations, rayonnement solaire
- Légende flottante (bouton + en bas à gauche) pour modèle météo, couches et graphique

## Sources de données

| Source | Usage | Licence |
|--------|-------|---------|
| [Open-Meteo](https://open-meteo.com) | Géocodage, prévisions horaires/quotidiennes | CC-BY 4.0, non-commercial |
| [RainViewer](https://www.rainviewer.com) | Tuiles radar pluie + satellite IR | Free, fair use |
| [OSRM](https://project-osrm.org) | Routing voiture multi-waypoints | Free demo, fair use |
| [Nominatim](https://nominatim.openstreetmap.org) | Reverse geocoding | OSM, fair use |
| [SunCalc](https://github.com/mourner/suncalc) | Astronomie soleil/lune | BSD-2 |
| [Leaflet](https://leafletjs.com) | Carte | BSD-2 |
| [Sortable.js](https://sortablejs.github.io/Sortable/) | Drag & drop des étapes | MIT |

## Lancement local

Les modules ES6 imposent un serveur HTTP — ouvrir directement `index.html` en `file://` ne marchera pas.

```bash
python3 -m http.server 8000
# ou
npx serve .
```

Puis ouvrir http://localhost:8000.

## Déploiement GitHub Pages

1. Pousser tous les fichiers sur le repo
2. Settings → Pages → Source : *Deploy from a branch* → branch `main` → root
3. Attendre ~1 minute
4. URL publique : `https://<username>.github.io/<repo>/`

## Structure

```
atlas-meteo/
├── index.html
├── styles/
│   ├── base.css         Variables CSS, layout, typo, transitions
│   ├── components.css   Composants UI (cards, scrubber, chart, picker)
│   ├── legend.css       Panneau flottant de légende + radio chart
│   └── waypoints.css    Cards waypoints multi-étapes
├── js/
│   ├── config.js        URLs API, codes WMO, modèles, palettes solaires
│   ├── utils.js         Formatters, géo helpers, color helpers
│   ├── state.js         État global + event bus
│   ├── map.js           Leaflet singleton
│   ├── geocoding.js     Open-Meteo + autocomplete + Nominatim reverse
│   ├── weather.js       Forecasts (current/hourly/daily/multi-point)
│   ├── routing.js       OSRM multi-waypoints + segments avec pauses
│   ├── rainviewer.js    Couches radar + nuages satellite
│   ├── astronomy.js     SunCalc + terminator + sun events
│   ├── time-ctl.js      Horloge virtuelle (singleton, rAF)
│   ├── theme.js         Palette UI dynamique selon altitude soleil
│   ├── car.js           Marker voiture animé
│   ├── map-picker.js    Sélection point par clic sur la carte
│   ├── scrubber.js      Gestion timeline-bar + tooltip survol
│   ├── chart.js         Graphiques SVG sous la timeline
│   ├── legend.js        Panneau flottant rebuildable
│   ├── city-mode.js     Orchestration mode ville
│   ├── route-mode.js    Orchestration mode itinéraire multi-waypoints
│   └── app.js           Point d'entrée
└── README.md
```

## Limites connues

- RainViewer ne couvre que [-12h, +2h] : au-delà, les couches radar/nuages disparaissent (par design)
- L'instance OSRM publique n'a pas de SLA — pour intensif, s'auto-héberger
- Nominatim a un fair use strict (1 req/s) — debounce intégré sur le drag
- Open-Meteo gratuit = non-commercial uniquement
- 10-12 waypoints max recommandé pour fluidité

## Licence

Code MIT. Données soumises aux licences de leurs fournisseurs respectifs.
