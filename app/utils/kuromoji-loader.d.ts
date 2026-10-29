declare module 'kuromoji/src/loader/BrowserDictionaryLoader' {
  const BrowserDictionaryLoader: { prototype: object };
  export default BrowserDictionaryLoader;
}

declare module 'kuromoji/src/viterbi/ViterbiBuilder' {
  const ViterbiBuilder: { prototype: object };
  export default ViterbiBuilder;
}

declare module 'kuromoji/src/viterbi/ViterbiLattice' {
  const ViterbiLattice: new () => { append(node: unknown): void; appendEos(): void };
  export default ViterbiLattice;
}

declare module 'kuromoji/src/viterbi/ViterbiNode' {
  const ViterbiNode: new (
    wordId: number,
    wordCost: number,
    start: number,
    length: number,
    type: string,
    leftId: number,
    rightId: number,
    surface: string,
  ) => unknown;
  export default ViterbiNode;
}

declare module 'kuromoji/src/util/SurrogateAwareString' {
  const SurrogateAwareString: new (text: string) => {
    length: number;
    slice(index: number): string;
    charAt(index: number): string;
    toString(): string;
  };
  export default SurrogateAwareString;
}
