// Validated global DIP rectangles become local to each overlay window.
function overlayRects(value, b) {
  if (!Array.isArray(value)) return [];
  return value.filter(r => r && [r.left, r.top, r.right, r.bottom].every(Number.isFinite)
    && r.right > r.left && r.bottom > r.top
    && r.right > b.x && r.left < b.x + b.width && r.bottom > b.y && r.top < b.y + b.height)
    .slice(0, 300).map(r => ({ left: r.left - b.x, top: r.top - b.y, right: r.right - b.x, bottom: r.bottom - b.y }));
}
module.exports = { overlayRects };
