'use client';

import {
  createContext, useContext, useEffect, useState, useCallback, ReactNode,
} from 'react';
import { supabase, DBProject } from './supabase';

// ── Project type (what components use) ───────────────────────────────────────

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
}

export interface Project {
  id:            string;
  name:          string;
  description:   string;
  createdAt:     string;
  status:        'setup' | 'pre-print' | 'printing' | 'complete';
  address:       string;
  structureType: string;
  totalLayers:   number;
  printSpeed:    number;
  printer: {
    name:          string;
    type?:         string;
    nozzle:        string;
    maxSpeed:      string;
    manualConfig?: Record<string, any>;
  };
  report?: {
    totalLayers:    number;
    layersPrinted:  number;
    errorsDetected: number;
    duration:       string;
    alerts:         { time: string; layer: number; message: string }[];
  };
}

interface ProjectContextValue {
  projects:          Project[];
  activeProject:     Project | null;
  loading:           boolean;
  createProject:     (data: Omit<Project, 'id' | 'createdAt' | 'printer' | 'status'>) => Promise<Project>;
  updateProject:     (id: string, updates: Partial<Project>) => Promise<void>;
  setActive:         (id: string) => void;
  setActiveProject:  (id: string) => void;
  deleteProject:     (id: string) => Promise<void>;
  refreshProjects:   () => Promise<void>;
}

const ProjectContext = createContext<ProjectContextValue | null>(null);

// ── Map DB row → Project ──────────────────────────────────────────────────────

function dbToProject(row: DBProject, printer?: any): Project {
  return {
    id:            row.id,
    name:          row.name,
    description:   row.description ?? '',
    createdAt:     row.created_at,
    status:        row.status,
    address:       row.address ?? '',
    structureType: row.structure_type,
    totalLayers:   row.total_layers,
    printSpeed:    row.print_speed,
    printer:       printer ?? { name: '', type: '', nozzle: '', maxSpeed: '' },
  };
}

// ── Provider ──────────────────────────────────────────────────────────────────

export function ProjectProvider({ children }: { children: ReactNode }) {
  const [projects,      setProjects]      = useState<Project[]>([]);
  const [activeId,      setActiveId]      = useState<string | null>(null);
  const [loading,       setLoading]       = useState(true);

  const refreshProjects = useCallback(async () => {
    setLoading(true);
    try {
      // Fetch projects
      const { data: rows, error } = await supabase
        .from('projects')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) throw error;

      // Fetch printer configs for all projects
      const { data: printers } = await supabase
        .from('printer_configs')
        .select('*');

      const printerMap: Record<string, any> = {};
      (printers ?? []).forEach(p => { printerMap[p.project_id] = p; });

      const mapped: Project[] = (rows ?? []).map(row => {
        const pc = printerMap[row.id];
        const printer = pc ? {
          name:         pc.printer_name,
          type:         pc.printer_type ?? '',
          nozzle:       pc.nozzle ?? '',
          maxSpeed:     pc.max_speed ?? '',
          manualConfig: pc.manual_config ?? undefined,
        } : { name:'', type:'', nozzle:'', maxSpeed:'' };
        return dbToProject(row, printer);
      });

      setProjects(mapped);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refreshProjects(); }, [refreshProjects]);

  const createProject = useCallback(async (
    data: Omit<Project, 'id' | 'createdAt' | 'printer' | 'status'>,
  ): Promise<Project> => {
    const { data: row, error } = await supabase
      .from('projects')
      .insert({
        name:           data.name,
        description:    data.description,
        address:        data.address,
        structure_type: data.structureType,
        status:         'setup',
        total_layers:   data.totalLayers ?? 100,
        print_speed:    data.printSpeed  ?? 60,
      })
      .select()
      .single();

    if (error) throw error;

    const project = dbToProject(row);
    setProjects(prev => [project, ...prev]);
    setActiveId(project.id);
    return project;
  }, []);

  const updateProject = useCallback(async (id: string, updates: Partial<Project>) => {
    // Update projects table fields
    const dbUpdates: Partial<DBProject> = {};
    if (updates.status        !== undefined) dbUpdates.status         = updates.status;
    if (updates.totalLayers   !== undefined) dbUpdates.total_layers   = updates.totalLayers;
    if (updates.printSpeed    !== undefined) dbUpdates.print_speed    = updates.printSpeed;
    if (updates.structureType !== undefined) dbUpdates.structure_type = updates.structureType;
    if (updates.name          !== undefined) dbUpdates.name           = updates.name;
    if (updates.description   !== undefined) dbUpdates.description    = updates.description;

    if (Object.keys(dbUpdates).length > 0) {
      await supabase.from('projects').update(dbUpdates).eq('id', id);
    }

    // Update printer config if provided
    if (updates.printer) {
      const p = updates.printer;
      // Upsert printer config
      await supabase.from('printer_configs').upsert({
        project_id:   id,
        printer_name: p.name,
        printer_type: p.type,
        nozzle:       p.nozzle,
        max_speed:    p.maxSpeed,
        manual_config: p.manualConfig ?? null,
      }, { onConflict: 'project_id' });
    }

    // Update local state optimistically
    setProjects(prev => prev.map(p =>
      p.id === id ? { ...p, ...updates } : p
    ));
  }, []);

  const deleteProject = useCallback(async (id: string) => {
    await supabase.from('projects').delete().eq('id', id);
    setProjects(prev => prev.filter(p => p.id !== id));
    if (activeId === id) setActiveId(null);
  }, [activeId]);

  const setActive = useCallback((id: string) => setActiveId(id), []);

  const activeProject = projects.find(p => p.id === activeId) ?? null;

  return (
    <ProjectContext.Provider value={{
      projects, activeProject, loading,
      createProject, updateProject, setActive,
      setActiveProject: setActiveId,
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