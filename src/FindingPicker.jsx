import { useState } from 'react'
const commonFindings = [
  ['Tooth structure', ['Dental caries / cavity', 'Recurrent caries', 'Cracked tooth', 'Fractured / chipped tooth', 'Tooth wear / attrition', 'Enamel erosion', 'Abrasion', 'Enamel defect']],
  ['Symptoms & supporting tissues', ['Tooth sensitivity', 'Toothache / pain', 'Gingival inflammation', 'Gingival recession', 'Periodontal pocket', 'Tooth mobility', 'Swelling', 'Suspected abscess']],
  ['Position & eruption', ['Impacted tooth', 'Partially erupted tooth', 'Malpositioned tooth', 'Retained root', 'Missing tooth']],
  ['Existing restorations', ['Existing filling', 'Defective / broken filling', 'Existing crown', 'Defective / loose crown', 'Previously root-treated tooth']],
]
export default function FindingPicker({ selections = [], notes = '' }) {
  const [chosen, setChosen] = useState(selections)
  const [search, setSearch] = useState('')
  const filtered = commonFindings.map(([group, items]) => [group, items.filter(item => item.toLowerCase().includes(search.trim().toLowerCase()))]).filter(([, items]) => items.length)
  function toggle(item) { setChosen(values => values.includes(item) ? values.filter(value => value !== item) : [...values, item]) }
  return <div className="finding-picker">
    <div className="finding-picker-heading"><h3>Common tooth findings</h3><span className="count">{chosen.length} selected</span></div>
    <p id="finding-help">Select all findings that apply, then add any details or planned care.</p>
    <input type="search" aria-label="Search common tooth findings" autoFocus placeholder="Search cavities, sensitivity, fractures…" value={search} onChange={event => setSearch(event.target.value)} />
    <div className="finding-options" role="group" aria-label="Common tooth findings" aria-describedby="finding-help" tabIndex="0">
      {filtered.map(([group, items]) => <fieldset key={group}><legend>{group}</legend>{items.map(item => <label className="finding-option" key={item}><input type="checkbox" checked={chosen.includes(item)} onChange={() => toggle(item)} /><span>{item}</span></label>)}</fieldset>)}
      {!filtered.length && <p className="empty">No matching findings. Add your own description in the notes below.</p>}
    </div>
    {chosen.length > 0 && <div className="selected-findings">{chosen.map(item => <span key={item}><input type="hidden" name="conditions" value={item} /><button type="button" aria-label={`Remove ${item}`} onClick={() => toggle(item)}>{item} ×</button></span>)}</div>}
    <label className="finding-notes">Additional finding / treatment note<textarea name="finding" required={chosen.length === 0} defaultValue={notes} rows="3" placeholder="Add symptoms, location, assessment, or planned care…" /></label>
    <small>Select a finding or enter a note to save.</small>
  </div>
}
