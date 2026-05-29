import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

import en from '../i18n/translations/en.json';
import zhTW from '../i18n/translations/zh-TW.json';

export type AppLanguage = 'en' | 'zh-TW';

const resources = {
  en: { translation: en },
  'zh-TW': { translation: zhTW },
} as const;

if (!i18n.isInitialized) {
  void i18n.use(initReactI18next).init({
    compatibilityJSON: 'v4',
    resources,
    lng: 'en',
    fallbackLng: 'en',
    interpolation: {
      escapeValue: false,
    },
  });
}

export async function setLanguage(language: AppLanguage) {
  await i18n.changeLanguage(language);
}

export default i18n;
