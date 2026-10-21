// macOS Chromium can map PingFang glyphs to look-alike Unicode radicals in ToUnicode.
// Preserve the glyphs and only repair the searchable text layer. References:
// https://www.unicode.org/Public/18.0.0/ucd/CJKRadicals.txt
// https://www.unicode.org/Public/18.0.0/ucd/NamesList.txt
const supplement = new Map([
  [0x2ec4, 0x897f], [0x2ec6, 0x89d2], [0x2ed3, 0x957f], [0x2ed4, 0x95e8],
  [0x2eda, 0x9875], [0x2edc, 0x98de], [0x2ee3, 0x9aa8], [0x2eec, 0x9f50],
]);

export function repairCMap(cmap, originalText) {
  const repair = hex => {
    if (hex.length % 4) throw new Error('Unexpected PDF Unicode mapping length');
    const text = hex.match(/.{4}/g).map(unit => String.fromCharCode(Number.parseInt(unit, 16))).join('');
    const corrected = [...text].map(char => {
      if (originalText.includes(char)) return char;
      const code = char.codePointAt(0);
      if (supplement.has(code)) return String.fromCodePoint(supplement.get(code));
      return code >= 0x2f00 && code <= 0x2fd5 ? char.normalize('NFKC') : char;
    }).join('');
    return [...Array(corrected.length)].map((_, index) => corrected.charCodeAt(index).toString(16).padStart(4, '0')).join('').toUpperCase();
  };
  let result = cmap.replace(/(\d+\s+beginbfchar)([\s\S]*?)endbfchar/g, (_match, header, body) =>
    `${header}${body.replace(/(<[0-9a-f]+>\s*)<([0-9a-f]+)>/gi, (_pair, source, unicode) => `${source}<${repair(unicode)}>`)}endbfchar`);
  result = result.replace(/\d+\s+beginbfrange([\s\S]*?)endbfrange/g, (match, body) => {
    const entries = [];
    let changed = false;
    const rest = body.replace(/<([0-9a-f]+)>\s*<([0-9a-f]+)>\s*<([0-9a-f]+)>/gi, (_range, startHex, endHex, unicodeHex) => {
      const start = Number.parseInt(startHex, 16), end = Number.parseInt(endHex, 16);
      if (end < start || end - start > 65535) throw new Error('Unexpected PDF Unicode range');
      for (let code = start; code <= end; code++) {
        const unicode = (BigInt(`0x${unicodeHex}`) + BigInt(code - start)).toString(16).padStart(unicodeHex.length, '0');
        const corrected = repair(unicode);
        changed ||= corrected !== unicode.toUpperCase();
        entries.push(`<${code.toString(16).padStart(startHex.length, '0')}> <${corrected}>`);
      }
      return '';
    });
    if (rest.trim()) throw new Error('Unsupported PDF Unicode range syntax');
    if (!changed) return match;
    const blocks = [];
    for (let index = 0; index < entries.length; index += 100) {
      const block = entries.slice(index, index + 100);
      blocks.push(`${block.length} beginbfchar\n${block.join('\n')}\nendbfchar`);
    }
    return blocks.join('\n');
  });
  return result;
}

export async function repairPdfText(pdf, originalText) {
  const { PDFDocument, PDFDict, PDFName, PDFRawStream, PDFRef, decodePDFRawStream } = await import('pdf-lib');
  const document = await PDFDocument.load(pdf, { updateMetadata: false });
  const processed = new Set();
  let changed = false;
  const name = PDFName.of('ToUnicode');
  for (const page of document.getPages()) {
    const fonts = page.node.Resources()?.lookupMaybe(PDFName.of('Font'), PDFDict);
    if (!fonts) continue;
    for (const [, value] of fonts.entries()) {
      const font = document.context.lookup(value, PDFDict), reference = font.get(name);
      if (!reference) continue;
      const stream = document.context.lookup(reference, PDFRawStream);
      if (processed.has(stream)) continue;
      processed.add(stream);
      const cmap = Buffer.from(decodePDFRawStream(stream).decode()).toString('ascii');
      const repaired = repairCMap(cmap, originalText);
      if (repaired === cmap) continue;
      const replacement = document.context.flateStream(Buffer.from(repaired, 'ascii'));
      for (const [key, entry] of stream.dict.entries()) {
        if (!['Length', 'Filter', 'DecodeParms'].includes(key.decodeText())) replacement.dict.set(key, entry);
      }
      if (reference instanceof PDFRef) document.context.assign(reference, replacement);
      else font.set(name, document.context.register(replacement));
      changed = true;
    }
  }
  return changed ? Buffer.from(await document.save({ useObjectStreams: false })) : pdf;
}
