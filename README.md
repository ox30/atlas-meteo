# Atlas Météo

Visualisation animée de prévisions météo, alimentée par Open-Meteo, RainViewer, OSRM et SunCalc. Deux modes : observation d'une ville avec scrubber temporel, et planification d'itinéraire avec voiture qui suit le tracé en temps simulé.

## Fonctionnalités

- **Mode Ville** : météo actuelle + prévisions 7 jours, scrubber temporel (court : ±2h, ou long : 7 jours), couches animées radar et nuages.
- **Mode Itinéraire** : routing OSRM, météo aux étapes selon l'heure d'arrivée, animation voiture, radar/nuages animés en temps réel.
- **Cycle jour/nuit** : terminator solaire affiché sur la carte, teinte UI dynamique selon l'altitude du soleil au point courant.
- **Détection soleil rasant** : avertissement quand on roule face à un soleil bas.
- **Légende flottante** : bouton "+" en bas à gauche de la carte pour activer/désactiver les couches et changer le modèle météo.

## Sources de données

| Source | Usage | Licence |
|--------|-------|---------|
| [Open-Meteo](https://open-meteo.com) | Géocodage, prévisions horaires/quotidiennes | CC-BY 4.0, non-commercial |
| [RainViewer](https://www.rainviewer.com) | Tuiles radar pluie + satellite IR | Free, fair use |
| [OSRM](https://project-osrm.org) | Routing voiture | Free demo, fair use |
| [Nominatim](https://nominatim.openstreetmap.org) | Reverse geocoding | OSM, fair use |
| [SunCalc](https://github.com/mourner/suncalc) | Astronomie soleil/lune | BSD-2 |
| [Leaflet](https://leafletjs.com) | Carte | BSD-2 |

## Lancement local

Les modules ES6 imposent un serveur HTTP — ouvrir directement `index.html` en `file://` ne marchera pas.

```bash
# Option 1 : Python
python3 -m http.server 8000

# Option 2 : Node
npx serve .

# Option 3 : VS Code "Live Server" extension
```

Puis ouvrir http://localhost:8000 dans le navigateur.

## Déploiement GitHub Pages

1. Créer un repo public sur GitHub (par exemple `atlas-meteo`)
2. Pousser tous les fichiers
3. Aller dans **Settings → Pages**
4. Source : **Deploy from a branch**, branch `main`, dossier `/ (root)`
5. Sauvegarder, attendre ~1 minute
6. URL publique : `https://<username>.github.io/atlas-meteo/`

## Structure du projet

```
atlas-meteo/
├── index.html
├── styles/
│   ├── base.css         Variables CSS, layout principal, typographie
│   ├── components.css   Composants UI (cards, inputs, scrubber)
│   └── legend.css       Panneau flottant de légende
├── js/
│   ├── config.js        Constantes (URLs API, codes WMO, modèles)
│   ├── utils.js         Helpers (formatters, haversine, bearing, debounce)
│   ├── state.js         État global + event bus
│   ├── map.js           Singleton Leaflet
│   ├── geocoding.js     Open-Meteo geocoding + autocomplete
│   ├── weather.js       Récupération prévisions
│   ├── routing.js       OSRM + sampling étapes
│   ├── rainviewer.js    Couches radar pluie + nuages
│   ├── astronomy.js     Soleil, terminator, événements lever/coucher
│   ├── time-ctl.js      Horloge virtuelle (singleton)
│   ├── theme.js         Palette UI dynamique selon position soleil
│   ├── car.js           Marker voiture animé
│   ├── legend.js        Panneau flottant des couches
│   ├── city-mode.js     Orchestration mode ville
│   ├── route-mode.js    Orchestration mode itinéraire
│   └── app.js           Point d'entrée
└── README.md
```

## Limites connues

- Le radar RainViewer ne couvre que [-12h, +2h]. Pour un voyage planifié au-delà, le radar n'apparaîtra pas (par design).
- L'instance OSRM publique n'a pas de SLA — pour un usage intensif, s'auto-héberger ou utiliser OpenRouteService.
- Nominatim a une politique stricte (1 req/sec) — pour de la prod, mettre en cache ou héberger.
- Open-Meteo gratuit = non-commercial uniquement.

## Licence

Code MIT. Données soumises aux licences de leurs fournisseurs respectifs.
