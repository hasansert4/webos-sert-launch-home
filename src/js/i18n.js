import de from './i18n/de.js';
import es from './i18n/es.js';
import fr from './i18n/fr.js';
import it from './i18n/it.js';

// Interface language. English is the source: every on-screen text is written
// in English and passed through t(), which looks it up in the dictionary of
// the language picked in Settings -> Look -> Language (config.launcher
// .clockLocale, which also formats the clock and date). A text missing from a
// dictionary shows in English.
const DICTIONARIES = {de: de, es: es, fr: fr, it: it};

let language = 'en';
let locale = 'en-GB';

/** `clockLocale` from the config ('fr-CH', 'en-GB', … or 'auto' = the TV's language). */
export function setLanguage(clockLocale) {
  locale = clockLocale && clockLocale !== 'auto'
    ? clockLocale
    : ((typeof navigator !== 'undefined' && navigator.language) || 'en-GB');
  language = String(locale).slice(0, 2).toLowerCase();
}

/** Two-letter interface language: en, fr, de, it or es. */
export function getLanguage() {
  return DICTIONARIES[language] ? language : 'en';
}

/** BCP 47 locale for Intl date formatting (the weather's weekdays, the clock). */
export function getLocale() {
  return locale;
}

export function t(text) {
  const dictionary = DICTIONARIES[language];
  const translated = dictionary && dictionary[text];
  return typeof translated === 'string' && translated ? translated : text;
}

/**
 * Translate the static text of index.html: elements with data-i18n get their
 * text, data-i18n-aria their aria-label, translated from the English in place.
 */
export function translateDocument(root) {
  const scope = root || document;
  Array.prototype.forEach.call(scope.querySelectorAll('[data-i18n]'), function (el) {
    el.textContent = t(el.textContent.trim());
  });
  Array.prototype.forEach.call(scope.querySelectorAll('[data-i18n-aria]'), function (el) {
    el.setAttribute('aria-label', t(el.getAttribute('aria-label') || ''));
  });
}
