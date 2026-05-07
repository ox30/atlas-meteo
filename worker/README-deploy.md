# Atlas Météo — déploiement du Worker `atlas-meteo-tiles`

Ce dossier contient le proxy Cloudflare Worker qui sert les tuiles OpenWeatherMap (clouds_new pour le moment) à l'app Atlas Météo. Le but : la clé OWM ne sort jamais du Worker.

Deux méthodes de déploiement, choisis celle qui te parle le plus.

---

## Méthode A — Dashboard web (la plus simple, zéro install)

1. **Crée le Worker**
   - Va sur https://dash.cloudflare.com → menu **Workers & Pages** → bouton **Create application** → onglet **Create Worker**
   - Nom : `atlas-meteo-tiles` (doit matcher le nom dans `wrangler.toml`)
   - Clique **Deploy** (Cloudflare crée un Worker "Hello World" par défaut)

2. **Colle le code**
   - Une fois le Worker créé, clique **Edit code**
   - Sélectionne tout le contenu du fichier par défaut, supprime, puis colle le contenu de `worker.js` (ce dossier)
   - Clique **Save and Deploy**

3. **Ajoute la clé OWM en secret**
   - Reviens sur la page du Worker → **Settings** → **Variables and Secrets**
   - Clique **Add** → type **Secret**
   - Variable name : `OWM_API_KEY`
   - Value : ta clé OWM (celle que tu as vue dans https://home.openweathermap.org/api_keys)
   - Clique **Save and deploy**

4. **Teste**
   - Ouvre dans ton navigateur : `https://atlas-meteo-tiles.<TON-USERNAME>.workers.dev/health`
   - Tu dois voir : `ok`
   - Puis teste une tuile : `https://atlas-meteo-tiles.<TON-USERNAME>.workers.dev/owm/clouds_new/3/4/2.png`
   - Tu dois voir une petite image PNG (carrée, parfois transparente si pas de nuages dans cette tuile-là)

5. **Récupère ton URL**
   - Ton Worker tourne sur `https://atlas-meteo-tiles.<TON-USERNAME>.workers.dev/`
   - Note ce `<TON-USERNAME>` exact, on en aura besoin dans `js/config.js`

---

## Méthode B — CLI avec wrangler (plus propre pour itérer)

Prérequis : Node.js 18+ installé.

```bash
# Installation globale (une seule fois)
npm install -g wrangler

# Login (ouvre ton navigateur pour autoriser wrangler)
wrangler login

# Depuis ce dossier (qui contient wrangler.toml et worker.js)
wrangler deploy

# Pose ta clé OWM comme secret (te demandera la valeur après Enter)
wrangler secret put OWM_API_KEY
```

L'URL du Worker est imprimée à la fin de `wrangler deploy`.

Pour les déploiements suivants après modification du code, juste `wrangler deploy`. Pour changer la clé : `wrangler secret put OWM_API_KEY` à nouveau.

---

## Vérifier que ça tourne

Une fois déployé, dans le navigateur :

| URL | Réponse attendue |
|---|---|
| `https://atlas-meteo-tiles.<USER>.workers.dev/health` | `ok` (texte brut) |
| `https://atlas-meteo-tiles.<USER>.workers.dev/owm/clouds_new/3/4/2.png` | image PNG, header `X-Atlas-Cache: MISS` (puis `HIT` au refresh) |
| `https://atlas-meteo-tiles.<USER>.workers.dev/owm/foo_bar/3/4/2.png` | 400 "Layer not allowed" |
| `https://atlas-meteo-tiles.<USER>.workers.dev/anything` | 404 "Not found" |

Pour voir les headers dans le navigateur : ouvre DevTools (F12) → onglet Network → recharge la page → clique sur la requête → onglet Headers.

Le header `X-Atlas-Cache: HIT` au deuxième chargement confirme que le cache marche.

---

## Surveillance et limites

- **Quota Cloudflare Workers (free tier)** : 100 000 requêtes/jour. Tu peux le suivre sur le dashboard du Worker, onglet **Analytics**.
- **Quota OpenWeatherMap (free)** : 60 calls/min sur l'API data, mais les **tuiles** sont sur un CDN séparé qui n'est pas vraiment compté de la même manière. Pour 10 utilisateurs amateurs c'est dans les clous.
- **En cas de souci** : un header `X-Atlas-Error` apparaît sur les tuiles qui échouent (visible dans DevTools Network). Le Worker continue de servir des tuiles transparentes pour ne pas casser l'affichage.

## Lockdown (plus tard si besoin)

Si tu veux que **seul** ox30.github.io puisse appeler ton Worker (pas un cas critique mais c'est propre) :

- Méthode A : dashboard → Settings → Variables → édite `ALLOWED_ORIGIN` → mets `https://ox30.github.io`
- Méthode B : édite `wrangler.toml` (`ALLOWED_ORIGIN = "https://ox30.github.io"`) puis `wrangler deploy`

Ça change juste l'en-tête `Access-Control-Allow-Origin`. Quelqu'un en `curl` peut toujours appeler le Worker, mais aucune autre app web ne peut le faire fonctionner depuis un autre domaine. Pour vraiment bloquer les non-navigateurs, faudrait un rate limit / un référer check, hors scope pour le moment.
