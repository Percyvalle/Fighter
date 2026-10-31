/* Roster: the characters the streamer can put in the left corner, or in the
   right one in the gorilla's place (mirrored, so they face left). Shared by the host (ids and names, for the panel and chat) and the
   overlay (assets and timing). A plain script, like fight.js, so the overlay's
   demo also works when opened straight from disk.

   Per character:
     still     the stance as a PNG: the layout box, and the fallback if video fails
     idle      stance loop, on the still's canvas
     attack    the ordinary blow: clip, `contactMs` (where in the clip the blow lands,
               so it starts that long before contact) and `reach` (how far the dash
               carries the character, so the fist stops at the gorilla's face at 16:9)
     crit      optional: replaces the attack on a critical blow; without one the
               crit is the attack clip with the crit's flash, number and knockback
     defeat    optional: played when the character loses the whole fight; without
               one they fade out greyed
     head      where the head is across the box, for the damage numbers
     sfx       optional: own sounds — `punch` clips in place of Vlad's (`peakMs`: how
               far into them the hit is), `crit` a shout started with the crit clip,
               `hurt` groans when the gorilla lands a blow, `win` one of them when
               they win the fight, `lose` a reaction to losing the whole fight
     label     optional: how the panel's picker shows them, when two characters
               share a name (Paver in white and in red) */
(function (root) {
  // Paver's voice and punches (both outfits), cut from Downloads/Звуки: each punch
  // hits about 35 ms in; the crit shout, started with the crit clip, peaks ~620 ms
  // in, right on the blow.
  const PAVER_SFX = {
    punch: [1, 2, 3].map(n => `assets/sfx/paver-punch-${n}.ogg`), peakMs: 35,
    crit: 'assets/sfx/paver-crit.ogg',
    hurt: [1, 2, 3].map(n => `assets/sfx/paver-hurt-${n}.ogg`),
    win: [1, 2].map(n => `assets/sfx/paver-win-${n}.ogg`),
  };

  const CHARACTERS = {
    vlad: {
      name: 'ВЛАД',
      still: 'assets/fighter.png',
      idle: 'assets/anim/vlad-idle.webm',
      // straight punch, full reach at f72 of its source
      attack: { src: 'assets/anim/vlad-punch.webm', contactMs: 542, reach: '33vw' },
      // spinning kick: foot out, the strike flash about to fire
      crit: { src: 'assets/anim/vlad-kick.webm', contactMs: 520, reach: '35vw' },
      // doubles over, tears his T-shirt, cries; stops on its last frame
      defeat: 'assets/anim/vlad-defeat.webm',
      head: 0.55,
      sfx: {
        // Only approved review variants A and C; pick() avoids consecutive repeats.
        punch: ['assets/sfx/vlad-attack-a.mp3', 'assets/sfx/vlad-attack-c.mp3'], peakMs: 35,
        crit: 'assets/sfx/vlad-crit-complete.ogg',
        hurt: [1, 2, 3, 4, 5, 6, 7].map(n => `assets/sfx/vlad-hurt-${n}.ogg`),
        win: ['assets/sfx/vlad-win.ogg'],
        lose: ['assets/sfx/vlad-defeat.ogg'],
      },
    },
    fighter2: {
      name: 'ПАВЕР',
      label: 'ПАВЕР — Белый',
      still: 'assets/fighter2.png',
      idle: 'assets/anim/f2-idle.webm',
      // step in and jab: fist fully out on clip frame 7 of 24 fps. The fist sits
      // 0.14 box-heights nearer his body than Vlad's at contact, so a longer dash.
      attack: { src: 'assets/anim/f2-punch.webm', contactMs: 292, reach: '38vw' },
      // shout, coil, lunging straight with a 3-frame hit-stop on the impact: fist
      // fully out on clip frame 14. It lands at head height, where the gorilla's brow
      // juts out further than its face at the jab's height, so a shorter dash.
      crit: { src: 'assets/anim/f2-crit.webm', contactMs: 583, reach: '37.5vw' },
      head: 0.55,
      sfx: PAVER_SFX,
    },
    // Paver in the red track jacket and ushanka, shot on a green screen.
    fighter3: {
      name: 'ПАВЕР',
      label: 'ПАВЕР — Красный',
      still: 'assets/fighter3.png',
      idle: 'assets/anim/f3-idle.webm',
      // wind-up and jab: fist fully out on clip frame 8 of 24 fps. It ends 0.02
      // box-heights further out than the white Paver's, so a slightly shorter dash.
      attack: { src: 'assets/anim/f3-punch.webm', contactMs: 333, reach: '37.2vw' },
      // super punch: a setup jab, the fist drawn back, then a lunging straight with a
      // 3-frame hit-stop: fist fully out on clip frame 14. It lands 0.06 box-heights
      // nearer his body than the jab, so a longer dash.
      crit: { src: 'assets/anim/f3-crit.webm', contactMs: 583, reach: '39.6vw' },
      head: 0.55,
      sfx: PAVER_SFX,
    },
  };

  root.Roster = { CHARACTERS, DEFAULT: 'vlad' };
})(typeof window !== 'undefined' ? window : globalThis);
