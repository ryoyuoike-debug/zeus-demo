// 関心領域画面で使うアイコン（インライン SVG）
const svg = (body, vb = '0 0 24 24') => `<svg viewBox="${vb}" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;

export const ICON = {
  line: svg('<path d="M6 18L18 6" stroke-dasharray="2.6 2.4"/><circle cx="5.2" cy="18.8" r="2.4" fill="currentColor" stroke="none"/><circle cx="18.8" cy="5.2" r="2.6"/>'),
  pen: svg('<path d="M15.5 4.5l4 4L9 19H5v-4z"/><path d="M13.5 6.5l4 4"/><circle cx="6.3" cy="17.7" r="0.6" fill="currentColor"/>'),
  eraser: svg('<path d="M8.5 19.5L3.8 14.8a1.6 1.6 0 010-2.3l8.7-8.7a1.6 1.6 0 012.3 0l5.4 5.4a1.6 1.6 0 010 2.3L12.5 19.5z"/><path d="M8.6 8.2l7.2 7.2"/><path d="M12.5 19.5H20"/>'),
  undo: svg('<path d="M9 7H15a5 5 0 010 10H8"/><path d="M12 4L9 7l3 3"/>'),
  trash: svg('<path d="M4.5 7h15"/><path d="M9.5 7V5h5v2"/><path d="M6.5 7l1 12.5h9l1-12.5"/><path d="M10.2 10.5v6M13.8 10.5v6"/>'),
  home: svg('<path d="M4 11.5L12 5l8 6.5"/><path d="M6.5 10v9h11v-9"/>'),
  focus: svg('<circle cx="12" cy="12" r="3.2"/><path d="M4 9V5.5A1.5 1.5 0 015.5 4H9M15 4h3.5A1.5 1.5 0 0120 5.5V9M20 15v3.5a1.5 1.5 0 01-1.5 1.5H15M9 20H5.5A1.5 1.5 0 014 18.5V15"/>'),
  depth: svg('<path d="M4 6h16"/><path d="M12 6v12"/><path d="M9 15l3 3 3-3"/>'),
  redo: svg('<path d="M20 12a8 8 0 11-2.3-5.6"/><path d="M20 4v5h-5"/>'),
};
