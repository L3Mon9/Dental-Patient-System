import assert from 'node:assert/strict'
import { syntheticDicom } from './dicom-fixture.mjs'
import { dicomInfo } from './src/dicom.js'
assert.equal(dicomInfo(syntheticDicom({patientName:'José^Niño',charset:'ISO_IR 192'})).patientName,'José Niño')
assert.equal(dicomInfo(syntheticDicom({patientName:Buffer.from('José^Niño','latin1'),charset:'ISO_IR 100'})).patientName,'José Niño')
const unreadable=dicomInfo(syntheticDicom({patientName:Buffer.from([0xff,0xff]),charset:'ISO_IR 192'}))
assert.equal(unreadable.patientName,'');assert.equal(unreadable.nameDecodeIssue,true)
const unsupported=dicomInfo(syntheticDicom({patientName:'Test^Patient',charset:'UNSUPPORTED'}))
assert.equal(unsupported.nameDecodeIssue,true)
console.log('PASS: declared UTF-8 and Latin-1 names decode; invalid/unsupported encodings show as unavailable.')
