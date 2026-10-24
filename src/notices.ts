import type { NoticeState } from './contract.js';

export function parseNotices(markdown: string): NoticeState['cards'] {
  if (new TextEncoder().encode(markdown).length > 32_768) throw new Error('notice_too_large');
  const cards: NoticeState['cards'] = [];
  let card: NoticeState['cards'][number] | undefined;
  for (const line of markdown.replace(/^\uFEFF/, '').replaceAll('\r\n', '\n').split('\n')) {
    const heading = /^##\s+(.+)$/.exec(line);
    if (heading) {
      card = { title: heading[1].trim(), text: '' };
      if (card.title.length > 80 || cards.length >= 6) throw new Error('notice_too_large');
      cards.push(card);
    } else if (card) {
      card.text += line + '\n';
      if (card.text.length > 4000) throw new Error('notice_too_large');
    } else if (line.trim() && !/^#\s/.test(line)) {
      throw new Error('notice_heading_required');
    }
  }
  return cards.map(item => ({ ...item, text: item.text.trim() }));
}
