import fs from 'fs';
import path from 'path';
import {afterEach, describe, expect, it} from 'vitest';

import {getLanguage, setLanguage, t, translateDocument} from '../src/js/i18n.js';
import {conditionLabel} from '../src/js/weather.js';
import de from '../src/js/i18n/de.js';
import es from '../src/js/i18n/es.js';
import fr from '../src/js/i18n/fr.js';
import it_ from '../src/js/i18n/it.js';

afterEach(() => setLanguage('en-GB'));

describe('interface language', () => {
  it('follows the Language setting, English by default', () => {
    setLanguage('en-GB');
    expect(getLanguage()).toBe('en');
    expect(t('Save')).toBe('Save');
    setLanguage('fr-CH');
    expect(getLanguage()).toBe('fr');
    expect(t('Save')).toBe('Enregistrer');
    setLanguage('de-CH');
    expect(t('Save')).toBe('Speichern');
  });

  it('shows a text missing from the dictionary in English', () => {
    setLanguage('it-CH');
    expect(t('Not a key anyone wrote')).toBe('Not a key anyone wrote');
  });

  it('keeps the spaces of a sentence fragment', () => {
    setLanguage('fr-CH');
    expect(t('Could not launch ') + 'Netflix').toBe('Impossible de lancer Netflix');
    expect('Netflix' + t(' uninstalled')).toBe('Netflix désinstallée');
  });

  it('translates the weather', () => {
    setLanguage('es-ES');
    expect(conditionLabel(61, true)).toBe('Lluvia');
    setLanguage('en-US');
    expect(conditionLabel(61, true)).toBe('Rain');
  });

  it('translates the static page text', () => {
    setLanguage('fr-CH');
    document.body.innerHTML = '<span data-i18n>Listening</span>' +
      '<button data-i18n-aria aria-label="Settings"></button>';
    translateDocument();
    expect(document.querySelector('span').textContent).toBe('Écoute');
    expect(document.querySelector('button').getAttribute('aria-label')).toBe('Réglages');
  });

  it('has the same texts in every language, all used by the source', () => {
    const keys = Object.keys(fr).sort();
    for (const dictionary of [de, es, it_]) expect(Object.keys(dictionary).sort()).toEqual(keys);
    const dir = path.join(__dirname, '../src');
    const source = fs.readdirSync(path.join(dir, 'js'))
      .filter((f) => f.endsWith('.js'))
      .map((f) => fs.readFileSync(path.join(dir, 'js', f), 'utf8'))
      .concat(fs.readFileSync(path.join(dir, 'index.html'), 'utf8'))
      .join('\n')
      // Compare with the source's own escapes decoded.
      .replace(/\\u([0-9a-fA-F]{4})/g, (m, hex) => String.fromCharCode(parseInt(hex, 16)))
      .replace(/\\'/g, '\'');
    const unused = keys.filter((key) => source.indexOf(key) < 0);
    expect(unused).toEqual([]);
  });
});
