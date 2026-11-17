import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextIntlClientProvider } from 'next-intl';
import en from '@/locales/en/common.json';

vi.unmock('next-intl');
const state = vi.hoisted(() => ({
  saveFails: false,
  unreachable: false,
  savedUrl: '',
  mode: 'bootstrap',
  authenticated: true,
  readOnly: false,
  probeFails: false,
  nonJmap: false,
  operations: [] as Array<{ operation: string; url: string }>,
  router: { replace: vi.fn(), push: vi.fn() },
}));
vi.mock('next/navigation', () => ({ useRouter: () => state.router }));
vi.mock('@/lib/setup/url-token', () => ({ takeSetupTokenFromUrl: () => '' }));
vi.mock('@/lib/browser-navigation', () => ({
  withBasePath: (path: string) => path,
  getPathPrefix: () => '',
  apiFetch: vi.fn(async (path: string, init?: RequestInit) => {
    if (path === '/api/setup/status') {
      return Response.json({ state: state.mode, authenticated: state.authenticated, readOnly: state.readOnly, partialConfig: state.savedUrl ? { jmapServerUrl: state.savedUrl } : {} });
    }
    const body = JSON.parse(String(init?.body));
    if (path === '/api/setup/step') {
      expect(body.step).toBe('server');
      state.operations.push({ operation: 'save', url: body.values.jmapServerUrl });
      return state.saveFails ? Response.json({ error: 'Save refused' }, { status: 403 }) : Response.json({ ok: true });
    }
    if (path === '/api/setup/test-jmap') {
      state.operations.push({ operation: 'probe', url: body.url });
      if (state.probeFails) throw new Error('Connection failed');
      return Response.json(state.unreachable ? { status: 'unreachable', message: 'Server unavailable' } : { status: state.nonJmap ? 'reachable_no_jmap' : 'jmap_detected' });
    }
    throw new Error(`Unexpected request: ${path}`);
  }),
}));

const { default: SetupWizardPage } = await import('@/app/(main)/setup/page');
const server = 'https://mail.example.invalid/mail';

function renderWizard() {
  render(<NextIntlClientProvider locale="en" messages={en}><SetupWizardPage /></NextIntlClientProvider>);
}

async function openServerStep() {
  renderWizard();
  const field = await screen.findByPlaceholderText('https://');
  fireEvent.change(field, { target: { value: server } });
  return field;
}

beforeEach(() => {
  state.saveFails = false;
  state.unreachable = false;
  state.savedUrl = '';
  state.mode = 'bootstrap';
  state.authenticated = true;
  state.readOnly = false;
  state.probeFails = false;
  state.nonJmap = false;
  state.operations = [];
  vi.clearAllMocks();
});

describe('setup server probe', () => {
  it('checks a saved selection before resuming the next step', async () => {
    state.savedUrl = server;
    renderWizard();
    await screen.findByRole('heading', { name: 'Authentication' });
    expect(state.operations).toEqual([{ operation: 'probe', url: server }]);
  });

  it('restores the server step if the saved selection is unreachable', async () => {
    state.savedUrl = server;
    state.unreachable = true;
    renderWizard();
    expect(await screen.findByPlaceholderText('https://')).toHaveValue(server);
    expect(screen.queryByRole('heading', { name: 'Authentication' })).not.toBeInTheDocument();
  });

  it('keeps edit and retest available when the saved-selection probe throws', async () => {
    state.savedUrl = server;
    state.probeFails = true;
    renderWizard();
    expect(await screen.findByPlaceholderText('https://')).toHaveValue(server);
    expect(screen.queryByText('Setup token')).not.toBeInTheDocument();
  });

  it('requires a reachable non-JMAP selection to be confirmed again after reload', async () => {
    state.savedUrl = server;
    state.nonJmap = true;
    renderWizard();
    expect(await screen.findByPlaceholderText('https://')).toHaveValue(server);
    expect(screen.queryByRole('heading', { name: 'Authentication' })).not.toBeInTheDocument();
  });

  it('does not probe on a read-only bootstrap load', async () => {
    state.savedUrl = server;
    state.readOnly = true;
    renderWizard();
    await screen.findByText(en.setup.read_only.title);
    expect(state.operations).toEqual([]);
  });

  it('does not probe without a wizard session', async () => {
    state.savedUrl = server;
    state.authenticated = false;
    renderWizard();
    await screen.findByText('Setup token');
    expect(state.operations).toEqual([]);
  });

  it.each(['configured', 'env-managed'])('does not probe in %s mode', async (mode) => {
    state.savedUrl = server;
    state.mode = mode;
    renderWizard();
    await waitFor(() => expect(state.router.replace).toHaveBeenCalledWith('/'));
    expect(state.operations).toEqual([]);
  });

  it('saves the first server selection before probing it', async () => {
    await openServerStep();
    fireEvent.click(screen.getByRole('button', { name: 'Test' }));
    await screen.findByText(en.setup.server.probe_ok);
    expect(state.operations).toEqual([{ operation: 'save', url: server }, { operation: 'probe', url: server }]);
  });

  it('does not probe if the authenticated server save fails', async () => {
    state.saveFails = true;
    await openServerStep();
    fireEvent.click(screen.getByRole('button', { name: 'Test' }));
    await screen.findByText('Save refused');
    expect(state.operations).toEqual([{ operation: 'save', url: server }]);
  });

  it('lets an unreachable selection be edited and tested again', async () => {
    state.unreachable = true;
    const field = await openServerStep();
    fireEvent.click(screen.getByRole('button', { name: 'Test' }));
    await screen.findByText('Server unavailable');
    state.unreachable = false;
    const corrected = 'https://other.example.invalid/mail';
    fireEvent.change(field, { target: { value: corrected } });
    fireEvent.click(screen.getByRole('button', { name: 'Test' }));
    await screen.findByText(en.setup.server.probe_ok);
    expect(state.operations).toEqual([
      { operation: 'save', url: server }, { operation: 'probe', url: server },
      { operation: 'save', url: corrected }, { operation: 'probe', url: corrected },
    ]);
  });
});
