/**
 * app.js - Orchestration principale de l'application
 */

// ========================================
// RÉFÉRENCES DOM
// ========================================

const el = {};
const inputRefs = {};
let generatedData = null;
let officialPopulation = null;

function initDomRefs() {
  el.form = document.getElementById('clientForm');
  el.btn = document.getElementById('generatePlanBtn');
  el.btnText = document.getElementById('btnText');
  el.spinner = document.getElementById('spinner');
  el.progressContainer = document.getElementById('progressContainer');
  el.progressBar = document.getElementById('progressBar');
  el.progressPercent = document.getElementById('progressPercent');
  el.loadingStatus = document.getElementById('loadingStatus');
  el.alertBox = document.getElementById('alertBox');
  el.alertText = document.getElementById('alertText');
  el.aiConfigDetails = document.getElementById('aiConfigDetails');
  el.activeAiBadge = document.getElementById('activeAiBadge');
  el.outputContainer = document.getElementById('analysisOutputContainer');
  el.analysisCard = document.getElementById('clientAnalysisOutput');
  el.analysisText = document.getElementById('clientAnalysisText');
  el.planCard = document.getElementById('planOutput');
  el.dailyPlansContainer = document.getElementById('dailyPlansContainer');
  el.attendanceCard = document.getElementById('attendanceSheetContainer');
  el.attendanceGrid = document.getElementById('attendanceGrid');
  el.displayBrand = document.getElementById('displayBrand');
  el.dateSpan = document.getElementById('generationDate');
  el.mapContainer = document.getElementById('mapContainerWrapper');
  el.mapStats = document.getElementById('mapStats');
  el.officialBadges = document.getElementById('officialBadges');
  el.badgeSiren = document.getElementById('badgeSiren');
  el.badgeInsee = document.getElementById('badgeInsee');
  el.badgePop = document.getElementById('badgePop');
  el.sirenVal = document.getElementById('sirenVal');
  el.inseeVal = document.getElementById('inseeVal');
  el.popVal = document.getElementById('popVal');
  el.reachEstimationContainer = document.getElementById('reachEstimationContainer');
  el.estTotalStops = document.getElementById('estTotalStops');
  el.estReach = document.getElementById('estReach');
  el.estImpressions = document.getElementById('estImpressions');

  inputRefs.brand = document.getElementById('clientBrand');
  inputRefs.address = document.getElementById('clientAddress');
  inputRefs.radius = document.getElementById('campaignRadius');
  inputRefs.startDate = document.getElementById('campaignStartDate');
  inputRefs.duration = document.getElementById('campaignDuration');
  inputRefs.morning = document.getElementById('timeMorning');
  inputRefs.afternoon = document.getElementById('timeAfternoon');
  inputRefs.target = document.getElementById('targetProfile');
  inputRefs.competitors = document.getElementById('competitors');
  inputRefs.excludedCities = document.getElementById('excludedCities');
}

// ========================================
// GESTION CLÉS API (localStorage)
// ========================================

const ENGINE_CONFIG = {
  openrouter:  { inputId: 'openrouterKeyInput', statusId: 'openrouterKeyStatusText', btnId: 'validateOpenRouterKeyBtn', storageKey: StorageKeys.OPENROUTER, label: 'OpenRouter' },
  gemini:      { inputId: 'apiKeyInput',         statusId: 'keyStatusText',           btnId: 'validateKeyBtn',           storageKey: StorageKeys.GEMINI,     label: 'Google Gemini' },
  groq:        { inputId: 'groqKeyInput',        statusId: 'groqKeyStatusText',       btnId: 'validateGroqKeyBtn',       storageKey: StorageKeys.GROQ,       label: 'Groq' },
  openai:      { inputId: 'openaiKeyInput',      statusId: 'openaiKeyStatusText',     btnId: 'validateOpenAIKeyBtn',     storageKey: StorageKeys.OPENAI,     label: 'OpenAI' },
  mistral:     { inputId: 'mistralKeyInput',     statusId: 'mistralKeyStatusText',    btnId: 'validateMistralKeyBtn',    storageKey: StorageKeys.MISTRAL,    label: 'Mistral AI' },
};

function getActiveEngine() {
  return document.querySelector('input[name="aiEngine"]:checked')?.value || 'openrouter';
}

function getKeys() {
  const keys = { activeEngine: getActiveEngine() };
  for (const [engine, cfg] of Object.entries(ENGINE_CONFIG)) {
    const input = document.getElementById(cfg.inputId);
    keys[engine] = input?.value.trim() || '';
  }
  return keys;
}

function saveKeys() {
  for (const [engine, cfg] of Object.entries(ENGINE_CONFIG)) {
    const input = document.getElementById(cfg.inputId);
    if (input?.value.trim()) safeSetItem(cfg.storageKey, input.value.trim());
  }
  const modelSelect = document.getElementById('modelSelect');
  if (modelSelect) safeSetItem(StorageKeys.MODEL, modelSelect.value);
  safeSetItem(StorageKeys.ENGINE, getActiveEngine());
}

function loadSavedKeys() {
  for (const [engine, cfg] of Object.entries(ENGINE_CONFIG)) {
    const input = document.getElementById(cfg.inputId);
    const saved = safeGetItem(cfg.storageKey);
    if (input && saved) input.value = saved;
  }
  const savedModel = safeGetItem(StorageKeys.MODEL);
  const modelSelect = document.getElementById('modelSelect');
  if (savedModel && modelSelect) modelSelect.value = savedModel;

  const savedEngine = safeGetItem(StorageKeys.ENGINE) || 'openrouter';
  const radio = document.querySelector(`input[name="aiEngine"][value="${savedEngine}"]`);
  if (radio) radio.checked = true;

  updateAiBadge();
  autoCloseAiSettings();

  document.querySelectorAll('input[name="aiEngine"]').forEach(r => {
    r.addEventListener('change', () => { updateAiBadge(); saveKeys(); });
  });
}

function updateAiBadge() {
  if (!el.activeAiBadge) return;
  const names = { openrouter: 'OpenRouter', gemini: 'Google Gemini', groq: 'Groq', openai: 'OpenAI', mistral: 'Mistral AI' };
  el.activeAiBadge.textContent = names[getActiveEngine()] || getActiveEngine();
}

function autoCloseAiSettings() {
  const keys = getKeys();
  if (keys[keys.activeEngine] && el.aiConfigDetails) {
    el.aiConfigDetails.removeAttribute('open');
  }
}

// ========================================
// VALIDATION CLÉ - Handler générique
// ========================================

function setupValidationButtons() {
  for (const [engine, cfg] of Object.entries(ENGINE_CONFIG)) {
    const btn = document.getElementById(cfg.btnId);
    if (!btn) continue;

    btn.addEventListener('click', async () => {
      const input = document.getElementById(cfg.inputId);
      const statusEl = document.getElementById(cfg.statusId);
      const key = input?.value.trim();

      btn.disabled = true;
      btn.innerHTML = '<i data-lucide="loader-2" class="w-4 h-4 mr-1 animate-spin"></i> Test...';
      lucide.createIcons();
      statusEl.className = 'hidden';

      const geminiModel = document.getElementById('modelSelect')?.value || 'gemini-2.5-pro';
      const result = await validateApiKey({ engine, key, geminiModel });

      statusEl.textContent = result.message;
      const color = result.success ? 'emerald' : 'red';
      statusEl.className = `text-xs mt-1 text-${color}-600 font-bold block`;

      input.classList.remove('input-valid', 'input-invalid', 'border-gray-200');
      input.classList.add(result.success ? 'input-valid' : 'input-invalid');

      if (result.success) {
        saveKeys();
        setTimeout(() => { if (el.aiConfigDetails) el.aiConfigDetails.removeAttribute('open'); }, 800);
      }

      btn.disabled = false;
      btn.innerHTML = '<i data-lucide="check-circle" class="w-4 h-4 mr-1"></i> Vérifier';
      lucide.createIcons();
    });
  }
}

// ========================================
// UI HELPERS
// ========================================

function showMessage(msg, type = 'error') {
  if (!msg || msg.trim() === '') {
    el.alertBox.style.display = 'none';
    return;
  }
  el.alertText.textContent = msg; // textContent = pas de XSS
  el.alertBox.style.display = 'block';
  el.alertBox.className = type === 'error'
    ? 'alert-box bg-red-50 text-red-800 border-red-500'
    : 'alert-box bg-emerald-50 text-emerald-800 border-emerald-500';
  lucide.createIcons();
  el.alertBox.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function setProgress(msg, percent = null) {
  if (!msg) {
    el.spinner.classList.add('hidden');
    el.progressContainer.classList.add('hidden');
    el.btnText.textContent = 'Générer le Plan';
    el.btn.disabled = false;
    return;
  }
  el.spinner.classList.remove('hidden');
  el.loadingStatus.textContent = msg;
  el.progressContainer.classList.remove('hidden');
  if (percent !== null) {
    el.progressBar.style.width = `${percent}%`;
    el.progressPercent.textContent = `${percent}%`;
  }
  el.btnText.textContent = 'Analyse spatiale...';
  el.btn.disabled = true;
}

// ========================================
// ICÔNES TYPE D'ARRÊT (sécurisées)
// ========================================

const TYPE_ICONS = {
  market:     { icon: 'shopping-basket', color: 'text-[#10b981]' },
  transport:  { icon: 'train',           color: 'text-blue-500' },
  shopping:   { icon: 'shopping-bag',    color: 'text-purple-500' },
  school:     { icon: 'graduation-cap',  color: 'text-amber-500' },
  competitor: { icon: 'target',          color: 'text-red-500' },
  sport:      { icon: 'trophy',          color: 'text-orange-500' },
  culture:    { icon: 'palette',         color: 'text-pink-500' },
  park:       { icon: 'trees',           color: 'text-green-500' },
  medical:    { icon: 'heart-pulse',     color: 'text-rose-500' },
};

function getTypeIconHTML(type) {
  const cfg = TYPE_ICONS[type] || { icon: 'map-pin', color: 'text-gray-400' };
  return `<i data-lucide="${sanitize(cfg.icon)}" class="w-5 h-5 ${sanitize(cfg.color)} mr-3"></i>`;
}

/**
 * Génère le badge météo pour un jour.
 */
function renderWeatherBadge(weather) {
  if (!weather) return '';
  return `<span class="${weather.bg} border ${weather.border} ${weather.color} px-3 py-1.5 rounded-lg text-sm font-bold flex items-center shadow-sm gap-1.5" title="${sanitize(weather.label)} - ${weather.precipitation}mm - Vent ${weather.wind}km/h">
    <i data-lucide="${sanitize(weather.icon)}" class="w-4 h-4"></i>
    <span>${weather.tempMax}°</span>
    <span class="text-[10px] opacity-60">${weather.tempMin}°</span>
  </span>`;
}

// ========================================
// RENDU HTML SÉCURISÉ D'UN ARRÊT
// ========================================

function renderStopHTML(stop, distBadge) {
  return `
    <div class="flex items-center p-6 bg-white rounded-2xl border border-gray-200 shadow-sm mb-4">
      <div class="w-20 font-extrabold text-2xl text-[#0E2C59] tracking-tight">${sanitize(stop.time)}</div>
      <div class="flex-1 min-w-0 border-l-2 border-gray-100 pl-6">
        <div class="flex items-center flex-wrap">
          ${getTypeIconHTML(stop.type)}
          <span class="font-extrabold text-gray-900 text-xl">${sanitize(stop.locationName)}</span>
          ${distBadge}
        </div>
        <div class="text-sm text-gray-500 mt-2 flex items-center flex-wrap font-medium">
          ${sanitize(stop.address)}
          <span class="text-[10px] text-gray-400 uppercase tracking-widest ml-3 border-l border-gray-300 pl-3">SRC: ${sanitize(stop.source)}</span>
        </div>
      </div>
    </div>`;
}

// ========================================
// RENDU ÉMARGEMENT SÉCURISÉ
// ========================================

function renderAttendanceHTML(day) {
  const hasMorn = day.hasMorning !== false;
  const hasAft = day.hasAfternoon !== false;
  const cols = (hasMorn && hasAft) ? 'md:grid-cols-2' : 'md:grid-cols-1';

  let blocks = '';
  if (hasMorn) blocks += renderSignatureBlock('sun', 'amber', 'MATIN', day.startMatin, day.endMatin);
  if (hasAft) blocks += renderSignatureBlock('sunset', 'orange', 'APRÈS-MIDI', day.startAprem, day.endAprem);
  if (!hasMorn && !hasAft) blocks = '<p class="text-gray-400 italic text-center py-4">Journée sans créneau programmé</p>';

  return `
    <div class="border border-gray-200 rounded-[32px] p-8 bg-white mb-8 shadow-sm page-break-inside-avoid">
      <div class="flex flex-col sm:flex-row sm:items-center justify-between mb-8 pb-4 border-b border-gray-100 gap-4">
        <div class="font-extrabold text-2xl text-[#0E2C59] flex items-center">
          <i data-lucide="calendar" class="w-6 h-6 text-blue-500 mr-3"></i>
          ${sanitize(day.date)}
        </div>
        <div class="text-base text-gray-600 font-medium whitespace-nowrap flex items-center">
          Nom du chauffeur : <div class="w-64 border-b-2 border-dotted border-gray-400 ml-3"></div>
        </div>
      </div>
      <div class="grid grid-cols-1 ${cols} gap-8">
        ${blocks}
      </div>
    </div>`;
}

function renderSignatureBlock(icon, color, label, start, end) {
  return `
    <div class="bg-[#F8FAFC] p-6 rounded-3xl border border-gray-200">
      <div class="flex justify-between items-start mb-6">
        <div class="text-sm font-extrabold text-gray-800 flex items-center tracking-wider bg-white px-3 py-1 rounded-lg shadow-sm">
          <i data-lucide="${sanitize(icon)}" class="w-4 h-4 mr-2 text-${sanitize(color)}-500"></i> ${sanitize(label)}
        </div>
        <div class="text-xs text-right text-gray-600 font-medium">
          Début: <strong class="text-gray-900 text-sm ml-1">${sanitize(start)}</strong><br>
          Fin: <strong class="text-gray-900 text-sm ml-1">${sanitize(end)}</strong>
        </div>
      </div>
      <div class="h-32 border-2 border-dashed rounded-2xl border-${sanitize(color)}-200 bg-white flex items-end justify-end p-4">
        <span class="text-xs text-${sanitize(color)}-300 font-bold uppercase tracking-widest">Signature ${sanitize(label)}</span>
      </div>
    </div>`;
}

// ========================================
// GARDE-FOUS ÉCOLES
// ========================================

function enforceSchoolRules(dailyPlans) {
  dailyPlans.forEach(dayPlan => {
    const dayStr = (dayPlan.day || '').toLowerCase();
    const isSchoolDay = /lundi|mardi|jeudi|vendredi/.test(dayStr);

    if (!dayPlan.stops) return;

    let morningSchool = false;
    let afternoonSchool = false;

    dayPlan.stops.forEach(stop => {
      const isSchool = stop.type === 'school' ||
        /ecole|école|scolaire/i.test(stop.locationName || '');

      if (!isSchool) return;

      if (!isSchoolDay) {
        stop.type = 'shopping';
        return;
      }

      stop.type = 'school';
      const hour = parseInt(stop.time.split(':')[0]);

      if (hour < 14 && !morningSchool) {
        stop.time = '11:15';
        morningSchool = true;
      } else if (hour >= 14 && !afternoonSchool) {
        stop.time = '16:15';
        afternoonSchool = true;
      } else {
        stop.type = 'shopping';
      }
    });
  });
}

// ========================================
// GÉNÉRATION PRINCIPALE
// ========================================

async function handleGenerate() {
  showMessage('');

  if (!inputRefs.brand.value.trim() || !inputRefs.address.value.trim()) {
    return showMessage("Remplissez l'enseigne et la ville.");
  }

  const keys = getKeys();
  if (!keys[keys.activeEngine]) {
    return showMessage(`Veuillez renseigner votre clé API ${ENGINE_CONFIG[keys.activeEngine]?.label || keys.activeEngine}.`);
  }

  try {
    saveKeys();
    setProgress('Initialisation...', 5);

    // Reset UI
    ['mapContainer', 'planCard', 'attendanceCard', 'reachEstimationContainer',
     'officialBadges', 'badgeSiren', 'badgeInsee', 'badgePop', 'analysisCard'
    ].forEach(id => el[id]?.classList.add('hidden'));

    // --- Géocodage ---
    setProgress('Vérification Adresse (API BAN)...', 15);
    const originObj = await geocodeAddressBAN(inputRefs.address.value);

    if (originObj.insee) {
      el.inseeVal.textContent = originObj.insee;
      el.badgeInsee.classList.remove('hidden');
      el.officialBadges.classList.remove('hidden');

      setProgress('Analyse Démographique (Géo API)...', 20);
      officialPopulation = await fetchPopulation(originObj.insee);
      if (officialPopulation) {
        el.popVal.textContent = formatNumber(officialPopulation);
        el.badgePop.classList.remove('hidden');
      }
    }

    // --- Dates ---
    const startDateObj = new Date(inputRefs.startDate.value);
    const duration = parseInt(inputRefs.duration.value) || 1;
    const datesList = [];
    const datesISO = [];
    for (let i = 0; i < duration; i++) {
      const d = new Date(startDateObj);
      d.setDate(d.getDate() + i);
      datesList.push(d.toLocaleDateString('fr-FR', { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' }));
      datesISO.push(d.toISOString().split('T')[0]);
    }

    // --- Météo (Open-Meteo, gratuit) ---
    setProgress('Prévisions météo (Open-Meteo)...', 22);
    const weatherForecast = await fetchWeatherForecast(originObj.lat, originObj.lng, startDateObj, duration);

    // --- SIRENE ---
    setProgress(`Vérification légale SIRENE...`, 30);
    let officialBrand = inputRefs.brand.value;
    const companyData = await verifySIREN(inputRefs.brand.value);
    if (companyData) {
      officialBrand = companyData.nom_complet || inputRefs.brand.value;
      el.sirenVal.textContent = companyData.siren;
      el.badgeSiren.classList.remove('hidden');
      el.officialBadges.classList.remove('hidden');
    }

    // --- Auto-détection concurrents ---
    if (!inputRefs.competitors.value.trim()) {
      setProgress(`Détection IA des concurrents...`, 35);
      const geminiModel = document.getElementById('modelSelect')?.value || 'gemini-2.5-pro';
      try {
        const sys = 'Tu es un expert retail et géomarketing.';
        const p = `Identifie les 3 principaux concurrents physiques directs de "${officialBrand}" en France. JSON: {"competitors": "Aldi, Carrefour, Leclerc"}`;
        const raw = await callActiveAI(keys, p, sys, geminiModel);
        const parsed = JSON.parse(cleanJson(raw));
        if (parsed.competitors && !/vide|inconnu/i.test(parsed.competitors)) {
          inputRefs.competitors.value = parsed.competitors;
        }
      } catch { /* non-blocking */ }
    }

    // --- POIs OSM ---
    const radius = parseFloat(inputRefs.radius.value) || 10;
    setProgress(`Scan topographique à ${radius}km...`, 45);
    const realPOIsRaw = await fetchRealPOIs(originObj.lat, originObj.lng, radius);
    const targetCity = originObj.city || inputRefs.address.value.split(',')[0].trim();

    if (realPOIsRaw.length === 0) {
      showMessage("Attention : Aucun POI trouvé. Le plan sera rempli avec des secteurs résidentiels.", 'error');
    }

    // --- Filtrage exclusions ---
    const excludedList = inputRefs.excludedCities.value.trim().toLowerCase()
      .split(',').map(c => c.trim()).filter(Boolean);

    let filteredPOIs = realPOIsRaw.filter(poi =>
      excludedList.length === 0 || !excludedList.some(ex => poi.address.toLowerCase().includes(ex))
    );

    // --- Concurrents ---
    setProgress('Localisation des concurrents...', 50);
    const userCompetitors = inputRefs.competitors.value.trim();
    let preVerifiedCompetitors = [];

    if (userCompetitors) {
      const compList = userCompetitors.split(',').map(c => c.trim().toLowerCase()).filter(Boolean);

      for (const poi of filteredPOIs) {
        if (compList.some(c => poi.name.toLowerCase().includes(c))) {
          poi.type = 'competitor';
          preVerifiedCompetitors.push(poi);
        }
      }
      preVerifiedCompetitors = preVerifiedCompetitors.filter((v, i, a) => a.findIndex(v2 => v2.name === v.name) === i);

      if (preVerifiedCompetitors.length === 0) {
        for (const comp of compList) {
          const sData = await verifyCompetitorSIREN(comp, originObj.lat, originObj.lng, radius);
          if (sData) {
            const dist = calculateDistance(originObj.lat, originObj.lng, sData.lat, sData.lng);
            if (dist <= radius && !excludedList.some(ex => sData.address.toLowerCase().includes(ex))) {
              preVerifiedCompetitors.push({
                name: sData.name, lat: sData.lat, lng: sData.lng,
                type: 'competitor', address: sData.address,
                distance: dist.toFixed(1), source: 'SIRENE (Certifié)',
              });
            }
          }
        }
      }
    }

    // --- Tri POIs ---
    filteredPOIs.sort((a, b) => {
      if (a.type === 'market' && b.type !== 'market') return -1;
      if (b.type === 'market' && a.type !== 'market') return 1;
      const aLocal = a.address.toLowerCase().includes(targetCity.toLowerCase()) && parseFloat(a.distance) <= 2.0;
      const bLocal = b.address.toLowerCase().includes(targetCity.toLowerCase()) && parseFloat(b.distance) <= 2.0;
      if (aLocal && !bLocal) return -1;
      if (!aLocal && bLocal) return 1;
      return parseFloat(a.distance) - parseFloat(b.distance);
    });

    // --- Construction du prompt IA ---
    let poiContext = filteredPOIs.length > 0
      ? `BASE OSM DÉDIÉE :\n${JSON.stringify(filteredPOIs.slice(0, 100))}\n`
      : 'BASE OSM VIDE.\n';

    if (preVerifiedCompetitors.length > 0) {
      poiContext += `\nBASE CONCURRENTS CERTIFIÉS :\n${JSON.stringify(preVerifiedCompetitors)}\n`;
    }

    let competitorInstruction = preVerifiedCompetitors.length > 0
      ? 'CONCURRENTS: Inclus au moins 1-2 par jour tirés de la BASE CONCURRENTS CERTIFIÉS.'
      : 'CONCURRENTS: Aucun trouvé dans le périmètre.';

    const exclusionInstruction = excludedList.length > 0
      ? `INTERDICTION : aucun arrêt dans ${excludedList.join(', ').toUpperCase()}.`
      : 'Ne traverse PAS les fleuves majeurs.';

    // --- Horaires par jour (personnalisés ou par défaut) ---
    const perDayTimes = [];
    let perDayTimesPrompt = '';
    for (let i = 0; i < duration; i++) {
      const t = getTimesForDay(i);
      perDayTimes.push(t);

      const mornLabel = t.hasMorning ? `Matin ${t.mornStart}-${t.mornEnd}` : 'PAS DE MATIN (0 arrêts)';
      const aftLabel = t.hasAfternoon ? `Aprem ${t.aftStart}-${t.aftEnd}` : 'PAS D\'APRÈS-MIDI (0 arrêts)';
      perDayTimesPrompt += `  - ${datesList[i]} : ${mornLabel}, ${aftLabel}\n`;
    }

    setProgress('Analyse IA Stratégique...', 60);
    el.displayBrand.textContent = officialBrand;
    el.dateSpan.textContent = new Date().toLocaleDateString('fr-FR');

    const systemInstruction = `Tu es un expert en géomarketing. Renvoie UNIQUEMENT du JSON pur.
RAYON MAX: ${radius} km autour de (${originObj.lat}, ${originObj.lng}).
${exclusionInstruction}
STRATÉGIE CARDINALE: Attribue à chaque jour une direction dominante (Nord, Sud, Est, Ouest).
PROXIMITÉ: 60% des arrêts dans "${targetCity}" à moins de 2.0 km.
HORAIRES: EXACTEMENT 4 arrêts par créneau actif. ATTENTION : chaque jour peut avoir des horaires DIFFÉRENTS. Si un créneau indique "PAS DE MATIN" ou "PAS D'APRÈS-MIDI", génère ZÉRO arrêt pour ce créneau (ne mets aucun stop). Respecte scrupuleusement les horaires donnés pour chaque jour.
DIVERSITÉ: Mélanger transport, shopping, school, competitor, sport, culture, park, medical. Max 2 du même type d'affilée.
ÉCOLES: EXCLUSIVEMENT Lundi, Mardi, Jeudi, Vendredi. Matin à "11:15", après-midi à "16:15".
${competitorInstruction}
ANTI-DOUBLON: Aucune adresse répétée.
COPIE EXACTE: Recopier name/address depuis la BASE OSM.
JSON FORMAT: {"analysis":"...","dailyPlans":[{"day":"lundi JJ/MM/YYYY","role":"VÉHICULE","stops":[{"time":"HH:MM","locationName":"Nom","address":"Adresse","type":"market|transport|shopping|school|competitor|sport|culture|park|medical|other","source":"OSM","lat":0,"lng":0}]}],"attendance":[{"date":"JJ/MM/YYYY","startMatin":"HH:MM","endMatin":"HH:MM","startAprem":"HH:MM","endAprem":"HH:MM"}]}`;

    const prompt = `Plan pour ${officialBrand} depuis ${inputRefs.address.value}.\nHORAIRES PAR JOUR :\n${perDayTimesPrompt}\n${poiContext}`;

    const geminiModel = document.getElementById('modelSelect')?.value || 'gemini-2.5-pro';
    let rawText;
    try {
      rawText = await callActiveAI(keys, prompt, systemInstruction, geminiModel);
    } catch (e) {
      throw new Error(`Serveurs IA indisponibles : ${e.message}`);
    }

    let data;
    try {
      data = JSON.parse(cleanJson(rawText));
      data.dailyPlans = data.dailyPlans || [];
      if (data.dailyPlans.length === 0) {
        throw new Error("Plan vide. Élargissez le rayon ou relancez.");
      }
      // Toujours écraser l'attendance avec les horaires réels de l'utilisateur
      data.attendance = datesList.map((d, i) => {
        const t = perDayTimes[i] || perDayTimes[0];
        return {
          date: d,
          hasMorning: t.hasMorning,
          hasAfternoon: t.hasAfternoon,
          startMatin: t.mornStart,
          endMatin: t.mornEnd,
          startAprem: t.aftStart,
          endAprem: t.aftEnd,
        };
      });
    } catch (err) {
      throw new Error(err.message.includes('vide') ? err.message : "L'IA a mal formaté la réponse.");
    }

    data.shopLocation = { lat: originObj.lat, lng: originObj.lng, address: originObj.display_name };

    // --- Garde-fou créneaux désactivés (supprime les arrêts hors créneau) ---
    data.dailyPlans.forEach((dayPlan, idx) => {
      const t = perDayTimes[idx];
      if (!t || !dayPlan.stops) return;

      dayPlan.stops = dayPlan.stops.filter(stop => {
        const hour = parseInt((stop.time || '12:00').split(':')[0]);
        if (!t.hasMorning && hour < 14) return false;  // Pas de matin → supprime
        if (!t.hasAfternoon && hour >= 14) return false; // Pas d'aprem → supprime
        return true;
      });
    });

    // --- Garde-fou écoles (1er passage) ---
    enforceSchoolRules(data.dailyPlans);

    // --- Validation topographique des arrêts ---
    setProgress('Génération des tracés réels...', 75);
    const availablePOIs = [...filteredPOIs, ...preVerifiedCompetitors];
    const usedPOINames = new Set();
    const defaultComps = ['aldi', 'lidl', 'carrefour', 'store', 'brico', 'castorama', 'leroy'];
    const userCompsList = userCompetitors ? userCompetitors.split(',').map(s => s.trim().toLowerCase()) : [];
    const allCompsToCheck = [...defaultComps, ...userCompsList];

    for (const day of data.dailyPlans) {
      if (!day.stops) continue;
      const dayStr = (day.day || '').toLowerCase();
      const isSchoolDay = /lundi|mardi|jeudi|vendredi/.test(dayStr);

      for (const stop of day.stops) {
        stop.locationName = stop.locationName || 'Lieu de prospection';
        stop.address = stop.address || '';
        stop.type = stop.type || 'other';
        let isLegit = false;

        // Vérif concurrent SIRENE
        const isCompStop = stop.type === 'competitor' || allCompsToCheck.some(c => c && stop.locationName.toLowerCase().includes(c));
        if (isCompStop && stop.source !== 'SIRENE (Certifié)') {
          const cleanName = stop.locationName.replace(new RegExp(inputRefs.address.value, 'gi'), '').trim();
          let sireneData = await verifyCompetitorSIREN(cleanName, originObj.lat, originObj.lng, radius);
          if (!sireneData && cleanName.includes(' ')) {
            sireneData = await verifyCompetitorSIREN(cleanName.split(' ')[0], originObj.lat, originObj.lng, radius);
          }
          if (sireneData && !excludedList.some(ex => sireneData.address.toLowerCase().includes(ex))) {
            Object.assign(stop, {
              locationName: sireneData.name, address: sireneData.address,
              lat: sireneData.lat, lng: sireneData.lng,
              source: 'SIRENE (CERTIFIÉ OFFICIEL)',
            });
            isLegit = true;
          }
        } else if (stop.source === 'SIRENE (Certifié)') {
          isLegit = true;
        }

        // Match dans la base OSM
        if (!isLegit) {
          const aiName = stop.locationName.toLowerCase().replace(/[^a-z0-9]/g, '');
          const idx = availablePOIs.findIndex(p => {
            const pName = p.name.toLowerCase().replace(/[^a-z0-9]/g, '');
            return !usedPOINames.has(p.name) && (
              (aiName.length > 2 && (aiName.includes(pName) || pName.includes(aiName))) ||
              (stop.address && stop.address.toLowerCase().includes(p.address.toLowerCase()))
            );
          });
          if (idx !== -1) {
            const real = availablePOIs[idx];
            Object.assign(stop, {
              locationName: real.name, address: real.address,
              lat: real.lat, lng: real.lng, type: real.type, source: 'OSM',
            });
            usedPOINames.add(real.name);
            isLegit = true;
          }
        }

        // Fallback intelligent
        if (!isLegit && availablePOIs.length > 0) {
          const findFallback = (filter) => availablePOIs.findIndex(p =>
            filter(p) && (isSchoolDay || p.type !== 'school')
          );

          let idx = findFallback(p => p.type === stop.type && p.address.toLowerCase().includes(targetCity.toLowerCase()) && !usedPOINames.has(p.name));
          if (idx === -1) idx = findFallback(p => p.address.toLowerCase().includes(targetCity.toLowerCase()) && !usedPOINames.has(p.name));
          if (idx === -1) idx = findFallback(p => !usedPOINames.has(p.name));
          if (idx === -1) idx = findFallback(() => true); // réutilisation

          if (idx !== -1) {
            const fb = availablePOIs[idx];
            Object.assign(stop, {
              locationName: fb.name, address: fb.address,
              lat: fb.lat, lng: fb.lng, type: fb.type,
              source: 'CORRECTION (Base OSM)',
            });
            usedPOINames.add(fb.name);
            isLegit = true;
          }
        }

        // Dernier recours : reverse geocoding
        if (!isLegit) {
          let validStreet = null, finalLat = originObj.lat, finalLng = originObj.lng;
          for (let attempt = 0; attempt < 5 && !validStreet; attempt++) {
            const angle = Math.random() * Math.PI * 2;
            const distKm = 0.3 + Math.random() * 1.5;
            finalLat = originObj.lat + (distKm / 111) * Math.cos(angle);
            finalLng = originObj.lng + (distKm / (111 * Math.cos(originObj.lat * Math.PI / 180))) * Math.sin(angle);
            validStreet = await reverseGeocodeBAN(finalLat, finalLng);
          }
          stop.lat = finalLat;
          stop.lng = finalLng;
          if (validStreet) {
            stop.type = 'shopping';
            stop.locationName = `Secteur à fort passage : ${validStreet.split(',')[0]}`;
            stop.address = validStreet;
          } else {
            stop.type = 'other';
            stop.locationName = 'Point de chute QG';
            stop.address = originObj.display_name;
          }
          stop.source = 'GÉNÉRATION (ZONE)';
        }

        // Reverse geocode les adresses génériques
        if (/^(Secteur|Sortie Scolaire|Arrêt\/Station|Place\/Rue)/i.test(stop.address)) {
          const realAddr = await reverseGeocodeBAN(stop.lat, stop.lng);
          if (realAddr) stop.address = realAddr;
        }
      }
    }

    // --- Garde-fou écoles (2e passage post-topographie) ---
    enforceSchoolRules(data.dailyPlans);

    // --- Rendu HTML sécurisé ---
    setProgress('Calcul itinéraire routier (OSRM)...', 85);

    let plansHtml = '';
    let outOfBoundsCount = 0;
    let totalStops = 0;

    for (let idx = 0; idx < data.dailyPlans.length; idx++) {
      const day = data.dailyPlans[idx];
      const att = data.attendance[idx] || { startMatin: morn.start, endMatin: morn.end, startAprem: aft.start, endAprem: aft.end };

      // Météo du jour
      const dayISO = datesISO[idx];
      const weather = dayISO ? weatherForecast[dayISO] : null;
      const weatherBadgeHtml = weather ? renderWeatherBadge(weather) : '';

      const stopsHtmlArr = await Promise.all((day.stops || []).map(async (s) => {
        totalStops++;
        const routeDist = await getRealRouteDistance(originObj.lat, originObj.lng, s.lat, s.lng);

        let distBadge;
        if (routeDist > radius) {
          if (routeDist > radius * 1.3) outOfBoundsCount++;
          distBadge = `<span class="text-sm font-bold text-amber-500 ml-3 whitespace-nowrap">&#x1F699; ${routeDist.toFixed(1)}km</span>`;
        } else {
          distBadge = `<span class="text-sm font-bold text-[#10b981] ml-3 whitespace-nowrap">&#x2713; ${routeDist.toFixed(1)}km</span>`;
        }

        return renderStopHTML(s, distBadge);
      }));

      // Alerte météo si mauvais temps
      let weatherAlert = '';
      if (weather && weather.severity === 'bad') {
        weatherAlert = `<div class="bg-red-50 border border-red-200 rounded-xl p-3 mb-3 flex items-center gap-2 text-sm text-red-700 font-semibold">
          <i data-lucide="alert-triangle" class="w-5 h-5 text-red-500 flex-shrink-0"></i>
          <span>Alerte météo : ${sanitize(weather.label)} prévue (${weather.precipitation}mm de précipitations, vent ${weather.wind}km/h). Prévoir un plan de repli.</span>
        </div>`;
      }

      plansHtml += `
        <div id="day-card-${idx}" class="mb-10 page-break-inside-avoid px-2">
          <div class="flex flex-col md:flex-row md:justify-between md:items-end mb-4 pb-3 border-b border-gray-200 gap-4">
            <div class="flex flex-col">
              <h4 class="font-extrabold text-3xl text-[#0E2C59] capitalize mb-1">${sanitize(day.day)}</h4>
              <span class="text-sm font-bold uppercase text-gray-500 tracking-widest">${sanitize(day.role || 'VÉHICULE')}</span>
            </div>
            <div class="flex flex-wrap gap-2 items-center">
              ${weatherBadgeHtml}
              ${att.hasMorning !== false ? `<span class="bg-amber-50 border border-amber-200 text-amber-800 px-3 py-1.5 rounded-lg text-sm font-bold flex items-center shadow-sm">
                <i data-lucide="sun" class="w-4 h-4 mr-1.5"></i> ${sanitize(att.startMatin)} - ${sanitize(att.endMatin)}
              </span>` : ''}
              ${att.hasAfternoon !== false ? `<span class="bg-orange-50 border border-orange-200 text-orange-800 px-3 py-1.5 rounded-lg text-sm font-bold flex items-center shadow-sm">
                <i data-lucide="sunset" class="w-4 h-4 mr-1.5"></i> ${sanitize(att.startAprem)} - ${sanitize(att.endAprem)}
              </span>` : ''}
              ${att.hasMorning === false && att.hasAfternoon === false ? '<span class="text-sm text-gray-400 italic">Pas de créneau</span>' : ''}
            </div>
          </div>
          ${weatherAlert}
          <div class="bg-[#F8FAFC] p-4 rounded-3xl">${stopsHtmlArr.join('')}</div>
        </div>`;
    }

    el.dailyPlansContainer.innerHTML = plansHtml;

    // --- Finalisation ---
    setProgress('Génération du document final...', 95);
    el.outputContainer.classList.remove('hidden');

    if (data.analysis) {
      el.analysisText.textContent = data.analysis; // textContent, pas innerHTML !
      el.analysisCard.classList.remove('hidden');
    }

    el.planCard.classList.remove('hidden');

    const statusOk = outOfBoundsCount === 0;
    el.mapStats.innerHTML = `<span class="${statusOk ? 'text-[#4ade80]' : 'text-amber-300'} flex items-center">
      <span class="mr-1">${statusOk ? '&#x2713;' : '&#x1F699;'}</span>
      ${statusOk ? 'Distances routières 100% OK' : 'Itinéraires de route calculés'}
    </span>`;

    if (data.attendance?.length > 0) {
      el.attendanceGrid.innerHTML = data.attendance.map(renderAttendanceHTML).join('');
      el.attendanceCard.classList.remove('hidden');
    }

    generatedData = data;
    lucide.createIcons();

    setTimeout(() => {
      el.mapContainer.classList.remove('hidden');

      setTimeout(() => {
        drawMap(data, originObj, radius);

        // Calcul Reach
        const baseReach = 350 + Math.floor(Math.random() * 200);
        let reach = Math.round(totalStops * baseReach * 1.1);
        if (officialPopulation && reach > officialPopulation * 0.8) {
          reach = Math.round(officialPopulation * (0.4 + Math.random() * 0.3));
        }
        const impressions = Math.round(reach * 3.5);

        el.estTotalStops.textContent = totalStops;
        el.estReach.textContent = formatNumber(reach);
        el.estImpressions.textContent = formatNumber(impressions);
        el.reachEstimationContainer.classList.remove('hidden');

        setProgress(false);
        el.outputContainer.scrollIntoView({ behavior: 'smooth' });
      }, 400);
    }, 100);

  } catch (e) {
    setProgress(false);
    showMessage('Interruption : ' + (e.message || 'Erreur'));
  }
}

// ========================================
// HORAIRES PAR JOUR (personnalisation)
// ========================================

/**
 * Génère dynamiquement les lignes de personnalisation par jour
 * dans le conteneur #perDayScheduleContainer.
 */
function rebuildPerDaySchedule() {
  const container = document.getElementById('perDayScheduleContainer');
  if (!container) return;

  const startDate = inputRefs.startDate?.value;
  const duration = parseInt(inputRefs.duration?.value) || 0;

  if (!startDate || duration < 1) {
    container.innerHTML = '<p class="text-xs text-gray-400 italic">Renseignez la date de début et la durée pour voir les jours.</p>';
    return;
  }

  const defaultMorn = inputRefs.morning?.value || '10:00 - 13:00';
  const defaultAft = inputRefs.afternoon?.value || '14:00 - 18:00';
  const startObj = new Date(startDate);

  let html = '';
  for (let i = 0; i < duration; i++) {
    const d = new Date(startObj);
    d.setDate(d.getDate() + i);
    const dayLabel = d.toLocaleDateString('fr-FR', { weekday: 'long', day: '2-digit', month: '2-digit' });

    html += `
      <div class="flex flex-col sm:flex-row items-start sm:items-center gap-2 p-2 rounded-lg bg-white border border-indigo-100">
        <span class="text-sm font-bold text-indigo-900 capitalize min-w-[140px]">${sanitize(dayLabel)}</span>
        <div class="flex flex-1 gap-2 flex-wrap">
          <div class="flex items-center gap-1">
            <i data-lucide="sun" class="w-3 h-3 text-amber-500 flex-shrink-0"></i>
            <input type="text" class="input-style text-xs py-1.5 px-2 w-[130px]"
                   id="perDay_morn_${i}" value="${sanitize(defaultMorn)}" placeholder="Vide = pas de matin" />
          </div>
          <div class="flex items-center gap-1">
            <i data-lucide="sunset" class="w-3 h-3 text-orange-500 flex-shrink-0"></i>
            <input type="text" class="input-style text-xs py-1.5 px-2 w-[130px]"
                   id="perDay_aft_${i}" value="${sanitize(defaultAft)}" placeholder="Vide = pas d'aprem" />
          </div>
        </div>
      </div>`;
  }

  container.innerHTML = html;
  lucide.createIcons();
}

/**
 * Récupère les horaires pour un jour donné (index).
 * Un champ vide = pas de session ce créneau (retourne null pour matin ou après-midi).
 */
function getTimesForDay(dayIndex) {
  const defaultMorn = parseTimes(inputRefs.morning?.value || '10:00 - 13:00');
  const defaultAft = parseTimes(inputRefs.afternoon?.value || '14:00 - 18:00');

  const mornInput = document.getElementById(`perDay_morn_${dayIndex}`);
  const aftInput = document.getElementById(`perDay_aft_${dayIndex}`);

  const mornRaw = mornInput ? mornInput.value.trim() : null;
  const aftRaw = aftInput ? aftInput.value.trim() : null;

  // Champ vide ou inexistant → pas de session
  const hasMorning = mornRaw !== null && mornRaw !== '';
  const hasAfternoon = aftRaw !== null && aftRaw !== '';

  const morn = hasMorning ? parseTimes(mornRaw) : null;
  const aft = hasAfternoon ? parseTimes(aftRaw) : null;

  return {
    hasMorning,
    hasAfternoon,
    mornStart: morn?.start || (hasMorning ? defaultMorn.start : null),
    mornEnd: morn?.end || (hasMorning ? defaultMorn.end : null),
    aftStart: aft?.start || (hasAfternoon ? defaultAft.start : null),
    aftEnd: aft?.end || (hasAfternoon ? defaultAft.end : null),
  };
}

// ========================================
// INITIALISATION
// ========================================

document.addEventListener('DOMContentLoaded', () => {
  lucide.createIcons();
  initDomRefs();
  loadSavedKeys();
  setupValidationButtons();

  // Date par défaut = demain
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  inputRefs.startDate.valueAsDate = tomorrow;

  // Régénérer les lignes par jour quand date/durée/horaires changent
  const triggerFields = ['campaignStartDate', 'campaignDuration', 'timeMorning', 'timeAfternoon'];
  triggerFields.forEach(id => {
    const field = document.getElementById(id);
    if (field) field.addEventListener('change', rebuildPerDaySchedule);
  });
  rebuildPerDaySchedule();

  // Événements
  el.btn.addEventListener('click', handleGenerate);
  document.getElementById('downloadKmlBtn').addEventListener('click', () => generateKML(generatedData));
  document.getElementById('downloadCsvBtn').addEventListener('click', () => generateCSV(generatedData, inputRefs.brand.value));
  document.getElementById('downloadPdfBtn').addEventListener('click', () => generateFullPDF(generatedData, inputRefs));
});
