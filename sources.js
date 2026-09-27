// sources.js — đổi URL/selector khi site đổi HTML, crawler vẫn chạy được
// Verify 2026-09-27: socolivezm.tv là domain sống (template mới: slug có -luc-HHMM-,
// tên BLV trong text anchor). socoliveo.tv đã chết, socolivexv.com thành trang SEO.
export const SOURCES = [
  { id: 'socolive', name: 'Socolive', scheduleUrl: 'https://socolivezm.tv/', strategy: 'blv', linkSelector: 'a', fallbacks: ['https://socoliven.tv/', 'https://socolivexv.com/', 'https://socolive4.in/', 'https://socolive.id/'], discovery: { query: 'socolive trực tiếp bóng đá blv', keyword: 'socolive' } }
];


