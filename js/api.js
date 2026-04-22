/**
 * api.js - Tous les appels API (IA + données publiques)
 */

// ========================================
// APPELS IA - Fonction générique avec retry
// ========================================

/**
 * Exécute un appel fetch avec retries automatiques.
 * @param {Function} fetchFn - Fonction async retournant la réponse brute
 * @param {number[]} delays - Délais entre les tentatives (ms)
 * @returns {Promise<string>} - Contenu texte de la réponse
 */
async function fetchWithRetry(fetchFn, delays = [1000, 2000, 4000]) {
  let lastError;
  for (let i = 0; i <= delays.length; i++) {
    try {
      return await fetchFn();
    } catch (e) {
      lastError = e;
      if (i < delays.length) {
        await new Promise(r => setTimeout(r, delays[i]));
      }
    }
  }
  throw lastError;
}

// --- Google Gemini ---
async function callGeminiAPI(apiKey, prompt, systemInstruction, model) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
  const body = {
    contents: [{ parts: [{ text: prompt }] }],
    systemInstruction: { parts: [{ text: systemInstruction }] },
    generationConfig: { responseMimeType: "application/json" },
  };

  return fetchWithRetry(async () => {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error?.message || `Erreur Gemini (${res.status})`);
    }
    const data = await res.json();
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) throw new Error("Réponse Gemini vide.");
    return text;
  });
}

// --- Groq ---
async function callGroqAPI(apiKey, prompt, systemInstruction) {
  return callOpenAICompatible(
    "https://api.groq.com/openai/v1/chat/completions",
    apiKey,
    "llama-3.3-70b-versatile",
    prompt,
    systemInstruction,
    "Groq"
  );
}

// --- OpenAI ---
async function callOpenAIAPI(apiKey, prompt, systemInstruction) {
  return callOpenAICompatible(
    "https://api.openai.com/v1/chat/completions",
    apiKey,
    "gpt-4o",
    prompt,
    systemInstruction,
    "OpenAI"
  );
}

// --- Mistral ---
async function callMistralAPI(apiKey, prompt, systemInstruction) {
  return callOpenAICompatible(
    "https://api.mistral.ai/v1/chat/completions",
    apiKey,
    "mistral-large-latest",
    prompt,
    systemInstruction,
    "Mistral"
  );
}

/**
 * Appel générique pour toute API compatible OpenAI (Groq, OpenAI, Mistral).
 */
async function callOpenAICompatible(url, apiKey, model, prompt, systemInstruction, label) {
  const body = {
    model,
    messages: [
      { role: "system", content: systemInstruction },
      { role: "user", content: prompt },
    ],
    response_format: { type: "json_object" },
    temperature: 0.2,
  };

  return fetchWithRetry(async () => {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error?.message || err.message || `Erreur ${label} (${res.status})`);
    }
    const data = await res.json();
    const text = data?.choices?.[0]?.message?.content;
    if (!text) throw new Error(`Réponse ${label} vide.`);
    return text;
  });
}

// --- OpenRouter (fallback multi-modèles gratuits) ---
const OPENROUTER_FREE_MODELS = [
  "meta-llama/llama-3.3-70b-instruct:free",
  "qwen/qwen-2.5-72b-instruct:free",
  "mistralai/mistral-nemo:free",
  "google/gemini-2.0-flash-thinking-exp:free",
];

async function callOpenRouterAPI(apiKey, prompt, systemInstruction) {
  let lastError;
  for (const modelId of OPENROUTER_FREE_MODELS) {
    try {
      const body = {
        model: modelId,
        messages: [
          { role: "system", content: systemInstruction },
          { role: "user", content: prompt },
        ],
        response_format: { type: "json_object" },
        temperature: 0.2,
      };

      const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          "HTTP-Referer": "https://alo-geomarketing.fr",
          "X-Title": "Planificateur Géomarketing",
        },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error?.message || `Erreur OpenRouter (${res.status})`);
      }
      const data = await res.json();
      const text = data?.choices?.[0]?.message?.content;
      if (!text) throw new Error("Réponse vide.");
      return text;
    } catch (e) {
      lastError = e;
      await new Promise(r => setTimeout(r, 500));
    }
  }
  throw new Error("Serveurs gratuits saturés. " + (lastError?.message || ""));
}

// --- Dispatch vers le moteur actif ---
async function callActiveAI(keys, prompt, systemInstruction, geminiModel) {
  const engine = keys.activeEngine;
  const key = keys[engine];
  if (!key) throw new Error(`Clé API ${engine} manquante.`);

  switch (engine) {
    case 'groq':       return callGroqAPI(key, prompt, systemInstruction);
    case 'openai':     return callOpenAIAPI(key, prompt, systemInstruction);
    case 'mistral':    return callMistralAPI(key, prompt, systemInstruction);
    case 'openrouter': return callOpenRouterAPI(key, prompt, systemInstruction);
    default:           return callGeminiAPI(key, prompt, systemInstruction, geminiModel);
  }
}

// ========================================
// VALIDATION GÉNÉRIQUE DE CLÉ API
// ========================================

/**
 * Valide une clé API en envoyant une mini-requête.
 * @param {Object} config
 * @param {string} config.engine - nom du moteur (gemini, groq, openai, mistral, openrouter)
 * @param {string} config.key - la clé à tester
 * @param {string} [config.geminiModel] - modèle Gemini si applicable
 * @returns {Promise<{success: boolean, message: string, model?: string}>}
 */
async function validateApiKey({ engine, key, geminiModel }) {
  if (!key) return { success: false, message: "Veuillez d'abord saisir une clé." };

  try {
    if (engine === 'gemini') {
      await callGeminiAPI(key, "Réponds 'OK'.", "Tu es un assistant de test.", geminiModel || 'gemini-2.5-pro');
      return { success: true, message: "Clé API Gemini valide avec ce modèle !" };
    }

    if (engine === 'openrouter') {
      const testModels = [
        "meta-llama/llama-3.3-70b-instruct:free",
        "qwen/qwen-2.5-72b-instruct:free",
        "mistralai/mistral-nemo:free",
      ];
      for (const modelId of testModels) {
        try {
          const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
            method: "POST",
            headers: {
              Authorization: `Bearer ${key}`,
              "Content-Type": "application/json",
              "HTTP-Referer": "https://alo-geomarketing.fr",
              "X-Title": "Planificateur Géomarketing",
            },
            body: JSON.stringify({
              model: modelId,
              messages: [{ role: "user", content: "Test" }],
              max_tokens: 5,
            }),
          });
          if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error?.message || "Erreur");
          const usedModel = modelId.split('/')[1].split(':')[0];
          return { success: true, message: `Clé valide ! (Connecté via ${usedModel})`, model: usedModel };
        } catch { /* try next */ }
      }
      return { success: false, message: "Serveurs gratuits saturés." };
    }

    // Groq, OpenAI, Mistral - même pattern
    const configs = {
      groq:    { url: "https://api.groq.com/openai/v1/chat/completions",  model: "llama-3.1-8b-instant", label: "Groq" },
      openai:  { url: "https://api.openai.com/v1/chat/completions",       model: "gpt-4o-mini",          label: "OpenAI" },
      mistral: { url: "https://api.mistral.ai/v1/chat/completions",       model: "mistral-small-latest", label: "Mistral AI" },
    };

    const cfg = configs[engine];
    if (!cfg) return { success: false, message: "Moteur inconnu." };

    const res = await fetch(cfg.url, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: cfg.model,
        messages: [{ role: "user", content: "Test" }],
        max_tokens: 5,
      }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error?.message || err.message || `Code HTTP ${res.status}`);
    }

    return { success: true, message: `Clé ${cfg.label} valide !` };
  } catch (e) {
    return { success: false, message: e.message || "Erreur inconnue" };
  }
}

// ========================================
// APIs PUBLIQUES FRANÇAISES (sans clé)
// ========================================

async function geocodeAddressBAN(addressStr) {
  try {
    const res = await fetch(
      `https://api-adresse.data.gouv.fr/search/?q=${encodeURIComponent(addressStr)}&limit=1`
    );
    const data = await res.json();
    if (data?.features?.length > 0) {
      const feat = data.features[0];
      return {
        lat: feat.geometry.coordinates[1],
        lng: feat.geometry.coordinates[0],
        display_name: feat.properties.label,
        city: feat.properties.city || feat.properties.name,
        insee: feat.properties.citycode,
        context: feat.properties.context,
      };
    }
  } catch { /* fallback OSM */ }
  return geocodeAddressOSM(addressStr);
}

async function geocodeAddressOSM(addressStr) {
  const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(addressStr)}&limit=1&addressdetails=1`;
  try {
    const res = await fetch(url, { headers: { 'Accept-Language': 'fr' } });
    const data = await res.json();
    if (data?.length > 0) {
      return {
        lat: parseFloat(data[0].lat),
        lng: parseFloat(data[0].lon),
        display_name: data[0].display_name,
        city: data[0].address?.city || data[0].address?.town || data[0].address?.village || addressStr.split(',')[0].trim(),
      };
    }
  } catch { /* throw below */ }
  throw new Error("Impossible de trouver l'adresse sur la carte.");
}

async function reverseGeocodeBAN(lat, lng) {
  try {
    const res = await fetch(`https://api-adresse.data.gouv.fr/reverse/?lon=${lng}&lat=${lat}&limit=1`);
    const data = await res.json();
    if (data?.features?.length > 0) {
      const p = data.features[0].properties;
      return `${p.name}, ${p.city}`;
    }
  } catch { /* silent */ }
  return null;
}

async function fetchPopulation(inseeCode) {
  try {
    const res = await fetch(`https://geo.api.gouv.fr/communes?code=${inseeCode}&fields=population`);
    const data = await res.json();
    if (data?.length > 0) return data[0].population;
  } catch { /* silent */ }
  return null;
}

async function verifySIREN(brandName) {
  try {
    const res = await fetch(
      `https://recherche-entreprises.api.gouv.fr/search?q=${encodeURIComponent(brandName)}&per_page=1`
    );
    const data = await res.json();
    if (data?.results?.length > 0) return data.results[0];
  } catch { /* silent */ }
  return null;
}

async function verifyCompetitorSIREN(brandName, lat, lng, radiusKm) {
  try {
    const url = `https://recherche-entreprises.api.gouv.fr/search?q=${encodeURIComponent(brandName)}&lat=${lat}&lon=${lng}&radius=${radiusKm}&per_page=1`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    if (data?.results?.length > 0) {
      const etab = data.results[0].matching_etablissements?.[0] || data.results[0].siege;
      if (etab?.adresse && etab?.latitude) {
        return {
          name: data.results[0].nom_complet,
          address: etab.adresse,
          lat: parseFloat(etab.latitude),
          lng: parseFloat(etab.longitude),
        };
      }
    }
  } catch { /* silent */ }
  return null;
}

async function getRealRouteDistance(lat1, lng1, lat2, lng2) {
  try {
    const url = `https://router.project-osrm.org/route/v1/driving/${lng1},${lat1};${lng2},${lat2}?overview=false`;
    const res = await fetch(url);
    const data = await res.json();
    if (data?.routes?.length > 0) return data.routes[0].distance / 1000;
  } catch { /* fallback */ }
  return calculateDistance(lat1, lng1, lat2, lng2);
}

// ========================================
// OVERPASS API (OSM POIs) - avec fallback serveurs
// ========================================

const OVERPASS_ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://lz4.overpass-api.de/api/interpreter",
];

// Requête rapide : nodes uniquement, types essentiels pour le chauffeur
function buildEssentialQuery(lat, lng, radiusMeters) {
  return `[out:json][timeout:25];(` +
    `node["highway"="bus_stop"](around:${radiusMeters},${lat},${lng});` +
    `node["railway"~"station|tram_stop|halt"](around:${radiusMeters},${lat},${lng});` +
    `node["amenity"~"pharmacy|bakery|cafe|restaurant|fast_food|bank|post_office|townhall|place_of_worship|supermarket|marketplace|hospital|clinic"](around:${radiusMeters},${lat},${lng});` +
    `node["shop"~"bakery|pharmacy|supermarket|convenience|butcher|newsagent|hairdresser|optician|florist|tabacco|pastry|greengrocer|deli"](around:${radiusMeters},${lat},${lng});` +
    `);out 600;`;
}

// Requête complète (plus lente) : tous types + way
function buildFullQuery(lat, lng, radiusMeters) {
  return `[out:json][timeout:45];(` +
    `node["highway"="bus_stop"](around:${radiusMeters},${lat},${lng});` +
    `node["railway"~"station|tram_stop|halt"](around:${radiusMeters},${lat},${lng});` +
    `node["shop"](around:${radiusMeters},${lat},${lng});` +
    `way["shop"](around:${radiusMeters},${lat},${lng});` +
    `node["amenity"~"pharmacy|bakery|cafe|restaurant|fast_food|bank|post_office|townhall|place_of_worship|cinema|library|hospital|clinic|dentist|doctors|marketplace|community_centre"](around:${radiusMeters},${lat},${lng});` +
    `way["amenity"~"pharmacy|bakery|supermarket|townhall|place_of_worship|hospital|clinic|marketplace"](around:${radiusMeters},${lat},${lng});` +
    `node["leisure"~"sports_centre|stadium|swimming_pool|fitness_centre|park"](around:${radiusMeters},${lat},${lng});` +
    `node["tourism"~"museum|attraction"](around:${radiusMeters},${lat},${lng});` +
    `);out center 1000;`;
}

// Fallback Nominatim : cherche des types spécifiques quand Overpass échoue
async function fetchPOIsNominatim(lat, lng, radiusKm) {
  const r = Math.min(radiusKm, 10); // Nominatim : limiter à 10km pour la pertinence
  const dLat = r / 111;
  const dLng = r / (111 * Math.cos(lat * Math.PI / 180));
  const viewbox = `${lng - dLng},${lat + dLat},${lng + dLng},${lat - dLat}`;
  const types = ['pharmacy', 'bakery', 'supermarket', 'bus_stop', 'post_office', 'townhall', 'cafe', 'restaurant', 'bank', 'place_of_worship'];
  const results = [];
  const seen = new Set();

  for (const type of types) {
    try {
      const url = `https://nominatim.openstreetmap.org/search?format=json&amenity=${type}&viewbox=${viewbox}&bounded=1&limit=5&addressdetails=1`;
      const res = await fetch(url, { headers: { 'User-Agent': 'ALO-Geomarketing/1.7' } });
      if (!res.ok) continue;
      const items = await res.json();
      for (const item of items) {
        const itemLat = parseFloat(item.lat);
        const itemLng = parseFloat(item.lon);
        const rawName = item.name || item.display_name?.split(',')[0] || '';
        const city = item.address?.city || item.address?.town || item.address?.village || '';
        const street = item.address?.road || '';
        const num = item.address?.house_number || '';
        const addr = [num, street].filter(Boolean).join(' ') + (city ? `, ${city}` : '');
        const label = OSM_TYPE_LABELS[type] || type;
        const name = rawName || (city ? `${label} (${city})` : label);
        const key = name + addr;
        if (seen.has(key)) continue;
        seen.add(key);
        results.push({
          name,
          lat: itemLat,
          lng: itemLng,
          type: type === 'bus_stop' ? 'transport' : 'shopping',
          address: addr || item.display_name?.split(',').slice(0, 2).join(',') || '',
          reliability: type === 'bus_stop' ? 9 : 6,
          distance: calculateDistance(lat, lng, itemLat, itemLng).toFixed(1),
          hours: 'Non spécifié',
        });
      }
      await new Promise(r => setTimeout(r, 200)); // respecter rate limit Nominatim
    } catch { /* continue */ }
  }
  return results;
}

async function fetchRealPOIs(lat, lng, radiusKm) {
  const r4km   = Math.min(4000,            radiusKm * 1000);
  const rFull  = radiusKm * 1000;
  const rWide  = Math.min(radiusKm * 2000, 40000); // plafonner à 40km

  function dedupe(pois) {
    return pois.filter((v, i, a) =>
      a.findIndex(v2 => v2.name === v.name && v2.address === v.address) === i
    );
  }

  async function tryOverpass(queryFn, radiusMeters) {
    const query = queryFn(lat, lng, radiusMeters);
    for (const endpoint of OVERPASS_ENDPOINTS) {
      try {
        const res = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: 'data=' + encodeURIComponent(query),
        });
        if (!res.ok) continue;
        const text = await res.text();
        let data;
        try { data = JSON.parse(text); } catch { continue; }
        if (!data.elements) continue;
        return dedupe(data.elements.map(e => parsePOI(e, lat, lng)).filter(Boolean));
      } catch { /* try next */ }
    }
    return null; // null = échec total (pas juste 0 résultats)
  }

  // Étape 1 : requête rapide essentielle à 4km
  let results = await tryOverpass(buildEssentialQuery, r4km);
  if (results && results.length >= 5) return results;

  // Étape 2 : requête rapide essentielle au rayon complet
  if (rFull > r4km) {
    const r2 = await tryOverpass(buildEssentialQuery, rFull);
    if (r2 && r2.length >= 5) return r2;
    if (r2 && r2.length > 0) results = r2;
  }

  // Étape 3 : requête complète (nodes + ways) au rayon complet
  const r3 = await tryOverpass(buildFullQuery, rFull);
  if (r3 && r3.length >= 5) return r3;
  if (r3 && r3.length > 0) results = (results || []).concat(r3);

  // Étape 4 : requête complète élargie
  if (rWide > rFull) {
    const r4 = await tryOverpass(buildFullQuery, rWide);
    if (r4 && r4.length >= 3) return dedupe([...(results || []), ...r4]);
    if (r4 && r4.length > 0) results = dedupe([...(results || []), ...r4]);
  }

  // Étape 5 : fallback Nominatim — toujours des résultats même si Overpass est KO
  if (!results || results.length < 3) {
    const nominatim = await fetchPOIsNominatim(lat, lng, radiusKm);
    if (nominatim.length > 0) return dedupe([...(results || []), ...nominatim]);
  }

  return results || [];
}

// Labels français pour les types OSM sans nom propre
const OSM_TYPE_LABELS = {
  // shop=*
  bakery: 'Boulangerie', pharmacy: 'Pharmacie', butcher: 'Boucherie',
  supermarket: 'Supermarché', convenience: 'Épicerie', florist: 'Fleuriste',
  hairdresser: 'Coiffeur', optician: 'Opticien', clothes: 'Boutique vêtements',
  shoes: 'Chaussures', hardware: 'Quincaillerie', car_repair: 'Garage',
  beauty: 'Institut de beauté', jewelry: 'Bijouterie', books: 'Librairie',
  electronics: 'Électronique', furniture: 'Meubles', gift: 'Cadeaux',
  mobile_phone: 'Téléphonie', newsagent: 'Presse / Tabac', pastry: 'Pâtisserie',
  deli: 'Traiteur', tobacco: 'Tabac / Presse', sports: 'Articles de sport',
  toys: 'Jouets', pet: 'Animalerie', garden_centre: 'Jardinerie',
  laundry: 'Laverie', dry_cleaning: 'Pressing', photo: 'Photographe',
  copyshop: 'Imprimerie', travel_agency: 'Agence de voyage',
  greengrocer: 'Primeur', wine: 'Cave à vins', cheese: 'Fromagerie',
  // amenity=*
  cafe: 'Café', restaurant: 'Restaurant', fast_food: 'Restauration rapide',
  bank: 'Banque', post_office: 'La Poste', townhall: 'Mairie',
  place_of_worship: 'Église / Lieu de culte', cinema: 'Cinéma', library: 'Médiathèque',
  hospital: 'Hôpital', clinic: 'Clinique', dentist: 'Dentiste',
  doctors: 'Cabinet médical', veterinary: 'Vétérinaire',
};

// Types OSM inutiles pour un chauffeur de street marketing
const BLACKLISTED_SHOP_TYPES = new Set([
  'parking', 'car_parts', 'car_wash', 'fuel', 'storage_rental',
  'agrarian', 'agricultural_supplies', 'wholesale', 'doityourself',
  'vacant', 'mall', // mall = le centre commercial entier, pas un point précis
  'kiosk', 'vending_machine',
]);

// Score de fiabilité (plus haut = meilleur point de repère pour le chauffeur)
const POI_RELIABILITY = {
  competitor: 10,  // concurrent ciblé → priorité absolue
  transport: 9,    // arrêt bus, gare, tram → toujours trouvable
  market: 8,       // marché forain → forte affluence
  medical: 7,      // pharmacie, cabinet → adresse certaine, facile à trouver
  shopping: 6,     // commerces courants
  culture: 5,      // mairie, église → repères civiques
  sport: 4,
  park: 3,
  school: 2,
  other: 1,
};

// Extraire les jours d'ouverture depuis le format OSM opening_hours
// Ex: "Mo,We,Sa 07:00-13:00" → ['lundi', 'mercredi', 'samedi']
function parseMarketDays(openingHours) {
  if (!openingHours || openingHours === 'Non spécifié') return [];
  const dayMap = {
    mo: 'lundi', tu: 'mardi', we: 'mercredi',
    th: 'jeudi', fr: 'vendredi', sa: 'samedi', su: 'dimanche',
  };
  const oh = openingHours.toLowerCase();
  const days = [];
  for (const [abbr, fr] of Object.entries(dayMap)) {
    // Chercher l'abréviation comme mot entier (éviter "the" qui contient "th")
    if (new RegExp(`(?<![a-z])${abbr}(?![a-z])`).test(oh)) days.push(fr);
  }
  return days;
}

function parsePOI(e, originLat, originLng) {
  const tags = e.tags || {};

  // Exclure types inutiles immédiatement
  if (BLACKLISTED_SHOP_TYPES.has(tags.shop)) return null;
  if (tags.amenity === 'parking' || tags.amenity === 'fuel') return null;
  if (tags.landuse || tags.industrial) return null;

  // Générer un nom depuis le type si pas de nom propre
  let name = tags.name || tags.brand;
  const hasProperName = !!name;
  if (!name) {
    const shopType = tags.shop;
    const amenityType = tags.amenity;
    const city = tags['addr:city'] || tags['addr:town'] || '';
    const suffix = city ? ` (${city})` : '';
    if (shopType && OSM_TYPE_LABELS[shopType]) {
      name = OSM_TYPE_LABELS[shopType] + suffix;
    } else if (amenityType && OSM_TYPE_LABELS[amenityType]) {
      name = OSM_TYPE_LABELS[amenityType] + suffix;
    } else if (shopType) {
      name = shopType.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()) + suffix;
    } else {
      return null;
    }
  }

  // Filtrer établissements non pertinents
  if (/coll[eè]ge|lyc[eé]e|cr[eè]che|maternelle|universit[eé]|campus|facult[eé]|institut/i.test(name)) {
    return null;
  }

  if ((tags.railway === 'station' || tags.railway === 'tram_stop') && !/gare|tram/i.test(name)) {
    name = tags.railway === 'tram_stop' ? `Tram ${name}` : `Gare de ${name}`;
  }

  let address = '';
  if (tags["addr:street"]) {
    address = `${tags["addr:housenumber"] || ''} ${tags["addr:street"]}`.trim();
    if (tags["addr:city"]) address += `, ${tags["addr:city"]}`;
  } else if (tags.highway === 'pedestrian' || tags.place === 'square') {
    address = `Place/Rue : ${name}`;
  } else if (tags.public_transport || tags.railway || tags.highway === 'bus_stop') {
    address = `Arrêt/Station : ${name}`;
  } else if (tags.amenity === 'school') {
    address = `Sortie Scolaire : ${name}`;
  } else if (tags.leisure?.match(/sports_centre|stadium|swimming_pool|fitness_centre/)) {
    address = `Complexe Sportif : ${name}`;
  } else if (tags.amenity?.match(/theatre|arts_centre|community_centre|events_venue|conference_centre/) || tags.tourism?.match(/museum|gallery|attraction/)) {
    address = `Lieu Culturel : ${name}`;
  } else if (tags.leisure === 'park') {
    address = `Parc : ${name}`;
  } else if (tags.amenity?.match(/hospital|clinic/)) {
    address = `Centre Médical : ${name}`;
  } else {
    address = name; // adresse = nom du commerce, sera enrichie par reverse geocoding si besoin
  }

  const clat = e.lat || e.center?.lat;
  const clng = e.lon || e.center?.lon;
  if (!clat || !clng) return null;

  let type = 'other';
  if (tags.amenity === 'marketplace') type = 'market';
  else if (tags.public_transport || tags.railway || tags.highway === 'bus_stop') type = 'transport';
  else if (tags.leisure?.match(/sports_centre|stadium|swimming_pool|fitness_centre/)) type = 'sport';
  else if (tags.amenity?.match(/theatre|arts_centre|community_centre|events_venue|conference_centre/) || tags.tourism?.match(/museum|gallery|attraction/)) type = 'culture';
  else if (tags.leisure === 'park') type = 'park';
  else if (tags.amenity?.match(/hospital|clinic|dentist|doctors|veterinary/)) type = 'medical';
  else if (tags.highway === 'pedestrian' || tags.shop || tags.place === 'square' ||
           tags.amenity?.match(/cafe|restaurant|fast_food|cinema|bakery|bank|post_office|pharmacy|library/)) type = 'shopping';
  else if (tags.amenity === 'school') type = 'school';

  const openingHours = tags.opening_hours || 'Non spécifié';
  // Pour les marchés forains : extraire les jours réels d'ouverture depuis OSM
  // Si pas de tag opening_hours → jours par défaut mercredi+samedi (standard France)
  const marketDays = type === 'market'
    ? (parseMarketDays(openingHours).length > 0 ? parseMarketDays(openingHours) : ['mercredi', 'samedi'])
    : [];

  return {
    name,
    lat: clat,
    lng: clng,
    type,
    address,
    reliability: POI_RELIABILITY[type] || 1,
    distance: calculateDistance(originLat, originLng, clat, clng).toFixed(1),
    hours: openingHours,
    marketDays, // jours où le marché est ouvert (vide pour les non-marchés)
  };
}

// ========================================
// MÉTÉO (Open-Meteo - 100% gratuit, sans clé)
// ========================================

/**
 * WMO Weather interpretation codes → libellé + icône
 */
const WMO_CODES = {
  0: { label: 'Ensoleillé', icon: 'sun', color: 'text-amber-500', bg: 'bg-amber-50', border: 'border-amber-200', severity: 'good' },
  1: { label: 'Dégagé', icon: 'sun', color: 'text-amber-500', bg: 'bg-amber-50', border: 'border-amber-200', severity: 'good' },
  2: { label: 'Partiellement nuageux', icon: 'cloud-sun', color: 'text-blue-400', bg: 'bg-blue-50', border: 'border-blue-200', severity: 'good' },
  3: { label: 'Couvert', icon: 'cloud', color: 'text-gray-500', bg: 'bg-gray-50', border: 'border-gray-200', severity: 'ok' },
  45: { label: 'Brouillard', icon: 'cloud-fog', color: 'text-gray-400', bg: 'bg-gray-50', border: 'border-gray-200', severity: 'warn' },
  48: { label: 'Brouillard givrant', icon: 'cloud-fog', color: 'text-blue-300', bg: 'bg-blue-50', border: 'border-blue-200', severity: 'warn' },
  51: { label: 'Bruine légère', icon: 'cloud-drizzle', color: 'text-blue-400', bg: 'bg-blue-50', border: 'border-blue-200', severity: 'ok' },
  53: { label: 'Bruine', icon: 'cloud-drizzle', color: 'text-blue-500', bg: 'bg-blue-50', border: 'border-blue-200', severity: 'warn' },
  55: { label: 'Bruine dense', icon: 'cloud-drizzle', color: 'text-blue-600', bg: 'bg-blue-100', border: 'border-blue-300', severity: 'warn' },
  61: { label: 'Pluie légère', icon: 'cloud-rain', color: 'text-blue-500', bg: 'bg-blue-50', border: 'border-blue-200', severity: 'warn' },
  63: { label: 'Pluie modérée', icon: 'cloud-rain', color: 'text-blue-600', bg: 'bg-blue-100', border: 'border-blue-300', severity: 'bad' },
  65: { label: 'Forte pluie', icon: 'cloud-rain', color: 'text-red-500', bg: 'bg-red-50', border: 'border-red-200', severity: 'bad' },
  71: { label: 'Neige légère', icon: 'snowflake', color: 'text-blue-300', bg: 'bg-blue-50', border: 'border-blue-200', severity: 'warn' },
  73: { label: 'Neige', icon: 'snowflake', color: 'text-blue-500', bg: 'bg-blue-100', border: 'border-blue-300', severity: 'bad' },
  75: { label: 'Forte neige', icon: 'snowflake', color: 'text-red-500', bg: 'bg-red-50', border: 'border-red-200', severity: 'bad' },
  80: { label: 'Averses légères', icon: 'cloud-rain-wind', color: 'text-blue-500', bg: 'bg-blue-50', border: 'border-blue-200', severity: 'warn' },
  81: { label: 'Averses modérées', icon: 'cloud-rain-wind', color: 'text-blue-600', bg: 'bg-blue-100', border: 'border-blue-300', severity: 'bad' },
  82: { label: 'Averses violentes', icon: 'cloud-rain-wind', color: 'text-red-500', bg: 'bg-red-50', border: 'border-red-200', severity: 'bad' },
  95: { label: 'Orage', icon: 'cloud-lightning', color: 'text-red-600', bg: 'bg-red-100', border: 'border-red-300', severity: 'bad' },
  96: { label: 'Orage avec grêle', icon: 'cloud-lightning', color: 'text-red-700', bg: 'bg-red-100', border: 'border-red-300', severity: 'bad' },
  99: { label: 'Orage violent', icon: 'cloud-lightning', color: 'text-red-700', bg: 'bg-red-100', border: 'border-red-300', severity: 'bad' },
};

function getWeatherInfo(code) {
  return WMO_CODES[code] || WMO_CODES[Math.floor(code / 10) * 10] || { label: 'Inconnu', icon: 'help-circle', color: 'text-gray-400', bg: 'bg-gray-50', border: 'border-gray-200', severity: 'ok' };
}

/**
 * Récupère les vacances scolaires françaises couvrant la période donnée.
 * Source : data.education.gouv.fr (API ouverte, gratuite, sans clé).
 * @returns {Array<{start: string, end: string, description: string}>}
 */
async function fetchSchoolHolidays(startDate, endDate, zone = 'B') {
  try {
    const start = startDate.toISOString().split('T')[0];
    const end = endDate.toISOString().split('T')[0];
    const url = `https://data.education.gouv.fr/api/explore/v2.1/catalog/datasets/fr-en-calendrier-scolaire/records?where=end_date>='${start}' AND start_date<='${end}' AND zones like '${zone}'&limit=20`;
    const res = await fetch(url);
    if (!res.ok) return [];
    const data = await res.json();
    return (data.results || []).map(r => ({
      start: (r.start_date || '').split('T')[0],
      end: (r.end_date || '').split('T')[0],
      description: r.description || '',
    }));
  } catch { return []; }
}

/**
 * Récupère les prévisions météo pour une position et des dates données.
 * @returns {Object} Map de "YYYY-MM-DD" → { code, tempMax, tempMin, precipitation, wind, label, icon, ... }
 */
async function fetchWeatherForecast(lat, lng, startDate, days) {
  try {
    const endDate = new Date(startDate);
    endDate.setDate(endDate.getDate() + days - 1);
    const startStr = startDate.toISOString().split('T')[0];
    const endStr = endDate.toISOString().split('T')[0];

    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,wind_speed_10m_max&timezone=Europe/Paris&start_date=${startStr}&end_date=${endStr}`;

    const res = await fetch(url);
    if (!res.ok) return {};
    const data = await res.json();

    if (!data?.daily?.time) return {};

    const forecast = {};
    data.daily.time.forEach((date, i) => {
      const code = data.daily.weather_code[i];
      const info = getWeatherInfo(code);
      forecast[date] = {
        code,
        tempMax: Math.round(data.daily.temperature_2m_max[i]),
        tempMin: Math.round(data.daily.temperature_2m_min[i]),
        precipitation: data.daily.precipitation_sum[i],
        wind: Math.round(data.daily.wind_speed_10m_max[i]),
        ...info,
      };
    });
    return forecast;
  } catch { return {}; }
}
