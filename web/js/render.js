/* SVG rendering. All art is inline SVG symbols styled with CSS custom
 * properties so it follows the light/dark theme. */
(function (root) {
  const DC = root.DC;
  const C = 32; // cell size in SVG units

  const COLORS = {
    gold: '#d9a514', crimson: '#c8372d', azure: '#2f7fd8', emerald: '#2a9d5c',
    violet: '#8e4fc9', teal: '#159a8c',
  };
  const ANGLE = { E: 0, SE: 45, S: 90, SW: 135, W: 180, NW: 225, N: 270, NE: 315 };

  const ink = 'stroke:var(--ink);stroke-linecap:round;stroke-linejoin:round';

  const SYMBOLS = `
  <pattern id="grid" width="${C}" height="${C}" patternUnits="userSpaceOnUse">
    <path d="M${C} 0H0V${C}" style="fill:none;stroke:var(--grid)" stroke-width="1"/>
  </pattern>
  <pattern id="hatch" width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
    <line x1="0" y1="0" x2="0" y2="7" style="stroke:var(--hatch)" stroke-width="2.2"/>
  </pattern>

  <symbol id="i-start" viewBox="0 0 32 32">
    <circle cx="16" cy="16" r="11" style="fill:var(--sun);${ink}" stroke-width="1.8"/>
    <circle cx="12" cy="13.5" r="1.7" style="fill:var(--ink)"/>
    <circle cx="20" cy="13.5" r="1.7" style="fill:var(--ink)"/>
    <path d="M10.5 18.5Q16 24.5 21.5 18.5" style="fill:none;${ink}" stroke-width="2"/>
  </symbol>

  <symbol id="i-stairs" viewBox="0 0 32 32">
    <path d="M4 28H10V22H16V16H22V10H28V28Z" style="fill:var(--stone);${ink}" stroke-width="1.8"/>
    <path d="M10 28V22M16 28V16M22 28V10" style="fill:none;${ink}" stroke-width="1" opacity=".55"/>
    <path d="M6 9l5 5M11 9v5H6" style="fill:none;${ink}" stroke-width="2"/>
  </symbol>

  <symbol id="i-coin" viewBox="0 0 32 32">
    <circle cx="16" cy="16" r="8" style="fill:#e8b923;${ink}" stroke-width="1.8"/>
    <circle cx="16" cy="16" r="4.8" style="fill:none;stroke:#9a6c00" stroke-width="1.3"/>
    <path d="M14 13.5l2-1.3v7.3" style="fill:none;stroke:#9a6c00;stroke-linecap:round" stroke-width="1.5"/>
  </symbol>

  <symbol id="i-chest" viewBox="0 0 32 32">
    <path d="M5 14Q5 7 16 7Q27 7 27 14Z" style="fill:#b7712f;${ink}" stroke-width="1.8"/>
    <rect x="5" y="14" width="22" height="12" rx="1.5" style="fill:#9c5a22;${ink}" stroke-width="1.8"/>
    <path d="M5 18H27M10 7.8V26M22 7.8V26" style="fill:none;stroke:#e8b923" stroke-width="1.6"/>
    <rect x="13.5" y="15.5" width="5" height="6" rx="1" style="fill:#e8b923;${ink}" stroke-width="1.2"/>
  </symbol>

  <symbol id="i-darkchest" viewBox="0 0 32 32">
    <path d="M5 14Q5 7 16 7Q27 7 27 14Z" style="fill:#54407e;${ink}" stroke-width="1.8"/>
    <rect x="5" y="14" width="22" height="12" rx="1.5" style="fill:#3d2f5c;${ink}" stroke-width="1.8"/>
    <path d="M5 18H27M10 7.8V26M22 7.8V26" style="fill:none;stroke:#c9b6ff" stroke-width="1.6"/>
    <path d="M18.6 15.2a4.2 4.2 0 1 0 1.6 6.6A3.4 3.4 0 0 1 18.6 15.2Z" style="fill:#ffe58a;stroke:var(--ink)" stroke-width="1"/>
  </symbol>

  <symbol id="i-mimic" viewBox="0 0 32 32">
    <path d="M5 14Q5 7 16 7Q27 7 27 14Z" style="fill:#b7712f;${ink}" stroke-width="1.8"/>
    <rect x="5" y="14" width="22" height="12" rx="1.5" style="fill:#9c5a22;${ink}" stroke-width="1.8"/>
    <path d="M5 18H27M10 7.8V26M22 7.8V26" style="fill:none;stroke:#e8b923" stroke-width="1.6"/>
    <path d="M6.5 14l1 1.7l1-1.7M23 14l1 1.7l1-1.7" style="fill:#fff;stroke:var(--ink);stroke-linejoin:round" stroke-width=".6"/>
    <rect x="13.5" y="15.5" width="5" height="6" rx="1" style="fill:#e8b923;${ink}" stroke-width="1.2"/>
  </symbol>

  <symbol id="i-mimic-open" viewBox="0 0 32 32">
    <path d="M5 12Q5 3 16 3Q27 3 27 12Z" style="fill:#b7712f;${ink}" stroke-width="1.8"/>
    <path d="M6 12H26L24 21H8Z" style="fill:#5a0d14;${ink}" stroke-width="1.4"/>
    <path d="M7 12l2 4l2-4l2 4l2-4l2 4l2-4l2 4l2-4l2 4l2-4" style="fill:#fff;stroke:var(--ink);stroke-linejoin:round" stroke-width=".8"/>
    <path d="M12 21Q14 16 17 18Q20 20 18 25" style="fill:#e0527a;${ink}" stroke-width="1.2"/>
    <rect x="5" y="20" width="22" height="9" rx="1.5" style="fill:#9c5a22;${ink}" stroke-width="1.8"/>
    <path d="M8 20l2 -3.5l2 3.5M20 20l2 -3.5l2 3.5" style="fill:#fff;stroke:var(--ink);stroke-linejoin:round" stroke-width=".8"/>
    <circle cx="11" cy="7.5" r="1.4" style="fill:#ffd23f;stroke:var(--ink)" stroke-width=".8"/>
    <circle cx="21" cy="7.5" r="1.4" style="fill:#ffd23f;stroke:var(--ink)" stroke-width=".8"/>
  </symbol>

  <symbol id="i-torch" viewBox="0 0 32 32">
    <path d="M14 30L12.6 16h6.8L18 30Z" style="fill:#9c5a22;${ink}" stroke-width="1.6"/>
    <rect x="11.5" y="13.5" width="9" height="3.2" rx="1" style="fill:#6b6f78;${ink}" stroke-width="1.4"/>
    <path d="M16 2.5C10.5 8 10.6 12.5 16 13.8C21.4 12.5 21.5 8 16 2.5Z" style="fill:#f08a24;${ink}" stroke-width="1.4"/>
    <path d="M16 6.5C13.6 9.3 13.8 11.6 16 12.3C18.2 11.6 18.4 9.3 16 6.5Z" style="fill:#ffd23f"/>
  </symbol>

  <symbol id="i-stalker" viewBox="0 0 32 32">
    <path d="M6 28Q6.5 12 16 5Q25.5 12 26 28L21.5 25.5L16 28L10.5 25.5Z" style="fill:#3b3350;${ink}" stroke-width="1.8"/>
    <path d="M10.5 16Q16 10 21.5 16Q21 22 16 23Q11 22 10.5 16Z" style="fill:#15121c;stroke:var(--ink)" stroke-width="1"/>
    <path d="M12.3 16.6l2.6 1M19.7 16.6l-2.6 1" style="fill:none;stroke:#ff4d3d;stroke-linecap:round" stroke-width="2.2"/>
  </symbol>

  <symbol id="i-body" viewBox="0 0 32 32">
    <path d="M6 24Q8 19 13 20L19 18Q25 17 27 22Q26 26 17 26Q8 27 6 24Z" style="fill:#b9b3c4;${ink}" stroke-width="1.6"/>
    <path d="M10 21.5l2 2M12 21.5l-2 2M15 20.5l2 2M17 20.5l-2 2" style="fill:none;${ink}" stroke-width="1.3"/>
    <circle cx="22" cy="11" r="2.6" style="fill:#8f8a7c;${ink}" stroke-width="1.2"/>
    <circle cx="26.5" cy="14" r="2.1" style="fill:#a5a093;${ink}" stroke-width="1.2"/>
  </symbol>

  <symbol id="i-sling" viewBox="0 0 32 32">
    <path d="M16 29V17M16 17L9 6M16 17L23 6" style="fill:none;stroke:#8a5a2b;stroke-linecap:round;stroke-linejoin:round" stroke-width="3.4"/>
    <path d="M9 6Q16 14 23 6" style="fill:none;stroke:currentColor;stroke-linecap:round" stroke-width="1.8"/>
    <circle cx="16" cy="10" r="2.6" style="fill:#8f8a7c;${ink}" stroke-width="1.2"/>
  </symbol>

  <symbol id="i-missile" viewBox="0 0 32 32">
    <path d="M4 28L15 17" style="fill:none;stroke:#b48cff;stroke-linecap:round;stroke-dasharray:2 3" stroke-width="2.6"/>
    <path d="M22 4l2.2 5.6L30 10l-4.6 3.8L27 20l-5-3.4L17 20l1.6-6.2L14 10l5.8-.4Z" style="fill:#b48cff;${ink}" stroke-width="1.5"/>
    <circle cx="22" cy="12" r="2" style="fill:#fff"/>
  </symbol>

  <symbol id="i-cls-base" viewBox="0 0 32 32">
    <circle cx="16" cy="10" r="5.5" style="fill:#f1c9a5;${ink}" stroke-width="1.8"/>
    <path d="M6 29Q6 17 16 17Q26 17 26 29Z" style="fill:#8f8a7c;${ink}" stroke-width="1.8"/>
  </symbol>

  <symbol id="i-cls-fighter" viewBox="0 0 32 32">
    <path d="M16 3L27 7V15C27 22 22 27 16 30C10 27 5 22 5 15V7Z" style="fill:#c8372d;${ink}" stroke-width="2"/>
    <path d="M16 6V27M9 13H23" style="fill:none;stroke:#f4e9d0;stroke-linecap:round" stroke-width="2.6"/>
  </symbol>

  <symbol id="i-cls-wizard" viewBox="0 0 32 32">
    <path d="M16 2L24 24H8Z" style="fill:#5b3fa8;${ink}" stroke-width="2"/>
    <path d="M4 25Q16 20 28 25Q16 30 4 25Z" style="fill:#5b3fa8;${ink}" stroke-width="2"/>
    <path d="M14 10l1 2.4 2.6.2-2 1.7.6 2.5-2.2-1.4-2.2 1.4.6-2.5-2-1.7 2.6-.2Z" style="fill:#ffd23f"/>
    <circle cx="18.5" cy="19" r="1.4" style="fill:#ffd23f"/>
  </symbol>

  <symbol id="i-cls-rogue" viewBox="0 0 32 32">
    <path d="M5 14Q16 2 27 14L24 18Q16 12 8 18Z" style="fill:#2f5d3a;${ink}" stroke-width="2"/>
    <path d="M8 18Q16 12 24 18L22 26Q16 30 10 26Z" style="fill:#2f5d3a;${ink}" stroke-width="2"/>
    <path d="M11 19.5h3.5M17.5 19.5H21" style="fill:none;stroke:#ffd23f;stroke-linecap:round" stroke-width="2.2"/>
  </symbol>

  <symbol id="i-levelup" viewBox="0 0 32 32">
    <path d="M16 3L26 14H20V22H12V14H6Z" style="fill:#ffd23f;${ink}" stroke-width="2"/>
    <path d="M9 26H23M11 29.5H21" style="fill:none;stroke:#ffd23f;stroke-linecap:round" stroke-width="2.4"/>
  </symbol>

  <symbol id="i-lockpick" viewBox="0 0 32 32">
    <circle cx="9" cy="23" r="5" style="fill:#c9ccd3;${ink}" stroke-width="1.8"/>
    <circle cx="9" cy="23" r="1.8" style="fill:var(--paper);stroke:var(--ink)" stroke-width="1"/>
    <path d="M12.5 19.5L25 7L27 9M22 10l2 2" style="fill:none;${ink}" stroke-width="2.2"/>
  </symbol>

  <symbol id="i-sp-dex" viewBox="0 0 32 32">
    <path d="M11 28V14Q11 12 13 12Q15 12 15 14V9Q15 7 17 7Q19 7 19 9V14V11Q19 9 21 9Q23 9 23 11V15V13Q23 11.5 24.5 11.5Q26 11.5 26 13V20Q26 28 18 28Z" style="fill:#f1c9a5;${ink}" stroke-width="1.6"/>
    <path d="M6 9l2-4 2 4M4.5 14H9" style="fill:none;stroke:currentColor;stroke-linecap:round;stroke-linejoin:round" stroke-width="1.8"/>
  </symbol>

  <symbol id="i-moon" viewBox="0 0 32 32">
    <path d="M20 4.5A11.5 11.5 0 1 0 27.5 24A9.5 9.5 0 0 1 20 4.5Z" style="fill:#c9b6ff;${ink}" stroke-width="1.8"/>
    <circle cx="24" cy="9" r="1.2" style="fill:var(--ink)"/><circle cx="27.5" cy="14" r=".9" style="fill:var(--ink)"/>
  </symbol>

  <filter id="fog-soft" x="-5%" y="-5%" width="110%" height="110%"><feGaussianBlur stdDeviation="2.5"/></filter>

  <symbol id="i-heart" viewBox="0 0 32 32">
    <path d="M16 27C6 20 3.5 14 7.5 9.8C10.8 6.5 14.6 8 16 11.2C17.4 8 21.2 6.5 24.5 9.8C28.5 14 26 20 16 27Z"
      style="fill:#e0453a;${ink}" stroke-width="1.8"/>
    <path d="M9.5 12.5Q10.5 10 13 10" style="fill:none;stroke:#fff;stroke-linecap:round" stroke-width="1.6" opacity=".7"/>
  </symbol>

  <symbol id="i-medpack" viewBox="0 0 32 32">
    <path d="M12.5 9V6.5h7V9" style="fill:none;${ink}" stroke-width="1.8"/>
    <rect x="5" y="9" width="22" height="17" rx="3" style="fill:#f4f4f0;${ink}" stroke-width="1.8"/>
    <path d="M14 12.5h4v3.5h3.5v4H18v3.5h-4V20h-3.5v-4H14Z" style="fill:#e0453a;stroke:#9e211a" stroke-width="1"/>
  </symbol>

  <symbol id="i-web" viewBox="0 0 32 32">
    <g style="fill:none;stroke:var(--web);stroke-linecap:round" stroke-width="1.3">
      <path d="M16 2V30M2 16H30M6 6L26 26M26 6L6 26"/>
      <path d="M16 6.5L22.7 9.3L25.5 16L22.7 22.7L16 25.5L9.3 22.7L6.5 16L9.3 9.3Z"/>
      <path d="M16 11L19.5 12.5L21 16L19.5 19.5L16 21L12.5 19.5L11 16L12.5 12.5Z"/>
    </g>
    <circle cx="21" cy="11" r="2.4" style="fill:var(--ink)"/>
    <path d="M18.5 9.5l-2-1M18.5 11h-2.3M18.6 12.4l-2 1M23.5 9.5l2-1M23.5 11h2.3M23.4 12.4l2 1"
      style="fill:none;${ink}" stroke-width=".9"/>
  </symbol>

  <symbol id="i-enemy" viewBox="0 0 32 32">
    <path d="M6.5 27Q6 8 16 6.5Q26 8 25.5 27L22.3 24L19.2 27L16 24L12.8 27L9.7 24Z"
      style="fill:var(--enemy);${ink}" stroke-width="1.8"/>
    <path d="M10 13.5l4.5 2M22 13.5l-4.5 2" style="fill:none;${ink}" stroke-width="1.8"/>
    <circle cx="12.6" cy="17.2" r="2" style="fill:#fff;stroke:var(--ink)" stroke-width="1"/>
    <circle cx="19.4" cy="17.2" r="2" style="fill:#fff;stroke:var(--ink)" stroke-width="1"/>
    <circle cx="12.9" cy="17.5" r=".9" style="fill:var(--ink)"/>
    <circle cx="19.1" cy="17.5" r=".9" style="fill:var(--ink)"/>
    <path d="M13 21.5h6" style="fill:none;${ink}" stroke-width="1.6"/>
  </symbol>

  <symbol id="i-key" viewBox="0 0 32 32">
    <circle cx="10" cy="16" r="5" style="fill:none;stroke:var(--ink)" stroke-width="5"/>
    <path d="M14.5 16H27M23 16v5M27 16v4" style="fill:none;stroke:var(--ink);stroke-linecap:round" stroke-width="5"/>
    <circle cx="10" cy="16" r="5" style="fill:none;stroke:currentColor" stroke-width="2.8"/>
    <path d="M14.5 16H27M23 16v5M27 16v4" style="fill:none;stroke:currentColor;stroke-linecap:round" stroke-width="2.8"/>
  </symbol>

  <symbol id="i-lock" viewBox="0 0 32 32">
    <rect x="3" y="3" width="26" height="26" rx="2" style="fill:currentColor;${ink}" stroke-width="2"/>
    <path d="M3 10H29M3 22H29" style="fill:none;stroke:var(--ink)" stroke-width="1" opacity=".5"/>
    <circle cx="16" cy="14" r="3.2" style="fill:var(--ink)"/>
    <path d="M14.4 15.5L13.5 21.5H18.5L17.6 15.5Z" style="fill:var(--ink)"/>
  </symbol>

  <symbol id="i-mimic-lock" viewBox="0 0 32 32">
    <rect x="3" y="3" width="26" height="26" rx="2" style="fill:currentColor;${ink}" stroke-width="2"/>
    <path d="M3 10H29M3 22H29" style="fill:none;stroke:var(--ink)" stroke-width="1" opacity=".5"/>
    <path d="M3.5 21.6l1.2 1.8l1.2-1.8M26.1 21.6l1.2 1.8l1.2-1.8" style="fill:#fff;stroke:var(--ink);stroke-linejoin:round" stroke-width=".6"/>
    <circle cx="16" cy="14" r="3.2" style="fill:var(--ink)"/>
    <path d="M14.4 15.5L13.5 21.5H18.5L17.6 15.5Z" style="fill:var(--ink)"/>
  </symbol>

  <symbol id="i-mimic-door" viewBox="0 0 32 32">
    <path d="M3 3H29V12H3Z" style="fill:currentColor;${ink}" stroke-width="2"/>
    <path d="M3 20H29V29H3Z" style="fill:currentColor;${ink}" stroke-width="2"/>
    <path d="M3 12H29V20H3Z" style="fill:#5a0d14;${ink}" stroke-width="1.4"/>
    <path d="M4 12l2.5 4l2.5-4l2.5 4l2.5-4l2.5 4l2.5-4l2.5 4l2.5-4l2.5 4l2-4" style="fill:#fff;stroke:var(--ink);stroke-linejoin:round" stroke-width=".8"/>
    <path d="M5 20l2.5-3.5l2.5 3.5M22 20l2.5-3.5l2.5 3.5" style="fill:#fff;stroke:var(--ink);stroke-linejoin:round" stroke-width=".8"/>
    <circle cx="11" cy="7.5" r="1.6" style="fill:#ffd23f;stroke:var(--ink)" stroke-width=".8"/>
    <circle cx="21" cy="7.5" r="1.6" style="fill:#ffd23f;stroke:var(--ink)" stroke-width=".8"/>
  </symbol>

  <symbol id="i-door-open" viewBox="0 0 32 32">
    <path d="M4 4V28M28 4V28" style="fill:none;stroke:currentColor;stroke-linecap:round" stroke-width="3"/>
    <path d="M4 4L10 7V25L4 28" style="fill:currentColor;${ink}" stroke-width="1.3" opacity=".8"/>
  </symbol>

  <symbol id="i-portal" viewBox="0 0 32 32">
    <ellipse cx="16" cy="16" rx="11" ry="13" style="fill:currentColor;fill-opacity:.18;stroke:currentColor" stroke-width="2.6"/>
    <ellipse cx="16" cy="16" rx="7" ry="8.5" style="fill:none;stroke:currentColor" stroke-width="2.2" stroke-dasharray="7 3"/>
    <ellipse cx="16" cy="16" rx="3" ry="4" style="fill:currentColor"/>
  </symbol>

  <symbol id="i-player" viewBox="0 0 32 32">
    <ellipse cx="16" cy="27" rx="9" ry="2.6" style="fill:var(--ink)" opacity=".18"/>
    <path d="M9.5 27Q9 20 13.4 17.2A6 6 0 1 1 18.6 17.2Q23 20 22.5 27Z" style="fill:var(--player);${ink}" stroke-width="1.8"/>
    <circle cx="14.2" cy="9.8" r="1.6" style="fill:#fff" opacity=".7"/>
  </symbol>

  <symbol id="i-cross" viewBox="0 0 32 32">
    <path d="M7 8Q16 15 25 25M25 7Q17 16 7.5 25" style="fill:none;stroke:var(--pencil);stroke-linecap:round" stroke-width="2.4"/>
  </symbol>

  <symbol id="i-sp-noclip" viewBox="0 0 32 32">
    <rect x="12" y="4" width="8" height="24" style="fill:url(#hatch);stroke:var(--ink)" stroke-width="1.6"/>
    <path d="M3 16H29M24 11l5 5-5 5" style="fill:none;stroke:currentColor;stroke-linecap:round;stroke-linejoin:round" stroke-width="2.6" stroke-dasharray="4 2.5"/>
  </symbol>
  <symbol id="i-sp-fireball" viewBox="0 0 32 32">
    <path d="M16 29C9 29 6 24 7 18.5C8 13.5 12 12 12.5 6C16 8.5 17 11.5 16.5 14C18.5 12.5 19.5 10.5 19.5 8.5C24 12 26 16 25.5 20.5C25 25.5 21.5 29 16 29Z"
      style="fill:#f08a24;${ink}" stroke-width="1.6"/>
    <path d="M16 27C12.5 27 11 24.5 11.6 21.8C12.2 19 14.5 18 15 15.5C17 17.5 18 18 18.5 20C19.5 18.8 20 18 20 17C21.5 19 21.8 21 21.5 22.5C21 25.5 19 27 16 27Z" style="fill:#ffd23f"/>
  </symbol>
  <symbol id="i-sp-luck" viewBox="0 0 32 32">
    <rect x="4" y="9" width="14" height="14" rx="3" transform="rotate(-12 11 16)" style="fill:var(--die);${ink}" stroke-width="1.6"/>
    <rect x="14" y="9" width="14" height="14" rx="3" transform="rotate(10 21 16)" style="fill:var(--die);${ink}" stroke-width="1.6"/>
    <circle cx="11" cy="16" r="1.6" style="fill:#c8372d"/>
    <circle cx="21" cy="16" r="1.6" style="fill:#c8372d"/>
    <path d="M7 6Q16 0 25 6" style="fill:none;stroke:currentColor;stroke-linecap:round" stroke-width="2"/>
    <path d="M10 27l2.5-1.5M22 27l-2.5-1.5M16 29v-3" style="fill:none;stroke:currentColor;stroke-linecap:round" stroke-width="1.8"/>
  </symbol>
  <symbol id="i-sp-reroll" viewBox="0 0 32 32">
    <rect x="9" y="9" width="14" height="14" rx="3" style="fill:var(--die);${ink}" stroke-width="1.6"/>
    <circle cx="13" cy="13" r="1.4" style="fill:var(--ink)"/><circle cx="19" cy="19" r="1.4" style="fill:var(--ink)"/>
    <path d="M5 13A11.5 11.5 0 0 1 25 7M27 19A11.5 11.5 0 0 1 7 25" style="fill:none;stroke:currentColor;stroke-linecap:round" stroke-width="2.2"/>
    <path d="M25 3V7.5H20.5M7 29V24.5H11.5" style="fill:none;stroke:currentColor;stroke-linecap:round;stroke-linejoin:round" stroke-width="2.2"/>
  </symbol>
  <symbol id="i-sp-invis" viewBox="0 0 32 32">
    <path d="M9.5 27Q9 20 13.4 17.2A6 6 0 1 1 18.6 17.2Q23 20 22.5 27Z" style="fill:var(--player);fill-opacity:.25;stroke:currentColor;stroke-linejoin:round" stroke-width="2" stroke-dasharray="3 2.4"/>
    <path d="M24 5l1 2.4 2.4 1-2.4 1-1 2.4-1-2.4-2.4-1 2.4-1ZM6 19l.8 1.8 1.8.8-1.8.8L6 24.2l-.8-1.8-1.8-.8 1.8-.8Z" style="fill:currentColor"/>
  </symbol>
  <symbol id="i-sp-maxhp" viewBox="0 0 32 32">
    <use href="#i-heart"/>
    <path d="M22 4v8M18 8h8" style="fill:none;stroke:var(--good);stroke-linecap:round" stroke-width="3"/>
  </symbol>
  <symbol id="i-sp-heal" viewBox="0 0 32 32">
    <path d="M11 6h10v4l-2 3v13a2 2 0 0 1-2 2h-2a2 2 0 0 1-2-2V13l-2-3Z" style="fill:#e0453a;${ink}" stroke-width="1.6"/>
    <rect x="10.5" y="3.5" width="11" height="3" rx="1" style="fill:var(--stone);${ink}" stroke-width="1.4"/>
    <path d="M13 18h6" style="fill:none;stroke:#fff;stroke-linecap:round" stroke-width="1.5" opacity=".7"/>
  </symbol>
  <symbol id="i-sp-str" viewBox="0 0 32 32">
    <path d="M7 25L22 10M19 7l6 6M5 27l4-4" style="fill:none;${ink}" stroke-width="5"/>
    <path d="M7 25L22 10" style="fill:none;stroke:#c9ccd3;stroke-linecap:round" stroke-width="3"/>
    <path d="M19 7l6 6" style="fill:none;stroke:#b7712f;stroke-linecap:round" stroke-width="3"/>
    <path d="M5 27l4-4" style="fill:none;stroke:#7a4a1c;stroke-linecap:round" stroke-width="3"/>
  </symbol>
  <symbol id="i-sp-gamble" viewBox="0 0 32 32">
    <path d="M6 28h20l-2-7H8Z" style="fill:#e8b923;${ink}" stroke-width="1.6"/>
    <rect x="9" y="5" width="14" height="14" rx="3" transform="rotate(14 16 12)" style="fill:var(--die);${ink}" stroke-width="1.6"/>
    <circle cx="13" cy="9.5" r="1.4" style="fill:var(--ink)"/><circle cx="16" cy="12" r="1.4" style="fill:var(--ink)"/><circle cx="19" cy="14.5" r="1.4" style="fill:var(--ink)"/>
  </symbol>`;

  const use = (id, x, y, extra) =>
    `<use href="#${id}" x="${x * C}" y="${y * C}" width="${C}" height="${C}"${extra || ''}/>`;
  const center = (v) => v * C + C / 2;

  function boardShell(svg) {
    svg.innerHTML = `<defs>${SYMBOLS}</defs><g class="static"></g><g class="dyn"></g>`;
  }

  function staticLayer(L) {
    const { w, h, tiles } = L;
    const wall = (x, y) => x < 0 || y < 0 || x >= w || y >= h || tiles[y * w + x] === 0;
    let walls = '', edges = '';
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const X = x * C, Y = y * C;
        if (wall(x, y)) { walls += `M${X} ${Y}h${C}v${C}h-${C}z`; continue; }
        if (wall(x, y - 1)) edges += `M${X} ${Y}h${C}`;
        if (wall(x, y + 1)) edges += `M${X} ${Y + C}h${C}`;
        if (wall(x - 1, y)) edges += `M${X} ${Y}v${C}`;
        if (wall(x + 1, y)) edges += `M${X + C} ${Y}v${C}`;
      }
    }
    return `<rect width="${w * C}" height="${h * C}" style="fill:var(--paper)"/>
      <rect width="${w * C}" height="${h * C}" fill="url(#grid)"/>
      <path d="${walls}" style="fill:var(--wall)"/>
      <path d="${walls}" fill="url(#hatch)"/>
      <path d="${edges}" class="edge"/>`;
  }

  function objectSvg(o, i) {
    const color = COLORS[o.color] ? ` style="color:${COLORS[o.color]}"` : '';
    let sym = o.type === 'enemy' && o.stalker ? 'i-stalker' : 'i-' + o.type;
    if (o.type === 'lock' && o.mimic) sym = 'i-mimic-lock';
    if (o.type === 'enemy' && o.mimic) sym = o.mimic === 'door' ? 'i-mimic-door' : 'i-mimic-open';
    const opened = o.done && (o.type === 'lock' || o.mimic === 'door'); // a dead door mimic leaves a doorway
    if (opened) sym = 'i-door-open';
    let out = use(sym, o.x, o.y, color);
    if (o.type === 'enemy' && !o.done && o.maxHp > 1) {
      const bx = o.x * C + C - 9, by = o.y * C + 2;
      out += `<g class="badge"><circle cx="${bx + 4}" cy="${by + 4}" r="6"/><text x="${bx + 4}" y="${by + 7.6}">${o.hp}</text></g>`;
    }
    if (o.done && !opened && o.type !== 'portal') out += use('i-cross', o.x, o.y);
    const cls = o.done && !opened ? 'obj done' : 'obj';
    return `<g class="${cls}" data-obj="${i}">${out}</g>`;
  }

  /* Darkness: a fog rect over the map, with holes cut by a mask. Lit squares
   * are clear; remembered squares (unless memory is 'none') show dimly. */
  function fogLayer(game, memory) {
    const L = game.s.level, W = L.w * C, H = L.h * C;
    let lit = '', seen = '';
    for (let i = 0; i < L.w * L.h; i++) {
      const sq = `M${(i % L.w) * C} ${((i / L.w) | 0) * C}h${C}v${C}h-${C}z`;
      if (game.vis && game.vis.has(i)) lit += sq;
      else if (memory !== 'none' && L.seen && L.seen[i]) seen += sq;
    }
    return `<mask id="fog-mask" maskUnits="userSpaceOnUse" x="0" y="0" width="${W}" height="${H}">
        <rect width="${W}" height="${H}" fill="#fff"/>
        <g filter="url(#fog-soft)"><path d="${seen}" fill="#9a9a9a"/><path d="${lit}" fill="#000"/></g>
      </mask>
      <rect class="fog" width="${W}" height="${H}" mask="url(#fog-mask)"/>`;
  }

  function dynamicLayer(game, ui) {
    const s = game.s, L = s.level, p = s.player;
    const dark = !!L.dark;
    const memory = dark ? DC.rules.darkMemory(s.floor) : 'full';
    const lit = (x, y) => game.isVisible(x, y);
    const remembered = (x, y) => memory !== 'none' && L.seen && L.seen[y * L.w + x];
    // Enemies only show while lit; other objects stay marked once seen on 'full' memory floors.
    const shows = (o) => !dark || lit(o.x, o.y) || (o.type !== 'enemy' && memory === 'full' && o.seen);

    let out = '';
    if (!dark || lit(L.start.x, L.start.y) || remembered(L.start.x, L.start.y)) out += use('i-start', L.start.x, L.start.y);

    for (const seg of L.trail) {
      if (seg.length > 1) out += `<polyline class="trail" points="${seg.map(([x, y]) => `${center(x)},${center(y)}`).join(' ')}"/>`;
      const [x0, y0] = seg[0];
      out += `<circle class="trail-dot" cx="${center(x0)}" cy="${center(y0)}" r="2.6"/>`;
    }

    L.objects.forEach((o, i) => { if (shows(o)) out += objectSvg(o, i); });

    if (dark) out += fogLayer(game, memory);
    // Stairs stay clearly marked once seen, drawn above the fog.
    if (!dark || lit(L.stairs.x, L.stairs.y) || L.seenStairs) out += use('i-stairs', L.stairs.x, L.stairs.y);

    out += `<g class="player${s.armed.invis ? ' invisible' : ''}${s.armed.noclip ? ' noclip' : ''}${L.torchLit ? ' torchlit' : ''}">${use('i-player', p.x, p.y)}</g>`;

    if (ui.targeting) {
      for (const i of game.fireballTargets()) {
        const o = L.objects[i];
        out += `<rect class="target" data-target="${i}" x="${o.x * C + 1.5}" y="${o.y * C + 1.5}" width="${C - 3}" height="${C - 3}" rx="6"/>`;
      }
    } else if (ui.aiming && !ui.busy) {
      // Range boost: enemies close enough to shoot directly.
      for (const i of game.freeTargets()) {
        const o = L.objects[i];
        out += `<rect class="target free" data-shoot="${i}" x="${o.x * C + 1.5}" y="${o.y * C + 1.5}" width="${C - 3}" height="${C - 3}" rx="6"/>`;
      }
      for (const d of game.shotDirs()) {
        const ax = p.x + DC.DIRS[d][0], ay = p.y + DC.DIRS[d][1];
        out += `<g class="arrow aim" data-dir="${d}" transform="translate(${center(ax)} ${center(ay)})">
          <circle r="13"/><path d="M-7 0H6M0.5-5.5L6.5 0L0.5 5.5" transform="rotate(${ANGLE[d]})"/></g>`;
      }
    } else if (!ui.busy) {
      const steps = game.stepsLeft();
      for (const d of game.availableDirs()) {
        const m = game.legalMove(d, steps);
        // Never reveal an unseen landing square: put a No Clipping arrow on the wall instead.
        let ax = m.x, ay = m.y;
        if (m.kind === 'noclip' && !lit(m.x, m.y)) { ax = p.x + DC.DIRS[d][0]; ay = p.y + DC.DIRS[d][1]; }
        out += `<g class="arrow${m.kind === 'noclip' ? ' ghost' : ''}" data-dir="${d}" transform="translate(${center(ax)} ${center(ay)})">
          <circle r="13"/><path d="M-7 0H6M0.5-5.5L6.5 0L0.5 5.5" transform="rotate(${ANGLE[d]})"/></g>`;
      }
    }
    return out;
  }

  // Dashed straight-line preview of the hovered direction (its own layer so
  // hovering never re-creates the clickable arrows).
  function previewLayer(game, preview, shot) {
    if (shot && shot.length) {
      const p = game.s.player;
      const [lx, ly] = shot[shot.length - 1];
      return `<polyline class="shotline" points="${[[p.x, p.y], ...shot].map(([x, y]) => `${center(x)},${center(y)}`).join(' ')}"/>
        <circle class="shot-end" cx="${center(lx)}" cy="${center(ly)}" r="6"/>`;
    }
    if (!preview || !preview.length) return '';
    const p = game.s.player;
    const [lx, ly] = preview[preview.length - 1];
    return `<polyline class="preview" points="${[[p.x, p.y], ...preview].map(([x, y]) => `${center(x)},${center(y)}`).join(' ')}"/>
      <circle class="preview-end" cx="${center(lx)}" cy="${center(ly)}" r="5"/>`;
  }

  // Shop floors get an illustrated storefront instead of a map.
  function shopScene() {
    const W = 17 * C, H = 13 * C;
    return `<rect width="${W}" height="${H}" style="fill:var(--paper)"/>
      <rect width="${W}" height="${H}" fill="url(#grid)"/>
      <g transform="translate(${W / 2 - 170} 40)">
        <path d="M0 70H340V330H0Z" style="fill:var(--stone);${ink}" stroke-width="3"/>
        <path d="M-15 70L20 10H320L355 70Z" style="fill:#c8372d;${ink}" stroke-width="3"/>
        <path d="M45 10L30 70M90 10L85 70M135 10L135 70M205 10L205 70M250 10L255 70M295 10L310 70" style="fill:none;stroke:#f4f4f0" stroke-width="12" opacity=".85"/>
        <path d="M-15 70L20 10H320L355 70Z" style="fill:none;${ink}" stroke-width="3"/>
        <rect x="95" y="22" width="150" height="36" rx="6" style="fill:var(--paper);${ink}" stroke-width="2.5"/>
        <text x="170" y="49" class="shop-title">SHOP</text>
        <g transform="translate(130 100)">
          <circle cx="40" cy="40" r="32" style="fill:#f1c9a5;${ink}" stroke-width="3"/>
          <path d="M8 34Q40 -6 72 34Q60 18 40 18Q20 18 8 34Z" style="fill:#7a4a1c;${ink}" stroke-width="2.5"/>
          <circle cx="29" cy="42" r="3.4" style="fill:var(--ink)"/><circle cx="51" cy="42" r="3.4" style="fill:var(--ink)"/>
          <path d="M24 56Q40 66 56 56" style="fill:none;${ink}" stroke-width="3"/>
          <path d="M18 52Q40 74 62 52Q60 80 40 82Q20 80 18 52Z" style="fill:#5a3a1a;${ink}" stroke-width="2"/>
          <path d="M-10 140Q-6 84 40 84Q86 84 90 140Z" style="fill:#2f7fd8;${ink}" stroke-width="3"/>
        </g>
        <rect x="-10" y="235" width="360" height="40" style="fill:#9c5a22;${ink}" stroke-width="3"/>
        <use href="#i-sp-heal" x="20" y="195" width="44" height="44"/>
        <use href="#i-coin" x="80" y="205" width="34" height="34"/><use href="#i-coin" x="98" y="200" width="34" height="34"/>
        <use href="#i-sp-fireball" x="230" y="192" width="46" height="46"/>
        <use href="#i-chest" x="282" y="190" width="50" height="50"/>
      </g>`;
  }

  const PIPS = {
    1: [[50, 50]], 2: [[28, 28], [72, 72]], 3: [[28, 28], [50, 50], [72, 72]],
    4: [[28, 28], [72, 28], [28, 72], [72, 72]], 5: [[28, 28], [72, 28], [50, 50], [28, 72], [72, 72]],
    6: [[28, 26], [72, 26], [28, 50], [72, 50], [28, 74], [72, 74]],
  };
  function dieSvg(v, cls) {
    const pips = v ? PIPS[v].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="9"/>`).join('') :
      '<text x="50" y="64" class="die-q">?</text>';
    return `<svg viewBox="0 0 100 100" class="die ${cls || ''}" role="img" aria-label="${v ? 'Die showing ' + v : 'Die not rolled'}">
      <rect x="5" y="5" width="90" height="90" rx="18" class="die-face"/>${pips}</svg>`;
  }

  // A standalone SVG icon from the symbol sheet (used in HTML panels).
  function icon(id, cls, color) {
    return `<svg viewBox="0 0 32 32" class="icon ${cls || ''}" aria-hidden="true"${color ? ` style="color:${color}"` : ''}><use href="#${id}"/></svg>`;
  }

  DC.render = { C, COLORS, SYMBOLS, boardShell, staticLayer, dynamicLayer, previewLayer, shopScene, dieSvg, icon };
})(typeof window !== 'undefined' ? window : globalThis);
