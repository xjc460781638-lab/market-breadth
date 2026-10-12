/** Assign unique, widely spaced hues across the full catalogue, independent of selection/rank. */
export function flowColors(codes:string[]) {
  return new Map([...new Set(codes)].sort().map((code,i)=>[
    code,`hsl(${((i*137.507764)%360).toFixed(4)}, ${[88,68,98][i%3]}%, ${[64,75,55][Math.floor(i/3)%3]}%)`,
  ]));
}
