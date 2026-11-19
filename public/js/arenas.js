/* Shared arena catalogue for the host and the overlay's standalone demo. */
(function (root) {
  const DEFAULT = 'temple';
  const ARENAS = {
    temple: { name: 'Затерянный храм', background: 'assets/bg.jpg' },
    sunset: { name: 'Храм на закате', background: 'assets/arenas/sunset.jpg' },
  };
  const has = id => typeof id === 'string' && Object.hasOwn(ARENAS, id);
  root.Arenas = { ARENAS, DEFAULT, has };
})(typeof window !== 'undefined' ? window : globalThis);
