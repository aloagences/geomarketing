/**
 * utils.js - Fonctions utilitaires et sécurité
 */

// ========================================
// ANTI-XSS : Assainissement HTML
// ========================================

/**
 * Échappe les caractères HTML dangereux pour prévenir les injections XSS.
 * À utiliser PARTOUT où du contenu externe est injecté dans le DOM.
 */
function sanitize(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
}

/**
 * Crée un élément texte sûr (jamais interprété comme HTML).
 */
function safeText(str) {
  return document.createTextNode(str || '');
}

// ========================================
// STOCKAGE LOCAL SÉCURISÉ
// ========================================

const StorageKeys = Object.freeze({
  GEMINI: 'gemini_api_key',
  GROQ: 'groq_api_key',
  OPENAI: 'openai_api_key',
  MISTRAL: 'mistral_api_key',
  OPENROUTER: 'openrouter_api_key',
  MODEL: 'gemini_model',
  ENGINE: 'active_ai_engine',
});

function safeGetItem(key) {
  try { return localStorage.getItem(key) || ''; }
  catch { return ''; }
}

function safeSetItem(key, value) {
  try { if (value) localStorage.setItem(key, value); }
  catch { /* quota exceeded or private browsing */ }
}

// ========================================
// CALCULS GÉOGRAPHIQUES
// ========================================

function calculateDistance(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ========================================
// NETTOYAGE JSON
// ========================================

function cleanJson(text) {
  if (!text) throw new Error("Le texte renvoyé par l'IA est vide.");
  const firstBrace = text.indexOf('{');
  const lastBrace = text.lastIndexOf('}');
  if (firstBrace === -1 || lastBrace === -1) {
    throw new Error("Format JSON invalide renvoyé par l'IA.");
  }
  return text.substring(firstBrace, lastBrace + 1).replace(/[\x00-\x1F]+/g, ' ');
}

// ========================================
// FORMATAGE
// ========================================

function formatNumber(n) {
  return new Intl.NumberFormat('fr-FR').format(n);
}

function parseTimes(timeStr) {
  const parts = timeStr.split('-');
  return {
    start: (parts[0] || '').trim(),
    end: (parts[1] || '').trim(),
  };
}
