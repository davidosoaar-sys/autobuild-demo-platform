'use client';
import {
  createContext, useContext, useEffect, useState, useCallback, ReactNode,
} from 'react';
import { readProjects, changeProjects, PROJECTS_KEY } from './local-projects.mjs';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ReportAlert {
  time:    string;
  layer:   number;
  message: string;
}

export interface ProjectReport {
  generatedAt:    string;
  totalLayers:    number;
  layersPrinted:  number;
  errorsDetected: number;
  errorRate:      string;
  duration:       string;
  alerts:         ReportAlert[];
  printerName?:   string;
  printerModel?:  string;
  structureType?: string;
  [key: string]:  any;
}

export interface ManualPrinterConfig {
  nozzleDiameter?:       number;
  nozzleShape?:          string;
  beadCompression?:      number;
  printSpaceX?:          number;
  printSpaceY?:          number;
  printSpaceZ?:          number;
  pumpType?:             string;
  hoseLength?:           number;
  hoseInternalDiam?:     number;
  maxFlowRate?:          number;
  minFlowRate?:          number;
  maxVelocity?:          number;
  acceleration?:         number;
  jerkDeviation?:        number;
  aggregatePrinterSize?: number;
  initialSetTime?:       number;
  slumpValue?:           number;
  [key: string]: any;
}

export interface Project {
  id:            string;
  name:          string;
  description:   string;
  createdAt:     string;
  status:        'setup' | 'pre-print' | 'printing' | 'post-processing' | 'complete';
  address:       string;
  structureType: string;
  totalLayers:   number;
  printSpeed:    number;
  printer: {
    name:             string;
    type?:            string;
    nozzle:           string;
    maxSpeed:         string;
    layerHeight?:     number;
    beadCompression?: number;
    manualConfig?:    ManualPrinterConfig;
  };
  report?: Record<string, any>;
}

interface ProjectContextValue {
  projects:         Project[];
  activeProject:    Project | null;
  loading:          boolean;
  error:            string;
  createProject:    (data: Omit<Project, 'id' | 'createdAt' | 'printer' | 'status'>) => Promise<Project>;
  updateProject:    (id: string, updates: Partial<Project>) => Promise<void>;
  setActive:        (id: string) => void;
  setActiveProject: (id: string) => void;
  deleteProject:    (id: string) => Promise<void>;
  refreshProjects:  () => Promise<void>;
}

const ProjectContext = createContext<ProjectContextValue | null>(null);

const ACTIVE_KEY = 'autobuild.projects.active.v1';

export function ProjectProvider({ children }: { children: ReactNode }) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const refreshProjects = useCallback(async () => {
    try {
      setProjects(readProjects(window.localStorage));
      setError('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Projects could not be loaded.');
    } finally { setLoading(false); }
  }, []);
  useEffect(() => {
    try { setActiveId(sessionStorage.getItem(ACTIVE_KEY)); } catch { /* selection can remain in memory */ }
    void refreshProjects();
    const onStorage = (event: StorageEvent) => {
      if (event.key === PROJECTS_KEY || event.key === null) void refreshProjects();
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [refreshProjects]);
  const select = useCallback((id: string) => {
    try { sessionStorage.setItem(ACTIVE_KEY, id); } catch { /* selection can remain in memory */ }
    setActiveId(id);
  }, []);
  const createProject = useCallback(async (data: Omit<Project, 'id' | 'createdAt' | 'printer' | 'status'>) => {
    const name = data.name.trim();
    if (!name) throw new Error('Enter a project name.');
    const project: Project = {...data, name, id: crypto.randomUUID(), createdAt: new Date().toISOString(), status: 'setup', printer: {name: '', nozzle: '', maxSpeed: ''}};
    setProjects(changeProjects(window.localStorage, 'create', project));
    select(project.id);
    return project;
  }, [select]);
  const updateProject = useCallback(async (id: string, updates: Partial<Project>) => {
    setProjects(changeProjects(window.localStorage, 'update', id, updates));
  }, []);
  const deleteProject = useCallback(async (id: string) => {
    setProjects(changeProjects(window.localStorage, 'delete', id));
    if (activeId === id) {
      try { sessionStorage.removeItem(ACTIVE_KEY); } catch { /* no persisted selection */ }
      setActiveId(null);
    }
  }, [activeId]);
  const activeProject = projects.find(p => p.id === activeId) ?? null;

  return (
    <ProjectContext.Provider value={{
      projects, activeProject, loading, error,
      createProject, updateProject, setActive: select,
      setActiveProject: select,
      deleteProject, refreshProjects,
    }}>
      {children}
    </ProjectContext.Provider>
  );
}

export function useProjects() {
  const ctx = useContext(ProjectContext);
  if (!ctx) throw new Error('useProjects must be inside ProjectProvider');
  return ctx;
}