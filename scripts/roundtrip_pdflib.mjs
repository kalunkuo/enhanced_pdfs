// Re-save an enhanced PDF the way the browser viewer does: load with pdf-lib, add a
// standard annotation and an annotations.json attachment, write the file back.
//
//   NODE_PATH=<dir with node_modules/pdf-lib> node scripts/roundtrip_pdflib.mjs in.pdf out.pdf
//
// Used by roundtrip_check.py; pdf-lib is the viewer's save library (viewer/package.json).
import fs from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { PDFDocument, PDFName, PDFString } = require('pdf-lib');

const [, , input, output] = process.argv;
if (!input || !output) {
    console.error('usage: roundtrip_pdflib.mjs in.pdf out.pdf');
    process.exit(2);
}

const doc = await PDFDocument.load(fs.readFileSync(input), { updateMetadata: false });
const page = doc.getPage(0);
const { x, y } = page.getPosition();
const annot = doc.context.obj({
    Type: 'Annot',
    Subtype: 'Square',
    Rect: [x + 100, y + 100, x + 300, y + 200],
    C: [1, 0, 0],
    Border: [0, 0, 2],
    NM: PDFString.of('ep-roundtrip-square'),
    Contents: PDFString.of('round-trip test markup'),
    T: PDFString.of('roundtrip_check'),
});
const ref = doc.context.register(annot);
let annots = page.node.lookup(PDFName.of('Annots'));
if (!annots) {
    annots = doc.context.obj([]);
    page.node.set(PDFName.of('Annots'), annots);
}
annots.push(ref);

const review = { version: 1, annotations: [{ id: 'ep-roundtrip-square', kind: 'square', elementKeys: [] }] };
await doc.attach(Buffer.from(JSON.stringify(review)), 'annotations.json', {
    mimeType: 'application/json',
    description: 'round-trip test review layer',
});

fs.writeFileSync(output, await doc.save({ useObjectStreams: false }));
console.log(`wrote ${output}`);
