export default function ImagingImportDialog({ importer }) {
 const {progress,review,groupKey,setGroupKey,cancel,confirm}=importer
 if(!progress&&!review)return null
 return <div className="modal-backdrop"><section className="modal import-dialog" role="dialog" aria-modal="true" aria-labelledby="import-title">
   {progress?<><h2 id="import-title">{progress.label}</h2><p className="import-progress-label" role="status">{progress.done} of {progress.total} files</p><progress max={progress.total||1} value={progress.done}/><p>Please keep this page open while the scan is imported.</p></>:<>
     <h2 id="import-title">Review scan import</h2><p className="import-destination">Attach scan to <strong>{review.patientName}</strong></p><p>Confirm the scan belongs to this patient once for the whole batch.</p>
     {review.groups.length>1&&<p className="import-warning">This selection contains different patient identities. Choose the group belonging to {review.patientName}; other groups will not be attached.</p>}
     <div className="import-groups">{review.groups.map(group=><label className="import-group" key={group.key}><input type="radio" name="scan-patient" checked={groupKey===group.key} onChange={()=>setGroupKey(group.key)}/><span><strong>{group.name}</strong><small>Scan patient ID: {group.patientId||'Not recorded'}</small><small>{group.entries.length} image file(s) · {group.series.size} DICOM series</small>{group.encodingIssue&&<small>Name uses an unsupported or invalid text encoding. Verify the scan using its patient ID.</small>}</span></label>)}</div>
     {(review.skipped>0||review.failures.length>0)&&<p className="import-skipped">{review.skipped} non-image or duplicate file(s) skipped. {review.failures.length} unreadable file(s).</p>}
     {review.failures.length>0&&<details><summary>Files that could not be read</summary><ul>{review.failures.slice(0,20).map((failure,i)=><li key={i}>{failure}</li>)}</ul></details>}
     <div className="modal-actions"><button type="button" className="secondary" onClick={cancel}>Cancel import</button><button type="button" className="primary" disabled={!groupKey} onClick={confirm}>Import and open Viewer</button></div>
   </>}
 </section></div>
}
