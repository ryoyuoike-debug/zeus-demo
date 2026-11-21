// AR表示で使うインライン SVG アイコン（外部リソースなし）
const svg = (body, vb = '0 0 24 24') => `<svg viewBox="${vb}" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;

export const ICON = {
  cast: svg('<path d="M3 17.5a3.5 3.5 0 0 1 3.5 3.5"/><path d="M3 13.5A7.5 7.5 0 0 1 10.5 21"/><path d="M3 9.6V6a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-5.5"/>'),
  hand: svg('<path d="M8 13V5.5a1.5 1.5 0 0 1 3 0V11"/><path d="M11 10.5V4a1.5 1.5 0 0 1 3 0v7"/><path d="M14 10.5V5.5a1.5 1.5 0 0 1 3 0V13"/><path d="M17 11.5a1.5 1.5 0 0 1 3 0V15a7 7 0 0 1-7 7h-1.2a6 6 0 0 1-4.6-2.2L4 16.2a1.6 1.6 0 0 1 2.4-2L8 15.5"/>'),
  grab: svg('<path d="M7 11V8.5a1.5 1.5 0 0 1 3 0V11"/><path d="M10 10V7a1.5 1.5 0 0 1 3 0v4"/><path d="M13 10.5V8a1.5 1.5 0 0 1 3 0v3"/><path d="M16 11a1.5 1.5 0 0 1 3 0v3a7 7 0 0 1-7 7h-.6A6.4 6.4 0 0 1 5 14.6V13a2 2 0 0 1 2-2"/>'),
  lock: svg('<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>'),
  unlock: svg('<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 7.6-1.8"/>'),
  sync: svg('<path d="M20 12a8 8 0 0 1-13.7 5.6"/><path d="M4 12a8 8 0 0 1 13.7-5.6"/><path d="M18 3v4h-4"/><path d="M6 21v-4h4"/>'),
  warn: svg('<path d="M12 3.5 2.5 20h19z"/><path d="M12 10v4.5"/><path d="M12 17.4v.1"/>'),
  view: svg('<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/>'),
  recenter: svg('<circle cx="12" cy="12" r="3.2"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3"/>'),
  check: svg('<path d="M5 12.5l4.2 4.2L19 7"/>'),
  trash: svg('<path d="M4 7h16"/><path d="M9 7V4.5h6V7"/><path d="M6.5 7l1 13h9l1-13"/>'),
  list: svg('<path d="M9 6h11M9 12h11M9 18h11"/><circle cx="4.5" cy="6" r="1"/><circle cx="4.5" cy="12" r="1"/><circle cx="4.5" cy="18" r="1"/>'),
  target: svg('<circle cx="12" cy="12" r="7.5"/><circle cx="12" cy="12" r="2.5"/><path d="M12 1.8v3M12 19.2v3M1.8 12h3M19.2 12h3"/>'),
  layers: svg('<path d="M12 3 2.5 8 12 13l9.5-5z"/><path d="M2.5 12.5 12 17.5l9.5-5"/><path d="M2.5 16.5 12 21.5l9.5-5"/>'),
  monitor: svg('<rect x="2.5" y="4" width="19" height="12.5" rx="1.6"/><path d="M8 20.5h8M12 16.5v4"/>'),
  tablet: svg('<rect x="4.5" y="2.5" width="15" height="19" rx="2.2"/><path d="M11 18.5h2"/>'),
  data: svg('<ellipse cx="12" cy="5.5" rx="7.5" ry="3"/><path d="M4.5 5.5v6c0 1.7 3.4 3 7.5 3s7.5-1.3 7.5-3v-6"/><path d="M4.5 11.5v6c0 1.7 3.4 3 7.5 3s7.5-1.3 7.5-3v-6"/>'),
};
