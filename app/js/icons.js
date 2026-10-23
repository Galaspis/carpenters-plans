// Small inline SVG icons for tools and hardware (all 64×64 viewBox).
const wrap = (body, vb = '0 0 64 64') => `<svg viewBox="${vb}" xmlns="http://www.w3.org/2000/svg" width="48" height="48" fill="none" stroke="#2b2117" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;

export const icons = {
  screw: wrap(`<path d="M20 10h24l-4 8H24z" fill="#9aa3ad"/><path d="M24 18h16v8l-8 30-8-30z" fill="#b8c0c8"/><path d="M26 30h12M27 36h10M28 42h8M29 48h6" stroke="#5c6670" stroke-width="2"/><path d="M28 12l8 4" stroke="#333"/>`),
  screwSmall: wrap(`<path d="M24 12h16l-3 6H27z" fill="#9aa3ad"/><path d="M27 18h10v6l-5 26-5-26z" fill="#b8c0c8"/><path d="M29 28h6M29.5 34h5M30 40h4" stroke="#5c6670" stroke-width="2"/>`),
  drill: wrap(`<path d="M6 30h30v12H6z" fill="#e8b24a"/><path d="M36 31h16l6 5-6 5H36z" fill="#777"/><path d="M14 42l-2 14h10l2-14" fill="#e8b24a"/><path d="M28 36h6" stroke="#333"/><circle cx="12" cy="36" r="2" fill="#333"/>`),
  bit: wrap(`<path d="M30 6h4v14h-4z" fill="#777"/><path d="M28 20h8l-2 36h-4z" fill="#999"/><path d="M30 26l4 6M30 34l4 6M30 42l4 6" stroke="#555"/>`),
  countersink: wrap(`<path d="M30 6h4v16h-4z" fill="#777"/><path d="M22 22h20l-10 20z" fill="#999"/><path d="M8 50h48" stroke="#8a6a3c"/><path d="M8 50h48v8H8z" fill="#e3b97f"/><path d="M26 50l6 6 6-6" fill="#fff" stroke="#8a6a3c"/>`),
  counterbore: wrap(`<path d="M8 44h48v14H8z" fill="#e3b97f"/><path d="M8 44h48" stroke="#8a6a3c"/><path d="M22 44v8h20v-8" fill="#fff" stroke="#8a6a3c"/><path d="M29 52v6h6v-6" fill="#fff" stroke="#8a6a3c"/><path d="M30 8h4v14h-4z" fill="#777"/><path d="M22 22h20v8H22z" fill="#999"/>`),
  pilot: wrap(`<path d="M8 40h48v18H8z" fill="#e3b97f"/><path d="M8 40h48" stroke="#8a6a3c"/><path d="M30 40v12h4V40" fill="#fff" stroke="#1f6fb2"/><path d="M31 6h2v26h-2z" fill="#777"/>`),
  saw: wrap(`<path d="M8 20h44l4 6-4 2-4 4-4-2-4 4-4-2-4 4-4-2-4 4-4-2-4 4-4-2-4 4" fill="#c9ced4"/><path d="M8 20l-2 10 8 2 2-10" fill="#b7742c"/><path d="M6 30l12 22 8-4-10-20" fill="#b7742c"/>`),
  square: wrap(`<path d="M8 8h48v10H18v38H8z" fill="#e8b24a"/><path d="M24 8v6M32 8v6M40 8v6M48 8v6M12 24h4M12 32h4M12 40h4M12 48h4" stroke="#333" stroke-width="1.5"/>`),
  tape: wrap(`<circle cx="26" cy="32" r="18" fill="#e8b24a"/><circle cx="26" cy="32" r="6" fill="#fff"/><path d="M40 28h20v8H40z" fill="#fff"/><path d="M44 28v3M48 28v5M52 28v3M56 28v5" stroke="#333" stroke-width="1.5"/>`),
  clamp: wrap(`<path d="M14 8h8v48h-8z" fill="#c0392b"/><path d="M22 10h30v8H22zM22 46h30v8H22z" fill="#555"/><path d="M48 18v28" stroke="#777" stroke-width="4"/><path d="M44 8h8v6h-8z" fill="#333"/>`),
  sandpaper: wrap(`<path d="M10 14h44v36H10z" fill="#d9b382"/><g fill="#8a6a3c" stroke="none"><circle cx="18" cy="22" r="1.5"/><circle cx="28" cy="20" r="1.5"/><circle cx="40" cy="24" r="1.5"/><circle cx="22" cy="32" r="1.5"/><circle cx="34" cy="30" r="1.5"/><circle cx="46" cy="34" r="1.5"/><circle cx="18" cy="42" r="1.5"/><circle cx="30" cy="40" r="1.5"/><circle cx="42" cy="44" r="1.5"/></g>`),
  pencil: wrap(`<path d="M12 48l34-34 8 8-34 34H12z" fill="#e8b24a"/><path d="M12 48v8h8" fill="#f5deb3"/><path d="M46 14l-4-4 6-2 6 6-2 6z" fill="#f08"/>`),
  oil: wrap(`<path d="M20 20h20v34H20z" fill="#5c7a3a"/><path d="M24 10h12v10H24z" fill="#333"/><path d="M26 30h8M26 38h8" stroke="#fff"/>`),
  glue: wrap(`<path d="M24 22h16v32H24z" fill="#f2c94c"/><path d="M28 8h8v14h-8z" fill="#fff"/><path d="M30 4h4v4h-4z" fill="#c0392b"/>`),
  level: wrap(`<path d="M6 26h52v12H6z" fill="#e8b24a"/><path d="M26 29h12v6H26z" fill="#9f9"/><path d="M30 29v6M34 29v6" stroke="#333" stroke-width="1.5"/>`),
  driver: wrap(`<path d="M8 28h22v8H8z" fill="#c0392b"/><path d="M30 30h26v4H30z" fill="#777"/><path d="M56 28l4 4-4 4" fill="#777"/>`),
  wood: wrap(`<path d="M8 20h48v24H8z" fill="#e3b97f"/><path d="M8 20l6-6h48l-6 6" fill="#c99a5e"/><path d="M56 20l6-6v24l-6 6" fill="#b0803f"/><path d="M12 30q10-4 20 0t20 0" stroke="#b0803f" stroke-width="1.5"/>`),
  hook: wrap(`<path d="M24 10v26a8 8 0 0 0 16 0" stroke="#555" stroke-width="4"/><path d="M18 8h12v6H18z" fill="#777"/>`),
  wheel: wrap(`<circle cx="32" cy="36" r="16" fill="#555"/><circle cx="32" cy="36" r="6" fill="#aaa"/><path d="M22 10h20v8H22z" fill="#777"/><path d="M32 18v6" stroke="#777" stroke-width="4"/>`),
};

export function screwIcon(d, len) {
  return `<span class="hw"><span class="ico">${icons.screw}</span><b>${d}×${len}</b></span>`;
}
