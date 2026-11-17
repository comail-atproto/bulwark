// @vitest-environment node
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import postcss from 'postcss';
import tailwindcss from '@tailwindcss/postcss';
import { describe, expect, it } from 'vitest';

const actor = 'did:plc:syntheticviewer';
const creator = 'did:plc:syntheticorganizer';
const rkey = '3l3d3d3d3d3d3';
const uri = `at://${creator}/community.lexicon.calendar.event/${rkey}`;
const originalUrl = `https://atmo.rsvp/p/${encodeURIComponent(creator)}/e/${rkey}`;

describe('Atmosphere calendar in the existing browser UI', () => {
  it.runIf(process.env.COMAIL_BROWSER_TESTS === '1').each(['pds', 'browser', 'copy'] as const)('shows read-only events, refreshes and %s visibility', async (storage) => {
    let enabled = true;
    let phase: 'initial' | 'updated' | 'withdrawn' = 'initial';
    const stylesheet = process.env.COMAIL_ATMO_BROWSER_CSS
      ? await readFile(process.env.COMAIL_ATMO_BROWSER_CSS, 'utf8')
      : (await postcss([tailwindcss()]).process(await readFile('app/globals.css', 'utf8'), { from: 'app/globals.css' })).css;
    const requests: Array<{ method: string; path: string; slot: string | null; body?: unknown }> = [];
    const bundle = await build({
      stdin: {
        resolveDir: process.cwd(), loader: 'tsx', contents: `
          import React, { useState } from 'react';
          import { createRoot } from 'react-dom/client';
          import { NextIntlClientProvider } from 'next-intl';
          import upstreamMessages from './locales/en/common.json';
          import { withComailMessages } from './i18n/comail-messages';
          import { AtmoCalendarAdapter } from './lib/jmap/atmo-calendar-adapter';
          import { SpaceCalendarAdapter } from './lib/jmap/space-calendar-adapter';
          import { useCalendarStore } from './stores/calendar-store';
          import { useSettingsStore } from './stores/settings-store';
          import { CalendarSidebarPanel } from './components/calendar/calendar-sidebar-panel';
          import { CalendarWeekView } from './components/calendar/calendar-week-view';
          import { EventDetailPopover } from './components/calendar/event-detail-popover';
          const messages = withComailMessages('en', upstreamMessages);
          const adapter = ${storage === 'copy' ? 'new SpaceCalendarAdapter(() => 1)' : 'new AtmoCalendarAdapter(() => 1)'};
          const publicActions = new SpaceCalendarAdapter(() => 1);
          const client = {
            getAllCalendarsWithFailures: async () => ({ calendars: await adapter.getCalendars(), failedAccountIds: [] }),
            queryAllCalendarEvents: ({ after, before }) => adapter.getEvents(after, before),
            getParticipantIdentities: async () => [],
          };
          const refresh = async () => {
            await useCalendarStore.getState().fetchCalendars(client);
            await useCalendarStore.getState().fetchEvents(client, '2026-10-09T00:00:00', '2026-10-13T00:00:00');
          };
          window.proof = { refresh, snapshot: () => useCalendarStore.getState().events.map(e => ({ id: e.id, cid: e.atprotoCid, start: e.utcStart })) };
          useSettingsStore.setState({ timeZone: 'UTC', timeFormat: '24h', calendarLimitHours: false });
          function ExistingCalendar() {
            const calendars = useCalendarStore(s => s.calendars);
            const events = useCalendarStore(s => s.events);
            const selected = useCalendarStore(s => s.selectedCalendarIds);
            const [detailId, setDetailId] = useState(null);
            const detail = events.find(e => e.id === detailId);
            const visible = events.filter(e => Object.keys(e.calendarIds).some(id => selected.includes(id)));
            return <>
              <aside><CalendarSidebarPanel calendars={calendars} selectedCalendarIds={selected}
                onToggleVisibility={async () => { await adapter.setEnabled(!calendars[0].isVisible); await refresh(); }} /></aside>
              <main><CalendarWeekView focus={{ date: new Date(2026, 9, 10), nonce: 0 }} windowKey="atmo-proof"
                rangeStart={new Date(2026, 9, 9)} rangeEnd={new Date(2026, 9, 12)} selectedDate={new Date(2026, 9, 10)}
                events={visible} calendars={calendars} onSelectDate={() => {}} onSelectEvent={e => setDetailId(e.id)} onCreateAtTime={() => {}} />
              </main>
              {detail && <EventDetailPopover event={detail} calendar={calendars[0]} anchorRect={new DOMRect(300, 150, 100, 30)}
                onClose={() => setDetailId(null)} onEdit={() => { throw new Error('Unexpected edit'); }}
                onDelete={() => { throw new Error('Unexpected delete'); }} onDuplicate={() => { throw new Error('Unexpected duplicate'); }}
                onSaveNote={() => { throw new Error('Unexpected note'); }} onRsvp={() => { throw new Error('Unexpected private RSVP'); }}
                onSubscribePublic={() => publicActions.subscribePublicEvent(detail)}
                onPublicRsvp={status => publicActions.rsvpPublicEvent(detail, status)} />}
            </>;
          }
          createRoot(document.getElementById('root')).render(<NextIntlClientProvider locale="en" messages={messages} timeZone="UTC"><ExistingCalendar /></NextIntlClientProvider>);
          refresh();
        `,
      },
      bundle: true, platform: 'browser', write: false, minify: true, jsx: 'automatic', external: ['crypto'],
      define: { 'process.env': '{}', 'process.env.NODE_ENV': '"production"', 'process.env.NEXT_PUBLIC_BASE_PATH': '""', 'process.env.NEXT_PUBLIC_BULWARK_LITE': '"false"' },
    });
    const server = createServer(async (request, response) => {
      try {
        const url = new URL(request.url ?? '/', 'http://synthetic.test');
        if (url.pathname === '/') {
          response.setHeader('Content-Type', 'text/html');
          response.end(`<!doctype html><style>${stylesheet}</style><style>body{margin:0;font-family:sans-serif}aside{width:240px;padding:16px}main{position:absolute;left:270px;top:0;width:1000px;height:780px}.flex{display:flex}.relative{position:relative}.absolute{position:absolute}.fixed{position:fixed}.overflow-auto{overflow:auto}.h-full{height:100%}.w-full{width:100%}.text-start{text-align:left}.grid{display:grid}.hidden{display:none}svg{width:16px;height:16px}button{cursor:pointer}</style><div id="root"></div><script src="/client.js"></script>`);
        } else if (url.pathname === '/client.js') {
          response.setHeader('Content-Type', 'application/javascript');
          response.end(bundle.outputFiles[0].text);
        } else if (storage === 'copy' && ['/api/calendar/calendars', '/api/calendar/events'].includes(url.pathname)) {
          requests.push({ method: request.method ?? 'GET', path: url.pathname, slot: url.searchParams.get('slot') });
          const cid = 'bafyreiaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
          response.setHeader('Content-Type', 'application/json');
          response.end(JSON.stringify(url.pathname === '/api/calendar/calendars' ? { calendars: [{ id: 'private', name: 'My calendar',
            source: 'atproto-space', myRole: 'owner', initialized: true, revisionId: 'private-state', mayShare: false, members: [] }] }
            : { events: [{ id: 'linked-event', uid: uri, calendarId: 'private', revisionId: 'revision-one', actorDID: actor, ownerDID: actor,
              title: 'Synthetic Atmosphere meetup', description: 'Public organizer details in a private calendar.', start: '2026-10-10T10:00:00',
              timeZone: 'UTC', duration: 'PT1H', showWithoutTime: false, status: 'confirmed' }],
            metadata: { 'linked-event': { sequence: 0, ...(phase === 'updated' ? { publicSource: { uri, cid } } : {}) } } }));
        } else if (url.pathname === '/api/calendar/subscriptions' || url.pathname === '/api/calendar/public/rsvps') {
          let raw = '';
          for await (const chunk of request) raw += chunk.toString();
          requests.push({ method: request.method ?? 'GET', path: url.pathname, slot: url.searchParams.get('slot'), body: JSON.parse(raw) });
          response.setHeader('Content-Type', 'application/json');
          response.end(JSON.stringify(url.pathname.endsWith('/subscriptions') ? {
            id: 'linked-event', uid: uri, calendarId: 'private', revisionId: 'revision-one', actorDID: actor, ownerDID: actor,
            title: 'Synthetic Atmosphere meetup', description: '', start: '2026-10-10T00:00:00', timeZone: 'UTC', duration: 'PT1H',
            showWithoutTime: false, status: 'confirmed',
          } : { uri: `at://${actor}/community.lexicon.calendar.rsvp/3m3z2a2b3c4d5`, cid: 'bafyreiaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' }));
        } else if (url.pathname === '/api/atmo-calendar' || url.pathname === '/api/calendar/sources/atmo') {
          requests.push({ method: request.method ?? 'GET', path: url.pathname, slot: url.searchParams.get('slot') });
          if (url.pathname === '/api/calendar/sources/atmo') {
            let body = '';
            for await (const chunk of request) body += chunk.toString();
            const command = JSON.parse(body) as { enabled: unknown };
            if (request.method !== 'PUT' || typeof command.enabled !== 'boolean') throw new Error('Invalid synthetic command');
            enabled = command.enabled;
          }
          response.setHeader('Content-Type', 'application/json');
          response.setHeader('Cache-Control', 'no-store');
          if (!url.searchParams.has('after')) {
            response.end(JSON.stringify(storage === 'browser' ? { actorDid: actor, preferenceStorage: 'browser' } : { actorDid: actor, state: `source-state-${'a'.repeat(64)}`, sources: [{
              id: 'atmo', type: 'atproto-community-calendar', actorDid: actor, includeHosted: true, statuses: ['going', 'interested'], enabled,
            }] }));
          } else {
            response.end(JSON.stringify({ actorDid: actor, complete: true, after: url.searchParams.get('after'), before: url.searchParams.get('before'),
              events: phase === 'withdrawn' ? [] : [{ uri, cid: phase === 'initial' ? 'bafyreiaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' : 'bafyreiaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaai',
                creatorDid: creator, name: phase === 'initial' ? 'Synthetic Atmosphere meetup' : 'Rescheduled Atmosphere meetup',
                startsAt: phase === 'initial' ? '2026-10-10T00:00:00Z' : '2026-10-11T10:00:00Z',
                status: 'scheduled', attendance: 'going', atmoUrl: originalUrl,
              }],
            }));
          }
        } else {
          response.writeHead(404);
          response.end();
        }
      } catch {
        response.writeHead(500);
        response.end('Synthetic fixture failed');
      }
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Missing synthetic address');
    let browser;
    try {
      browser = await chromium.launch({ headless: true, executablePath: process.env.COMAIL_CHROMIUM_PATH || undefined });
      const page = await browser.newPage({ viewport: { width: 1320, height: 900 }, timezoneId: 'UTC' });
      await page.goto(`http://127.0.0.1:${address.port}`);
      const source = page.locator(`[data-testid="calendar-item"][data-calendar-name="${storage === 'copy' ? 'My calendar' : 'Atmosphere'}"]`);
      if (storage === 'browser') {
        await page.waitForFunction(() => document.querySelector('[data-calendar-name="Atmosphere"]')?.getAttribute('data-visible') === 'false');
        expect(await source.getAttribute('title')).toBe('Visibility is saved only in this browser.');
        expect(requests).toHaveLength(1);
        if (process.env.COMAIL_ATMO_BROWSER_EVIDENCE) await page.screenshot({ path: `${process.env.COMAIL_ATMO_BROWSER_EVIDENCE}.before.png` });
        await source.click();
        await page.waitForFunction(() => document.querySelector('[data-calendar-name="Atmosphere"]')?.getAttribute('data-visible') === 'true');
        await page.reload();
      }
      await source.waitFor();
      expect(await source.getAttribute('data-visible')).toBe('true');
      const card = page.getByRole('button', { name: /Synthetic Atmosphere meetup,/ });
      await card.waitFor();
      if (storage === 'copy') {
        await card.press('Enter');
        await page.getByRole('button', { name: 'Edit event', exact: true }).waitFor();
        await page.waitForFunction(() => {
          const dialog = document.querySelector('[role="dialog"]');
          return dialog && getComputedStyle(dialog).opacity === '1' && dialog.getBoundingClientRect().left >= 0;
        });
        if (process.env.COMAIL_ATMO_COPY_EVIDENCE) await page.screenshot({ path: `${process.env.COMAIL_ATMO_COPY_EVIDENCE}.before.png` });
        phase = 'updated';
        await page.evaluate(() => (window as unknown as { proof: { refresh: () => Promise<void> } }).proof.refresh());
        await page.getByRole('link', { name: 'Open in Atmo' }).waitFor();
      }
      expect(await card.getAttribute('draggable')).not.toBe('true');
      expect(await page.locator('[data-resize-handle]').count()).toBe(0);
      await card.click();
      const original = page.getByRole('link', { name: 'Open in Atmo' });
      if (storage !== 'copy') await page.getByText('End time not specified', { exact: true }).waitFor();
      expect(await original.count()).toBe(1);
      expect(await original.getAttribute('href')).toBe(originalUrl);
      if (storage === 'copy') {
        await page.waitForFunction(() => {
          const dialog = document.querySelector('[role="dialog"]');
          return dialog && getComputedStyle(dialog).opacity === '1' && dialog.getBoundingClientRect().left >= 0;
        });
        for (const action of ['Edit event', 'Duplicate', 'Delete event']) expect(await page.getByRole('button', { name: action, exact: true }).count()).toBe(0);
        expect(requests.every(request => request.method === 'GET' && request.slot === '1')).toBe(true);
        if (process.env.COMAIL_ATMO_COPY_EVIDENCE) await page.screenshot({ path: process.env.COMAIL_ATMO_COPY_EVIDENCE });
        return;
      }
      expect(await page.getByText('Going', { exact: true }).count()).toBeGreaterThanOrEqual(1);
      expect(await page.getByText('End time not specified', { exact: true }).count()).toBe(1);
      for (const action of ['Edit event', 'Duplicate', 'Delete event']) expect(await page.getByRole('button', { name: action, exact: true }).count()).toBe(0);
      await page.getByRole('button', { name: 'Copy to My Calendar', exact: true }).click();
      await page.getByRole('button', { name: 'Interested', exact: true }).click();
      await expect.poll(() => requests.filter(request => request.method === 'POST').length).toBe(2);
      const publicRequests = requests.filter(request => request.method === 'POST');
      expect(publicRequests.map(request => request.path)).toEqual(['/api/calendar/subscriptions', '/api/calendar/public/rsvps']);
      expect(publicRequests[0].body).toMatchObject({ source: { uri, cid: 'bafyreiaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' } });
      expect(publicRequests[1].body).toMatchObject({ eventUri: uri, expectedRsvpCid: null, status: 'interested' });
      const initial = await page.evaluate(() => (window as unknown as { proof: { snapshot: () => unknown } }).proof.snapshot());
      if (storage === 'browser' && process.env.COMAIL_ATMO_BROWSER_EVIDENCE) await page.screenshot({ path: process.env.COMAIL_ATMO_BROWSER_EVIDENCE });
      phase = 'updated';
      await page.evaluate(() => (window as unknown as { proof: { refresh: () => Promise<void> } }).proof.refresh());
      await page.getByRole('button', { name: /Rescheduled Atmosphere meetup,/ }).waitFor();
      const updated = await page.evaluate(() => (window as unknown as { proof: { snapshot: () => unknown } }).proof.snapshot());
      expect(initial).toEqual([{ id: `atmo:${uri}`, cid: 'bafyreiaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', start: '2026-10-10T00:00:00.000Z' }]);
      expect(updated).toEqual([{ id: `atmo:${uri}`, cid: 'bafyreiaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaai', start: '2026-10-11T10:00:00.000Z' }]);
      phase = 'withdrawn';
      await page.evaluate(() => (window as unknown as { proof: { refresh: () => Promise<void> } }).proof.refresh());
      expect(await page.getByRole('button', { name: /Rescheduled Atmosphere meetup,/ }).count()).toBe(0);
      if (storage === 'browser') await source.click();
      else enabled = false;
      await page.evaluate(() => (window as unknown as { proof: { refresh: () => Promise<void> } }).proof.refresh());
      await page.waitForFunction(() => document.querySelector('[data-calendar-name="Atmosphere"]')?.getAttribute('data-visible') === 'false');
      await source.click();
      await page.waitForFunction(() => document.querySelector('[data-calendar-name="Atmosphere"]')?.getAttribute('data-visible') === 'true');
      expect(requests.every(request => request.slot === '1')).toBe(true);
      expect(requests.filter(request => request.method === 'PUT').map(({ method, path, slot }) => ({ method, path, slot })))
        .toEqual(storage === 'browser' ? [] : [{ method: 'PUT', path: '/api/calendar/sources/atmo', slot: '1' }]);
    } finally {
      await browser?.close();
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    }
  }, 45_000);
});
