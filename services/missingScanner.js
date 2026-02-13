const fs = require('fs');
const path = require('path');

function pad(n){return n<10? '0'+n: String(n)}
function toDateStr(d){return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`}

function buildDateRange(start, end){
  const dates = [];
  const s = new Date(start); s.setHours(0,0,0,0);
  const e = new Date(end); e.setHours(0,0,0,0);
  if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime()) || s>e) return dates;
  const cur = new Date(s);
  while (cur<=e){ dates.push(toDateStr(new Date(cur))); cur.setDate(cur.getDate()+1); }
  return dates;
}

function isDateFolder(name){ return /^\d{4}-\d{2}-\d{2}$/.test(name); }

function extractPosFromFilename(name){
  const m1 = /pos[_-]?(\d{1,3})/i.exec(name);
  if(m1) return String(Number(m1[1]));
  const m2 = /^pos(\d{1,3})_/.exec(name);
  if(m2) return String(Number(m2[1]));
  const m3 = /_(\d{1,3})_/.exec(name);
  if(m3) return String(Number(m3[1]));
  return null;
}

function scanWorkdir(workdir){
  const abs = path.resolve(process.cwd(), workdir || 'latest');
  if(!fs.existsSync(abs)) return {};
  const branches = fs.readdirSync(abs, { withFileTypes: true });
  const result = {};
  for(const b of branches){
    if(!b.isDirectory()) continue;
    const branch = b.name;
    const branchPath = path.join(abs, branch);
    const dateEntries = fs.readdirSync(branchPath, { withFileTypes: true });
    for(const d of dateEntries){
      if(d.isDirectory() && isDateFolder(d.name)){
        const date = d.name;
        const datePath = path.join(branchPath, d.name);
        const files = fs.readdirSync(datePath).filter(Boolean);
        for(const f of files){
          const pos = extractPosFromFilename(f) || '1';
          result[branch] = result[branch] || {};
          result[branch][pos] = result[branch][pos] || new Set();
          result[branch][pos].add(date);
        }
      } else if(d.isFile()){
        // try to extract date from filename
        const m = /(\d{4}-\d{2}-\d{2})/.exec(d.name);
        if(m){
          const date = m[1];
          const pos = extractPosFromFilename(d.name) || '1';
          result[branch] = result[branch] || {};
          result[branch][pos] = result[branch][pos] || new Set();
          result[branch][pos].add(date);
        }
      }
    }
  }
  // convert sets to arrays
  const out = {};
  for(const [branch, posMap] of Object.entries(result)){
    out[branch] = {};
    for(const [pos, s] of Object.entries(posMap)) out[branch][pos] = Array.from(s).sort();
  }
  return out;
}

const { parse } = require('csv-parse/sync');

function inferWeekdaysFromDates(dates){
  const s = new Set(dates.map(d=> new Date(d).getDay()));
  return Array.from(s).sort();
}

function tryParseDateFromValue(val){
  if(!val) return null;
  const s = String(val).trim();
  // ISO-like
  const mIso = /(\d{4}-\d{2}-\d{2})/.exec(s);
  if(mIso) return mIso[1];
  // common mm/dd/yyyy
  const m2 = /(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(s);
  if(m2){
    const mm = m2[1].padStart(2,'0');
    const dd = m2[2].padStart(2,'0');
    return `${m2[3]}-${mm}-${dd}`;
  }
  return null;
}

function inferWeekdaysFromSampleFile(samplePath, maxRows=500){
  try{
    if(!fs.existsSync(samplePath)) return null;
    const content = fs.readFileSync(samplePath, 'utf8');
    const records = parse(content, { relax_column_count: true, skip_empty_lines: true });
    const dates = [];
    for(let i=0;i<records.length && dates.length<maxRows;i++){
      const row = records[i];
      // try each column for a parsable date
      for(const cell of row){
        const d = tryParseDateFromValue(cell);
        if(d){ dates.push(d); break; }
      }
    }
    if(!dates.length) return null;
    return inferWeekdaysFromDates(dates.slice(0,200));
  }catch(e){
    return null;
  }
}

async function scan(opts = {}){
  const { workdir = 'latest', start, end, branches, positions, sampleFile } = opts;
  const rangeStart = start || (()=>{ const d = new Date(); d.setDate(d.getDate()-30); return toDateStr(d); })();
  const rangeEnd = end || toDateStr(new Date());
  const allDates = buildDateRange(rangeStart, rangeEnd);

  const scanned = scanWorkdir(workdir);

  const branchesList = branches && branches.length ? branches : Object.keys(scanned);
  const posListDefault = positions && positions.length ? positions.map(String) : null;

  const results = [];
  // try sample-file inference first (if provided)
  const sampleWeekdays = sampleFile ? inferWeekdaysFromSampleFile(path.resolve(process.cwd(), sampleFile)) : null;

  for(const branch of branchesList){
    const posMap = scanned[branch] || {};
    const posKeys = posListDefault || Object.keys(posMap).length ? Object.keys(posMap) : ['1'];
    for(const pos of posKeys){
      const existing = (posMap[pos] || []).filter(Boolean);
      // infer operating weekdays
      let operatingWeekdays = null;
      if(sampleWeekdays && sampleWeekdays.length) {
        operatingWeekdays = sampleWeekdays;
      } else {
        const weekdayCounts = new Set(existing.map(d=> new Date(d).getDay()));
        if(weekdayCounts.size && existing.length>=3){
          operatingWeekdays = Array.from(weekdayCounts).sort();
        } else {
          // fallback: assume all days
          operatingWeekdays = [0,1,2,3,4,5,6];
        }
      }
      const expected = allDates.filter(d=> operatingWeekdays.includes(new Date(d).getDay()));
      const missing = expected.filter(d=> !existing.includes(d));
      results.push({ branch, pos: Number(pos), existingDates: existing, existingCount: existing.length, operatingWeekdays, missingDates: missing });
    }
  }

  return { start: rangeStart, end: rangeEnd, results };
}

module.exports = { scan };
