// Keep generated diagrams intact; place Hebrew explanations in a readable, numbered HTML legend.
(() => {
  const ns='http://www.w3.org/2000/svg';
  function copyLabel(source,target) {
    source.childNodes.forEach(node=>{
      if(node.nodeType===3){target.append(document.createTextNode(node.textContent));return;}
      if(node.nodeType!==1||node.localName==='title')return;
      const shift=node.getAttribute('baseline-shift')||node.style.baselineShift||'';
      const tag=shift==='super'||parseFloat(shift)>0?'sup':shift==='sub'||parseFloat(shift)<0?'sub':'span';
      const fragment=document.createElement(tag);copyLabel(node,fragment);target.append(fragment);
    });
  }
  function prepare() {
    document.querySelectorAll('svg:not(.sumit-diagram)').forEach(svg=>{
      if(svg.closest('.katex') || !svg.querySelector('text'))return;
      svg.classList.add('sumit-diagram');
      const legend=document.createElement('ol');legend.className='diagram-legend';legend.dir='rtl';
      let index=0;
      svg.querySelectorAll('text').forEach(text=>{
        const label=text.textContent.trim(); if(!/[\u0590-\u05ff]/.test(label)) {text.style.direction='ltr';text.style.unicodeBidi='isolate';return;}
        const item=document.createElement('li'),badge=document.createElement('span'),description=document.createElement('bdi');
        badge.className='diagram-key';badge.textContent=String(++index);description.dir='auto';copyLabel(text,description);item.append(badge,description);legend.append(item);
        const marker=document.createElementNS(ns,'text');
        for(const attr of ['x','y','transform'])if(text.hasAttribute(attr))marker.setAttribute(attr,text.getAttribute(attr));
        marker.textContent=String(index);marker.setAttribute('class','diagram-marker');marker.setAttribute('font-size','14');marker.setAttribute('text-anchor','middle');marker.setAttribute('direction','ltr');
        marker.style.unicodeBidi='isolate';marker.style.fill=text.getAttribute('fill')||'currentColor';
        marker.style.paintOrder='stroke';marker.style.stroke='var(--surface,white)';marker.style.strokeWidth='5px';marker.style.strokeLinejoin='round';
        const title=document.createElementNS(ns,'title');title.textContent=label;marker.append(title);
        text.replaceWith(marker);
      });
      if(index)svg.after(legend);
      const wrapper=document.createElement('div');wrapper.className='diagram-scroll';svg.before(wrapper);wrapper.append(svg);
    });
    layout();
  }
  function layout() {
    document.querySelectorAll('svg.sumit-diagram').forEach(svg=>{
      if(!svg.getBoundingClientRect().width)return;
      svg.querySelectorAll('.diagram-leader').forEach(el=>el.remove());
      const occupied=[];
      svg.querySelectorAll('.diagram-marker').forEach(text=>{
        // Preserve the reference point, but separate labels that share it.
        text.removeAttribute('dy'); let box=text.getBBox(),dy=0;
        while(occupied.some(b=>box.x<b.x+b.width+4 && box.x+box.width+4>b.x && box.y<b.y+b.height+4 && box.y+box.height+4>b.y) && dy<150){dy+=20;text.setAttribute('dy',dy);box=text.getBBox();}
        if(dy) {
          const x=parseFloat(text.getAttribute('x')),y=parseFloat(text.getAttribute('y'));
          if(Number.isFinite(x)&&Number.isFinite(y)) {
            const line=document.createElementNS(ns,'line');line.setAttribute('class','diagram-leader');line.setAttribute('x1',x);line.setAttribute('x2',x);line.setAttribute('y1',y);line.setAttribute('y2',y+dy-12);
            if(text.hasAttribute('transform'))line.setAttribute('transform',text.getAttribute('transform'));
            line.setAttribute('stroke','currentColor');line.setAttribute('stroke-width','1');line.setAttribute('stroke-dasharray','3 3');text.before(line);
          }
        }
        occupied.push(box);
      });
      try {
        const box=svg.getBBox();if(!box.width||!box.height)return;
        if(!svg.dataset.originalViewbox)svg.dataset.originalViewbox=svg.getAttribute('viewBox')||`0 0 ${svg.getAttribute('width')||box.width} ${svg.getAttribute('height')||box.height}`;
        const original=svg.dataset.originalViewbox.split(/[ ,]+/).map(Number);if(original.length!==4||!original.every(Number.isFinite))return;
        const left=Math.min(original[0],box.x-18),top=Math.min(original[1],box.y-18);
        const width=Math.max(original[0]+original[2],box.x+box.width+18)-left,height=Math.max(original[1]+original[3],box.y+box.height+18)-top;
        svg.setAttribute('viewBox',`${left} ${top} ${width} ${height}`);
        svg.style.width='100%';svg.style.height='auto';svg.style.maxWidth=`${Math.max(280,width)}px`;
      } catch (_) {}
    });
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',prepare);else prepare();
  if(document.fonts)document.fonts.ready.then(layout);
  document.addEventListener('toggle',()=>requestAnimationFrame(layout),true);
  document.addEventListener('click',()=>requestAnimationFrame(layout));
  addEventListener('resize',layout);addEventListener('beforeprint',layout);
})();
