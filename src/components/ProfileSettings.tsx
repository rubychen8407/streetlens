import { useEffect, useRef, useState } from 'react';
import { Moon, Sun, X, UserRound } from 'lucide-react';
import { t, setLanguage, useLanguage } from '../i18n';
import { setTheme, useTheme } from '../utils/theme';
import { logoutPrivateHousing, usePrivateHousingAccess } from '../utils/privateHousingAccess';

export function ProfileSettings({ open, onClose }: { open: boolean; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const language = useLanguage();
  const theme = useTheme();
  const access = usePrivateHousingAccess(open);
  const [logoutFailed, setLogoutFailed] = useState(false);
  useEffect(() => {
    if (open && !dialog.current?.open) dialog.current?.showModal();
    if (!open && dialog.current?.open) dialog.current?.close();
  }, [open]);
  return <dialog ref={dialog} className="profile-settings" aria-labelledby="profile-settings-title"
    onCancel={event => { event.preventDefault(); onClose(); }}
    onClose={onClose} onClick={event => { if (event.target === dialog.current) onClose(); }}>
    <div className="profile-settings-body">
      <header><h2 id="profile-settings-title"><UserRound size={20} />{t('個人設定')}</h2>
        <button type="button" aria-label={t('關閉')} onClick={onClose}><X size={20} /></button></header>
      <fieldset><legend>{t('語言')}</legend><div className="profile-options">
        <label><input type="radio" name="profile-language" value="zh-TW" checked={language === 'zh-TW'} onChange={() => setLanguage('zh-TW')} /><span>繁體中文</span></label>
        <label><input type="radio" name="profile-language" value="en" checked={language === 'en'} onChange={() => setLanguage('en')} /><span>English</span></label>
      </div></fieldset>
      <fieldset><legend>{t('外觀')}</legend><div className="profile-options">
        <label><input type="radio" name="profile-theme" value="dark" checked={theme === 'dark'} onChange={() => setTheme('dark')} /><Moon size={18} /><span>{t('深色模式')}</span></label>
        <label><input type="radio" name="profile-theme" value="light" checked={theme === 'light'} onChange={() => setTheme('light')} /><Sun size={18} /><span>{t('淺色模式')}</span></label>
      </div></fieldset>
      {access.enabled && <fieldset><legend>{t('私人功能')}</legend>
        {!access.authorized && !logoutFailed ? <a href="/api/private/google/login" className="inline-flex items-center min-h-11 text-sm underline">{t('以 Google 登入')}</a>
          : <button type="button" className="min-h-11 text-sm" onClick={() => { void logoutPrivateHousing().then(() => setLogoutFailed(false)).catch(() => setLogoutFailed(true)); }}>{t('登出私人功能')}</button>}
        {logoutFailed && <p className="text-sm">{t('登出未完成，請重試或關閉瀏覽器。')}</p>}
      </fieldset>}
    </div>
  </dialog>;
}
