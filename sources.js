// sources.js — đổi URL/selector khi site đổi HTML, crawler vẫn chạy được
// Verify 2026-10-04: socolive-1.live là domain mới (slug /truc-tiep/<home>-vs-<away>-DD-MM-YYYY,
// BLV id nằm ở query ?blv=<id>, tên BLV trong text anchor, giờ lấy từ aria-label).
// Stream URL do resolver API (biz.vnres.co) trả về rồi JS đổi .flv -> .m3u8, nên sniff vẫn bắt được.
// Domain cũ: socoliveo.tv chết, socolivexv.com thành trang SEO, socolivezm.tv template cũ (/link/N).
export const SOURCES = [
  { id: 'socolive', name: 'Socolive', scheduleUrl: 'https://socolive-1.live/', strategy: 'blv', linkSelector: 'a', fallbacks: ['https://socolivezm.tv/', 'https://socoliven.tv/', 'https://socolive4.in/', 'https://socolive.id/'], discovery: { query: 'socolive trực tiếp bóng đá blv', keyword: 'socolive' } }
];


