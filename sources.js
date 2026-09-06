// sources.js — đổi URL/selector khi site đổi HTML, crawler vẫn chạy được
// Verify 2026-09-06: gavangtv.tv + socolivexv.com còn sống; xoilac42.com đã chết.
// Mấy trang này "domain hopping" liên tục nên mỗi nguồn có thêm fallbacks để thử dần.
export const SOURCES = [
  { id: 'gavang', name: 'GavangTV', scheduleUrl: 'https://gavangtv.tv/', linkSelector: 'a[href*="tructiep"], a.match-link', fallbacks: ['https://gavangtv2026.com/', 'https://gavangtv.mobi/'], discovery: { query: 'gavangtv trực tiếp bóng đá', keyword: 'gavang' } },
  { id: 'socolive', name: 'Socolive', scheduleUrl: 'https://socoliveo.tv/', strategy: 'blv', linkSelector: 'a', fallbacks: ['https://socolivexv.com/', 'https://socolive4.in/', 'https://socolive.id/'], discovery: { query: 'socolive trực tiếp bóng đá blv', keyword: 'socolive' } },
  { id: 'xoilac', name: 'Xoilac', scheduleUrl: 'https://xoilac.llc/', linkSelector: 'a.match-link', fallbacks: [], discovery: { query: 'xoilac trực tiếp bóng đá blv', keyword: 'xoilac' } }
];


