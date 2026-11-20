import test from 'node:test';
import assert from 'node:assert/strict';
import '../public/js/fight.js';
const { make, FIREBALL } = globalThis.FightScript;
function rng(seed) { let s=seed; return n => { s=(s*1664525+1013904223)>>>0;return Math.floor(s/2**32*n); }; }

test('meter supers deal exactly 35 HP, preserve results and reserve the complete cast time', () => {
  let seen=0;
  for(let seed=1;seed<=150;seed++) for(const side of ['fighter','gorilla']) {
    const characters={fighter:'fighter2',gorilla:'gorilla',[side]:'vlad'};
    const original=make('fighter',rng(seed));
    const script=make('fighter',rng(seed),characters);
    assert.deepEqual(script.score,original.score);
    let meter={fighter:0,gorilla:0};
    for(const round of script.rounds) {
      const hits=script.hits.filter(h=>h.round===round.n-1);
      assert.deepEqual(round.meterStart,meter);
      assert.ok(hits.filter(h=>h.super).length<=1);
      let hp={fighter:100,gorilla:100};
      for(let i=0;i<hits.length;i++) {
        const h=hits[i];
        const target=h.by==='fighter'?'gorilla':'fighter';
        assert.equal(hp[target]-h.hp[target],h.dmg);
        assert.ok(h.ko ? h.hp[target]===0 : h.hp[target]>0);
        assert.ok(h.hp[h.by]>0);
        hp=h.hp;
        if(!h.super) {
          if(h.by===side) { assert.ok(meter[side]<3);meter[side]++; }
          assert.deepEqual(h.meter,meter);
          continue;
        }
        seen++;
        assert.equal(h.by,side);assert.equal(meter[side],3);assert.equal(h.dmg,35);
        meter[side]=0;assert.deepEqual(h.meter,meter);
        const start=h.at+170-FIREBALL.contactMs;
        const end=start+FIREBALL.durationMs;
        assert.ok(start>=(i ? hits[i-1].at+820 : round.fight));
        assert.ok(i+1<hits.length ? hits[i+1].at-600>end : round.end>end);
      }
      assert.deepEqual(round.meterEnd,meter);
    }
    assert.deepEqual(script.meter,meter);
    const otherWinner=make('gorilla',rng(seed),characters);
    assert.deepEqual(script.hits.slice(0,4),otherWinner.hits.slice(0,4));
  }
  assert.ok(seen>0);
  assert.equal(FIREBALL.releaseMs-FIREBALL.chargeMs,2000);
  assert.equal(FIREBALL.contactMs-FIREBALL.releaseMs,250);
});

test('charge carries across rounds and a full meter fires on the next own turn without a crit roll', () => {
  let carried=0,normalSupers=0;
  for(let seed=1;seed<=100;seed++) {
    const s=make('gorilla',rng(seed),{fighter:'vlad',gorilla:'gorilla'});
    for(let i=1;i<s.rounds.length;i++) {
      const r=s.rounds[i];
      if(r.meterStart.fighter!==3)continue;
      carried++;
      const firstOwn=s.hits.find(h=>h.round===i&&h.by==='fighter');
      assert.equal(firstOwn.super,'fireball');
      if(!firstOwn.crit)normalSupers++;
    }
  }
  assert.ok(carried>0);assert.ok(normalSupers>0);
});

test('other roster characters do not gain Vlad fireballs', () => {
  for(let seed=1;seed<40;seed++) {
    const script=make('fighter',rng(seed),{fighter:'fighter4',gorilla:'fighter3'});
    assert.ok(script.hits.every(h=>!h.super));
  }
});
