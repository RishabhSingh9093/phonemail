import { I18n } from 'i18n-js';
import * as Localization from 'expo-localization';
import en from './en.json';
import hi from './hi.json';
import ta from './ta.json';

export const i18n = new I18n({ en, hi, ta });

// Default fallback
i18n.defaultLocale = 'en';
i18n.enableFallback = true;

// Language display names
export const LANGUAGES = [
  { code: 'en', label: 'English',   native: 'English' },
  { code: 'hi', label: 'Hindi',     native: 'हिन्दी' },
  { code: 'ta', label: 'Tamil',     native: 'தமிழ்' },
];

// Map Indian state name -> language code
// Reverse geocoding gives us a region/state name
export const STATE_TO_LANG = {
  'Tamil Nadu': 'ta',
  'Puducherry': 'ta',
  'Delhi': 'hi',
  'Haryana': 'hi',
  'Uttar Pradesh': 'hi',
  'Uttarakhand': 'hi',
  'Madhya Pradesh': 'hi',
  'Chhattisgarh': 'hi',
  'Rajasthan': 'hi',
  'Bihar': 'hi',
  'Jharkhand': 'hi',
  'Himachal Pradesh': 'hi',
};

// Detect initial language from device locale
export function detectDeviceLanguage() {
  try {
    const locales = Localization.getLocales();
    if (locales && locales[0] && locales[0].languageCode) {
      const code = locales[0].languageCode.toLowerCase();
      if (['en', 'hi', 'ta'].includes(code)) return code;
    }
  } catch (e) {
    // ignore
  }
  return 'en';
}

// Set the active language
export function setLanguage(code) {
  i18n.locale = code;
}

// Translation shortcut
export function t(key, opts) {
  return i18n.t(key, opts);
}
