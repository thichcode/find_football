// sources.js — đổi URL/selector khi site đổi HTML, crawler vẫn chạy được
// Verify 2026-10-31: socolivenp.top và socolivef.me là domain sống chính thức (socolivezag.tv / socolivezm.tv đã chết ERR_CONNECTION_REFUSED).
// Template mới dùng window.streamData & API biz.vnres.co hoặc pull.niues.live/niur.live cho HLS stream (.m3u8).
export const SOURCES = [
  {
    id: 'socolive',
    name: 'Socolive',
    scheduleUrl: 'https://socolivenp.top/',
    strategy: 'blv',
    linkSelector: 'a',
    fallbacks: [
      'https://socolivef.me/',
      'https://socolivezo.top/',
      'https://socolive7.cc/',
    ],
    discovery: { query: 'socolive trực tiếp bóng đá blv', keyword: 'socolive' },
  },
];
