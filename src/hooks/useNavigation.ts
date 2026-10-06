import { useReducer } from 'react';

export type Route = 'map' | 'walk' | 'assessment' | 'report' | 'field' | 'saved' | 'settings';
export type Navigation = { current: Route; history: Route[] };
export const backLabels: Record<Route, string> = {
  map: '返回地圖', walk: '返回實勘', assessment: '返回評估', report: '返回評估',
  field: '返回環境觀察', saved: '返回 Street Library', settings: '返回資料狀態',
};
export function navigationReducer(state: Navigation, action: { type: 'go'; route: Route } | { type: 'back' } | { type: 'close' }): Navigation {
  if (action.type === 'close') return { current: 'map', history: [] };
  if (action.type === 'back') return { current: state.history.at(-1) ?? 'map', history: state.history.slice(0, -1) };
  if (action.route === state.current) return state;
  return { current: action.route, history: [...state.history, state.current] };
}
export function useNavigation() {
  const [state, dispatch] = useReducer(navigationReducer, { current: 'map', history: [] });
  return { ...state, go: (route: Route) => dispatch({ type: 'go', route }), back: () => dispatch({ type: 'back' }), close: () => dispatch({ type: 'close' }) };
}
