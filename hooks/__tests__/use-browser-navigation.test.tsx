import { render, act } from '@testing-library/react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { useBrowserNavigation, type NavSnapshot } from '../use-browser-navigation';

/**
 * The hook is the mail client's history layer: it records every mailbox /
 * message / thread the user opens so back and forward walk the mail UI, and -
 * since #733 - writes a permalink into the address bar alongside each entry.
 * These tests pin the URL half: it must be opt-in (state-only without a
 * builder), must survive the synthetic "list" entry seeded for links opened
 * cold, and must never fight a back/forward restore.
 */

interface HarnessProps extends NavSnapshot {
  withUrl?: boolean;
  onRestore?: (state: NavSnapshot) => void;
}

function Harness({ withUrl = true, onRestore = () => {}, ...snapshot }: HarnessProps) {
  useBrowserNavigation({
    ...snapshot,
    onRestore,
    buildUrl: withUrl
      ? (s) => (s.emailId ? `/mail/message/${s.emailId}` : '/mail')
      : undefined,
  });
  return null;
}

const EMPTY: NavSnapshot = {
  mailboxId: null,
  emailId: null,
  threadId: null,
  composerOpen: false,
  sidebarOpen: false,
};

let pushSpy: ReturnType<typeof vi.spyOn>;
let replaceSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  window.history.replaceState(null, '', '/');
  pushSpy = vi.spyOn(window.history, 'pushState');
  replaceSpy = vi.spyOn(window.history, 'replaceState');
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('useBrowserNavigation - permalinks', () => {
  it('leaves the URL alone when no builder is supplied', () => {
    const { rerender } = render(<Harness {...EMPTY} withUrl={false} mailboxId="inbox" />);
    rerender(<Harness {...EMPTY} withUrl={false} mailboxId="inbox" emailId="m1" />);

    for (const call of [...pushSpy.mock.calls, ...replaceSpy.mock.calls]) {
      expect(call[2]).toBeUndefined();
    }
  });

  it('writes the permalink for each new history entry', () => {
    const { rerender } = render(<Harness {...EMPTY} mailboxId="inbox" />);
    // First run replaces rather than pushes, so opening the app doesn't leave
    // an extra entry the user has to back through to leave.
    expect(replaceSpy).toHaveBeenLastCalledWith(expect.anything(), '', '/mail');

    rerender(<Harness {...EMPTY} mailboxId="inbox" emailId="m1" />);
    expect(pushSpy).toHaveBeenLastCalledWith(expect.anything(), '', '/mail/message/m1');
  });

  it('seeds a list entry behind a message opened cold, with its own URL', () => {
    // Mounting straight onto a message is what a deep link does: back has to
    // land on the list, not leave the app.
    render(<Harness {...EMPTY} mailboxId="inbox" emailId="m1" />);

    expect(replaceSpy).toHaveBeenLastCalledWith(expect.anything(), '', '/mail');
    expect(pushSpy).toHaveBeenLastCalledWith(expect.anything(), '', '/mail/message/m1');
  });

  it('does not push a new entry while restoring a back/forward navigation', async () => {
    const restored: NavSnapshot[] = [];
    const { rerender } = render(
      <Harness {...EMPTY} mailboxId="inbox" onRestore={(s) => { restored.push(s); }} />,
    );
    rerender(<Harness {...EMPTY} mailboxId="inbox" emailId="m1" onRestore={(s) => { restored.push(s); }} />);
    pushSpy.mockClear();

    await act(async () => {
      window.dispatchEvent(new PopStateEvent('popstate', {
        state: { __mailNav: { ...EMPTY, mailboxId: 'inbox', navId: 1 } },
      }));
    });
    // The page applies the restored snapshot; the hook must treat the
    // resulting render as a replay, not as a fresh user navigation.
    rerender(<Harness {...EMPTY} mailboxId="inbox" onRestore={(s) => { restored.push(s); }} />);

    expect(restored).toHaveLength(1);
    expect(pushSpy).not.toHaveBeenCalled();
  });
});
