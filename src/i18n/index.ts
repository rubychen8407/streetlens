import { useSyncExternalStore } from 'react';
import { catalog } from './catalog';

export type Language = 'zh-TW' | 'en';
export const LANGUAGE_KEY = 'streetlens-language';
export function isLanguage(value: unknown): value is Language { return value === 'zh-TW' || value === 'en'; }
const listeners = new Set<() => void>();
let language: Language = 'zh-TW';
try { const saved = localStorage.getItem(LANGUAGE_KEY); if (isLanguage(saved)) language = saved; } catch { /* Storage may be disabled. */ }
function applyDocumentLanguage() { if (typeof document !== 'undefined') document.documentElement.lang = language; }
applyDocumentLanguage();
export function getLanguage() { return language; }
export function setLanguage(next: Language) {
  if (!isLanguage(next) || next === language) return;
  language = next;
  try { localStorage.setItem(LANGUAGE_KEY, next); } catch { /* Switching still works for this session. */ }
  applyDocumentLanguage(); listeners.forEach(listener => listener());
}
if (typeof window !== 'undefined') window.addEventListener('storage', event => {
  if (event.key === LANGUAGE_KEY) setLanguage(isLanguage(event.newValue) ? event.newValue : 'zh-TW');
});
export function useLanguage() {
  return useSyncExternalStore(listener => { listeners.add(listener); return () => { listeners.delete(listener); }; }, getLanguage, () => 'zh-TW' as Language);
}
export function t(text: string, selected = language): string {
  const known = catalog[text]?.[selected];
  if (known) return known;
  const flood = /^floodHazard_([\d.]+)mmh$/.exec(text);
  if (flood) return selected === 'en' ? `Flood depth · ${flood[1]} mm/h` : `淹水深度 · ${flood[1]} mm/h`;
  if (text.startsWith('資料來源：')) return t('資料來源：', selected) + text.slice(5).split('、').map(source => t(source, selected)).join(' · ');
  return text;
}
export function bilingual(zh: string, en: string) { return language === 'en' ? en : zh; }
export function errorText(message: string, fallback: string) { return catalog[message] ? t(message) : t(fallback); }
export function dateLocale() { return language === 'en' ? 'en-US' : 'zh-TW'; }
export function displayPlace(name: string) {
  return /^實勘位置 \([-\d.]+, [-\d.]+\)$/.test(name) && language === 'en' ? name.replace('實勘位置', 'Field location') : name;
}
