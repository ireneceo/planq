// 시간 격자에서 겹치는 일정을 **나란히** 놓는다 (2026-10-07).
//   Irene: "일정에서 시간이 겹칠 때 아예 표시가 겹쳐버려. 글자들이 겹치면 안되는데 2열이 되게 하거나 조치 좀 해봐."
//   예전엔 모든 일정이 left:2px · right:2px 로 칸 전체를 차지해 같은 시각 일정이 서로를 덮었다.
//
//   ① 화면에 그려지는 범위(최소 높이 포함)로 겹침을 판정한다 — 10분짜리도 20분 높이로 그려지므로
//      실제 시각만 보면 «안 겹친다» 고 판정한 두 칸의 글자가 겹친다.
//   ② 서로 이어진 겹침 묶음(cluster)마다 칸 수를 정하고, 각 일정은 비어 있는 가장 왼쪽 칸에 들어간다.
//   ③ 묶음이 끝나면 칸 수를 새로 센다 — 오전에 셋이 겹쳤다고 오후 일정까지 1/3 폭이 되면 안 된다.
export interface LaneInput { key: string; startMin: number; endMin: number }
export interface LanePos { lane: number; lanes: number }

export function layoutLanes(items: LaneInput[]): Map<string, LanePos> {
  const out = new Map<string, LanePos>();
  const sorted = [...items].sort((a, b) => a.startMin - b.startMin || b.endMin - a.endMin);
  let cluster: { key: string; lane: number }[] = [];
  let laneEnds: number[] = [];
  let clusterEnd = -Infinity;
  const flush = () => {
    const lanes = Math.max(1, laneEnds.length);
    for (const c of cluster) out.set(c.key, { lane: c.lane, lanes });
    cluster = []; laneEnds = []; clusterEnd = -Infinity;
  };
  for (const it of sorted) {
    if (cluster.length && it.startMin >= clusterEnd) flush();
    let lane = laneEnds.findIndex((end) => end <= it.startMin);
    if (lane === -1) { lane = laneEnds.length; laneEnds.push(it.endMin); } else laneEnds[lane] = it.endMin;
    cluster.push({ key: it.key, lane });
    clusterEnd = Math.max(clusterEnd, it.endMin);
  }
  flush();
  return out;
}
