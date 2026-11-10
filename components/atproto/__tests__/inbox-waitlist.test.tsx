import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { InboxWaitlist } from '../inbox-waitlist';

const loginUrl = window.location.origin + '/webmail/login';
const session = { state: 'waitlist', csrf: 'server-proof', did: 'did:plc:verified', handle: 'alice.bsky.social', recorded: true };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
let request: MockInstance<typeof fetch>;

beforeEach(() => { request = vi.spyOn(globalThis, 'fetch'); });
afterEach(() => { request.mockRestore(); vi.useRealTimers(); });

function show() { return render(<InboxWaitlist loginUrl={loginUrl} callbackError={null} />); }
async function addEmail() {
  await screen.findByText('waitlist.saved');
  fireEvent.click(screen.getByText('waitlist.add_email'));
  fireEvent.change(screen.getByLabelText('waitlist.email_label'), { target: { value: 'notify@example.test' } });
  fireEvent.submit(screen.getByLabelText('waitlist.email_label').closest('form')!);
}

describe('Inbox waitlist on public login', () => {
  it('shows saved signup from server proof without requiring a join action or email', async () => {
    request.mockResolvedValue(json(session));
    show();
    await screen.findByText('waitlist.saved');
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('waitlist.title');
    expect(screen.getByLabelText('waitlist.email_label')).not.toBeVisible();
    expect(request).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledWith(window.location.origin + '/inbox/waitlist/session', expect.objectContaining({ credentials: 'same-origin' }));
  });

  it.each([
    [json({ error: 'waitlist_proof_required' }, 401), 'proof_required'],
    [json({ ...session, recorded: false }), 'try_again'],
    [json({ ...session, csrf: '' }), 'try_again'],
    [json({ error: 'inbox_available' }, 409), 'inbox_available'],
  ] as const)('does not claim signup succeeded for missing proof or an unsaved identity', async (response, code) => {
    request.mockResolvedValue(response);
    show();
    expect(await screen.findByRole('alert')).toHaveTextContent('waitlist.' + code);
    expect(screen.queryByText('waitlist.saved')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('waitlist.email_label')).not.toBeInTheDocument();
  });

  it('keeps identity and signup visible while optional email confirmation is pending', async () => {
    request.mockResolvedValueOnce(json(session)).mockResolvedValueOnce(json({ state: 'confirmation_pending' }, 202));
    const initialURL = window.location.href;
    show();
    await addEmail();
    await screen.findByText('waitlist.check_email');
    expect(screen.getByText('waitlist.saved')).toBeInTheDocument();
    expect(screen.queryByText('waitlist.email_confirmed')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('waitlist.email_label')).not.toBeInTheDocument();
    expect(window.location.href).toBe(initialURL);
    expect(request).toHaveBeenLastCalledWith(window.location.origin + '/inbox/waitlist', expect.objectContaining({
      method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', 'X-Comail-Waitlist-CSRF': 'server-proof' },
      body: JSON.stringify({ notification_email: 'notify@example.test', notify_when_available: true }),
    }));
  });

  it('recognizes an already-confirmed address without falsely requesting another confirmation', async () => {
    request.mockResolvedValueOnce(json(session)).mockResolvedValueOnce(json({ state: 'recorded' }, 202));
    show(); await addEmail();
    await screen.findByText('waitlist.email_confirmed');
    expect(screen.queryByText('waitlist.check_email')).not.toBeInTheDocument();
  });

  it('preserves saved signup and email retry after a notification failure', async () => {
    request.mockResolvedValueOnce(json(session)).mockResolvedValueOnce(json({ error: 'rate_limited' }, 429));
    show(); await addEmail();
    expect(await screen.findByRole('alert')).toHaveTextContent('waitlist.rate_limited');
    expect(screen.getByText('waitlist.saved')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /waitlist.notify/ })).toBeEnabled();
  });

  it('does not mask callback failure with an earlier valid browser proof', async () => {
    request.mockResolvedValue(json(session));
    render(<InboxWaitlist loginUrl={loginUrl} callbackError="try_again" />);
    expect(await screen.findByRole('alert')).toHaveTextContent('waitlist.try_again');
    expect(request).not.toHaveBeenCalled();
    expect(screen.queryByText('waitlist.saved')).not.toBeInTheDocument();
  });

  it('never sends the browser proof to an external login provider', async () => {
    render(<InboxWaitlist loginUrl="https://external.example.test/webmail/login" callbackError={null} />);
    await screen.findByRole('alert');
    expect(request).not.toHaveBeenCalled();
  });

  it('bounds a stalled proof request without claiming signup succeeded', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    request.mockImplementation((_url, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('Timed out', 'AbortError')));
    }));
    show();
    await act(async () => { await vi.advanceTimersByTimeAsync(10_001); });
    expect(screen.getByRole('alert')).toHaveTextContent('waitlist.try_again');
    expect(screen.queryByText('waitlist.saved')).not.toBeInTheDocument();
  });

  it('cancels the proof request when the view unmounts', async () => {
    request.mockImplementation(() => new Promise(() => {}));
    const view = show();
    await waitFor(() => expect(request).toHaveBeenCalledTimes(1));
    const signal = request.mock.calls[0][1]!.signal!;
    view.unmount();
    expect(signal.aborted).toBe(true);
  });
});
