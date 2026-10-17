// Motion definitions copied from brand-studio.html → Graphics. Keep timing and paths in sync with that guide.
const BrainyFlights = (() => {
  'use strict';
  const clamp=x=>Math.max(0,Math.min(1,x)),mix=(a,b,t)=>a+(b-a)*t,TAU=Math.PI*2;
  const easings={
    silk:t=>{t=clamp(t);return t*t*t*(t*(t*6-15)+10)},
    arrive:t=>1-Math.pow(1-clamp(t),3),
    accelerate:t=>Math.pow(clamp(t),3),
    linear:t=>clamp(t),
    spring:t=>{t=clamp(t);return t===0||t===1?t:1-Math.exp(-7*t)*Math.cos(10*t)+(Math.exp(-7)*Math.cos(10))*t}
  };
  const point=(x,y)=>({x,y,scale:1});
  const cubic=(a,b,c,d,t)=>point((1-t)**3*a[0]+3*(1-t)**2*t*b[0]+3*(1-t)*t*t*c[0]+t**3*d[0],(1-t)**3*a[1]+3*(1-t)**2*t*b[1]+3*(1-t)*t*t*c[1]+t**3*d[1]);
  const curve=(a,b,c,d)=>t=>cubic(a,b,c,d,t);
  const paths=[
    {id:'glide',name:'Side glide',group:'Arrive',note:'A direct approach to a card edge.',fn:curve([0,.6],[.25,.6],[.5,.6],[.82,.6])},
    {id:'rise',name:'Rise from below',group:'Arrive',note:'Lift into an empty-state companion slot.',fn:curve([.5,1],[.5,.85],[.5,.5],[.5,.3])},
    {id:'drop',name:'Soft descent',group:'Arrive',note:'Float down beside a new notification.',fn:curve([.55,0],[.55,.2],[.55,.45],[.55,.68])},
    {id:'arc',name:'High arc',group:'Arrive',note:'Clear a component with one generous arch.',fn:curve([.02,.8],[.18,-.15],[.7,-.15],[.85,.65])},
    {id:'swoop',name:'Low swoop',group:'Arrive',note:'Dip under content, then rise into place.',fn:curve([.04,.2],[.25,1.05],[.65,1.05],[.85,.45])},
    {id:'s-curve',name:'S-curve',group:'Travel',note:'Change lanes without a sharp corner.',fn:curve([.04,.75],[.9,.95],[.02,.05],[.86,.25])},
    {id:'diagonal',name:'Diagonal crossing',group:'Travel',note:'A clear transfer between distant panels.',fn:curve([.08,.85],[.32,.65],[.6,.36],[.85,.12])},
    {id:'wave',name:'Ribbon wave',group:'Travel',note:'A rolling flight for video transitions.',fn:t=>point(.05+.8*t,.5+.22*Math.sin(TAU*t))},
    {id:'detour',name:'Component detour',group:'Travel',note:'Route above a reading area, then dock.',fn:curve([.04,.7],[.02,-.3],[.94,-.3],[.86,.7])},
    {id:'loop',name:'Loop and land',group:'Travel',note:'A single flourish before a quiet arrival.',fn:t=>point(.1+.7*t+.18*Math.sin(TAU*t),.55-.28*Math.sin(Math.PI*t)**2)},
    {id:'orbit',name:'Elliptical orbit',group:'Float',note:'Circle a focal component at a steady pace.',closed:true,fn:t=>point(.5+.36*Math.cos(TAU*t),.5+.35*Math.sin(TAU*t))},
    {id:'eight',name:'Figure eight',group:'Float',note:'Weave through two areas in a video scene.',closed:true,fn:t=>point(.5+.38*Math.sin(TAU*t),.5+.3*Math.sin(2*TAU*t))},
    {id:'hover',name:'Hover pocket',group:'Float',note:'A small, repeatable drift beside a task.',closed:true,fn:t=>point(.5+.055*Math.sin(TAU*t),.5+.08*Math.sin(2*TAU*t))},
    {id:'spiral',name:'Spiral inward',group:'Settle',note:'Tighten the orbit until the destination holds.',fn:t=>point(.5+.42*(1-t)**2*Math.cos(2*TAU*t),.5+.42*(1-t)**2*Math.sin(2*TAU*t))},
    {id:'brake',name:'Overshoot and return',group:'Settle',note:'Pass the anchor gently; return without a bounce.',fn:t=>point(.08+.74*easings.spring(t),.55)},
    {id:'pendulum',name:'Pendulum settle',group:'Settle',note:'Let lateral sway decay into a stable anchor.',fn:t=>point(.5+.38*Math.cos(2*TAU*t)*(1-t)**2,.15+.5*t)},
    {id:'retreat',name:'Retreat into depth',group:'Depart',note:'Recede from a finished task for a video cut.',fn:t=>({...point(.2+.6*t,.65-.4*t),scale:1-.45*t})},
    {id:'exit',name:'Lift and exit',group:'Depart',note:'Leave toward the top-right after a handoff.',fn:curve([.2,.75],[.8,.8],[.82,.25],[1.3,-.5])}
  ];
  function sample(id,time,{duration=4,easing='silk',drift=0,reduced=false}={}){
    const path=paths.find(p=>p.id===id)||paths[0];
    if(reduced)return {...(path.group==='Depart'?point(.82,.6):path.fn(1)),scale:1};
    const t=clamp(time/duration),p=path.fn((easings[easing]||easings.silk)(t));
    if(!reduced&&time>duration&&drift){const s=time-duration,fade=easings.silk(s/1.5);p.x+=.009*drift*fade*Math.sin(s*1.1);p.y+=.016*drift*fade*Math.sin(s*1.6);}
    return p;
  }
  const scenes=[
    {id:'assemble',name:'Fly in. Find a task.',note:'Eight entrances from different edges. Each agent finds a task, decelerates, then rests beside its component.',use:'UI · onboarding / task assignment',beats:['Launch','Find a task','Dock','Quiet hold']},
    {id:'orbit',name:'Around the workspace',note:'The whole family follows an ellipse around the focal panel, then peels off into individual anchors.',use:'Video · team introduction',beats:['Join orbit','Circle together','Peel away','Settle']},
    {id:'relay',name:'Pass the work along',note:'A staggered sequence carries attention from capture to structure to delivery. Each agent travels once.',use:'UI / video · workflow handoff',beats:['Memo starts','Team follows','Deliver','Hold the result']},
    {id:'weave',name:'Crossing currents',note:'Two streams travel on opposing curves, separated into lanes, before resolving into a calm formation.',use:'Video · transition / ensemble',beats:['Split lanes','Cross','Resolve','Formation']},
    {id:'spotlight',name:'Make room for one',note:'Brainy moves to the foreground while the other seven drift around the perimeter. Everyone returns to a shared formation.',use:'Video · introduce a capability',beats:['Gather','Brainy forward','Supporting orbit','Rejoin']},
    {id:'depart',name:'Wrap up and fly out',note:'Start at task anchors, linger for the result, then leave in a staggered fan of curved flights.',use:'UI / video · completion / outro',beats:['At work','Result ready','Lift away','Clear stage']}
  ];
  const anchor=i=>point(.13+(i%4)*.245,.31+Math.floor(i/4)*.43);
  function scene(id,i,time,reduced=false){
    const end=anchor(i),t=clamp(time/16)*16;
    if(reduced)return {...end,scale:1};
    let p=end;
    if(id==='assemble'){
      const u=easings.silk((t-i*.22)/4.5),left=i%2===0;
      p=cubic([left?-.18:1.18,i<4?-.2:1.15],[left?-.05:1.05,.1],[end.x,.05+Math.floor(i/4)*.5],[end.x,end.y],u);
    }else if(id==='orbit'){
      const a=i/8*TAU+Math.min(t,10)*.42,orb=point(.5+.39*Math.cos(a),.52+.36*Math.sin(a));
      const u=easings.silk((t-10)/4);p=point(mix(orb.x,end.x,u),mix(orb.y,end.y,u));
    }else if(id==='relay'){
      const u=easings.silk((t-i*.85)/4);p=cubic([-.18,.7],[.25,.1],[end.x,.05],[end.x,end.y],u);
    }else if(id==='weave'){
      const u=easings.silk((t-i*.14)/8),left=i%2===0;
      p=cubic([left?-.2:1.2,.15+(i%4)*.21],[left?.8:.2,.08],[left?.2:.8,.92],[end.x,end.y],u);
    }else if(id==='spotlight'){
      const enter=easings.silk(t/4),leave=easings.silk((t-10)/4),u=enter*(1-leave),a=i/8*TAU+t*.12;
      const target=i===1?point(.49,.53):point(.5+.43*Math.cos(a),.52+.4*Math.sin(a));
      p=point(mix(end.x,target.x,u),mix(end.y,target.y,u));p.scale=i===1?1+1.05*u:1-.18*u;
    }else if(id==='depart'){
      const u=easings.silk((t-4-i*.5)/5);p=cubic([end.x,end.y],[end.x,end.y-.25],[end.x+(i%2? .3:-.3),-.2],[i%2?1.2:-.2,-.4],u);
    }
    return p;
  }
  const api={version:'1.0.0',paths,scenes,easings,sample,scene,anchor};
  return api;
})();
function hash(s){let n=2166136261;for(const c of s)n=Math.imul(n^c.codePointAt(0),16777619)>>>0;return n;}
function horizontalOval(item){
 if(item.tag!=='ellipse')return false;
 const a=item.attrs,t=a.transform||'',matrix=t.match(/matrix\(([^)]+)\)/),rotation=t.match(/rotate\(([^)]+)\)/);
 let xx=1,xy=0,yx=0,yy=1;
 if(matrix)[xx,yx,xy,yy]=matrix[1].split(/[ ,]+/).map(Number);
 else if(rotation){const angle=parseFloat(rotation[1])*Math.PI/180;xx=yy=Math.cos(angle);yx=Math.sin(angle);xy=-yx;}
 return Math.hypot(xx*+a.rx,xy*+a.ry)>Math.hypot(yx*+a.rx,yy*+a.ry);
}
// Reuse agent route geometry AND easing; bake samples into portable SVG keyframes.
const DOT_ROUTES=[['glide','arrive'],['arc','silk'],['drop','arrive'],['swoop','silk'],['brake','linear'],['pendulum','silk'],['rise','spring'],['loop','arrive'],['diagonal','silk'],['s-curve','arrive']];
function dotFlight(recipe,item,index){
 if(recipe.id==='original-5'){
  const name=`dot-${recipe.id}-${index}`,radius=recipe.height*1.25;
  const frames=Array.from({length:121},(_,i)=>{
   const t=i/120,travel=Math.min(1,t/.78),p=BrainyFlights.sample('spiral',travel,{duration:1,easing:'linear'});
   const settle=Math.max(0,(t-.78)/.22),bounce=Math.sin(settle*Math.PI*2)*(1-settle);
   const x=(p.x-.5)*radius,y=t===1?0:(p.y-.5)*radius-Math.sin(settle*Math.PI)*recipe.height*.018;
   const scale=.65+.35*BrainyFlights.easings.arrive(travel)+.14*bounce;
   return `${(t*100).toFixed(2)}%{transform:translate(${x.toFixed(3)}px,${y.toFixed(3)}px) scale(${scale.toFixed(4)});opacity:${Math.min(1,t*15).toFixed(3)}}`;
  }).join('');
  return {name,route:'spiral',easing:'linear',frames,duration:2.4,delay:.35};
 }

 const identity=recipe.id.startsWith('original-')?Number(recipe.id.slice(9))-1:hash(recipe.id);
 const variation=identity+index, [route,easing]=DOT_ROUTES[variation%DOT_ROUTES.length];
 const w=recipe.width,h=recipe.height,end=BrainyFlights.sample(route,1,{duration:1,easing});
 const name=`dot-${recipe.id}-${index}`,mirror=variation%2?-1:1;
 const frames=Array.from({length:81},(_,i)=>{
  const t=i/80,p=BrainyFlights.sample(route,t,{duration:1,easing});
  const progress=BrainyFlights.easings.arrive(t);
  const scale=1-(.25+(variation%3)*.12)*(1-progress)+(.12+(variation%4)*.035)*Math.sin(Math.PI*t);
  return `${(t*100).toFixed(2)}%{transform:translate(${((p.x-end.x)*w*1.65*mirror).toFixed(3)}px,${((p.y-end.y)*h*1.65).toFixed(3)}px) scale(${scale.toFixed(4)});opacity:${Math.min(1,t*12).toFixed(3)}}`;
 }).join('');
 return {name,route,easing,frames,duration:1.2+(variation%5)*.17,delay:.25+(index%4)*.13};
}
const RECIPE_MOTION_STYLE=`<style>
.recipe-motion{animation-duration:1.15s;animation-delay:var(--delay,0s);animation-fill-mode:both;animation-timing-function:cubic-bezier(.22,1,.36,1)}
.rm-breathe,.rm-breath-dot{animation-duration:4.6s;animation-timing-function:cubic-bezier(.37,0,.63,1)}.rm-breathe{animation-name:recipe-breathe;transform-box:fill-box;transform-origin:center bottom}.rm-breath-dot{animation-name:recipe-breath-dot}
.rm-rise{animation-name:recipe-rise}.rm-side{animation-name:recipe-side;animation-duration:1.3s}.rm-squish{animation-name:recipe-squish;animation-duration:1.5s;transform-box:fill-box;transform-origin:center}.rm-tile{animation-name:recipe-tile;animation-duration:.7s;transform-box:fill-box;transform-origin:center}.rm-draw{animation-name:recipe-draw;animation-duration:1.3s;stroke-dasharray:1;stroke-dashoffset:0}
.rm-rise-squish{animation-name:recipe-rise-squish;animation-duration:1.5s;transform-box:fill-box;transform-origin:center bottom}
.rm-appear{animation-name:recipe-appear;animation-duration:.65s}
.rm-arm{animation-name:recipe-arm;animation-duration:1.8s;transform-box:view-box}.rm-wrist{animation-name:recipe-wrist;animation-duration:1.65s;transform-box:view-box}
.rm-turn{animation-name:recipe-turn;animation-duration:1.5s;transform-box:fill-box;transform-origin:center}
.rm-pop{animation-name:recipe-pop;animation-duration:.85s;animation-timing-function:cubic-bezier(.4,0,.2,1);transform-box:fill-box;transform-origin:center}
.motion-paused .recipe-motion{animation-play-state:paused}
@keyframes recipe-appear{from{opacity:0;transform:translateY(18px)}to{opacity:1;transform:translateY(0)}}
@keyframes recipe-arm{0%{transform:rotate(-55deg)}72%{transform:rotate(3deg)}88%{transform:rotate(-1deg)}100%{transform:rotate(0)}}
@keyframes recipe-wrist{0%{transform:rotate(85deg)}70%{transform:rotate(-4deg)}88%{transform:rotate(1deg)}100%{transform:rotate(0)}}
@keyframes recipe-turn{0%{transform:rotate(-150deg) scale(.4)}75%{transform:rotate(12deg) scale(1.04)}100%{transform:rotate(0) scale(1)}}
@keyframes recipe-pop{0%{transform:scale(0)}25%{transform:scale(.22)}60%{transform:scale(1)}76%{transform:scale(1.12)}89%{transform:scale(.96)}100%{transform:scale(1)}}
@keyframes recipe-breathe{0%{transform:translateY(var(--rise)) scale(.975,1.035);animation-timing-function:cubic-bezier(.22,.65,.35,1)}30%{transform:translateY(-6px) scale(.975,1.035)}48%{transform:translateY(4px) scale(1.02,.97)}66%{transform:translateY(-3px) scale(.986,1.02)}84%{transform:translateY(2px) scale(1.008,.988)}100%{transform:translateY(0) scale(1)}}
@keyframes recipe-breath-dot{0%{transform:translateY(var(--rise));animation-timing-function:cubic-bezier(.22,.65,.35,1)}30%{transform:translateY(-21px)}48%{transform:translateY(17px)}66%{transform:translateY(-12px)}84%{transform:translateY(7px)}100%{transform:translateY(0)}}
@keyframes recipe-rise{from{transform:translateY(var(--rise,800px))}to{transform:translateY(0)}}
@keyframes recipe-side{from{transform:translateX(var(--side))}to{transform:translateX(0)}}
@keyframes recipe-rise-squish{0%{transform:translateY(var(--rise)) scale(.82,1.22)}65%{transform:translateY(0) scale(1.12,.88)}82%{transform:translateY(0) scale(.96,1.04)}100%{transform:translateY(0) scale(1)}}
@keyframes recipe-squish{0%{transform:translateX(var(--side)) scale(1.28,.78)}65%{transform:translateX(0) scale(.86,1.14)}82%{transform:translateX(0) scale(1.045,.955)}100%{transform:translateX(0) scale(1)}}
@keyframes recipe-tile{0%{opacity:0;transform:translateY(45px) rotate(-18deg) scale(.2)}70%{opacity:1;transform:translateY(-5px) rotate(3deg) scale(1.08)}100%{opacity:1;transform:translateY(0) rotate(0) scale(1)}}
@keyframes recipe-draw{0%{stroke-dashoffset:1;opacity:0}1%{opacity:1}100%{stroke-dashoffset:0;opacity:1}}
@media(prefers-reduced-motion:reduce){.recipe-motion{animation:none!important}}
</style>`;


// Animate the existing artwork, preserving its geometry and palette.
// Only the primitive SVG subset produced by our thumbnail service is accepted.
export function animateThumbnail(source) {
  const document = new DOMParser().parseFromString(source, 'image/svg+xml');
  const root = document.documentElement;
  if (root.localName !== 'svg' || root.querySelector('parsererror')) return null;
  const nodes = [...root.children];
  const allowed = new Set(['rect', 'ellipse', 'circle', 'path']);
  if (!nodes.length || nodes.some(node => !allowed.has(node.localName))) return null;
  const safe = /^(?:x|y|width|height|rx|ry|cx|cy|r|d|fill|transform)$/;
  if (nodes.some(node => [...node.attributes].some(attr => !safe.test(attr.name)))) return null;
  const background = nodes.shift();
  if (background.localName !== 'rect') return null;
  // Older thumbnails have no recipe metadata. Recognize the catalog's converge
  // geometry so saved artwork also gets Studio's original-10 motion.
  const ellipses = nodes.filter(node => node.localName === 'ellipse');
  const opposingBlobs = ellipses.length >= 2
    && nodes.every(node => node.localName === 'ellipse' || node.localName === 'circle')
    && ellipses.every(node => !node.hasAttribute('transform')
      && (+node.getAttribute('cx') < 80 || +node.getAttribute('cx') > 720))
    && ellipses.some(node => +node.getAttribute('cx') < 80)
    && ellipses.some(node => +node.getAttribute('cx') > 720);
  const recipe = { id: opposingBlobs ? 'original-10' : 'thumbnail', width: 800, height: 450 };
  const serialize = node => new XMLSerializer().serializeToString(node);
  const styles = [];
  let dot = 0;
  const art = nodes.map((node, index) => {
    const item = { tag: node.localName, attrs: Object.fromEntries([...node.attributes].map(a => [a.name, a.value])) };
    const markup = serialize(node), delay = index * .1;
    if (item.tag === 'rect') {
      const a = item.attrs, x = +a.x || 0, y = +a.y || 0, w = +a.width, h = +a.height;
      const stroke = Math.min(w, h), radius = stroke / 2;
      const path = w >= h ? `M ${x + radius} ${y + h / 2} h ${Math.max(.001, w - stroke)}` : `M ${x + w / 2} ${y + h - radius} v ${-Math.max(.001, h - stroke)}`;
      // Preserve any source transform without interpolating it into markup.
      const maskPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      Object.entries({ class: 'recipe-motion rm-draw', style: `--delay:${delay}s`, d: path, fill: 'none', stroke: 'white', 'stroke-width': stroke, 'stroke-linecap': 'round', pathLength: 1 }).forEach(([key, value]) => maskPath.setAttribute(key, String(value)));
      if (a.transform) maskPath.setAttribute('transform', a.transform);
      return `<defs><mask id="line-${index}" maskUnits="userSpaceOnUse" x="-3200" y="-1800" width="7200" height="4050" style="mask-type:luminance">${serialize(maskPath)}</mask></defs><g mask="url(#line-${index})">${markup}</g>`;
    }
    if (item.tag === 'circle' && opposingBlobs) {
      return `<g class="recipe-motion rm-pop" style="--delay:.55s">${markup}</g>`;
    }
    if (item.tag === 'ellipse' && opposingBlobs) {
      const direction = +item.attrs.cx < recipe.width / 2 ? -1 : 1;
      return `<g class="recipe-motion rm-side" style="--delay:.1s;--side:${direction * recipe.width * 1.8}px">${markup}</g>`;
    }
    if (item.tag === 'circle') {
      const flight = dotFlight(recipe, item, dot++);
      styles.push(`@keyframes ${flight.name}{${flight.frames}}`);
      return `<g class="recipe-motion rm-agent-dot" style="animation-name:${flight.name};animation-duration:${flight.duration}s;animation-timing-function:linear;--delay:${flight.delay}s;transform-box:fill-box;transform-origin:center">${markup}</g>`;
    }
    const kind = horizontalOval(item) ? 'side' : 'rise';
    return `<g class="recipe-motion rm-${kind}" style="--delay:${delay}s;--side:${hash(recipe.id) % 2 ? 1440 : -1440}px;--rise:720px">${markup}</g>`;
  }).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 450" width="800" height="450">${RECIPE_MOTION_STYLE}<style>${styles.join('')}</style>${serialize(background)}${art}</svg>`;
}
