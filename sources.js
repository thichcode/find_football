// sources.js — đổi URL/selector khi site đổi HTML, crawler vẫn chạy được
// Verify 2026-11-07: socolive9.icu và socolivef.me là domain sống chính thức (socolivenp.top đã chết).
// Template dùng window.streamData & API biz.vnres.co hoặc pull.niues.live/niur.live cho HLS stream (.m3u8).
export const SOURCES = [
  {
    id: 'socolive',
    name: 'Socolive',
    scheduleUrl: 'https://socolive9.icu/',
    strategy: 'blv',
    linkSelector: 'a',
    fallbacks: [
      'https://socolivef.me/',
      'https://socolive9.icu/',
      'https://socolivenp.top/',
      'https://socolivezo.top/',
      'https://socolive7.cc/',
    ],
    discovery: { query: 'socolive trực tiếp bóng đá blv', keyword: 'socolive' },
  },
];
