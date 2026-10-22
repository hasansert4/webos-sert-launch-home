// Imported first by main.js, so the language is set before any module builds
// text at load time (constants made with t()).
import {loadConfig} from './config.js';
import {setLanguage} from './i18n.js';

setLanguage((loadConfig().launcher || {}).clockLocale);
