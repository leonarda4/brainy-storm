// Adapted from leonarda4/brainy-hq motion kit v1.1 (ES module export).
  'use strict';
  const NS='http://www.w3.org/2000/svg';
  // Canvas includes motion clearance; the body's largest dimension is about 54–62% of it at rest.
  const sizes={
    compact:{label:'Compact · live UI',canvas:56,name:10,nameOptions:[10,8],reserve:56,body:'30–35 px',use:'Live status, agent lists, and narrow sidebars.',videoCanvas:null,videoName:null},
    medium:{label:'Medium · supporting',canvas:112,name:12,reserve:56,body:'60–69 px',use:'Placeholders, empty states, and supporting agents.',videoCanvas:240,videoName:24},
    featured:{label:'Large · featured',canvas:300,name:14,reserve:64,body:'162–185 px',use:'A featured agent, an introduction, or a close-up.',videoCanvas:600,videoName:32}
  };
  function setSize(nodes,key='medium',options={}){
    const size=sizes[key];
    if(!size)throw new RangeError('Unknown agent size: '+key);
    const name=key==='compact'&&size.nameOptions.includes(options.name)?options.name:size.name;
    nodes.wrap.dataset.agentSize=key;
    nodes.wrap.style.setProperty('--agent-size',size.canvas+'px');
    nodes.wrap.style.setProperty('--agent-name-size',name+'px');
    nodes.wrap.style.setProperty('--agent-label-reserve',size.reserve+'px');
    nodes.avatar.style.width=size.canvas+'px';
    nodes.badge.style.fontSize=name+'px';
    nodes.badge.style.padding=key==='compact'?(name===8?'2px 4px':'3px 5px'):'';
    nodes.wrap.style.minHeight=size.canvas+'px';
    nodes.wrap.style.minWidth=key==='compact'?(size.canvas+size.reserve)+'px':'0';
    nodes.wrap.style.paddingRight=size.reserve+'px';
    return nodes;
  }
  function element(tag,attrs={}){const n=document.createElementNS(NS,tag);for(const [k,v]of Object.entries(attrs))n.setAttribute(k,v);return n;}
  function tagInk(color){
    const rgb=color.slice(1).match(/../g).map(h=>parseInt(h,16)/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4);
    const luminance=rgb[0]*.2126+rgb[1]*.7152+rgb[2]*.0722;
    return 1.05/(luminance+.05)>(luminance+.05)/.058568?'#FFFFFF':'#171717';
  }
  function create(agent, shapes, outlines, label=agent.shape){
    const wrap=document.createElement('div');wrap.className='brainystorm-character';
    const avatar=document.createElement('div');avatar.className='brainystorm-avatar';
    avatar.style.setProperty('--agent-color',agent.color);avatar.style.setProperty('--tag-ink',tagInk(agent.color));
    const svg=element('svg',{viewBox:'-30 -30 240 240',role:'img','aria-label':agent.name+' · '+label});
    const pose=element('g'),body=element('g',{fill:agent.color}),face=element('g',{fill:'#FFFFFF'});
    shapes[agent.shape].forEach(s=>body.append(element(s.tag,s.attrs)));
    const eyes=[element('ellipse',{cx:76.4375,cy:82.5625,rx:7.4375,ry:10.9375}),element('ellipse',{cx:103.5625,cy:82.5625,rx:7.4375,ry:10.9375})];
    face.append(...eyes);pose.append(body,face);svg.append(pose);
    const badge=document.createElement('span');badge.className='brainystorm-name';badge.textContent=agent.name;
    avatar.append(svg,badge);wrap.append(avatar);
    // The builder samples these outlines from the same SVG shapes used for export.
    const contours=outlines[agent.shape].map((polygon,index)=>{
      const attrs=shapes[agent.shape][index].attrs;
      return {points:polygon.map(([x,y])=>({x,y})),ear:agent.name==='Memo'&&index<2,cx:Number(attrs.cx),cy:Number(attrs.cy)};
    });
    const spinRadius=Math.max(...contours.flatMap(contour=>contour.points.map(p=>Math.hypot(p.x-90,p.y-90))));
    return {wrap,avatar,pose,body,face,eyes,badge,contours,spinRadius,ears:agent.name==='Memo'?[...body.children].slice(0,2):[]};
  }
  function placeBadge(nodes,b,steadySpin=false){
    const angle=b.rotation*Math.PI/180,c=Math.cos(angle),s=Math.sin(angle);
    const top=90+b.y+26*b.sy;
    let right=-Infinity;
    if(steadySpin){
      // A full-turn envelope removes petal/corner jitter at any playback speed.
      // Keep translation and loading bounce immediate; no frame-history lag when scrubbing.
      const radius=nodes.spinRadius*Math.max(b.sx,b.sy);
      right=90+b.x+Math.sqrt(Math.max(0,radius*radius-(top-90-b.y)**2));
    }else for(const contour of nodes.contours){
      const points=contour.points.map(p=>{
        const px=contour.ear?contour.cx+(p.x-contour.cx)*b.ears:p.x;
        const py=contour.ear?contour.cy+(p.y-contour.cy)*b.ears:p.y;
        const x=(px-90)*b.sx,y=(py-90)*b.sy;
        return {x:90+b.x+x*c-y*s,y:90+b.y+x*s+y*c};
      });
      points.forEach((p,i)=>{
        if(p.y>=top)right=Math.max(right,p.x);
        const q=points[(i+1)%points.length];
        if((p.y<top)!==(q.y<top))right=Math.max(right,p.x+(q.x-p.x)*(top-p.y)/(q.y-p.y));
      });
    }
    // Upright, constant-size text with a 4px gap from the silhouette or spin envelope.
    nodes.badge.style.left=`calc(${(right+30)/240*100}% + 4px)`;
    nodes.badge.style.top=`${(top+30)/240*100}%`;
  }
  function render(nodes,frame){
    const b=frame.body,eyes=frame.eyes;
    nodes.pose.setAttribute('transform',`translate(${b.x} ${b.y}) rotate(${b.rotation} 90 90)`);
    nodes.body.setAttribute('transform',`translate(90 90) scale(${b.sx} ${b.sy}) translate(-90 -90)`);
    nodes.face.setAttribute('transform',frame.upright?`rotate(${-b.rotation} 90 90)`:'');
    nodes.eyes.forEach((n,i)=>{for(const[k,v]of Object.entries(eyes[i]))n.setAttribute(k,v);});
    nodes.ears.forEach(n=>{const x=n.getAttribute('cx'),y=n.getAttribute('cy');n.setAttribute('transform',`translate(${x} ${y}) scale(${b.ears}) translate(${-x} ${-y})`);});
    placeBadge(nodes,b,frame.tagMode==='steady-spin');
  }
  const api={create,render,sizes,setSize};

export default api;
