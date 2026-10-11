import { describe, it, expect } from 'vitest';
import { FirstTouchGate, gateKeysFor } from '../first-touch-gate';

type Call = [string, Record<string, unknown>, string];

function deferred<T = void>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

const flush = () => new Promise<void>((r) => setTimeout(r, 0));

const calGet = (accountId = 'a'): Call => ['Calendar/get', { accountId }, '0'];
const evQuery = (accountId = 'a'): Call => ['CalendarEvent/query', { accountId }, '0'];
const bookGet = (accountId = 'a'): Call => ['AddressBook/get', { accountId }, '0'];
const mboxGet = (accountId = 'a'): Call => ['Mailbox/get', { accountId }, '0'];

describe('gateKeysFor', () => {
  it('maps calendar and contact methods to per-account keys', () => {
    expect(gateKeysFor([calGet('a'), evQuery('a'), bookGet('b')]).sort()).toEqual([
      'calendar:a',
      'contacts:b',
    ]);
  });

  it('ignores non-gated methods and calls without an accountId', () => {
    expect(gateKeysFor([mboxGet(), ['Email/query', { accountId: 'a' }, '0']])).toEqual([]);
    expect(gateKeysFor([['Calendar/get', {}, '0']])).toEqual([]);
  });
});

describe('FirstTouchGate', () => {
  it('holds a second calendar request until the first one for that account settles', async () => {
    const gate = new FirstTouchGate();
    const first = deferred<string>();
    const order: string[] = [];

    const p1 = gate.run([calGet()], () => { order.push('send1'); return first.promise; });
    const p2 = gate.run([evQuery()], async () => { order.push('send2'); return 'two'; });
    await flush();
    expect(order).toEqual(['send1']);

    first.resolve('one');
    await expect(p1).resolves.toBe('one');
    await expect(p2).resolves.toBe('two');
    expect(order).toEqual(['send1', 'send2']);
  });

  it('lets requests flow concurrently once the first touch has settled', async () => {
    const gate = new FirstTouchGate();
    await gate.run([calGet()], async () => 'warm');

    const a = deferred<string>();
    const order: string[] = [];
    const p1 = gate.run([calGet()], () => { order.push('send1'); return a.promise; });
    const p2 = gate.run([evQuery()], async () => { order.push('send2'); return 'two'; });
    await flush();
    expect(order).toEqual(['send1', 'send2']);
    a.resolve('one');
    await Promise.all([p1, p2]);
  });

  it('releases the gate when the first request fails', async () => {
    const gate = new FirstTouchGate();
    const first = deferred<string>();
    const p1 = gate.run([calGet()], () => first.promise);
    const p2 = gate.run([calGet()], async () => 'two');
    first.reject(new Error('boom'));
    await expect(p1).rejects.toThrow('boom');
    await expect(p2).resolves.toBe('two');
  });

  it('does not gate different accounts or different collections against each other', async () => {
    const gate = new FirstTouchGate();
    const first = deferred<string>();
    const order: string[] = [];
    const p1 = gate.run([calGet('a')], () => { order.push('cal-a'); return first.promise; });
    const p2 = gate.run([calGet('b')], async () => { order.push('cal-b'); return 'b'; });
    const p3 = gate.run([bookGet('a')], async () => { order.push('book-a'); return 'book'; });
    const p4 = gate.run([mboxGet('a')], async () => { order.push('mbox-a'); return 'mbox'; });
    await flush();
    expect(order).toEqual(['cal-a', 'cal-b', 'book-a', 'mbox-a']);
    first.resolve('a');
    await Promise.all([p1, p2, p3, p4]);
  });

  it('a request spanning two collections waits for every in-flight first touch it overlaps', async () => {
    const gate = new FirstTouchGate();
    const cal = deferred<string>();
    const book = deferred<string>();
    const order: string[] = [];
    const p1 = gate.run([calGet()], () => { order.push('cal'); return cal.promise; });
    const p2 = gate.run([evQuery(), bookGet()], async () => { order.push('mixed'); return 'mixed'; });
    // Nothing is in flight for contacts yet, so this one is the contacts
    // first touch and goes out immediately; the mixed request must now wait
    // for both.
    const p3 = gate.run([bookGet()], () => { order.push('book'); return book.promise; });
    await flush();
    expect(order).toEqual(['cal', 'book']);

    cal.resolve('cal');
    await flush();
    expect(order).toEqual(['cal', 'book']);

    book.resolve('book');
    await Promise.all([p1, p2, p3]);
    expect(order).toEqual(['cal', 'book', 'mixed']);
  });

  it('reset() forgets settled keys so the next request is gated again', async () => {
    const gate = new FirstTouchGate();
    await gate.run([calGet()], async () => 'warm');
    gate.reset();
    const first = deferred<string>();
    const order: string[] = [];
    const p1 = gate.run([calGet()], () => { order.push('1'); return first.promise; });
    const p2 = gate.run([calGet()], async () => { order.push('2'); return '2'; });
    await flush();
    expect(order).toEqual(['1']);
    first.resolve('1');
    await Promise.all([p1, p2]);
  });
});
