export function layoutBlocks<T extends { start: number; end: number }>(items: T[]): (T & { lane: number; lanes: number })[] {
  const result: (T & { lane: number; lanes: number })[] = [];
  let group: typeof result = [];
  let groupEnd = -Infinity;
  const finish = () => { const lanes = Math.max(1,...group.map(item => item.lane + 1)); group.forEach(item => { item.lanes = lanes; }); group = []; };
  for (const item of [...items].sort((a,b) => a.start - b.start || b.end - a.end)) {
    if (item.start >= groupEnd) { finish(); groupEnd = item.end; }
    const occupied = new Set(group.filter(block => block.end > item.start).map(block => block.lane));
    let lane = 0; while (occupied.has(lane)) lane++;
    const block = { ...item, lane, lanes: 1 }; result.push(block); group.push(block); groupEnd = Math.max(groupEnd,item.end);
  }
  finish(); return result;
}
