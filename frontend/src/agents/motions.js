// Adapted from leonarda4/brainy-hq motion kit v1.1 (ES module export).
  'use strict';
  const TAU = Math.PI * 2;
  const phase = (seconds, period) => ((seconds / period) % 1 + 1) % 1;
  const pulse = (t, center, width) => {
    const d = Math.abs(t - center) / width;
    return d < 1 ? (1 + Math.cos(Math.PI * d)) / 2 : 0;
  };
  const blink = (t, center = .72, width = .035) => 1 - .92 * pulse(t, center, width);
  // A short attack, a readable hold, and a slower release. All times are normalized.
  function beat(t, start, peak, hold, end) {
    if (t <= start || t >= end) return 0;
    if (t < peak) return 1 - Math.pow(1 - (t - start) / (peak - start), 3);
    if (t <= hold) return 1;
    const u = (t - hold) / (end - hold);
    return 1 - u * u * (3 - 2 * u);
  }
  const lid = (t, at = .7) => 1 - .94 * beat(t, at, at + .012, at + .022, at + .068);
  function track(t, keys) {
    for (let i = 1; i < keys.length; i++) {
      if (t <= keys[i][0]) {
        const [at, x, y] = keys[i - 1], [end, nx, ny] = keys[i];
        const u = Math.max(0, Math.min(1, (t - at) / (end - at)));
        const ease = u * u * (3 - 2 * u);
        return [x + (nx - x) * ease, y + (ny - y) * ease];
      }
    }
    return keys[keys.length - 1].slice(1);
  }
  const bodies = [
    ['still','Still','shared'], ['breathe','Breathe','shared'], ['float','Float','shared'],
    ['bounce','Bounce & land','shared'], ['squash','Squash & stretch','shared'],
    ['spin','Quick spin · 1 turn','shared'], ['spin-double','Quick spin · 2 turns','shared'], ['loading','Loading · slow spin + float','shared'],
    ['wobble','Wobble','shared'], ['pop','Pop with delight','shared'],
    ['nod','Yes · little nod','shared'], ['shake','No · gentle shake','shared'],
    ['original','Original body movement','shared'],
    ['memo','Memo · listening sway','signature'], ['brainy','Brainy · gather & bloom','signature'],
    ['scout','Scout · peek & discover','signature'], ['prism','Prism · weigh two sides','signature'],
    ['archie','Archie · build & settle','signature'], ['jayson','Jayson · bundle & release','signature'],
    ['finn','Finn · decisive nod','signature'], ['storm','Storm · focus nudge','signature']
  ];
  const eyes = [
    ['calm','Calm blink'], ['original','Original gaze & blink'], ['attentive','Attentive'],
    ['scan','Scan left & right'], ['think','Thinking · look up'], ['double','Double blink'],
    ['wink','Playful wink'], ['curious','Curious · one eye wider'], ['focus','Focused squint'],
    ['surprise','Wide-eyed surprise'], ['happy','Happy squint'], ['sleepy','Sleepy blink'],
    ['orbit','Round-and-round gaze'], ['look','Look around'],
    ['doubletake','Double take · snap, hold, return'], ['aha','Aha! · squint, open, settle']
  ];
  const personalities = {
    Memo: {body:'memo',eyes:'attentive',trait:'Warm & attentive',note:'A patient listener who leans in, with little pulses in the side ovals.'},
    Brainy: {body:'brainy',eyes:'think',trait:'Thoughtful & inventive',note:'Compresses while gathering thoughts, then opens up when an idea clicks.'},
    Scout: {body:'scout',eyes:'scan',trait:'Curious & adventurous',note:'Peeks out, scans the surroundings, and perks up at a discovery.'},
    Prism: {body:'prism',eyes:'curious',trait:'Measured & perceptive',note:'Tilts from one side to the other, taking a moment to consider both.'},
    Archie: {body:'archie',eyes:'focus',trait:'Steady & constructive',note:'Rises in two deliberate steps, then settles firmly into place.'},
    Jayson: {body:'jayson',eyes:'look',trait:'Precise & quietly playful',note:'Squeezes inward to gather the details, then releases a tidy bundle.'},
    Finn: {body:'finn',eyes:'happy',trait:'Decisive & reassuring',note:'Gives one clear nod and a small, satisfied rebound. Decision made.'},
    Storm: {body:'storm',eyes:'double',trait:'Alert & mischievous',note:'A quick lean and springy nudge to bring everyone back to the moment.'}
  };
  function original(profile, seconds) {
    const t = phase(seconds, 4), p = TAU * t, w = Math.sin(p);
    const gazes = [[3*w,0],[5*w,-3*Math.cos(p)],[0,2*w],[12*w,0],[12*w,6*Math.cos(p)],[0,4*w]];
    return {y:8*w*.4375,rotation:[.035,.06,.025,.12,.055,.025][profile]*w*180/Math.PI,
      scale:1+[.035,.018,.045,.02,.02,.035][profile]*w,gaze:gazes[profile].map(v=>v*.4375),
      blink:1-.92*Math.max(0,1-Math.abs(t-.64)/.035)};
  }
  function body(key, seconds, profile = 0, intensity = 1) {
    const t = phase(seconds, 3.6), w = Math.sin(TAU*t);
    const m = {x:0,y:0,rotation:0,sx:1,sy:1,ears:1};
    switch (key) {
      case 'breathe': m.sx=1+.025*w; m.sy=1+.025*w; break;
      case 'float': m.y=-7*w; m.rotation=3*Math.cos(TAU*t); break;
      case 'bounce': {
        const q=phase(seconds,1.8), lift=Math.sin(Math.PI*q)**2, land=Math.exp(-Math.pow(Math.sin(Math.PI*q)/.24,2));
        m.y=-22*lift; m.sx=1+.13*land-.06*lift; m.sy=1-.13*land+.08*lift; break;
      }
      case 'squash': m.sx=1-.13*w; m.sy=1+.16*w; m.y=-5*w; break;
      case 'spin':
      case 'spin-double': {
        const turns=key==='spin-double'?2:1, duration=turns===2?1.6:.9;
        const u=Math.max(0,Math.min(1,seconds/duration));
        m.rotation=360*turns*u*u*(3-2*u);
        break;
      }
      case 'loading': {
        const q=phase(seconds,4), lift=Math.sin(Math.PI*q)**2;
        m.rotation=seconds/8*360; m.y=-6*lift; m.sx=1-.025*lift; m.sy=1+.035*lift; break;
      }
      case 'wobble': m.rotation=10*w; m.x=3*w; break;
      case 'pop': {const p=pulse(t,.42,.22); m.sy=1+.10*p; m.sx=1+.08*p; m.y=-13*p; break;}
      case 'nod': {const p=pulse(t,.35,.12); m.y=6*p; m.sy=1-.045*p; break;}
      case 'shake': {const p=pulse(t,.4,.24); m.x=7*Math.sin(TAU*t*4)*p; m.rotation=4*Math.sin(TAU*t*4)*p; break;}
      case 'original': {const o=original(profile,seconds); m.y=o.y; m.rotation=o.rotation; m.sx=o.scale; m.sy=o.scale; break;}
      case 'memo': m.y=-3*w; m.rotation=3*w; m.ears=1+.075*Math.sin(TAU*t*2); m.sy=1+.014*w; break;
      case 'brainy': {
        const gather=pulse(t,.3,.23), bloom=pulse(t,.66,.18);
        m.sx=1+.06*gather+.05*bloom; m.sy=1-.10*gather+.07*bloom; m.y=3*gather-7*bloom; m.rotation=3*bloom; break;
      }
      case 'scout': {
        const left=pulse(t,.22,.17), right=pulse(t,.57,.17), hop=pulse(t,.8,.09);
        m.x=-7*left+7*right; m.rotation=-8*left+8*right; m.y=-8*hop; m.sy=1+.05*hop; break;
      }
      case 'prism': m.rotation=8*w; m.y=-2*Math.sin(TAU*t*2); break;
      case 'archie': {
        const build=pulse(t,.48,.32), step=pulse(t,.53,.15), settle=pulse(t,.85,.08);
        m.y=-6*build-6*step+2*settle; m.sy=1+.045*build-.025*settle; m.sx=1-.025*build+.025*settle; break;
      }
      case 'jayson': {
        const gather=pulse(t,.35,.25), release=pulse(t,.68,.14);
        m.sx=1-.11*gather+.035*release; m.sy=1+.07*gather-.03*release; m.rotation=2*release; break;
      }
      case 'finn': {
        const nod=pulse(t,.32,.1), rebound=pulse(t,.5,.11);
        m.y=7*nod-3*rebound; m.sy=1-.07*nod+.025*rebound; m.sx=1+.035*nod; break;
      }
      case 'storm': {
        const nudge=pulse(t,.27,.09), rebound=pulse(t,.42,.12);
        m.sx=1+.10*nudge-.03*rebound; m.sy=m.sx; m.rotation=-7*nudge+4*rebound; m.x=5*nudge-2*rebound; m.y=-5*nudge; break;
      }
    }
    const amount=Math.max(0,Math.min(1.5,intensity));
    for(const k of ['x','y']) m[k]*=amount;
    if(key!=='spin' && key!=='spin-double' && key!=='loading') m.rotation*=amount;
    for(const k of ['sx','sy','ears']) m[k]=1+(m[k]-1)*amount;
    return m;
  }
  function eye(key, seconds, profile = 0, expression = 1) {
    const t=phase(seconds,4.8), w=Math.sin(TAU*t);
    let gx=0,gy=0,rx=1,ry=1,left=1,right=1,ly=0,ryOffset=0;
    let b=lid(t), leftLid=1, rightLid=1;
    switch(key) {
      case 'original': {const o=original(profile,seconds); [gx,gy]=o.gaze; b=o.blink; break;}
      case 'attentive': {const p=beat(t,.13,.17,.34,.66);gx=1.3*w;gy=-2*p;ry=1+.22*p;right=1-.07*p;break;}
      case 'scan': [gx,gy]=track(t,[[0,0,0],[.12,0,0],[.15,-6.5,-1],[.2,-5.4,-1],[.37,-5.4,-1],[.40,6.7,0],[.45,5.4,0],[.68,5.4,0],[.94,0,0],[1,0,0]]); break;
      case 'think': [gx,gy]=track(t,[[0,0,0],[.12,0,0],[.16,4,-4.5],[.21,3.3,-3.8],[.5,3.3,-3.8],[.85,0,0],[1,0,0]]);left=1-.3*beat(t,.12,.17,.43,.77);right=1+.15*beat(t,.15,.2,.43,.77);break;
      case 'double': b=Math.min(lid(t,.3),lid(t,.40));break;
      case 'wink': leftLid=1-.95*beat(t,.25,.267,.31,.5);right=1+.16*beat(t,.24,.28,.34,.6);break;
      case 'curious': {const p=beat(t,.18,.22,.4,.82);left=1+.35*p;right=1-.4*p;gx=2*p;ly=-1.2*p;break;}
      case 'focus': ry=1-.55*beat(t,.15,.2,.48,.88);gx=2*w;break;
      case 'surprise': {const p=beat(t,.18,.205,.39,.84),anticipate=beat(t,.11,.14,.16,.20);rx=1+.17*p;ry=1+.48*p-.25*anticipate;gy=-2*p;break;}
      case 'happy': {const p=beat(t,.17,.22,.45,.85);ry=1-.65*p;rx=1+.12*p;gy=-2*p;break;}
      case 'sleepy': ry=.7; b=blink(t,.5,.16); gy=2*pulse(t,.5,.25); break;
      case 'orbit': gx=4*Math.sin(TAU*t*2); gy=-3*Math.cos(TAU*t*2); ly=Math.sin(TAU*t)*.5; ryOffset=-ly; break;
      case 'look': [gx,gy]=track(t,[[0,0,0],[.12,0,0],[.15,-4.5,-2],[.34,-4.5,-2],[.38,4.5,2],[.61,4.5,2],[.65,0,-3.5],[.75,0,-3.5],[1,0,0]]);break;
      case 'doubletake': {const p=beat(t,.31,.34,.5,.88);[gx,gy]=track(t,[[0,0,0],[.12,0,0],[.15,5.5,0],[.24,5.5,0],[.28,0,0],[.32,7,-1],[.38,5.5,-1],[.58,5.5,-1],[.96,0,0],[1,0,0]]);ry=1+.35*p;left=1+.1*p;break;}
      case 'aha': {const narrow=beat(t,.08,.13,.22,.29),open=beat(t,.25,.275,.47,.91);ry=1-.45*narrow+.44*open;rx=1+.12*open;gy=-2.5*open;break;}
    }
    // Legacy sampling stays exact regardless of the new expression setting.
    const amount=key==='original'?1:Math.max(.4,Math.min(1.35,expression));
    return [left,right].map((s,i)=>({cx:90+(i?13.5625:-13.5625)+gx*amount,cy:82.5625+(gy+(i?ryOffset:ly))*amount,rx:7.4375*(1+(rx-1)*amount),ry:Math.max(.6,10.9375*(1+(ry*s-1)*amount)*b*(i?rightLid:leftLid))}));
  }
  const recipes = [
    {id:'loading',name:'Loading',body:'loading',eyes:'calm',speed:1,energy:.45,expression:.7,upright:true,loop:true,duration:8,use:'Slow clockwise turn: 8 seconds at normal tempo, with a gentle float. Stop when the task resolves.'},
    {id:'thinking',name:'Thinking',body:'float',eyes:'think',speed:.8,energy:.45,expression:.85,upright:false,loop:true,duration:4.8,use:'While processing; use one active agent near the task.'},
    {id:'found',name:'Found it!',body:'pop',eyes:'surprise',speed:1,energy:.8,expression:1.1,upright:false,loop:false,duration:1.4,use:'Once when useful research or a result appears.'},
    {id:'done',name:'All done',body:'nod',eyes:'happy',speed:1,energy:.7,expression:.9,upright:false,loop:false,duration:1.2,use:'Once after a confirmed save, export, or decision.'},
    {id:'curious',name:'Wait, what?',body:'wobble',eyes:'curious',speed:1,energy:.6,expression:1,upright:false,loop:false,duration:1.6,use:'Once for a clarification; show the question in text.'},
    {id:'attention',name:'Back to focus',body:'storm',eyes:'doubletake',speed:1,energy:.75,expression:1.1,upright:false,loop:false,duration:1.5,use:'One timely nudge; avoid repeating it until the user acts.'},
    {id:'idea',name:'An idea clicks',body:'brainy',eyes:'aha',speed:1,energy:1,expression:1.2,upright:false,loop:false,duration:1.8,use:'One reveal in a demo, or a new idea in a session.'},
    {id:'quick-spin',name:'Quick spin · once',body:'spin',eyes:'surprise',speed:1,energy:1,expression:1.1,upright:false,loop:false,duration:.9,use:'One playful turn, then rest or a different action. Never continuous loading.'},
    {id:'double-spin',name:'Quick spin · twice',body:'spin-double',eyes:'doubletake',speed:1,energy:1,expression:1.1,upright:false,loop:false,duration:1.6,use:'Two playful turns, then rest or a different action. Replay only on a new cue.'}
  ];
  const isQuickSpin = key => key==='spin' || key==='spin-double';
  const spinDuration = key => key==='spin-double'?1.6:.9;
  function normalizeRecipe(recipe) {
    const r={...recipe};
    if(isQuickSpin(r.body)) {
      if(r.loop!==false || !Number.isFinite(r.duration)) r.duration=spinDuration(r.body);
      r.loop=false;
    }
    return r;
  }
  const periods={still:3.6,breathe:3.6,float:3.6,bounce:1.8,squash:3.6,spin:.9,'spin-double':1.6,loading:8,wobble:3.6,pop:3.6,nod:3.6,shake:3.6,original:4};
  function sample(recipe, seconds, profile=0, options={}) {
    recipe=normalizeRecipe(recipe);
    const elapsed=Math.max(0,seconds)*(recipe.speed??1),duration=recipe.duration??4.8;
    const done=recipe.loop===false && elapsed>=duration;
    if(options.reducedMotion || done) return {body:body('still',0),eyes:eye('calm',0),upright:!!recipe.upright,done:true,tagMode:isQuickSpin(recipe.body)?'steady-spin':'silhouette'};
    const bodyTime=recipe.loop===false?elapsed/duration*(periods[recipe.body]??3.6):elapsed;
    const eyeTime=recipe.loop===false?elapsed/duration*(recipe.eyes==='original'?4:4.8):elapsed;
    return {body:body(recipe.body,bodyTime,profile,recipe.energy??1),eyes:eye(recipe.eyes,eyeTime,profile,recipe.expression??1),upright:!!recipe.upright,done:false,tagMode:isQuickSpin(recipe.body)||recipe.body==='loading'?'steady-spin':'silhouette'};
  }
  const api={version:'1.1.0',bodies,eyes,personalities,recipes,body,eye,original,sample,isQuickSpin,spinDuration,normalizeRecipe};

export default api;
