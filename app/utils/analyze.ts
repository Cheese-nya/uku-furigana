import type { KuromojiToken } from './kuromojiEngine';

/** One kuromoji token with its place in the analysed text, for word lookup. */
export interface AnalyzedToken {
  surface: string;
  basicForm: string;
  reading: string;
  pos: string;
  posDetail: string;
  conjugatedForm: string;
  start: number;
  end: number;
}

export function toAnalyzedTokens(tokens: KuromojiToken[]): AnalyzedToken[] {
  let offset = 0;
  return tokens.map(token => {
    // word_position is 1-based, but counting surfaces is safe even if a build reports it differently
    const start = offset;
    offset += token.surface_form.length;
    return {
      surface: token.surface_form,
      basicForm: token.basic_form,
      reading: token.reading ?? '',
      pos: token.pos,
      posDetail: token.pos_detail_1,
      conjugatedForm: token.conjugated_form,
      start,
      end: offset,
    };
  });
}
