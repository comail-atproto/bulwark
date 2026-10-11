import { beforeEach, describe, expect, it } from 'vitest';
import {
  normalizeProTabState,
  useProTabStore,
  type ProSearchTabData,
  type ProTabCoreState,
} from '@/stores/pro-tab-store';

const data = (over: Partial<ProSearchTabData> = {}): ProSearchTabData => ({
  query: 'report', scope: 'all', accountId: null, title: 'report', ...over,
});

function reset() {
  useProTabStore.setState(normalizeProTabState({
    tabs: [], activeTabId: '', activeSplitTabId: null, focusedPaneId: 'main',
    splitOrientation: null, splitSide: 'right', readerTabId: null, loadedTabIds: [],
  } as ProTabCoreState));
}

describe('pro-tab-store search tabs (#641)', () => {
  beforeEach(reset);

  it('opens a search tab, activates it and stores the query', () => {
    const id = useProTabStore.getState().openSearchTab(data());
    const state = useProTabStore.getState();
    const tab = state.tabs.find((t) => t.id === id);
    expect(tab).toMatchObject({ kind: 'search', title: 'report', closeable: true, searchData: data() });
    expect(state.activeTabId).toBe(id);
  });

  it('focuses the existing tab for an identical query instead of duplicating', () => {
    const first = useProTabStore.getState().openSearchTab(data());
    useProTabStore.getState().openTab('calendar');
    const second = useProTabStore.getState().openSearchTab(data());
    expect(second).toBe(first);
    expect(useProTabStore.getState().tabs.filter((t) => t.kind === 'search')).toHaveLength(1);
    expect(useProTabStore.getState().activeTabId).toBe(first);
  });

  it('treats a different scope or account as a different search', () => {
    const first = useProTabStore.getState().openSearchTab(data());
    const second = useProTabStore.getState().openSearchTab(data({ scope: 'mail' }));
    const third = useProTabStore.getState().openSearchTab(data({ accountId: 'login-b' }));
    expect(new Set([first, second, third]).size).toBe(3);
  });

  it('updateSearchTab renames the tab with the refined query', () => {
    const id = useProTabStore.getState().openSearchTab(data());
    useProTabStore.getState().updateSearchTab(id, { query: 'invoices', title: 'invoices' });
    const tab = useProTabStore.getState().tabs.find((t) => t.id === id);
    expect(tab?.title).toBe('invoices');
    expect(tab?.searchData?.query).toBe('invoices');
    expect(tab?.searchData?.scope).toBe('all');
  });

  it('survives normalizeProTabState (restore-on-reload path)', () => {
    const id = useProTabStore.getState().openSearchTab(data());
    const core: ProTabCoreState = {
      tabs: useProTabStore.getState().tabs,
      activeTabId: id,
      activeSplitTabId: null,
      focusedPaneId: 'main',
      splitOrientation: null,
      splitSide: 'right',
      readerTabId: null,
      loadedTabIds: [id],
    };
    const normalized = normalizeProTabState(core);
    const tab = normalized.tabs.find((t) => t.id === id);
    expect(tab?.kind).toBe('search');
    expect(tab?.searchData?.query).toBe('report');
    expect(normalized.activeTabId).toBe(id);
  });
});
