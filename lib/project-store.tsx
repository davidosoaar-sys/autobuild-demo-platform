'use client';

import { createContext, useContext, useState, useEffect, ReactNode } from 'react';

export interface Printer {
  name: string;
  model: string;
  ip: string;
  status: 'connected' | 'connecting' | 'failed' | 'idle';
}

export interface Project {
  id: string;
  name: string;
  description: string;
  createdAt: string;
  status: 'setup' | 'pre-print' | 'printing' | 'complete';
  printer: Printer;
  totalLayers: number;
  printSpeed: number;
  structureType: string;
  report?: ProjectReport;
}

export interface ReportAlert {
  id: string;
  time: string;
  cameraLabel: string;
  type: 'caution' | 'warning';
  angle: number;
  layer: number;
}

export interface ProjectReport {
  generatedAt: string;
  duration: string;
  totalLayers: number;
  layersPrinted: number;
  errorsDetected: number;
  errorRate: string;
  alerts: ReportAlert[];
  printerName: string;
  printerModel: string;
  structureType: string;
}

interface ProjectContextType {
  projects: Project[];
  activeProject: Project | null;
  setActiveProject: (p: Project | null) => void;
  createProject: (p: Omit<Project, 'id' | 'createdAt' | 'status'>) => Project;
  updateProject: (id: string, updates: Partial<Project>) => void;
  deleteProject: (id: string) => void;
}

const ProjectContext = createContext<ProjectContextType | null>(null);

const SEED_PROJECTS: Project[] = [
  {
    id: 'proj-001',
    name: 'Wall Section A',
    description: 'North perimeter wall, 3m height target',
    createdAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 2).toISOString(),
    status: 'complete',
    printer: { name: 'COBOD BOD2 #1', model: 'COBOD BOD2', ip: '192.168.1.101', status: 'idle' },
    totalLayers: 120,
    printSpeed: 60,
    structureType: 'Load-bearing wall',
  },
  {
    id: 'proj-002',
    name: 'Foundation Slab B',
    description: 'Reinforced base layer for module B',
    createdAt: new Date(Date.now() - 1000 * 60 * 60 * 5).toISOString(),
    status: 'printing',
    printer: { name: 'Printerra P1', model: 'Printerra P1', ip: '192.168.1.102', status: 'connected' },
    totalLayers: 80,
    printSpeed: 55,
    structureType: 'Foundation slab',
  },
];

export function ProjectProvider({ children }: { children: ReactNode }) {
  const [projects, setProjects] = useState<Project[]>(SEED_PROJECTS);
  const [activeProject, setActiveProject] = useState<Project | null>(null);

  const createProject = (data: Omit<Project, 'id' | 'createdAt' | 'status'>): Project => {
    const newProject: Project = {
      ...data,
      id: `proj-${Date.now()}`,
      createdAt: new Date().toISOString(),
      status: 'setup',
    };
    setProjects(prev => [newProject, ...prev]);
    return newProject;
  };

  const updateProject = (id: string, updates: Partial<Project>) => {
    setProjects(prev => prev.map(p => p.id === id ? { ...p, ...updates } : p));
    setActiveProject(prev => prev?.id === id ? { ...prev, ...updates } : prev);
  };

  const deleteProject = (id: string) => {
    setProjects(prev => prev.filter(p => p.id !== id));
    if (activeProject?.id === id) setActiveProject(null);
  };

  return (
    <ProjectContext.Provider value={{ projects, activeProject, setActiveProject, createProject, updateProject, deleteProject }}>
      {children}
    </ProjectContext.Provider>
  );
}

export function useProjects() {
  const ctx = useContext(ProjectContext);
  if (!ctx) throw new Error('useProjects must be used within ProjectProvider');
  return ctx;
}