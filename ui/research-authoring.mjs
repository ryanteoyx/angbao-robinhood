/** Pure editor helpers for the existing research authoring payload. Validation stays at the save boundary. */
const LIMITS = Object.freeze({ evidence: 12, claims: 12, inferences: 8, gaps: 8 });
const LABELS = Object.freeze({ evidence: 'sources', claims: 'claims', inferences: 'inferences', gaps: 'gaps' });
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const trimmed = value => typeof value === 'string' ? value.trim() : value;

function clonedDraft(draft) {
  if (!object(draft)) throw new Error('The research draft must be an object. Restore the draft before editing it.');
  return structuredClone(draft);
}

function checkedSection(draft, section) {
  if (!Object.hasOwn(LIMITS, section)) throw new Error('Choose sources, claims, inferences or gaps to edit.');
  if (!Array.isArray(draft[section])) throw new Error(`The ${LABELS[section]} list is invalid. Check it in the JSON editor before adding or removing items.`);
  return draft[section];
}

/** A draft has the same shape as the save payload; IDs and optional version references stay intact. */
export function createResearchDraft(payload) {
  const blank = { question: '', answer: '', authorship: 'agent-authored', evidence: [], claims: [], inferences: [], gaps: [] };
  if (payload === undefined) return blank;
  return { ...blank, ...clonedDraft(payload) };
}

/** Trim prose without hiding incomplete rows, invalid values or unsupported fields from validation. */
export function researchDraftPayload(draft) {
  const payload = clonedDraft(draft);
  for (const key of ['question', 'answer']) if (Object.hasOwn(payload, key)) payload[key] = trimmed(payload[key]);
  if (Array.isArray(payload.evidence)) payload.evidence = payload.evidence.map(item => {
    if (!object(item)) return item;
    for (const key of ['title', 'url', 'excerpt']) if (Object.hasOwn(item, key)) item[key] = trimmed(item[key]);
    return item;
  });
  for (const section of ['claims', 'inferences']) if (Array.isArray(payload[section])) payload[section] = payload[section].map(item => {
    if (object(item) && Object.hasOwn(item, 'text')) item.text = trimmed(item.text);
    return item;
  });
  if (Array.isArray(payload.gaps)) payload.gaps = payload.gaps.map(trimmed);
  return payload;
}

/** Valid raw authoring JSON with no invented source or nested instruction wrapper. */
export function researchTemplatePayload() {
  return {
    question: 'Example: What changed, and what remains uncertain?',
    answer: 'Example only. Replace this with your final research answer before saving.',
    authorship: 'agent-authored',
    evidence: [],
    claims: [],
    inferences: [],
    gaps: ['Replace this example and add the sources you used. No sources have been supplied.'],
  };
}

function nextId(draft, prefix) {
  const used = new Set();
  for (const section of ['evidence', 'claims']) {
    if (Array.isArray(draft[section])) for (const item of draft[section]) if (object(item) && typeof item.id === 'string') used.add(item.id);
  }
  let number = 1;
  while (used.has(`${prefix}-${number}`)) number++;
  return `${prefix}-${number}`;
}

export function addResearchItem(draft, section) {
  const next = clonedDraft(draft), items = checkedSection(next, section);
  if (items.length >= LIMITS[section]) throw new Error(`You can add up to ${LIMITS[section]} ${LABELS[section]}. Remove an item before adding another.`);
  if (section === 'evidence') items.push({ id: nextId(next, 'source'), title: '', url: '', publishedAt: null, observedAt: null, excerpt: '' });
  else if (section === 'claims') items.push({ id: nextId(next, 'claim'), stance: 'supporting', text: '', evidenceIds: [] });
  else if (section === 'inferences') items.push({ text: '', claimIds: [] });
  else items.push('');
  return next;
}

export function removeResearchItem(draft, section, index) {
  const next = clonedDraft(draft), items = checkedSection(next, section);
  if (!Number.isInteger(index) || index < 0 || index >= items.length) throw new Error('This item is no longer in the draft. Choose an item from the current list.');
  if (section === 'evidence' || section === 'claims') {
    const dependentSection = section === 'evidence' ? 'claims' : 'inferences';
    const referenceField = section === 'evidence' ? 'evidenceIds' : 'claimIds';
    const dependents = checkedSection(next, dependentSection), id = items[index]?.id;
    if (typeof id === 'string' && dependents.some(item => object(item) && Array.isArray(item[referenceField]) && item[referenceField].includes(id))) {
      throw new Error(section === 'evidence'
        ? 'A claim still uses this source. Update or remove that claim before removing the source.'
        : 'An inference still uses this claim. Update or remove that inference before removing the claim.');
    }
  }
  items.splice(index, 1);
  return next;
}
