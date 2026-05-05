// API endpoints
export const API = {
  geocoding: 'https://geocoding-api.open-meteo.com/v1/search',
  forecast: 'https://api.open-meteo.com/v1/forecast',
  routing: 'https://router.project-osrm.org/route/v1/driving',
  reverseGeo: 'https://nominatim.openstreetmap.org/reverse',
  rainviewer: 'https://api.rainviewer.com/public/weather-maps.json'
};

// WMO weather codes -> icon + french label
export const WMO = {
  0:{icon:'☀️',label:'Ciel dégagé'}, 1:{icon:'🌤️',label:'Plutôt dégagé'},
  2:{icon:'⛅',label:'Partiellement nuageux'}, 3:{icon:'☁️',label:'Couvert'},
  45:{icon:'🌫️',label:'Brouillard'}, 48:{icon:'🌫️',label:'Brouillard givrant'},
  51:{icon:'🌦️',label:'Bruine légère'}, 53:{icon:'🌦️',label:'Bruine modérée'}, 55:{icon:'🌧️',label:'Bruine dense'},
  61:{icon:'🌧️',label:'Pluie faible'}, 63:{icon:'🌧️',label:'Pluie modérée'}, 65:{icon:'🌧️',label:'Pluie forte'},
  71:{icon:'🌨️',label:'Neige faible'}, 73:{icon:'🌨️',label:'Neige modérée'}, 75:{icon:'❄️',label:'Neige forte'},
  80:{icon:'🌦️',label:'Averses faibles'}, 81:{icon:'🌧️',label:'Averses modérées'}, 82:{icon:'⛈️',label:'Averses violentes'},
  85:{icon:'🌨️',label:'Averses neige'}, 86:{icon:'❄️',label:'Fortes averses neige'},
  95:{icon:'⛈️',label:'Orage'}, 96:{icon:'⛈️',label:'Orage avec grêle'}, 99:{icon:'⛈️',label:'Orage violent grêle'}
};
export const wmo = c => WMO[c] || { icon: '🌡️', label: 'Inconnu' };

// Available forecast models
export const MODELS = [
  { value: 'best_match', label: 'Mix automatique (recommandé)' },
  { value: 'meteoswiss_icon_ch1', label: 'ICON-CH1 (MétéoSuisse, 1 km)' },
  { value: 'meteoswiss_icon_ch2', label: 'ICON-CH2 (MétéoSuisse, 2 km)' },
  { value: 'icon_seamless', label: 'DWD ICON (Allemagne)' },
  { value: 'ecmwf_ifs025', label: 'ECMWF IFS (européen)' },
  { value: 'meteofrance_seamless', label: 'Météo-France' },
  { value: 'gfs_seamless', label: 'NOAA GFS' }
];

// Car SVG (top-down view, oriented north)
export const CAR_SVG = `<svg viewBox="0 0 24 36" xmlns="http://www.w3.org/2000/svg" width="36" height="54">
  <rect x="3" y="6" width="18" height="26" rx="4" fill="#ff9758" stroke="#0a0e14" stroke-width="1.5"/>
  <rect x="6" y="9" width="12" height="6" rx="1" fill="#0a0e14" opacity="0.55"/>
  <rect x="6" y="22" width="12" height="6" rx="1" fill="#0a0e14" opacity="0.55"/>
  <rect x="4" y="6" width="3" height="2" fill="#fffbe8"/>
  <rect x="17" y="6" width="3" height="2" fill="#fffbe8"/>
  <circle cx="12" cy="19" r="1.5" fill="#0a0e14" opacity="0.4"/>
</svg>`;

// Theme palettes anchored on solar altitude (degrees)
export const PALETTES = {
  night: {
    bg:'#0a0e14', 'bg-2':'#131a24', 'bg-3':'#1d2633',
    line:'#2a3441', 'line-soft':'#1a2330',
    text:'#f0ebe0', 'text-dim':'#8a96a8', 'text-mute':'#5d6a7d',
    accent:'#ff9758', 'accent-soft':'#d97842',
    'map-brightness':'0.7'
  },
  twilight: {
    bg:'#1f1822', 'bg-2':'#2c2330', 'bg-3':'#3a2e3f',
    line:'#4a3d4f', 'line-soft':'#332a37',
    text:'#f5e8d8', 'text-dim':'#a89888', 'text-mute':'#7a6a6a',
    accent:'#ff8866', 'accent-soft':'#e07050',
    'map-brightness':'0.85'
  },
  golden: {
    bg:'#e8d4b8', 'bg-2':'#dcc5a3', 'bg-3':'#c9b08a',
    line:'#a89878', 'line-soft':'#c0a888',
    text:'#2a2010', 'text-dim':'#5a4a30', 'text-mute':'#7a6a50',
    accent:'#d65a2c', 'accent-soft':'#b54a20',
    'map-brightness':'1.05'
  },
  day: {
    bg:'#f5f1ea', 'bg-2':'#ebe5d8', 'bg-3':'#dbd4c2',
    line:'#c8c0ae', 'line-soft':'#dcd5c5',
    text:'#1a2028', 'text-dim':'#4a5260', 'text-mute':'#7a8290',
    accent:'#c2533a', 'accent-soft':'#a04020',
    'map-brightness':'1.15'
  }
};

// City scrubber range modes
export const RANGE_MODES = {
  short: { hoursBefore: 12, hoursAfter: 2, label: 'Court (12h passé + 2h futur)' },
  long:  { hoursBefore: 0,  hoursAfter: 168, label: 'Long (7 jours à venir)' }
};
