// sources.js — đổi URL/selector khi site đổi HTML, crawler vẫn chạy được
// Verify 2026-10-25: socolivezag.tv là domain sống (socolivezm.tv redirect sang socolivezag.tv).
// socolive-1.live đã chết (ERR_NAME_NOT_RESOLVED).
// Stream HLS (.m3u8) được phục vụ khi client có User-Agent iOS/Safari.
export const SOURCES = [
  {
    id: 'socolive',
    name: 'Socolive',
    scheduleUrl: 'https://socolivezag.tv/',
    strategy: 'blv',
    linkSelector: 'a',
    fallbacks: [
      'https://socolivezm.tv/',
      'https://socolive.channel/',
      'https://socolive-1.live/',
    ],
    discovery: { query: 'socolive trực tiếp bóng đá blv', keyword: 'socolive' },
  },
];
