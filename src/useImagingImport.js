import { useEffect, useState } from 'react'
import { dicomInfo } from './dicom'

const normalize = name => name.normalize('NFKC').toLocaleLowerCase().split(/[\s,^]+/).filter(Boolean).sort().join(' ')
const date = () => new Date().toLocaleDateString('en-CA', { timeZone:'Asia/Manila' })

export default function useImagingImport({ patient, imageType, onImported, onNotice }) {
 const [progress,setProgress]=useState(null)
 const [review,setReview]=useState(null)
 const [groupKey,setGroupKey]=useState('')
 useEffect(()=>{
   if(!progress)return
   const guard=e=>{e.preventDefault();e.returnValue=''}
   window.addEventListener('beforeunload',guard)
   return ()=>window.removeEventListener('beforeunload',guard)
 },[progress])

 async function perform(batch, entries) {
   setReview(null)
   const imported=[], failures=[...batch.failures]
   setProgress({label:'Uploading scan files',done:0,total:entries.length})
   let completed=0
   // Three uploads at a time, with metadata-only patient records.
   for(let start=0;start<entries.length;start+=3){
     await Promise.all(entries.slice(start,start+3).map(async ({file,info})=>{
       try {
         if(info){
           const response=await fetch('/api/files',{method:'POST',credentials:'same-origin',signal:AbortSignal.timeout(120000),headers:{'Content-Type':'application/dicom','X-File-Name':encodeURIComponent(file.name)},body:file})
           const result=await response.json()
           if(!response.ok)throw new Error(result.error||'Upload failed')
           imported.push({id:crypto.randomUUID(),fileId:result.id,name:file.name,type:batch.type==='CBCT (DICOM)'?'CBCT (DICOM)':'DICOM study',date:date(),dicom:info})
         } else {
           const url=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(new Error('Cannot read this image'));reader.readAsDataURL(file)})
           imported.push({id:crypto.randomUUID(),name:file.name,url,type:batch.type,date:date()})
         }
       } catch(error){failures.push(`${file.name}: ${error.message}`)}
       finally {completed++;setProgress({label:'Uploading scan files',done:completed,total:entries.length})}
     }))
   }
   setProgress(null)
   const summary=`${imported.length} file(s) attached to ${batch.patientName}.`+(batch.skipped?` ${batch.skipped} non-image or duplicate file(s) skipped.`:'')+(failures.length?` ${failures.length} file(s) could not be imported: ${failures.slice(0,3).join('; ')}${failures.length>3?'…':''}`:'')
   if(imported.length)onImported(batch.patientId,imported,summary)
   else onNotice(summary)
 }

 async function choose(event) {
   const files=Array.from(event.target.files||[])
   const folder=event.target.hasAttribute('webkitdirectory')
   event.target.value=''
   if(!files.length||!patient||progress||review)return
   const batch={patientId:patient.id,patientName:patient.name,type:imageType,skipped:0,failures:[]}
   const entries=[]
   const seen=new Set(patient.images.map(image=>image.dicom?.sopUid).filter(Boolean))
   setProgress({label:'Reading scan folder',done:0,total:files.length})
   for(let index=0;index<files.length;index++){
     const file=files[index]
     try {
       if(file.name.toUpperCase()==='DICOMDIR'){batch.skipped++;continue}
       const header=new Uint8Array(await file.slice(0,132).arrayBuffer())
       const isDicom=header.length>=132&&String.fromCharCode(...header.slice(128,132))==='DICM'
       if(!isDicom&&folder){batch.skipped++;continue}
       if(imageType==='CBCT (DICOM)'&&!isDicom)throw new Error('CBCT requires original DICOM files (.dcm / .dicom), not JPG or PNG images')
       if(isDicom){
         if(file.size>128*1024*1024)throw new Error('DICOM limit is 128 MB per file')
         const info=dicomInfo(await file.arrayBuffer())
         if(info.sopUid&&seen.has(info.sopUid)){batch.skipped++;continue}
         if(info.sopUid)seen.add(info.sopUid)
         entries.push({file,info})
       } else {
         if(!['image/jpeg','image/png','image/webp'].includes(file.type)||file.size>2*1024*1024)throw new Error('Choose JPG, PNG or WebP up to 2 MB, or a DICOM file')
         entries.push({file,info:null})
       }
     }catch(error){batch.failures.push(`${file.name}: ${error.message||'Invalid DICOM file'}`)}
     finally {setProgress({label:'Reading scan folder',done:index+1,total:files.length})}
   }
   setProgress(null)
   if(!entries.length){onNotice(`No new image files were found. ${batch.skipped} file(s) skipped. ${batch.failures.slice(0,3).join('; ')}`);return}
   const groups=new Map()
   for(const entry of entries){
     const info=entry.info
     const key=info?JSON.stringify([info.patientId,normalize(info.patientName),(!info.patientId&&!info.patientName)?info.studyUid:'']):'images'
     if(!groups.has(key))groups.set(key,{key,name:info?.patientName||'Name unavailable',patientId:info?.patientId||'',encodingIssue:info?.nameDecodeIssue||false,entries:[],series:new Set()})
     const group=groups.get(key);group.entries.push(entry);if(info)group.series.add(info.seriesUid||info.studyUid||entry.file.name)
   }
   const candidates=[...groups.values()]
   const needsReview=folder||candidates.length>1||entries.some(entry=>entry.info&&(!entry.info.patientName||normalize(entry.info.patientName)!==normalize(patient.name)))
   if(needsReview){setReview({...batch,groups:candidates});setGroupKey(candidates.length===1?candidates[0].key:'')}
   else await perform(batch,entries)
 }
 return {choose,progress,review,groupKey,setGroupKey,cancel:()=>setReview(null),confirm:()=>{const group=review?.groups.find(item=>item.key===groupKey);if(group)void perform(review,group.entries)}}
}
