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
  inputRefs.ownBrand = document.getElementById('ownBrand');
  inputRefs.priorityCities = document.getElementById('priorityCities');
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
// REGISTRE DES ARRÊTS (pour édition inline)
// ========================================
const stopRegistry = {};
let _stopCounter = 0;

// ========================================
// RENDU HTML SÉCURISÉ D'UN ARRÊT
// ========================================

function renderStopHTML(stop, distBadge) {
  const stopId = `stop_${_stopCounter++}`;
  stopRegistry[stopId] = { ...stop };

  // Adresse en gras (repère principal), nom du commerce en secondaire
  const street = stop.address?.split(',')[0]?.trim() || stop.address || '';
  const city   = stop.address?.split(',').slice(1).join(',').trim() || '';

  return `
    <div class="stop-card flex items-center p-5 bg-white rounded-2xl border border-gray-200 shadow-sm mb-4" data-stop-id="${stopId}">
      <div class="w-20 font-extrabold text-2xl text-[#0E2C59] tracking-tight flex-shrink-0">${sanitize(stop.time)}</div>
      <div class="flex-1 min-w-0 border-l-2 border-gray-100 pl-5">

        <!-- Vue normale -->
        <div class="stop-view">
          <div class="flex items-center flex-wrap gap-2">
            ${getTypeIconHTML(stop.type)}
            <span class="font-extrabold text-gray-900 text-lg">${sanitize(street)}</span>
            ${distBadge}
            <button onclick="editStop('${stopId}')"
              class="ml-auto text-gray-300 hover:text-blue-500 transition-colors p-1 rounded"
              title="Modifier cet arrêt">
              <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24"
                fill="none" stroke="currentColor" stroke-width="2.5">
                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
              </svg>
            </button>
          </div>
          <div class="text-sm text-gray-500 mt-1.5 flex items-center flex-wrap gap-x-2">
            <span class="text-gray-400 text-xs">Repère visuel :</span>
            <span class="font-medium text-gray-700">${sanitize(stop.locationName)}</span>
            ${city ? `<span class="text-gray-400">${sanitize(city)}</span>` : ''}
            <span class="text-[10px] text-gray-300 uppercase tracking-widest border-l border-gray-200 pl-2 ml-1">
              SRC: ${sanitize(stop.source)}
            </span>
          </div>
        </div>

        <!-- Mode édition (caché par défaut) -->
        <div class="stop-edit hidden">
          <div class="flex flex-wrap gap-2 mt-1">
            <input type="text" id="edit-addr-${stopId}"
              class="input-style text-sm flex-1 min-w-[200px]"
              placeholder="Adresse complète" value="${sanitize(stop.address)}" />
            <input type="text" id="edit-name-${stopId}"
              class="input-style text-sm flex-1 min-w-[150px]"
              placeholder="Repère visuel (nom)" value="${sanitize(stop.locationName)}" />
            <button onclick="saveStop('${stopId}')"
              id="save-btn-${stopId}"
              class="bg-blue-600 text-white text-xs font-bold px-3 py-2 rounded-lg hover:bg-blue-700 whitespace-nowrap">
              ✓ Valider
            </button>
            <button onclick="cancelEditStop('${stopId}')"
              class="bg-gray-100 text-gray-600 text-xs font-bold px-3 py-2 rounded-lg hover:bg-gray-200">
              Annuler
            </button>
          </div>
          <p class="text-[11px] text-blue-500 mt-1">L'adresse sera vérifiée et la distance recalculée via BAN.</p>
        </div>

      </div>
    </div>`;
}

function editStop(stopId) {
  const card = document.querySelector(`[data-stop-id="${stopId}"]`);
  card?.querySelector('.stop-view')?.classList.add('hidden');
  card?.querySelector('.stop-edit')?.classList.remove('hidden');
  card?.querySelector(`#edit-addr-${stopId}`)?.focus();
}

function cancelEditStop(stopId) {
  const card = document.querySelector(`[data-stop-id="${stopId}"]`);
  card?.querySelector('.stop-view')?.classList.remove('hidden');
  card?.querySelector('.stop-edit')?.classList.add('hidden');
}

async function saveStop(stopId) {
  const card  = document.querySelector(`[data-stop-id="${stopId}"]`);
  const addrEl = document.getElementById(`edit-addr-${stopId}`);
  const nameEl = document.getElementById(`edit-name-${stopId}`);
  const btn    = document.getElementById(`save-btn-${stopId}`);
  if (!addrEl) return;

  const newAddr = addrEl.value.trim();
  const newName = (nameEl?.value || '').trim();
  if (!newAddr) return;

  if (btn) { btn.textContent = '⏳'; btn.disabled = true; }

  try {
    const stop = stopRegistry[stopId];
    const geoResult = await geocodeAddressBAN(newAddr);

    if (geoResult?.lat) {
      stop.lat = geoResult.lat;
      stop.lng = geoResult.lng;
      stop.address = geoResult.label || newAddr;
    } else {
      stop.address = newAddr;
    }
    if (newName) stop.locationName = newName;
    stop.source = 'MANUEL';

    // Recalculer distance
    let distBadge = '';
    const shopLoc = window._shopLocation;
    if (shopLoc && stop.lat && stop.lng) {
      const dist = calculateDistance(shopLoc.lat, shopLoc.lng, stop.lat, stop.lng);
      const cls  = dist <= 5 ? 'text-green-600' : dist <= 15 ? 'text-orange-500' : 'text-red-500';
      distBadge  = `<span class="${cls} font-bold text-sm ml-1">✓ ${dist.toFixed(1)}km</span>`;
    }

    const street = stop.address.split(',')[0]?.trim() || stop.address;
    const city   = stop.address.split(',').slice(1).join(',').trim() || '';

    const viewDiv = card?.querySelector('.stop-view');
    if (viewDiv) {
      viewDiv.innerHTML = `
        <div class="flex items-center flex-wrap gap-2">
          ${getTypeIconHTML(stop.type)}
          <span class="font-extrabold text-gray-900 text-lg">${sanitize(street)}</span>
          ${distBadge}
          <button onclick="editStop('${stopId}')"
            class="ml-auto text-gray-300 hover:text-blue-500 transition-colors p-1 rounded">
            <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24"
              fill="none" stroke="currentColor" stroke-width="2.5">
              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
              <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
            </svg>
          </button>
        </div>
        <div class="text-sm text-gray-500 mt-1.5 flex items-center flex-wrap gap-x-2">
          <span class="text-gray-400 text-xs">Repère visuel :</span>
          <span class="font-medium text-gray-700">${sanitize(stop.locationName)}</span>
          ${city ? `<span class="text-gray-400">${sanitize(city)}</span>` : ''}
          <span class="text-[10px] text-gray-300 uppercase tracking-widest border-l border-gray-200 pl-2 ml-1">SRC: MANUEL</span>
        </div>`;
    }

    cancelEditStop(stopId);
    lucide.createIcons(); // Rafraîchir les icônes Lucide après mise à jour du DOM
  } catch (err) {
    console.error('[saveStop]', err);
    if (btn) { btn.textContent = '✓ Valider'; btn.disabled = false; }
  }
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

function enforceSchoolRules(dailyPlans, datesISO = [], schoolHolidays = []) {
  dailyPlans.forEach((dayPlan, idx) => {
    const dayStr = (dayPlan.day || '').toLowerCase();
    const isWeekSchoolDay = /lundi|mardi|jeudi|vendredi/.test(dayStr);

    // Vérifier si c'est une période de vacances scolaires
    const dateISO = datesISO[idx] || '';
    const isHoliday = dateISO ? isSchoolHoliday(dateISO, schoolHolidays) : false;
    const isSchoolDay = isWeekSchoolDay && !isHoliday;

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
// EXTRACTION DATE ISO DEPUIS CHAÎNE FR
// ========================================

/**
 * Extrait la date ISO (YYYY-MM-DD) d'une chaîne comme "mercredi 29/04/2026".
 */
function extractISOFromFrDate(str) {
  const m = (str || '').match(/(\d{2})\/(\d{2})\/(\d{4})/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : '';
}

// ========================================
// REDISTRIBUTION DES ARRÊTS SUR UNE PLAGE
// ========================================

/**
 * Recale les horaires des arrêts pour couvrir toute la plage.
 * Préserve les arrêts école (11:15 / 16:15) à leur position.
 */
function redistributeStops(stops, startTime, endTime) {
  const toMin = t => { const [h, m] = t.split(':').map(Number); return h * 60 + (m || 0); };
  const toStr = m => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

  const startMin = toMin(startTime);
  const endMin = toMin(endTime);
  if (endMin <= startMin || stops.length === 0) return;

  const interval = (endMin - startMin) / stops.length;

  stops.forEach((stop, i) => {
    // Ne pas déplacer les arrêts école (horaires imposés)
    if (stop.type === 'school') return;
    const proposed = Math.round(startMin + i * interval);
    stop.time = toStr(Math.min(proposed, endMin - 15));
  });

  // Trier par horaire après redistribution
  stops.sort((a, b) => toMin(a.time) - toMin(b.time));
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

    // --- Météo + Vacances scolaires (APIs gratuites) ---
    setProgress('Prévisions météo & calendrier scolaire...', 22);
    const endDateObj = new Date(startDateObj);
    endDateObj.setDate(endDateObj.getDate() + duration - 1);
    const [weatherForecast, schoolHolidays] = await Promise.all([
      fetchWeatherForecast(originObj.lat, originObj.lng, startDateObj, duration),
      fetchSchoolHolidays(startDateObj, endDateObj),
    ]);

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
        let compValue = parsed.competitors;
        // L'IA peut retourner un tableau d'objets ou de chaînes — normaliser en string CSV
        if (Array.isArray(compValue)) {
          compValue = compValue.map(c => (typeof c === 'object' ? c.name || c.brand || '' : c)).filter(Boolean).join(', ');
        }
        if (compValue && typeof compValue === 'string' && !/vide|inconnu/i.test(compValue)) {
          inputRefs.competitors.value = compValue;
        }
      } catch { /* non-blocking */ }
    }

    // --- POIs OSM ---
    const radius = parseFloat(inputRefs.radius.value) || 10;
    setProgress(`Scan topographique à ${radius}km...`, 45);
    const realPOIsRaw = await fetchRealPOIs(originObj.lat, originObj.lng, radius);
    const targetCity = originObj.city || inputRefs.address.value.split(',')[0].trim();

    console.log(`[POI] ${realPOIsRaw.length} points d'intérêt trouvés dans la zone (rayon ${radius}km).`);

    // --- Filtrage exclusions ---
    const excludedList = inputRefs.excludedCities.value.trim().toLowerCase()
      .split(',').map(c => c.trim()).filter(Boolean);

    // Enseigne propre : liste des mots-clés (ex: "Marie Blachère" → ["marie blachère"])
    const ownBrandRaw = (inputRefs.ownBrand?.value || '').trim();
    const ownBrandList = ownBrandRaw.toLowerCase()
      .split(',').map(c => c.trim()).filter(Boolean);

    // Auto-détection : trouver nos propres magasins dans les POIs de la zone
    // et ajouter automatiquement leurs villes aux barrières
    if (ownBrandList.length > 0) {
      const ownStoresFound = realPOIsRaw.filter(poi =>
        ownBrandList.some(b => poi.name.toLowerCase().includes(b))
      );
      if (ownStoresFound.length > 0) {
        const newCities = [];
        ownStoresFound.forEach(store => {
          // Extraire la ville de l'adresse : dernier segment après la virgule
          const cityMatch = store.address.match(/,\s*([^,]+)$/);
          const city = cityMatch?.[1]?.trim().toLowerCase();
          if (city && !excludedList.includes(city)) {
            excludedList.push(city);
            newCities.push(city);
          }
        });
        if (newCities.length > 0) {
          // Mettre à jour le champ Barrières visuellement
          const currentVal = inputRefs.excludedCities.value.trim();
          inputRefs.excludedCities.value = [currentVal, ...newCities]
            .filter(Boolean).join(', ');
          showMessage(`Barrières auto-ajoutées (notre enseigne) : ${newCities.join(', ')}`, 'info');
        }
      }
    }

    // Géocoder les villes exclues → coordonnées GPS pour blocage précis
    // (certains POIs OSM n'ont pas addr:city → le blocage texte seul est insuffisant)
    const excludedCityCoords = [];
    for (const ex of excludedList) {
      try {
        const r = await fetch(
          `https://api-adresse.data.gouv.fr/search/?q=${encodeURIComponent(ex)}&type=municipality&limit=1`
        );
        const d = await r.json();
        if (d.features?.[0]) {
          const [lng, lat] = d.features[0].geometry.coordinates;
          excludedCityCoords.push({ name: ex, lat, lng });
        }
      } catch { /* continuer sans coords */ }
    }

    // Helper : un lieu est-il interdit ? (texte OU coordonnées dans rayon 3km)
    const isBlocked = (name = '', address = '', lat = null, lng = null) => {
      const nameLow = name.toLowerCase();
      const addrLow = address.toLowerCase();
      // Blocage par texte
      if (excludedList.some(ex => ex && (addrLow.includes(ex) || nameLow.includes(ex)))) return true;
      // Blocage par coordonnées GPS (fiable quand addr:city manque dans OSM)
      if (lat && lng && excludedCityCoords.some(ec =>
        calculateDistance(lat, lng, ec.lat, ec.lng) <= 3
      )) return true;
      // Notre enseigne : blocage par nom (mots-clés)
      if (ownBrandList.some(b => b && nameLow.includes(b))) return true;
      return false;
    };

    let filteredPOIs = realPOIsRaw.filter(poi =>
      !isBlocked(poi.name, poi.address, poi.lat, poi.lng)
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
            if (dist <= radius && !isBlocked(sData.name, sData.address, sData.lat, sData.lng)) {
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

    // --- Villes / quartiers prioritaires ---
    const priorityList = (inputRefs.priorityCities?.value || '').trim().toLowerCase()
      .split(',').map(c => c.trim()).filter(Boolean);

    // --- Tri POIs : prioritaires d'abord, puis marchés, puis local, puis distance ---
    filteredPOIs.sort((a, b) => {
      const aAddr = a.address.toLowerCase();
      const bAddr = b.address.toLowerCase();
      const aPriority = priorityList.length > 0 && priorityList.some(p => aAddr.includes(p) || a.name.toLowerCase().includes(p));
      const bPriority = priorityList.length > 0 && priorityList.some(p => bAddr.includes(p) || b.name.toLowerCase().includes(p));
      if (aPriority && !bPriority) return -1;
      if (!aPriority && bPriority) return 1;
      if (a.type === 'market' && b.type !== 'market') return -1;
      if (b.type === 'market' && a.type !== 'market') return 1;
      const aLocal = aAddr.includes(targetCity.toLowerCase()) && parseFloat(a.distance) <= 2.0;
      const bLocal = bAddr.includes(targetCity.toLowerCase()) && parseFloat(b.distance) <= 2.0;
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

    // Jours de marché vérifiés via OSM opening_hours
    const marketPOIs = filteredPOIs.filter(p => p.type === 'market');
    if (marketPOIs.length > 0) {
      const marketLines = marketPOIs.map(m =>
        `${m.name} (${m.address}) → ouvert : ${m.marketDays.length ? m.marketDays.join(', ') : 'mercredi, samedi'}`
      ).join('\n');
      poiContext += `\nMARCHÉS FORAINS VÉRIFIÉS (jours réels OSM) :\n${marketLines}\n`;
      poiContext += `RÈGLE ABSOLUE : ne placer un marché QUE sur les jours indiqués ci-dessus.\n`;
    }

    let competitorInstruction = preVerifiedCompetitors.length > 0
      ? 'CONCURRENTS: Inclus au moins 1-2 par jour tirés de la BASE CONCURRENTS CERTIFIÉS.'
      : 'CONCURRENTS: Aucun trouvé dans le périmètre.';

    const exclusionInstruction = [
      priorityList.length > 0
        ? `ZONES PRIORITAIRES : place OBLIGATOIREMENT au moins 30% des arrêts dans ou autour de : ${priorityList.join(', ').toUpperCase()}. Ces zones doivent apparaître chaque journée.`
        : '',
      excludedList.length > 0
        ? `INTERDICTION ABSOLUE : aucun arrêt dans ${excludedList.join(', ').toUpperCase()} ni dans aucune adresse contenant ces noms.`
        : 'Ne traverse PAS les fleuves majeurs.',
      ownBrandList.length > 0
        ? `NOTRE ENSEIGNE À ÉVITER : ne jamais planifier d'arrêt chez ${ownBrandList.join(', ').toUpperCase()} (notre propre réseau, risque de cannibalisation).`
        : '',
    ].filter(Boolean).join(' ');

    // --- Horaires par jour (personnalisés ou par défaut) ---
    const perDayTimes = [];
    let perDayTimesPrompt = '';
    for (let i = 0; i < duration; i++) {
      const t = getTimesForDay(i);
      perDayTimes.push(t);

      const isHoliday = isSchoolHoliday(datesISO[i], schoolHolidays);
      const mornLabel = t.hasMorning ? `Matin ${t.mornStart}-${t.mornEnd}` : 'PAS DE MATIN (0 arrêts)';
      const aftLabel = t.hasAfternoon ? `Aprem ${t.aftStart}-${t.aftEnd}` : 'PAS D\'APRÈS-MIDI (0 arrêts)';
      const holidayTag = isHoliday ? ' [VACANCES SCOLAIRES - PAS D\'ÉCOLE]' : '';
      perDayTimesPrompt += `  - ${datesList[i]} : ${mornLabel}, ${aftLabel}${holidayTag}\n`;
    }

    setProgress('Analyse IA Stratégique...', 60);
    el.displayBrand.textContent = officialBrand;
    el.dateSpan.textContent = new Date().toLocaleDateString('fr-FR');

    // Construire info vacances scolaires pour le prompt
    const holidayInfo = schoolHolidays.length > 0
      ? `VACANCES SCOLAIRES en cours : ${schoolHolidays.map(h => h.description || `${h.start} au ${h.end}`).join(', ')}. Les jours marqués [VACANCES SCOLAIRES] ne doivent avoir AUCUN arrêt école.`
      : '';

    const systemInstruction = `Tu es un expert en géomarketing. Renvoie UNIQUEMENT du JSON pur.
RAYON MAX: ${radius} km autour de (${originObj.lat}, ${originObj.lng}).
${exclusionInstruction}
STRATÉGIE CARDINALE: Attribue à chaque jour une direction dominante (Nord, Sud, Est, Ouest).
PROXIMITÉ: 60% des arrêts dans "${targetCity}" à moins de 2.0 km.
JOURS: Tu DOIS générer EXACTEMENT ${duration} entrées dans dailyPlans, une par jour, dans l'ordre chronologique. Même les jours sans créneau doivent avoir une entrée avec "stops":[] vide.
HORAIRES: EXACTEMENT 4 arrêts par créneau actif. ATTENTION : chaque jour peut avoir des horaires DIFFÉRENTS. Si un créneau indique "PAS DE MATIN" ou "PAS D'APRÈS-MIDI", génère ZÉRO arrêt pour ce créneau.
RÉPARTITION HORAIRE: Les 4 arrêts doivent être RÉPARTIS sur TOUTE la plage horaire du créneau. Par ex. pour 10:00-13:00 → arrêts vers 10:00, 10:45, 11:30, 12:15. Pour 14:00-18:00 → arrêts vers 14:00, 15:15, 16:30, 17:15. Ne PAS concentrer tous les arrêts au début.
DIVERSITÉ: Mélanger transport, shopping, school, competitor, sport, culture, park, medical. Max 2 du même type d'affilée.
MARCHÉS: Les arrêts type "market" se planifient UNIQUEMENT les mercredis et samedis matin (jours de marché traditionnels en France), à partir de 10h00. Ne jamais placer un marché un mardi, lundi, jeudi ou vendredi.
CENTRES COMMERCIAUX: Les arrêts type "shopping" se planifient entre 12h00 et 14h00 les mercredis après-midi et samedis après-midi (pic d'affluence pause déjeuner et week-end).
ÉCOLES: EXCLUSIVEMENT Lundi, Mardi, Jeudi, Vendredi HORS vacances scolaires. Horaires imposés : matin "11:15" (sortie 11h15-11h30), après-midi "16:15" (sortie 16h15-16h30). ${holidayInfo}
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
    window._shopLocation = data.shopLocation; // exposé pour l'édition inline des arrêts

    // --- Normalisation : exactement 1 entrée par date, dans l'ordre ---
    // L'IA peut sauter des jours, en dupliquer, ou les mettre dans le désordre.
    // On force le mapping par DATE, pas par index.
    const plansByISO = {};
    (data.dailyPlans || []).forEach(dp => {
      const iso = extractISOFromFrDate(dp.day || '');
      if (iso && !plansByISO[iso]) {
        plansByISO[iso] = dp;
      } else if (iso && plansByISO[iso]) {
        // Doublon : fusionner les stops
        plansByISO[iso].stops = [...(plansByISO[iso].stops || []), ...(dp.stops || [])];
      }
    });

    data.dailyPlans = datesISO.map((iso, i) => {
      return plansByISO[iso] || { day: datesList[i], role: 'VÉHICULE', stops: [] };
    });

    // --- Garde-fou : forcer la répartition matin/aprem ---
    // Maintenant l'index est fiable (1:1 avec perDayTimes).
    // Si l'IA n'a pas fourni assez d'arrêts, on crée des placeholders
    // que la validation topographique remplira avec de vrais POIs.
    const STOPS_PER_SLOT = 4;
    const makePlaceholder = () => ({
      time: '00:00', locationName: '', address: '', type: 'other',
      source: '', lat: 0, lng: 0,
    });

    data.dailyPlans.forEach((dayPlan, idx) => {
      const t = perDayTimes[idx];
      if (!t) return;
      dayPlan.stops = dayPlan.stops || [];

      const allStops = dayPlan.stops;

      if (t.hasMorning && t.hasAfternoon) {
        const needed = STOPS_PER_SLOT * 2;
        // Compléter si pas assez d'arrêts
        while (allStops.length < needed) allStops.push(makePlaceholder());
        const mornStops = allStops.slice(0, STOPS_PER_SLOT);
        const aftStops = allStops.slice(STOPS_PER_SLOT, needed);
        redistributeStops(mornStops, t.mornStart, t.mornEnd);
        redistributeStops(aftStops, t.aftStart, t.aftEnd);
        dayPlan.stops = [...mornStops, ...aftStops];
      } else if (t.hasMorning) {
        while (allStops.length < STOPS_PER_SLOT) allStops.push(makePlaceholder());
        const mornStops = allStops.slice(0, STOPS_PER_SLOT);
        redistributeStops(mornStops, t.mornStart, t.mornEnd);
        dayPlan.stops = mornStops;
      } else if (t.hasAfternoon) {
        while (allStops.length < STOPS_PER_SLOT) allStops.push(makePlaceholder());
        const aftStops = allStops.slice(0, STOPS_PER_SLOT);
        redistributeStops(aftStops, t.aftStart, t.aftEnd);
        dayPlan.stops = aftStops;
      } else {
        dayPlan.stops = [];
      }
    });

    // --- Garde-fou écoles (1er passage) ---
    enforceSchoolRules(data.dailyPlans, datesISO, schoolHolidays);

    // --- Validation topographique des arrêts ---
    setProgress('Génération des tracés réels...', 75);

    // Trier les POIs par fiabilité décroissante (transport > médical > commerce > ...)
    const availablePOIs = [...filteredPOIs, ...preVerifiedCompetitors]
      .sort((a, b) => (b.reliability || 1) - (a.reliability || 1));

    const defaultComps = ['aldi', 'lidl', 'carrefour', 'store', 'brico', 'castorama', 'leroy'];
    const userCompsList = userCompetitors ? userCompetitors.split(',').map(s => s.trim().toLowerCase()) : [];
    const allCompsToCheck = [...defaultComps, ...userCompsList];

    // Préférer les types utiles pour le chauffeur (commerces, transports)
    const USEFUL_TYPES = ['market', 'shopping', 'transport', 'competitor', 'sport', 'culture', 'medical'];

    // Compteur global d'utilisations — max 2 fois par POI sur toute la campagne
    const MAX_POI_USES = 2;
    const poiUseCount = new Map(); // name → nb d'utilisations
    const canUse = (name) => (poiUseCount.get(name) || 0) < MAX_POI_USES;
    const markUsed = (name) => poiUseCount.set(name, (poiUseCount.get(name) || 0) + 1);

    for (const day of data.dailyPlans) {
      if (!day.stops) continue;
      const dayStr = (day.day || '').toLowerCase();
      const isSchoolDay = /lundi|mardi|jeudi|vendredi/.test(dayStr);

      // Set des POIs déjà utilisés CE JOUR (évite doublons dans la même journée)
      const usedThisDay = new Set();

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
            return canUse(p.name) && !usedThisDay.has(p.name) && (
              (aiName.length > 2 && (aiName.includes(pName) || pName.includes(aiName))) ||
              (stop.address && stop.address.toLowerCase().includes(p.address.toLowerCase()))
            );
          });
          if (idx !== -1) {
            const real = availablePOIs[idx];
            Object.assign(stop, {
              locationName: real.name, address: real.address,
              lat: real.lat, lng: real.lng, type: real.type, source: 'OSM',
              marketDays: real.marketDays || [],
            });
            usedThisDay.add(real.name);
            markUsed(real.name);
            isLegit = true;
          }
        }

        // Fallback intelligent — privilégier transport et commerces fiables
        if (!isLegit && availablePOIs.length > 0) {
          const findFallback = (filter) => availablePOIs.findIndex(p =>
            filter(p) && (isSchoolDay || p.type !== 'school')
          );

          const inPriority = (p) => priorityList.length > 0 && priorityList.some(pr =>
            p.address.toLowerCase().includes(pr) || p.name.toLowerCase().includes(pr)
          );

          // 0. Zone prioritaire + type utile — en tête absolue
          let idx = priorityList.length > 0
            ? findFallback(p => inPriority(p) && USEFUL_TYPES.includes(p.type) && canUse(p.name) && !usedThisDay.has(p.name))
            : -1;
          // 1. Transport public (arrêt bus/tram/gare) — toujours trouvable
          if (idx === -1) idx = findFallback(p => p.type === 'transport' && canUse(p.name) && !usedThisDay.has(p.name));
          // 2. Même type, même ville, quota non atteint
          if (idx === -1) idx = findFallback(p => p.type === stop.type && p.address.toLowerCase().includes(targetCity.toLowerCase()) && canUse(p.name) && !usedThisDay.has(p.name));
          // 3. Type utile, même ville, quota non atteint
          if (idx === -1) idx = findFallback(p => USEFUL_TYPES.includes(p.type) && p.address.toLowerCase().includes(targetCity.toLowerCase()) && canUse(p.name) && !usedThisDay.has(p.name));
          // 4. Type utile, quota non atteint
          if (idx === -1) idx = findFallback(p => USEFUL_TYPES.includes(p.type) && canUse(p.name) && !usedThisDay.has(p.name));
          // 5. N'importe quel POI non utilisé ce jour, quota non atteint
          if (idx === -1) idx = findFallback(p => canUse(p.name) && !usedThisDay.has(p.name));
          // 6. Réutilisation au-delà du quota (max 2x déjà atteint) — dernier recours avant geocoding random
          if (idx === -1) idx = findFallback(p => USEFUL_TYPES.includes(p.type) && !usedThisDay.has(p.name));
          if (idx === -1) idx = findFallback(p => !usedThisDay.has(p.name));
          if (idx === -1) idx = findFallback(() => true);

          if (idx !== -1) {
            const fb = availablePOIs[idx];
            Object.assign(stop, {
              locationName: fb.name, address: fb.address,
              lat: fb.lat, lng: fb.lng, type: fb.type,
              source: 'CORRECTION (Base OSM)',
              marketDays: fb.marketDays || [],
            });
            usedThisDay.add(fb.name);
            markUsed(fb.name);
            isLegit = true;
          }
        }

        // Dernier recours — UNIQUEMENT si aucun POI du tout
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
            // Extraire le nom de rue comme nom de lieu (ex: "Rue du Général de Gaulle")
            const streetName = validStreet.split(',')[0].replace(/^\d+\s*/, '').trim();
            stop.type = 'shopping';
            stop.locationName = streetName || 'Rue commerçante';
            stop.address = validStreet;
          } else {
            stop.type = 'other';
            stop.locationName = 'Centre-ville';
            stop.address = originObj.display_name;
          }
          stop.source = 'GÉOLOCALISATION';
        }

        // Reverse geocode systématique si pas de vraie adresse postale
        // Une vraie adresse contient un numéro de rue OU une virgule (nom, ville)
        const hasRealAddress = stop.address
          && stop.address !== stop.locationName
          && /\d/.test(stop.address)
          && stop.address.includes(',');
        if (!hasRealAddress && stop.lat && stop.lng) {
          const realAddr = await reverseGeocodeBAN(stop.lat, stop.lng);
          if (realAddr) stop.address = realAddr;
        }
      }
    }

    // --- ENFORCEMENT ZONES PRIORITAIRES : 30% minimum par journée ---
    // L'IA peut ignorer les instructions → on force en post-processing
    if (priorityList.length > 0) {
      // POIs situés dans les zones prioritaires (adresse ou nom contient le mot-clé)
      const inPriorityZone = (name = '', address = '') =>
        priorityList.some(pr => address.toLowerCase().includes(pr) || name.toLowerCase().includes(pr));

      const priorityPOIs = filteredPOIs.filter(p => inPriorityZone(p.name, p.address));

      for (const day of data.dailyPlans) {
        if (!day.stops || day.stops.length === 0) continue;

        const total = day.stops.length;
        const targetCount = Math.ceil(total * 0.30); // 30% minimum
        const currentCount = day.stops.filter(s => inPriorityZone(s.locationName, s.address)).length;
        const deficit = targetCount - currentCount;

        if (deficit <= 0) continue; // Quota déjà atteint

        // POIs prioritaires non encore utilisés ce jour
        const usedNames = new Set(day.stops.map(s => s.locationName));
        const candidates = priorityPOIs.filter(p => !usedNames.has(p.name));

        // Remplacer des stops non-prioritaires (jamais les concurrents) par des POIs prioritaires
        let replaced = 0;
        for (let i = day.stops.length - 1; i >= 0 && replaced < deficit && replaced < candidates.length; i--) {
          const stop = day.stops[i];
          if (inPriorityZone(stop.locationName, stop.address)) continue; // déjà prioritaire
          if (stop.type === 'competitor') continue; // ne jamais toucher les concurrents
          const poi = candidates[replaced];
          const savedTime = stop.time;
          Object.assign(stop, {
            locationName: poi.name,
            address: poi.address,
            lat: poi.lat,
            lng: poi.lng,
            type: poi.type,
            source: 'ZONE PRIORITAIRE',
            marketDays: poi.marketDays || [],
          });
          stop.time = savedTime; // conserver le créneau horaire
          replaced++;
        }

        if (replaced > 0) {
          console.log(`[Priorité] ${day.day} : ${replaced} arrêt(s) replacé(s) dans ${priorityList.join(', ')}`);
        }
      }
    }

    // --- SMART SCHEDULING : marchés selon jours OSM, centres commerciaux aprem mer/sam ---
    const FR_DAYS = ['lundi','mardi','mercredi','jeudi','vendredi','samedi','dimanche'];

    for (const day of data.dailyPlans) {
      if (!day.stops || day.stops.length === 0) continue;
      const dayStr = (day.day || '').toLowerCase();
      // Extraire le nom du jour en français depuis la chaîne (ex: "mercredi 29/04/2026")
      const dayFr = FR_DAYS.find(d => dayStr.includes(d)) || '';
      const isWedOrSat = dayFr === 'mercredi' || dayFr === 'samedi';

      const toMin = t => { const [h, m] = (t || '0:0').split(':').map(Number); return h * 60 + (m || 0); };
      const morning   = day.stops.filter(s => toMin(s.time) < 14 * 60);
      const afternoon = day.stops.filter(s => toMin(s.time) >= 14 * 60);

      // Valider les marchés : vérifier que le jour courant est dans marketDays (données OSM réelles)
      // Si un marché est placé le mauvais jour → downgrade en shopping
      day.stops.forEach(s => {
        if (s.type !== 'market') return;
        const validDays = s.marketDays?.length ? s.marketDays : ['mercredi', 'samedi'];
        if (dayFr && !validDays.includes(dayFr)) {
          console.log(`[Market] ${s.locationName} invalidé pour ${dayFr} (ouvert : ${validDays.join(', ')})`);
          s.type = 'shopping'; // mauvais jour → dégradé
        }
      });

      // Matin mer/sam : marchés valides en premier (heure la plus tôt du créneau)
      if (isWedOrSat) {
        morning.sort((a, b) => {
          const aM = a.type === 'market'; const bM = b.type === 'market';
          return aM === bM ? 0 : aM ? -1 : 1;
        });
      }

      // Après-midi mer/sam : centres commerciaux et concurrents en premier (créneau 12h-14h)
      if (isWedOrSat) {
        afternoon.sort((a, b) => {
          const aS = ['shopping', 'competitor'].includes(a.type);
          const bS = ['shopping', 'competitor'].includes(b.type);
          return aS === bS ? 0 : aS ? -1 : 1;
        });
      }

      // Réappliquer les temps dans le nouvel ordre
      const mornTimes = morning.map(s => s.time);
      const aftTimes  = afternoon.map(s => s.time);
      morning.forEach((s, i)   => { s.time = mornTimes[i]; });
      afternoon.forEach((s, i) => { s.time = aftTimes[i]; });
      day.stops = [...morning, ...afternoon];
    }

    // --- FILTRE FINAL GARANTI : barrières + enseigne propre + limite chaîne ---
    // Ce filtre est la dernière ligne de défense, appliqué APRÈS toute validation IA ou geocoding
    for (const day of data.dailyPlans) {
      if (!day.stops) continue;

      const chainCountThisDay = {}; // nb de visites par chaîne (ex: "marie blachere" → 1)

      day.stops = day.stops.filter(stop => {
        // Blocage combiné texte + GPS : le plus robuste
        if (isBlocked(stop.locationName || '', stop.address || '', stop.lat, stop.lng)) return false;

        // Limite : max 2 visites de la même chaîne par jour
        const chainKey = (stop.locationName || '').toLowerCase()
          .replace(/[^a-zàâéèêëïîôùûü ]/gi, '').trim()
          .split(/\s+/).slice(0, 2).join(' ');
        if (chainKey.length > 3) {
          chainCountThisDay[chainKey] = (chainCountThisDay[chainKey] || 0) + 1;
          if (chainCountThisDay[chainKey] > 2) return false;
        }

        return true;
      });
    }

    // --- Garde-fou écoles (2e passage post-topographie) ---
    enforceSchoolRules(data.dailyPlans, datesISO, schoolHolidays);

    // --- Rendu HTML sécurisé ---
    setProgress('Calcul itinéraire routier (OSRM)...', 85);

    let plansHtml = '';
    let outOfBoundsCount = 0;
    let totalStops = 0;

    for (let idx = 0; idx < data.dailyPlans.length; idx++) {
      const day = data.dailyPlans[idx];
      const fallbackTimes = perDayTimes[idx] || perDayTimes[0];
      const att = data.attendance[idx] || { hasMorning: fallbackTimes.hasMorning, hasAfternoon: fallbackTimes.hasAfternoon, startMatin: fallbackTimes.mornStart, endMatin: fallbackTimes.mornEnd, startAprem: fallbackTimes.aftStart, endAprem: fallbackTimes.aftEnd };

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
// Mémorisation des défauts précédents pour la mise à jour intelligente
let _prevDefaultMorn = '';
let _prevDefaultAft = '';

function rebuildPerDaySchedule() {
  const container = document.getElementById('perDayScheduleContainer');
  if (!container) return;

  const startDate = inputRefs.startDate?.value;
  const duration = parseInt(inputRefs.duration?.value) || 0;

  if (!startDate || duration < 1) {
    container.innerHTML = '<p class="text-xs text-gray-400 italic">Renseignez la date de début et la durée pour voir les jours.</p>';
    return;
  }

  const newDefaultMorn = inputRefs.morning?.value || '10:00 - 13:00';
  const newDefaultAft = inputRefs.afternoon?.value || '14:00 - 18:00';

  // Sauvegarder les valeurs existantes AVANT de reconstruire
  const saved = {};
  for (let i = 0; i < 31; i++) {
    const m = document.getElementById(`perDay_morn_${i}`);
    const a = document.getElementById(`perDay_aft_${i}`);
    if (m !== null) {
      // Si la valeur est l'ANCIEN défaut → on la met à jour avec le NOUVEAU défaut
      // Si la valeur est une perso → on la conserve telle quelle
      const mVal = (_prevDefaultMorn && m.value === _prevDefaultMorn) ? newDefaultMorn : m.value;
      const aVal = (_prevDefaultAft && a && a.value === _prevDefaultAft) ? newDefaultAft : (a?.value ?? '');
      saved[i] = { morn: mVal, aft: aVal };
    }
  }

  _prevDefaultMorn = newDefaultMorn;
  _prevDefaultAft = newDefaultAft;

  const startObj = new Date(startDate);
  let html = '';
  for (let i = 0; i < duration; i++) {
    const d = new Date(startObj);
    d.setDate(d.getDate() + i);
    const dayLabel = d.toLocaleDateString('fr-FR', { weekday: 'long', day: '2-digit', month: '2-digit' });

    // Valeur perso conservée, ou nouveau défaut pour les nouveaux jours
    const mornVal = saved[i] !== undefined ? saved[i].morn : newDefaultMorn;
    const aftVal  = saved[i] !== undefined ? saved[i].aft  : newDefaultAft;

    html += `
      <div class="flex flex-col sm:flex-row items-start sm:items-center gap-2 p-2 rounded-lg bg-white border border-indigo-100">
        <span class="text-sm font-bold text-indigo-900 capitalize min-w-[140px]">${sanitize(dayLabel)}</span>
        <div class="flex flex-1 gap-2 flex-wrap">
          <div class="flex items-center gap-1">
            <i data-lucide="sun" class="w-3 h-3 text-amber-500 flex-shrink-0"></i>
            <input type="text" class="input-style text-xs py-1.5 px-2 w-[130px]"
                   id="perDay_morn_${i}" value="${sanitize(mornVal)}" placeholder="Vide = pas de matin" />
          </div>
          <div class="flex items-center gap-1">
            <i data-lucide="sunset" class="w-3 h-3 text-orange-500 flex-shrink-0"></i>
            <input type="text" class="input-style text-xs py-1.5 px-2 w-[130px]"
                   id="perDay_aft_${i}" value="${sanitize(aftVal)}" placeholder="Vide = pas d'aprem" />
          </div>
        </div>
      </div>`;
  }

  container.innerHTML = html;
  lucide.createIcons();
}

/**
 * Récupère les horaires pour un jour donné (index).
 * Champ vidé volontairement (existe mais vide) = pas de session.
 * Champ inexistant (section pas ouverte) = horaires par défaut.
 */
function getTimesForDay(dayIndex) {
  const defaultMorn = parseTimes(inputRefs.morning?.value || '10:00 - 13:00');
  const defaultAft = parseTimes(inputRefs.afternoon?.value || '14:00 - 18:00');

  // Garantir des valeurs par défaut solides
  const safeMornStart = defaultMorn.start || '10:00';
  const safeMornEnd = defaultMorn.end || '13:00';
  const safeAftStart = defaultAft.start || '14:00';
  const safeAftEnd = defaultAft.end || '18:00';

  const mornInput = document.getElementById(`perDay_morn_${dayIndex}`);
  const aftInput = document.getElementById(`perDay_aft_${dayIndex}`);

  // Input inexistant → utiliser les horaires par défaut (les deux créneaux actifs)
  // Input existant mais vide → créneau désactivé volontairement
  const hasMorning = mornInput ? mornInput.value.trim() !== '' : true;
  const hasAfternoon = aftInput ? aftInput.value.trim() !== '' : true;

  const morn = hasMorning ? parseTimes(mornInput ? mornInput.value.trim() : inputRefs.morning?.value || '10:00 - 13:00') : null;
  const aft = hasAfternoon ? parseTimes(aftInput ? aftInput.value.trim() : inputRefs.afternoon?.value || '14:00 - 18:00') : null;

  return {
    hasMorning,
    hasAfternoon,
    mornStart: (morn?.start && morn.start !== '') ? morn.start : safeMornStart,
    mornEnd: (morn?.end && morn.end !== '') ? morn.end : safeMornEnd,
    aftStart: (aft?.start && aft.start !== '') ? aft.start : safeAftStart,
    aftEnd: (aft?.end && aft.end !== '') ? aft.end : safeAftEnd,
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
