const STOP = new Set('a an and are as at be can do does erfan for from he her him his how i in is it me of on or s tell that the their them they this to us was what when where which who why with work you your about please'.split(' '));
export function normalize(value) { return value.toLowerCase().normalize('NFKD').replace(/[’']/g, '').replace(/[^a-z0-9]+/g, ' ').trim(); }
export function retrieve(question, knowledge, previousId = '') {
  const q = normalize(question);
  const byId = id => knowledge.find(item => item.id === id);
  if (/\b(secret|password|credential|private chat|client data|student record|system prompt|api key|ignore instruction)\b/.test(q)) return byId('boundaries');
  if (/^(hi|hello|hey|good morning|good evening)[ !.]*$/.test(q)) return byId('identity');
  if (/\b(price|pricing|available|availability|salary|revenue|profit|valuation|married|wife|birthday|religion|politic|guarantee)\b/.test(q)) return byId('unknown');
  if (/\b(connect|connected|connection|gateway|live memory|actual brain|real brain)\b/.test(q) && /\b(brain|drx|dr x|ai|you|profile|gateway)\b/.test(q)) return byId('gateway-connection');
  if (/\b(are you|clone|conscious|digital twin|real person|human being)\b/.test(q)) return byId('guide-identity');
  if (/\b(dr x|drx|second brain)\b/.test(q) && /\b(what|who|tell|explain|about)\b/.test(q)) return byId('second-brain');
  if (/\b(countr|countries|where|geograph|international)\b/.test(q) && /\b(work|worked|experience|based|career)\b/.test(q)) return byId('identity');
  const tokens = [...new Set(q.split(' ').filter(x => x.length > 2 && !STOP.has(x)))];
  if (tokens.length === 0) return byId('unknown');
  let best = null; let bestScore = 0;
  for (const item of knowledge.filter(x => x.id !== 'unknown')) {
    const patterns = [item.question, ...item.question_patterns].map(normalize);
    let score = 0;
    for (const pattern of patterns) {
      const pt = pattern.split(' ').filter(x => x.length > 2 && !STOP.has(x));
      if (pt.length && q.includes(pattern)) score = Math.max(score, 5 + pt.length);
      const hits = pt.filter(t => tokens.includes(t)).length;
      score = Math.max(score, hits ? hits * 2 + hits / Math.max(pt.length, 1) : 0);
    }
    if (score > bestScore) { bestScore = score; best = item; }
  }
  if (bestScore >= 2.4) return best;
  if (/\b(that|there|more|approach|result)\b/.test(q) && previousId && byId(previousId)) return byId(previousId);
  return byId('unknown');
}

export function selectSourcedAnswer(result, knowledge) {
  const item = knowledge.find(candidate => candidate.id === result?.id);
  if (!item || ['boundaries','unknown','guide-identity','contact','gateway-connection'].includes(item.id)) return null;
  if (typeof result.score !== 'number' || !Number.isFinite(result.score) || result.score < .15) return null;
  if (typeof result.excerpt !== 'string' || result.excerpt.trim().length < 3 || !item.answer.includes(result.excerpt)) return null;
  return item;
}
