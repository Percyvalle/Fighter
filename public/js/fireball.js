/* Presentation only: damage is still applied by the shared fight timeline. */
(function (root) {
  function create({ canvas, dim, corners }) {
    const ctx = canvas.getContext('2d');
    const texture = document.createElement('canvas');
    texture.width = texture.height = 128;
    const textureCtx = texture.getContext('2d');
    let active = null, frame = 0;
    function stop() {
      cancelAnimationFrame(frame);
      active = null;
      dim.style.opacity = '0';
      for (const side of ['fighter', 'gorilla']) corners[side].classList.remove('super-caster');
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
    function start(side, spec, video, elapsed = 0) {
      stop();
      active = { side, spec, video, origin: performance.now()-elapsed };
      draw();
    }
    function glow(x, y, radius, opacity = 1) {
      const g = ctx.createRadialGradient(x,y,0,x,y,radius*2.5);
      g.addColorStop(0, `rgba(255,226,135,${.7*opacity})`);
      g.addColorStop(.3, `rgba(255,137,15,${.4*opacity})`);
      g.addColorStop(1, 'rgba(255,55,0,0)');
      ctx.fillStyle = g;
      ctx.fillRect(x-radius*2.5,y-radius*2.5,radius*5,radius*5);
    }
    function draw() {
      if (!active) return;
      const { side, spec, video, origin } = active;
      const ms = performance.now()-origin;
      if (ms >= spec.durationMs) return stop();
      if (canvas.width !== innerWidth || canvas.height !== innerHeight) {
        canvas.width = innerWidth; canvas.height = innerHeight;
      }
      ctx.clearRect(0,0,canvas.width,canvas.height);
      const charging = ms >= spec.chargeMs && ms < spec.releaseMs;
      dim.style.opacity = charging ? '.68' : '0';
      corners[side].classList.toggle('super-caster', charging);
      const r = video.getBoundingClientRect();
      const point = p => ({ x: side === 'fighter' ? r.left+r.width*p.x : r.right-r.width*p.x,
        y: r.top+r.height*p.y });
      const source = point(spec.hand), charge = point(spec.charge);
      const targetSide = side === 'fighter' ? 'gorilla' : 'fighter';
      const targetRect = corners[targetSide].getBoundingClientRect();
      const target = { x: targetRect.left+targetRect.width*.5, y: targetRect.top+targetRect.height*.36 };
      const scale = innerHeight/1080;
      if (charging) {
        const p = (ms-spec.chargeMs)/(spec.releaseMs-spec.chargeMs);
        const radius = (16+42*p)*(1+.06*Math.sin(ms*.018))*scale;
        glow(charge.x,charge.y,radius);
        for (let i=0;i<13;i++) {
          const a = i*2.4+ms*.002, dist = (30+100*(1-(ms*.001+i*.17)%1))*scale;
          ctx.fillStyle = 'rgba(255,193,65,.9)';
          ctx.beginPath(); ctx.arc(charge.x+Math.cos(a)*dist,charge.y+Math.sin(a)*dist*.7,2*scale,0,Math.PI*2);ctx.fill();
        }
      }
      if (ms >= spec.releaseMs && ms < spec.contactMs) {
        const p = (ms-spec.releaseMs)/(spec.contactMs-spec.releaseMs);
        const x = source.x+(target.x-source.x)*p, y = source.y+(target.y-source.y)*p;
        const direction = side === 'fighter' ? 1 : -1, radius = 79*scale;
        glow(x,y,radius);
        for (let k=18;k>0;k--) {
          const q=k/18, rr=radius*(1-q)*.8;
          ctx.fillStyle=`rgba(255,${100+100*(1-q)},10,${.7*(1-q)})`;
          ctx.beginPath();ctx.ellipse(x-direction*q*250*scale,y+Math.sin(k*.7+ms*.04)*q*18*scale,Math.max(1,rr),Math.max(1,rr*.65),0,0,Math.PI*2);ctx.fill();
        }
        const pixels=textureCtx.createImageData(128,128), t=ms/1000;
        for(let py=0;py<128;py++) for(let px=0;px<128;px++) {
          const dx=(px-64)*1.25,dy=(py-64)*1.25,dist=Math.hypot(dx,dy),a=Math.atan2(dy,dx);
          const edge=64*(1+.055*Math.sin(a*7+t*28)+.035*Math.cos(a*11-t*22));
          const noise=(Math.sin(dx*.17+dy*.11+t*32)+Math.sin(dx*.08-dy*.19-t*24)+Math.cos(dist*.24-a*3+t*18))/3;
          const heat=Math.max(0,Math.min(1,.36+.52*(1-dist/64)+.24*noise)),i=(py*128+px)*4;
          pixels.data[i]=255;pixels.data[i+1]=65+190*heat;pixels.data[i+2]=5+210*heat**3;
          pixels.data[i+3]=255*Math.max(0,Math.min(1,(edge-dist)/4));
        }
        textureCtx.putImageData(pixels,0,0);
        ctx.drawImage(texture,x-radius*1.25,y-radius*1.25,radius*2.5,radius*2.5);
      }
      const dt=(ms-spec.contactMs)/1000;
      if(dt>=0 && dt<.85) {
        glow(target.x,target.y,(93+180*dt)*scale,Math.max(0,1-dt/.65));
        const rr=(48+496*dt)*scale;
        ctx.strokeStyle=`rgba(255,193,65,${Math.max(0,1-dt/.6)})`;ctx.lineWidth=8*scale;
        ctx.beginPath();ctx.arc(target.x,target.y,rr,0,Math.PI*2);ctx.stroke();
        for(let i=0;i<40;i++) {
          const a=i*2.4,speed=(180+(i*79)%500)*scale;
          ctx.strokeStyle=`rgba(255,${130+i%90},35,${Math.max(0,1-dt/.85)})`;ctx.lineWidth=3*scale;
          const x=target.x+Math.cos(a)*speed*dt,y=target.y+Math.sin(a)*speed*dt+180*dt*dt*scale;
          ctx.beginPath();ctx.moveTo(x,y);ctx.lineTo(x-Math.cos(a)*18*scale,y-Math.sin(a)*18*scale);ctx.stroke();
        }
      }
      frame=requestAnimationFrame(draw);
    }
    return { start, stop };
  }
  root.FireballFX = { create };
})(typeof window !== 'undefined' ? window : globalThis);
