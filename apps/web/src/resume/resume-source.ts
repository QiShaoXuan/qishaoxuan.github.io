export type ResumeBlock =
  | { type: 'paragraph'; text: string }
  | { type: 'heading'; level: number; text: string }
  | { type: 'list'; ordered: boolean; start: number; items: ResumeBlock[][] };

export interface ResumeSection {
  title: string;
  blocks: ResumeBlock[];
}

const listMarker = /^(\s*)([-*+]|\d+\.)\s+(.*)$/;

/** The small Markdown subset used by our resume; HTML is always ordinary text. */
export function parseResumeBlocks(source: string): ResumeBlock[] {
  const lines = source.replace(/\r\n/g, '\n').split('\n');
  const blocks: ResumeBlock[] = [];
  let index = 0;
  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim()) { index++; continue; }
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      blocks.push({ type: 'heading', level: heading[1].length, text: heading[2] });
      index++;
      continue;
    }
    const first = listMarker.exec(line);
    if (first) {
      const indent = first[1].length;
      const ordered = /\d/.test(first[2]);
      const items: ResumeBlock[][] = [];
      while (index < lines.length) {
        const marker = listMarker.exec(lines[index]);
        if (!marker || marker[1].length !== indent || /\d/.test(marker[2]) !== ordered) break;
        const contentIndent = marker[1].length + marker[2].length + 1;
        const itemLines = [marker[3]];
        index++;
        while (index < lines.length) {
          const next = lines[index];
          if (next.trim() && next.search(/\S/) <= indent) break;
          itemLines.push(next.slice(Math.min(contentIndent, next.search(/\S/) < 0 ? next.length : next.search(/\S/))));
          index++;
        }
        items.push(parseResumeBlocks(itemLines.join('\n')));
      }
      blocks.push({ type: 'list', ordered, start: ordered ? Number.parseInt(first[2], 10) : 1, items });
      continue;
    }
    const paragraph = [line.trim()];
    index++;
    while (index < lines.length && lines[index].trim() && !listMarker.test(lines[index]) && !/^#{1,6}\s/.test(lines[index])) {
      paragraph.push(lines[index].trim());
      index++;
    }
    blocks.push({ type: 'paragraph', text: paragraph.join(' ') });
  }
  return blocks;
}

export function parseResumeSections(source: string): ResumeSection[] {
  const sections: ResumeSection[] = [];
  for (const block of parseResumeBlocks(source)) {
    if (block.type === 'heading' && block.level === 2) sections.push({ title: block.text, blocks: [] });
    else {
      if (!sections.length) sections.push({ title: '', blocks: [] });
      sections.at(-1)!.blocks.push(block);
    }
  }
  return sections;
}

export function blockText(blocks: ResumeBlock[]): string {
  return blocks.map(block => block.type === 'list' ? block.items.map(blockText).join('\n') : block.text).join('\n');
}

export function safeLink(href: string): string | undefined {
  return /^(https?:\/\/|mailto:|tel:)/i.test(href) ? href : undefined;
}
