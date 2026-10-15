import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import type { Observation } from '@astro/iod/types';
import type { Site } from '@astro/observer';

export type NamedSite = Site & { id: string; name: string };
/** Raw input text for one fixed observation slot. siteKey: site id, 'geocenter', or 'stored:<lat>,<lon>,<elev>'. */
export type RowDraft = { utc: string; ra: string; dec: string; siteKey: string };

export type ObservationSet = {
  id: string;
  name: string;
  targetId?: string;
  synthetic?: boolean;
  /** Raw per-slot input text; observations is [] unless all 3 slots are valid. */
  drafts?: [RowDraft, RowDraft, RowDraft];
  observations: Observation[];
  /** Optional 4th (check) observation input text; never used by the IOD solvers. */
  checkDraft?: RowDraft;
  /** Parsed check observation; set only when checkDraft is fully valid. */
  check?: Observation;
};

export function newId(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  return `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

type State = {
  sites: NamedSite[];
  selectedSiteId: string | null;
  observationSets: ObservationSet[];
  activeSetId: string | null;
  nightMode: boolean;
};

type Actions = {
  addSite: (site: Omit<NamedSite, 'id'>) => string;
  updateSite: (id: string, patch: Partial<Omit<NamedSite, 'id'>>) => void;
  removeSite: (id: string) => void;
  selectSite: (id: string | null) => void;
  addSet: (set: Omit<ObservationSet, 'id'>) => string;
  updateSet: (id: string, patch: Partial<Omit<ObservationSet, 'id'>>) => void;
  removeSet: (id: string) => void;
  setActiveSet: (id: string | null) => void;
  toggleNightMode: () => void;
};

/** localStorage wrapper that never throws (quota, private mode, blocked); falls back to memory. */
const memStore = new Map<string, string>();
let warned = false;
const warnOnce = (e: unknown) => {
  if (warned) return;
  warned = true;
  console.warn('orbits: localStorage unavailable; keeping data in memory only.', e);
};
export const safeStorage = {
  getItem: (k: string): string | null => {
    try {
      const v = globalThis.localStorage.getItem(k);
      return v ?? memStore.get(k) ?? null;
    } catch (e) {
      warnOnce(e);
      return memStore.get(k) ?? null;
    }
  },
  setItem: (k: string, v: string): void => {
    memStore.set(k, v);
    try {
      globalThis.localStorage.setItem(k, v);
    } catch (e) {
      warnOnce(e);
    }
  },
  removeItem: (k: string): void => {
    memStore.delete(k);
    try {
      globalThis.localStorage.removeItem(k);
    } catch (e) {
      warnOnce(e);
    }
  },
};

export const STORED_PREFIX = 'stored:';
/** Draft siteKey that carries a site's coordinates directly (used when the saved site was removed). */
export const storedSiteKey = (s: Site) => `${STORED_PREFIX}${s.latDeg},${s.lonEastDeg},${s.elevM}`;

export const useStore = create<State & Actions>()(
  persist(
    (set) => ({
      sites: [],
      selectedSiteId: null,
      observationSets: [],
      activeSetId: null,
      nightMode: false,
      addSite: (site) => {
        const id = newId();
        set((s) => ({ sites: [...s.sites, { ...site, id }] }));
        return id;
      },
      updateSite: (id, patch) =>
        set((s) => ({ sites: s.sites.map((x) => (x.id === id ? { ...x, ...patch } : x)) })),
      removeSite: (id) =>
        set((s) => {
          const gone = s.sites.find((x) => x.id === id);
          // Drafts referencing the removed site keep its coordinates via a 'stored:' key.
          const fix = (d: RowDraft): RowDraft =>
            gone && d.siteKey === id ? { ...d, siteKey: storedSiteKey(gone) } : d;
          return {
            sites: s.sites.filter((x) => x.id !== id),
            selectedSiteId: s.selectedSiteId === id ? null : s.selectedSiteId,
            observationSets: s.observationSets.map((o) => {
              if (!gone || !(o.drafts?.some((d) => d.siteKey === id) || o.checkDraft?.siteKey === id)) return o;
              const n: ObservationSet = { ...o };
              if (o.drafts) n.drafts = o.drafts.map(fix) as [RowDraft, RowDraft, RowDraft];
              if (o.checkDraft) n.checkDraft = fix(o.checkDraft);
              return n;
            }),
          };
        }),
      selectSite: (id) => set({ selectedSiteId: id }),
      addSet: (setData) => {
        const id = newId();
        set((s) => ({ observationSets: [...s.observationSets, { ...setData, id }] }));
        return id;
      },
      updateSet: (id, patch) =>
        set((s) => ({
          observationSets: s.observationSets.map((x) => (x.id === id ? { ...x, ...patch } : x)),
        })),
      removeSet: (id) =>
        set((s) => ({
          observationSets: s.observationSets.filter((x) => x.id !== id),
          activeSetId: s.activeSetId === id ? null : s.activeSetId,
        })),
      setActiveSet: (id) => set({ activeSetId: id }),
      toggleNightMode: () => set((s) => ({ nightMode: !s.nightMode })),
    }),
    {
      name: 'orbits-v1',
      storage: createJSONStorage(() => safeStorage),
      partialize: (s) => ({
        sites: s.sites,
        selectedSiteId: s.selectedSiteId,
        observationSets: s.observationSets,
        activeSetId: s.activeSetId,
        nightMode: s.nightMode,
      }),
    },
  ),
);

export const SCHEMA_VERSION = 1;

/** Serialize one observation set; throws if the id is unknown. */
export function exportSet(id: string): string {
  const set = useStore.getState().observationSets.find((x) => x.id === id);
  if (!set) throw new Error(`No observation set with id "${id}".`);
  return JSON.stringify({ schemaVersion: SCHEMA_VERSION, set }, null, 2);
}

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const fin = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

function parseSite(v: unknown, where: string): Site | null {
  if (v === null) return null;
  if (!isObj(v) || !fin(v.latDeg) || !fin(v.lonEastDeg) || !fin(v.elevM)) {
    throw new Error(`${where}: site must be null or have finite latDeg, lonEastDeg, elevM.`);
  }
  return { latDeg: v.latDeg, lonEastDeg: v.lonEastDeg, elevM: v.elevM };
}

function parseDraft(d: unknown, bad: () => Error): RowDraft {
  if (!isObj(d)) throw bad();
  const { utc, ra, dec, siteKey } = d;
  if (typeof utc !== 'string' || typeof ra !== 'string' || typeof dec !== 'string' || typeof siteKey !== 'string') throw bad();
  return { utc, ra, dec, siteKey };
}

function parseObs(o: unknown, where: string): Observation {
  if (!isObj(o)) throw new Error(`${where} is not an object.`);
  for (const k of ['jdUtc', 'raRad', 'decRad'] as const) {
    if (!fin(o[k])) throw new Error(`${where}: "${k}" must be a finite number.`);
  }
  if (o.label !== undefined && typeof o.label !== 'string') {
    throw new Error(`${where}: "label" must be a string.`);
  }
  const obs: Observation = {
    jdUtc: o.jdUtc as number,
    raRad: o.raRad as number,
    decRad: o.decRad as number,
    site: parseSite(o.site ?? null, where),
  };
  if (o.label !== undefined) obs.label = o.label as string;
  return obs;
}

/** Validate JSON produced by exportSet, add it to the store with a fresh id, return the new id. */
export function importSet(json: string): string {
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch (e) {
    throw new Error(`Import failed: not valid JSON (${e instanceof Error ? e.message : String(e)}).`, { cause: e });
  }
  if (!isObj(data)) throw new Error('Import failed: expected a JSON object.');
  if (data.schemaVersion !== SCHEMA_VERSION) {
    throw new Error(
      `Import failed: unsupported schemaVersion ${JSON.stringify(data.schemaVersion)} (expected ${SCHEMA_VERSION}).`,
    );
  }
  const raw = data.set;
  if (!isObj(raw)) throw new Error('Import failed: missing "set" object.');
  if (typeof raw.name !== 'string') throw new Error('Import failed: set.name must be a string.');
  if (raw.targetId !== undefined && typeof raw.targetId !== 'string') {
    throw new Error('Import failed: set.targetId must be a string.');
  }
  if (raw.synthetic !== undefined && typeof raw.synthetic !== 'boolean') {
    throw new Error('Import failed: set.synthetic must be a boolean.');
  }
  let drafts: [RowDraft, RowDraft, RowDraft] | undefined;
  if (raw.drafts !== undefined) {
    const bad = () => new Error('Import failed: set.drafts must be an array of 3 objects with string utc, ra, dec, siteKey.');
    if (!Array.isArray(raw.drafts) || raw.drafts.length !== 3) throw bad();
    drafts = raw.drafts.map((d: unknown) => parseDraft(d, bad)) as [RowDraft, RowDraft, RowDraft];
  }
  let checkDraft: RowDraft | undefined;
  if (raw.checkDraft !== undefined) {
    checkDraft = parseDraft(raw.checkDraft, () => new Error('Import failed: set.checkDraft must be an object with string utc, ra, dec, siteKey.'));
  }
  let check: Observation | undefined;
  if (raw.check !== undefined) check = parseObs(raw.check, 'Import failed: check observation');
  if (!Array.isArray(raw.observations)) {
    throw new Error('Import failed: set.observations must be an array.');
  }
  const observations: Observation[] = raw.observations.map((o: unknown, i: number) =>
    parseObs(o, `Import failed: observation ${i + 1}`),
  );
  if (raw.observations.length !== 0 && raw.observations.length !== 3) {
    throw new Error(`Import failed: set.observations must have 0 or 3 entries (got ${raw.observations.length}).`);
  }
  const set: Omit<ObservationSet, 'id'> = { name: raw.name, observations };
  if (raw.targetId !== undefined) set.targetId = raw.targetId;
  if (raw.synthetic !== undefined) set.synthetic = raw.synthetic;
  if (drafts) set.drafts = drafts;
  if (checkDraft) set.checkDraft = checkDraft;
  if (check) set.check = check;
  return useStore.getState().addSet(set);
}
