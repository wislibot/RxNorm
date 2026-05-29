const MERGE_BLACKLIST = new Set([
  'mg', 'ml', 'mcg', 'g', 'iu', 'kg', 'cm', 'mm',
]);

const DOMAIN_REPLACEMENTS: Array<[RegExp, string]> = [
  [/Warnings\s*&\s*Precaut\s+ions/gi, 'Warnings & Precautions'],
  [/Precaut\s+ions/gi, 'Precautions'],
  [/Physiciam/gi, 'Physician'],
  [/Pharmaci\s+st/gi, 'Pharmacist'],
];

export function normalizeOcrEnglishSpacing(text: string): string {
  if (!text) return text;

  let result = text;

  for (let pass = 0; pass < 3; pass++) {
    let changed = false;
    const words = result.split(/(\s+)/);
    const output: string[] = [];
    let i = 0;

    while (i < words.length) {
      const w = words[i];
      if (/^[A-Za-z]{2,}$/.test(w) && !MERGE_BLACKLIST.has(w.toLowerCase())) {
        let j = i + 1;
        while (j < words.length && words[j].trim() === '') j++;
        const nextWord = words[j];
        if (
          j < words.length &&
          /^[A-Za-z]{2,}$/.test(nextWord) &&
          !MERGE_BLACKLIST.has(nextWord.toLowerCase())
        ) {
          const combined = w + nextWord;
          if (combined.length <= 20) {
            if (w.length >= 5 && nextWord.length >= 5) {
              output.push(w);
              i++;
              continue;
            }
            output.push(combined);
            output.push(words[j + 1] ?? '');
            i = j + 2;
            changed = true;
            continue;
          }
        }
      }
      output.push(w);
      i++;
    }

    result = output.join('');
    if (!changed) break;
  }

  for (const [pattern, replacement] of DOMAIN_REPLACEMENTS) {
    result = result.replace(pattern, replacement);
  }

  return result;
}
