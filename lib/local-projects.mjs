export const PROJECTS_KEY = 'autobuild.projects.v1';
const states = new Set(['setup', 'pre-print', 'printing', 'post-processing', 'complete']);

/** @param {Pick<Storage,'getItem'>} storage @returns {import('./project-store').Project[]} */
export function readProjects(storage) {
  try {
    const raw = storage.getItem(PROJECTS_KEY);
    const items = raw === null ? [] : JSON.parse(raw);
    if (!Array.isArray(items) || items.some(p => !p || typeof p.id !== 'string' || typeof p.name !== 'string' || !states.has(p.status) || !p.printer || typeof p.printer.name !== 'string')) throw new Error('Invalid projects');
    return items;
  } catch {
    throw new Error('Projects could not be read in this browser. Existing data was not changed.');
  }
}

/** @param {Pick<Storage,'getItem'|'setItem'>} storage @param {'create'|'update'|'delete'} operation @param {import('./project-store').Project|string} entry @param {Partial<import('./project-store').Project>} [updates] */
export function changeProjects(storage, operation, entry, updates) {
  const projects = readProjects(storage);
  const id = typeof entry === 'string' ? entry : entry.id;
  const existing = projects.find(p => p.id === id);
  if (operation === 'create' ? existing : !existing) throw new Error(operation === 'create' ? 'Project already exists.' : 'Project not found in this browser.');
  const next = operation === 'create' && typeof entry !== 'string' ? [entry, ...projects] : operation === 'delete' ? projects.filter(p => p.id !== id) : projects.map(p => p.id === id ? {...p, ...updates, id} : p);
  try {
    storage.setItem(PROJECTS_KEY, JSON.stringify(next));
  } catch {
    throw new Error('Project changes could not be saved in this browser.');
  }
  return next;
}
