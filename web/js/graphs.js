import { $, announce } from './api.js';

// exactly your existing pretty SVG renderer, exported:
export async function tryRenderPrettyGraphs(sessionId){
  const prettyWrap = $('graphs-pretty');
  const host = $('graphHost');
  const legend = $('graphLegend');
  if(!prettyWrap || !host || !legend) return false;

  let data;
  try{
    const r = await fetch(`/api/session/${encodeURIComponent(sessionId)}/fr.json`);
    if(!r.ok) throw 0;
    data = await r.json();
    if(!data || !Array.isArray(data.series) || !data.series.length) throw 0;
  }catch{ prettyWrap.hidden = true; return false; }

  // … keep the rest of your renderer unchanged …
  // (Paste your drawGrid/drawSeries/etc. functions here verbatim)

  // At the end:
  prettyWrap.hidden=false;
  return true;
}
