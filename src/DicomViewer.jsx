import { useEffect, useRef, useState } from 'react'
import { RenderingEngine, Enums, init as coreInit } from '@cornerstonejs/core'
import { init as loaderInit, wadouri } from '@cornerstonejs/dicom-image-loader'
import { groupStudies } from './dicom'
let initialized
function initialize(){
 if(!initialized)initialized=(async()=>{
   await coreInit()
   // Local Part 10 files use the dataset provider. The naturalized provider in
   // this loader release can lose multi-frame pixel data in Vite development.
   loaderInit({maxWebWorkers:2,useLegacyMetadataProvider:true})
 })().catch(error=>{initialized=undefined;throw error})
 return initialized
}
export default function DicomViewer({images,patientName,initialSeriesId}) {
 const groups=groupStudies(images)
 const [series,setSeries]=useState(initialSeriesId||groups[0]?.id||''),[slice,setSlice]=useState(0),[total,setTotal]=useState(0),[status,setStatus]=useState('Select an imported DICOM series.'),[ready,setReady]=useState(false),[error,setError]=useState(''),[width,setWidth]=useState(2000),[center,setCenter]=useState(500)
 const element=useRef(null),engine=useRef(null),viewport=useRef(null),drag=useRef(null),container=useRef(null)
 const group=groups.find(g=>g.id===series)||groups[0]
 const seriesKey=group?.images.map(i=>i.fileId).join(',')||''
 useEffect(()=>{
   if(!seriesKey)return
   let disposed=false,observer,ownEngine;const controller=new AbortController(),fileIndices=[]
   ;(async()=>{try{
     setReady(false);setError('');setStatus('Loading study…');setSlice(0)
     await initialize();if(disposed)return
     const ids=[];let loadedFiles=0;const fileIds=seriesKey.split(',')
     for(const id of fileIds) {
       const response=await fetch(`/api/files/${id}`,{signal:controller.signal,credentials:'same-origin'})
       if(!response.ok)throw new Error('Cannot load this scan. Your session may have expired.')
       const file=await response.blob();if(disposed)return;loadedFiles++;setStatus(`Loading scan file ${loadedFiles} of ${fileIds.length}…`)
       const {dicomInfo}=await import('./dicom');const info=dicomInfo(await file.arrayBuffer())
       const base=wadouri.fileManager.add(file);fileIndices.push(Number(base.split(':')[1]))
       for(let frame=1;frame<=info.frames;frame++)ids.push(`${base}?frame=${frame}`)
     }
     if(disposed)return
     ownEngine=new RenderingEngine(`dental-${crypto.randomUUID()}`);engine.current=ownEngine
     ownEngine.enableElement({viewportId:'scan',type:Enums.ViewportType.STACK,element:element.current,defaultOptions:{background:[0.035,0.055,0.05]}})
     const view=ownEngine.getViewport('scan');viewport.current=view
     await view.setStack(ids,0);if(disposed)return
     view.render();setTotal(ids.length);setReady(true);setStatus('Drag to pan · use slice controls to navigate')
     const range=view.getProperties().voiRange;if(range){setWidth(Math.max(1,range.upper-range.lower));setCenter((range.upper+range.lower)/2)}
     observer=new ResizeObserver(()=>ownEngine.resize(true,false));observer.observe(element.current)
   }catch(e){if(!disposed){setError(e.message||'This scan could not be decoded. The transfer syntax may not be supported.');setStatus('Unable to open study')}}})()
   return()=>{disposed=true;controller.abort();observer?.disconnect();if(ownEngine){ownEngine.destroy();if(engine.current===ownEngine){engine.current=null;viewport.current=null}}for(const index of fileIndices)wadouri.fileManager.remove(index)}
 },[seriesKey])
 function apply(fn){try{if(viewport.current&&ready){fn(viewport.current);viewport.current.render()}}catch(e){setError(e.message)}}
 async function changeSlice(value){const next=Math.max(0,Math.min(total-1,Number(value)));try{if(!viewport.current||!ready)return;await viewport.current.setImageIdIndex(next);setSlice(next);viewport.current.render()}catch(e){setError(e.message)}}
 function contrast(w,c){setWidth(w);setCenter(c);apply(view=>view.setProperties({voiRange:{lower:c-w/2,upper:c+w/2}}))}
 return <section className="dicom-viewer" ref={container}><div className="viewer-heading"><div><span className="badge">DICOM VIEWER</span><h3>{patientName}</h3><p>2D images & multi-frame stacks · no 3D/MPR reconstruction</p></div><button className="secondary" onClick={()=>{const action=document.fullscreenElement?document.exitFullscreen():container.current.requestFullscreen();action?.catch(()=>setError('Fullscreen is unavailable in this browser.'))}}>Fullscreen</button></div>{groups.length>0?<><label className="series-select">Study series<select aria-label="Study series" value={group?.id||''} onChange={e=>setSeries(e.target.value)}>{groups.map(g=><option key={g.id} value={g.id}>{g.name} · {g.frames} frame(s)</option>)}</select></label><div className="viewer-toolbar"><button disabled={!ready} onClick={()=>apply(v=>v.setZoom(v.getZoom()*1.2))}>Zoom +</button><button disabled={!ready} onClick={()=>apply(v=>v.setZoom(v.getZoom()/1.2))}>Zoom −</button><button disabled={!ready} onClick={()=>apply(v=>v.setProperties({invert:!v.getProperties().invert}))}>Invert</button><button disabled={!ready} onClick={()=>apply(v=>v.setProperties({rotation:((v.getProperties().rotation||0)+90)%360}))}>Rotate 90°</button><button disabled={!ready} onClick={()=>apply(v=>{v.resetCamera();v.resetProperties();const r=v.getProperties().voiRange;if(r){setWidth(r.upper-r.lower);setCenter((r.upper+r.lower)/2)}})}>Reset view</button></div>{error&&<div className="viewer-error" role="alert">{error}</div>}<div className="dicom-stage" ref={element} onPointerDown={e=>{if(!ready)return;e.currentTarget.setPointerCapture(e.pointerId);drag.current={x:e.clientX,y:e.clientY,pan:viewport.current.getPan()}}} onPointerMove={e=>{if(!drag.current)return;const start=drag.current;apply(v=>v.setPan([start.pan[0]+e.clientX-start.x,start.pan[1]+e.clientY-start.y]))}} onPointerUp={()=>{drag.current=null}} onPointerCancel={()=>{drag.current=null}}/><div className="slice-controls"><button disabled={!ready||slice===0} onClick={()=>changeSlice(slice-1)}>Previous</button><input type="range" aria-label="DICOM frame" min="0" max={Math.max(0,total-1)} value={slice} disabled={!ready} onChange={e=>changeSlice(e.target.value)}/><span>{ready?`${slice+1} / ${total}`:'Loading…'}</span><button disabled={!ready||slice===total-1} onClick={()=>changeSlice(slice+1)}>Next</button></div><div className="window-controls"><label>Window width<input type="number" min="1" step="100" value={Math.round(width)} disabled={!ready} onChange={e=>contrast(Math.max(1,Number(e.target.value)),center)}/></label><label>Window center<input type="number" step="100" value={Math.round(center)} disabled={!ready} onChange={e=>contrast(width,Number(e.target.value))}/></label><span>{group?.images[0]?.dicom?.modality} · {group?.images[0]?.dicom?.columns} × {group?.images[0]?.dicom?.rows}</span></div><p className="viewer-status" role="status">{status}</p></>:<div className="viewer-empty"><span>◉</span><h3>Your imaging workspace</h3><p>Import .dcm files from the Imaging tab. Single images and supported multi-frame DICOM studies open here.</p><p>For a CBCT folder, select its DICOM files together. Files are grouped by series.</p></div>}</section>
}

