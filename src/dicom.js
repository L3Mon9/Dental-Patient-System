import dicomParser from 'dicom-parser'

const characterSets = {
  'ISO_IR 6': 'utf-8', 'ISO_IR 192': 'utf-8', 'ISO_IR 100': 'iso-8859-1',
  'ISO_IR 101': 'iso-8859-2', 'ISO_IR 109': 'iso-8859-3', 'ISO_IR 110': 'iso-8859-4',
  'ISO_IR 144': 'iso-8859-5', 'ISO_IR 127': 'iso-8859-6', 'ISO_IR 126': 'iso-8859-7',
  'ISO_IR 138': 'iso-8859-8', 'ISO_IR 148': 'iso-8859-9', 'ISO_IR 166': 'windows-874',
  GB18030: 'gb18030', GBK: 'gbk', 'ISO_IR 13': 'shift_jis',
}
export function dicomInfo(buffer) {
 const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer)
 const dataset = dicomParser.parseDicom(bytes, { untilTag: 'x7fe00010' })
 const text = tag => dataset.string(tag)?.trim() || ''
 const charset = text('x00080005')
 const encoding = characterSets[charset || 'ISO_IR 6']
 function decoded(tag) {
   const element=dataset.elements[tag]
   if(!element || !element.length)return {value:'',issue:false}
   if(!encoding)return {value:'',issue:true}
   try {
     const raw=dataset.byteArray.subarray(element.dataOffset,element.dataOffset+element.length)
     const value=new TextDecoder(encoding,{fatal:true}).decode(raw).replace(/\0+$/,'').trim()
     // Do not present undecodable control bytes as a patient identity.
     if(Array.from(value).some(char=>{const code=char.codePointAt(0);return code<32||(code>=127&&code<=159)||code===65533}))return {value:'',issue:true}
     return {value,issue:false}
   } catch { return {value:'',issue:true} }
 }
 const rows=dataset.uint16('x00280010'), columns=dataset.uint16('x00280011')
 if (!rows || !columns) throw new Error('This DICOM object does not contain a supported image matrix.')
 const frames = Number(text('x00280008') || 1)
 if (!Number.isSafeInteger(frames) || frames < 1 || frames > 50000) throw new Error('Invalid or oversized frame count.')
 const name=decoded('x00100010'), id=decoded('x00100020')
 return { patientName:(name.value.split('=').find(Boolean)||'').replaceAll('^',' ').replace(/\s+/g,' ').trim(), patientId:id.value, nameDecodeIssue:name.issue, characterSet:charset, modality:text('x00080060'), seriesUid:text('x0020000e'), studyUid:text('x0020000d'), sopUid:text('x00080018'), description:decoded('x0008103e').value, instance:Number(text('x00200013')||0), rows,columns,frames,transferSyntax:text('x00020010') }
}
export function groupStudies(images) {
 const groups=new Map()
 for(const image of images.filter(i=>i.fileId)) {const key=image.dicom?.seriesUid || image.fileId;if(!groups.has(key))groups.set(key,{id:key,name:image.dicom?.description||image.name,images:[],frames:0});const group=groups.get(key);group.images.push(image);group.frames+=image.dicom?.frames||1}
 return [...groups.values()].map(group=>({...group,images:group.images.sort((a,b)=>(a.dicom?.instance||0)-(b.dicom?.instance||0)||a.name.localeCompare(b.name))}))
}
