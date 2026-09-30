import { create } from 'zustand';
import { schoolTypesService, type SchoolStructure } from '../services/schoolTypesService';

/**
 * The signed-in person's school: its type, levels, tools and grades.
 *
 * Loaded once per signed-in person and shared, because the shell needs it on
 * every page to decide which menu entries the school's type uses. It is held
 * against the person it was loaded for, so somebody else signing in on the
 * same browser never sees the previous school's menu. If it cannot be loaded
 * the shell falls back to the full school menu rather than an empty one.
 */
interface SchoolStructureState {
  structure: SchoolStructure | null;
  status: 'idle' | 'loading' | 'ready' | 'failed';
  /** Whose structure this is. */
  forUser: string | null;
  load: (userId: string, force?: boolean) => Promise<void>;
}

export const useSchoolStructureStore = create<SchoolStructureState>((set, get) => ({
  structure: null,
  status: 'idle',
  forUser: null,
  load: async (userId, force = false) => {
    const s = get();
    if (!force && s.forUser === userId && s.status !== 'idle') return;
    set({ status: 'loading', forUser: userId, structure: s.forUser === userId ? s.structure : null });
    try {
      const structure = await schoolTypesService.getStructure();
      if (get().forUser === userId) set({ structure, status: 'ready' });
    } catch {
      if (get().forUser === userId) set({ structure: null, status: 'failed' });
    }
  },
}));
