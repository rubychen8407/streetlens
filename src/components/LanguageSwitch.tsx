import { setLanguage, useLanguage } from '../i18n';

export function LanguageSwitch() {
  const language = useLanguage();
  const label = language === 'zh-TW' ? '切換至英文' : 'Switch to Chinese';
  return <button type="button" data-testid="language-switch" onClick={() => setLanguage(language === 'zh-TW' ? 'en' : 'zh-TW')}
    aria-label={label} title={label} className="h-12 min-w-11 shrink-0 rounded-2xl border border-white/10 bg-[#1A212B]/90 backdrop-blur-md text-white text-xs font-semibold px-2">
    {language === 'zh-TW' ? 'EN' : '中文'}
  </button>;
}
