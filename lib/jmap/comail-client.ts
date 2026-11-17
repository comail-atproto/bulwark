import { AtmoCalendarAdapter } from './atmo-calendar-adapter';
import { SpaceCalendarAdapter, SpaceCalendarError, type SpaceCalendarPersonalProperties } from './space-calendar-adapter';
import { isPublicAtprotoCalendar, isPublicAtprotoEvent } from '@/lib/calendar-editability';
import type { Calendar, CalendarEvent, CalendarRights } from './types';
import { JMAPClient } from './client';
import { SpaceContactAdapter, SpaceContactError } from './space-contact-adapter';
import { SpaceFileAdapter, SpaceFileError } from './space-file-adapter';
import { useAccountStore } from '@/stores/account-store';
import { generateAccountId } from '@/lib/account-utils';
import { IS_LITE } from '@/lib/lite';

// Native auth helpers import the auth store, so construct this class after the native client has loaded.
function defineComailClient() {
  return class ComailJMAPClient extends JMAPClient {
    private readonly spaceContactAdapter = new SpaceContactAdapter(() => this.cookieSlot());
    private readonly spaceFileAdapter = new SpaceFileAdapter(() => this.cookieSlot());
    private privateFiles = false;
    private privateGroupware: { slot: number; calendar: boolean; contacts: boolean; files?: boolean } | null = null;
    private calendarGeneration = 0;
    private spaceCalendarAdapter = this.newSpaceCalendarAdapter();
    private atmoCalendarAdapter = this.newAtmoCalendarAdapter();
    private spaceCalendars: Calendar[] | null = null;
    private spaceCalendarSlot: number | undefined;
    private atmoCalendarStale = false;
    private atmoEventsCache: { slot: number | undefined; range: string; events: CalendarEvent[] } | null = null;

    private newSpaceCalendarAdapter(): SpaceCalendarAdapter {
      const generation = this.calendarGeneration;
      return new SpaceCalendarAdapter(() => generation === this.calendarGeneration ? this.cookieSlot() : undefined);
    }

    private newAtmoCalendarAdapter(): AtmoCalendarAdapter {
      const generation = this.calendarGeneration;
      return new AtmoCalendarAdapter(() => generation === this.calendarGeneration ? this.cookieSlot() : undefined);
    }

    private resetCalendarAdapters(): void {
      this.calendarGeneration++;
      this.spaceCalendars = null;
      this.spaceCalendarSlot = undefined;
      this.atmoEventsCache = null;
      this.atmoCalendarStale = false;
      this.spaceCalendarAdapter = this.newSpaceCalendarAdapter();
      this.atmoCalendarAdapter = this.newAtmoCalendarAdapter();
    }

    configurePrivateGroupware(slot: number, support: { calendar: boolean; contacts: boolean; files?: boolean }): void {
      if ((this.privateGroupware && this.privateGroupware.slot !== slot) || (this.spaceCalendars && this.spaceCalendarSlot !== slot)) {
        this.resetCalendarAdapters();
      }
      this.privateGroupware = { slot, ...support };
    }

    private supportsPrivateGroupware(resource: 'calendar' | 'contacts' | 'files'): boolean {
      return !IS_LITE && this.privateGroupware?.[resource] === true && this.cookieSlot() === this.privateGroupware.slot;
    }

    private checkPrivateGroupware(resource: 'calendar' | 'contacts' | 'files'): void {
      if (this.privateGroupware === null || this.supportsPrivateGroupware(resource)) return;
      const changed = this.cookieSlot() !== this.privateGroupware.slot;
      if (resource === 'contacts') throw new SpaceContactError(changed ? 'account_changed' : 'not_configured');
      if (resource === 'files') throw new SpaceFileError(changed ? 'account_changed' : 'not_configured');
      throw new SpaceCalendarError(changed ? 'Calendar account changed' : 'Private calendar is unavailable', changed ? 'account_changed' : 'not_configured', 403);
    }

    override supportsContacts(accountId?: string): boolean {
      return this.privateGroupware === null ? super.supportsContacts(accountId) : this.supportsPrivateGroupware('contacts') && (!accountId || accountId === this.getAccountId());
    }

    override supportsCalendars(accountId?: string): boolean {
      return this.privateGroupware === null ? super.supportsCalendars(accountId) : this.supportsPrivateGroupware('calendar') && (!accountId || accountId === this.getAccountId());
    }

    protected override supportsNativeCalendars(): boolean {
      return this.privateGroupware === null && super.supportsNativeCalendars();
    }

    private cookieSlot(): number | undefined {
      if (IS_LITE) return undefined;
      return useAccountStore.getState().getAccountById(generateAccountId(this.getUsername(), this.getServerUrl()))?.cookieSlot;
    }

    private async privateContacts(): Promise<boolean> {
      this.checkPrivateGroupware('contacts');
      return !IS_LITE && this.spaceContactAdapter.configured();
    }

    private async usesPrivateFiles(): Promise<boolean> {
      this.checkPrivateGroupware('files');
      return !IS_LITE && this.spaceFileAdapter.configured();
    }

    override async getAddressBooks(...args: Parameters<JMAPClient['getAddressBooks']>) {
      this.checkPrivateGroupware('contacts');
      return (!IS_LITE && await this.spaceContactAdapter.addressBooks()) || super.getAddressBooks(...args);
    }

    override async getAllAddressBooks() {
      this.checkPrivateGroupware('contacts');
      const books = !IS_LITE && await this.spaceContactAdapter.addressBooks();
      return books ? books.map(book => ({ ...book, accountId: this.getContactsAccountId(), accountName: this.getUsername(), isShared: false })) : super.getAllAddressBooks();
    }

    override async getContacts(...args: Parameters<JMAPClient['getContacts']>) {
      this.checkPrivateGroupware('contacts');
      return (!IS_LITE && await this.spaceContactAdapter.contacts(args[0])) || super.getContacts(...args);
    }

    override async getAllContacts() {
      this.checkPrivateGroupware('contacts');
      const contacts = !IS_LITE && await this.spaceContactAdapter.contacts();
      return contacts ? contacts.map(contact => ({ ...contact, accountId: this.getContactsAccountId(), accountName: this.getUsername(), isShared: false })) : super.getAllContacts();
    }

    private checkContactAccount(accountId?: string): void {
      if (accountId && accountId !== this.getContactsAccountId()) throw new SpaceContactError('unsupported_account');
    }

    override async getContact(...args: Parameters<JMAPClient['getContact']>) {
      if (!await this.privateContacts()) return super.getContact(...args);
      this.checkContactAccount(args[1]);
      return (await this.spaceContactAdapter.contacts())?.find(contact => contact.id === args[0]) ?? null;
    }

    override async createContact(...args: Parameters<JMAPClient['createContact']>) {
      if (!await this.privateContacts()) return super.createContact(...args);
      this.checkContactAccount(args[1]);
      return this.spaceContactAdapter.create(args[0]);
    }

    override async updateContact(...args: Parameters<JMAPClient['updateContact']>) {
      if (!await this.privateContacts()) return super.updateContact(...args);
      this.checkContactAccount(args[2]);
      return this.spaceContactAdapter.update(args[0], args[1]);
    }

    override async deleteContact(...args: Parameters<JMAPClient['deleteContact']>) {
      if (!await this.privateContacts()) return super.deleteContact(...args);
      this.checkContactAccount(args[1]);
      return this.spaceContactAdapter.remove(args[0]);
    }

    override async searchContacts(query: string) {
      this.checkPrivateGroupware('contacts');
      const contacts = !IS_LITE && await this.spaceContactAdapter.contacts();
      return contacts ? contacts.filter(contact => JSON.stringify(contact).toLocaleLowerCase().includes(query.toLocaleLowerCase())).slice(0, 50) : super.searchContacts(query);
    }

    override async createAddressBook(...args: Parameters<JMAPClient['createAddressBook']>) {
      if (await this.privateContacts()) throw new SpaceContactError('unsupported_address_book_operation');
      return super.createAddressBook(...args);
    }

    override async updateAddressBook(...args: Parameters<JMAPClient['updateAddressBook']>) {
      if (await this.privateContacts()) throw new SpaceContactError('unsupported_address_book_operation');
      return super.updateAddressBook(...args);
    }

    override async setDefaultAddressBook(...args: Parameters<JMAPClient['setDefaultAddressBook']>) {
      if (await this.privateContacts()) throw new SpaceContactError('unsupported_address_book_operation');
      return super.setDefaultAddressBook(...args);
    }

    override async deleteAddressBook(...args: Parameters<JMAPClient['deleteAddressBook']>) {
      if (await this.privateContacts()) throw new SpaceContactError('unsupported_address_book_operation');
      return super.deleteAddressBook(...args);
    }

    override async setAddressBookShare(...args: Parameters<JMAPClient['setAddressBookShare']>) {
      if (await this.privateContacts()) throw new SpaceContactError('unsupported_sharing');
      return super.setAddressBookShare(...args);
    }

    override supportsFiles(accountId?: string): boolean {
      if (this.privateGroupware !== null) return this.supportsPrivateGroupware('files') && (!accountId || accountId === this.getFilesAccountId());
      return this.privateFiles ? !accountId || accountId === this.getFilesAccountId() : super.supportsFiles(accountId);
    }

    override async probeFileNodeSupport() {
      if (!await this.usesPrivateFiles()) return super.probeFileNodeSupport();
      this.privateFiles = true;
      return true;
    }

    override async getFileNodes(...args: Parameters<JMAPClient['getFileNodes']>) {
      return await this.usesPrivateFiles() ? (await this.spaceFileAdapter.list()).filter(node => args[0] === null || args[0].includes(node.id)) : super.getFileNodes(...args);
    }

    override async queryFileNodes(...args: Parameters<JMAPClient['queryFileNodes']>) {
      if (!await this.usesPrivateFiles()) return super.queryFileNodes(...args);
      const [filter, sort] = args;
      const nodes = (await this.spaceFileAdapter.list()).filter(node => (filter.parentId === undefined || node.parentId === filter.parentId)
        && (filter.name === undefined || node.name.includes(filter.name)) && (filter.type === undefined || node.type === filter.type));
      for (const order of [...(sort || [])].reverse()) {
        if (!['name', 'size', 'type'].includes(order.property)) throw new SpaceFileError('unsupported_operation');
        nodes.sort((a, b) => {
          const left = a[order.property as 'name' | 'size' | 'type']; const right = b[order.property as 'name' | 'size' | 'type'];
          return (left < right ? -1 : left > right ? 1 : 0) * (order.isAscending ? 1 : -1);
        });
      }
      return nodes.map(node => node.id);
    }

    override async listAllFileNodes() {
      return await this.usesPrivateFiles() ? this.spaceFileAdapter.list() : super.listAllFileNodes();
    }

    override async listAllFileNodesAcrossAccounts() {
      return await this.usesPrivateFiles() ? this.spaceFileAdapter.list() : super.listAllFileNodesAcrossAccounts();
    }

    override async setFileNodeShare(...args: Parameters<JMAPClient['setFileNodeShare']>) {
      if (await this.usesPrivateFiles()) throw new SpaceFileError('unsupported_sharing');
      return super.setFileNodeShare(...args);
    }

    async uploadFileBlob(...args: Parameters<JMAPClient['uploadBlob']>) {
      if (!await this.usesPrivateFiles()) return super.uploadBlob(...args);
      const options = typeof args[1] === 'string' ? { accountId: args[1] } : args[1];
      if (options?.accountId && options.accountId !== this.getFilesAccountId()) throw new SpaceFileError('unsupported_account');
      return this.spaceFileAdapter.stage(args[0], options);
    }

    override async createFileDirectory(...args: Parameters<JMAPClient['createFileDirectory']>) {
      return await this.usesPrivateFiles() ? this.spaceFileAdapter.createDirectory(...args) : super.createFileDirectory(...args);
    }

    override async createFileNode(...args: Parameters<JMAPClient['createFileNode']>) {
      return await this.usesPrivateFiles() ? this.spaceFileAdapter.create(...args) : super.createFileNode(...args);
    }

    override async updateFileNode(...args: Parameters<JMAPClient['updateFileNode']>) {
      return await this.usesPrivateFiles() ? this.spaceFileAdapter.update(...args) : super.updateFileNode(...args);
    }

    override async updateFileNodes(...args: Parameters<JMAPClient['updateFileNodes']>) {
      if (!await this.usesPrivateFiles()) return super.updateFileNodes(...args);
      const updated: string[] = []; const notUpdated: Record<string, string> = {};
      let failure: string | undefined;
      for (const [id, change] of Object.entries(args[0])) {
        if (failure) { notUpdated[id] = failure; continue; }
        try { await this.spaceFileAdapter.update(id, change); updated.push(id); }
        catch (error) { failure = error instanceof Error ? error.message : 'File update failed'; notUpdated[id] = failure; }
      }
      return { updated, notUpdated };
    }

    override async destroyFileNodes(...args: Parameters<JMAPClient['destroyFileNodes']>) {
      if (!await this.usesPrivateFiles()) return super.destroyFileNodes(...args);
      const destroyed: string[] = [];
      for (const id of args[0]) { await this.spaceFileAdapter.remove(id); destroyed.push(id); }
      return { destroyed, notDestroyed: [] };
    }

    override async copyFileNode(...args: Parameters<JMAPClient['copyFileNode']>) {
      return await this.usesPrivateFiles() ? this.spaceFileAdapter.copy(args[0], args[1], args[2]) : super.copyFileNode(...args);
    }

    override getBlobDownloadUrl(...args: Parameters<JMAPClient['getBlobDownloadUrl']>) {
      if (args[0].startsWith('space-file:') || args[0].startsWith('space-upload:')) throw new SpaceFileError('unsupported_operation');
      return super.getBlobDownloadUrl(...args);
    }

    override async fetchBlob(...args: Parameters<JMAPClient['fetchBlob']>) {
      if (!args[0].startsWith('space-file:')) return super.fetchBlob(...args);
      this.checkPrivateGroupware('files');
      if (args[3] && args[3] !== this.getFilesAccountId()) throw new SpaceFileError('unsupported_account');
      return this.spaceFileAdapter.download(args[0]);
    }

    override async getCalendars() {
      if (this.privateGroupware === null) return super.getCalendars();
      return this.supportsPrivateGroupware('calendar') ? this.getAtprotoSpaceCalendars() : [];
    }

    override async getAllCalendarsWithFailures() {
      const publicCalendars = this.getAtmoPublicCalendars().catch(error => {
        this.atmoCalendarStale = true;
        console.error('Failed to fetch Atmosphere calendar:', error);
        return [] as Calendar[];
      });
      const [native, space, publicSources] = await Promise.all([
        this.privateGroupware === null ? super.getAllCalendarsWithFailures() : { calendars: [], failedAccountIds: [] },
        this.privateGroupware === null || this.supportsPrivateGroupware('calendar') ? this.getAtprotoSpaceCalendars() : [], publicCalendars,
      ]);
      return { calendars: [...native.calendars, ...space, ...publicSources], failedAccountIds: native.failedAccountIds };
    }

    override async queryAllCalendarEvents(...args: Parameters<JMAPClient['queryAllCalendarEvents']>) {
      const [filter, , , options] = args;
      const native = this.privateGroupware === null ? super.queryAllCalendarEvents(...args) : Promise.resolve([]);
      if (!filter.after || !filter.before) return native;
      const [accountEvents, space, publicSources] = await Promise.all([
        native, this.privateGroupware === null || this.supportsPrivateGroupware('calendar')
          ? this.getAtprotoSpaceCalendarEvents(filter.after, filter.before) : [],
        this.getAtmoPublicCalendarEvents(filter.after, filter.before),
      ]);
      if (options?.signal?.aborted) throw Object.assign(new Error('aborted'), { name: 'AbortError' });
      return [...accountEvents, ...space, ...publicSources];
    }

    override disconnect(): void {
      super.disconnect();
      this.resetCalendarAdapters();
    }

    async getAtprotoSpaceCalendars(): Promise<Calendar[]> {
      this.checkPrivateGroupware('calendar');
      const slot = this.cookieSlot();
      const calendars = (await this.spaceCalendarAdapter.getCalendars()).map((calendar) => ({
        ...calendar,
        accountId: this.getCalendarsAccountId(),
        accountName: this.getUsername(),
        isShared: false,
      }));
      this.checkPrivateGroupware('calendar');
      if (slot !== this.cookieSlot()) throw new SpaceCalendarError('Calendar account changed', 'account_changed', 403);
      this.spaceCalendars = calendars;
      this.spaceCalendarSlot = slot;
      return calendars;
    }

    async getAtmoPublicCalendars(): Promise<Calendar[]> {
      return (await this.atmoCalendarAdapter.getCalendars()).map(calendar => ({
        ...calendar, accountId: this.getCalendarsAccountId(), accountName: this.getUsername(), isShared: false, atmoStale: this.atmoCalendarStale,
      }));
    }

    async getAtmoPublicCalendarEvents(after: string, before: string): Promise<CalendarEvent[]> {
      const range = `${after}|${before}`;
      const slot = this.cookieSlot();
      try {
        const events = (await this.atmoCalendarAdapter.getEvents(after, before)).map(event => ({
          ...event, accountId: this.getCalendarsAccountId(), accountName: this.getUsername(), isShared: false,
        }));
        if (slot !== this.cookieSlot()) return [];
        const complete = this.atmoCalendarAdapter.isLastRefreshComplete();
        this.atmoCalendarStale = !complete;
        if (complete) this.atmoEventsCache = { slot, range, events };
        return !complete && this.atmoEventsCache && this.atmoEventsCache.slot === slot && slot === this.cookieSlot() && this.atmoEventsCache.range === range ? this.atmoEventsCache.events : events;
      } catch (error) {
        this.atmoCalendarStale = true;
        console.error('Failed to refresh Atmosphere calendar events:', error);
        return this.atmoEventsCache && this.atmoEventsCache.slot === slot && slot === this.cookieSlot() && this.atmoEventsCache.range === range ? this.atmoEventsCache.events : [];
      }
    }

    getAtmoCalendarStale(): boolean {
      return this.atmoCalendarStale;
    }

    async setAtmoCalendarEnabled(enabled: boolean): Promise<Calendar> {
      const calendar = await this.atmoCalendarAdapter.setEnabled(enabled);
      return { ...calendar, accountId: this.getCalendarsAccountId(), accountName: this.getUsername(), isShared: false };
    }

    async startAtmoCalendarConsent(): Promise<string> {
      return this.atmoCalendarAdapter.startAuthorization();
    }

    async getAtprotoSpacePrincipals() {
      this.checkPrivateGroupware('calendar');
      return this.spaceCalendarAdapter.getPrincipals();
    }

    async startAtprotoSpaceCalendarConsent(): Promise<string> {
      this.checkPrivateGroupware('calendar');
      return this.spaceCalendarAdapter.startAuthorization('member-calendar');
    }

    async getAtprotoSpaceCalendarEvents(after: string, before: string): Promise<CalendarEvent[]> {
      this.checkPrivateGroupware('calendar');
      if (this.spaceCalendars && this.spaceCalendarSlot !== this.cookieSlot()) this.resetCalendarAdapters();
      const calendars = this.spaceCalendars ?? await this.getAtprotoSpaceCalendars();
      if (calendars.length === 0 || calendars.some((calendar) => calendar.spaceConsentRequired)) return [];
      return this.spaceCalendarAdapter.getEvents(after, before);
    }

    async updateAtprotoSpaceCalendarEvent(eventId: string, baseRevision: string, updates: Partial<CalendarEvent>): Promise<CalendarEvent> {
      this.checkPrivateGroupware('calendar');
      return this.spaceCalendarAdapter.updateEvent(eventId, baseRevision, updates);
    }

    async updateAtprotoSpaceCalendarPrivateEvent(eventId: string, basePersonalRevision: string, updates: Partial<SpaceCalendarPersonalProperties>, recurrenceId?: string, inherit?: Array<keyof SpaceCalendarPersonalProperties>): Promise<CalendarEvent> {
      this.checkPrivateGroupware('calendar');
      return this.spaceCalendarAdapter.updatePrivateEvent(eventId, basePersonalRevision, updates, recurrenceId, inherit);
    }

    async rsvpAtprotoSpaceCalendarEvent(eventId: string, baseRevision: string, status: string, recurrenceId?: string): Promise<CalendarEvent> {
      this.checkPrivateGroupware('calendar');
      return this.spaceCalendarAdapter.rsvpEvent(eventId, baseRevision, status, recurrenceId);
    }

    async cancelAtprotoSpaceCalendarEvent(eventId: string, baseRevision: string, calendarId: string): Promise<CalendarEvent> {
      this.checkPrivateGroupware('calendar');
      if (this.spaceCalendarSlot !== this.cookieSlot()) throw new SpaceCalendarError('Calendar account changed', 'account_changed', 403);
      const calendar = this.spaceCalendars?.find((item) => (item.originalId || item.id) === calendarId);
      if (!calendar?.spaceRole) throw new SpaceCalendarError('Space calendar role is unavailable', 'invalid_response');
      return this.spaceCalendarAdapter.cancelEvent(eventId, baseRevision, calendar.spaceRole);
    }

    async createAtprotoSpaceCalendarEvent(calendarId: string, event: Partial<CalendarEvent>, sendSchedulingMessages = false): Promise<CalendarEvent> {
      this.checkPrivateGroupware('calendar');
      return this.spaceCalendarAdapter.createEvent(calendarId, event, sendSchedulingMessages);
    }

    async subscribeAtprotoPublicCalendarEvent(event: CalendarEvent): Promise<CalendarEvent> {
      return this.spaceCalendarAdapter.subscribePublicEvent(event);
    }

    async rsvpAtprotoPublicCalendarEvent(event: CalendarEvent, status: 'going' | 'interested' | 'notgoing') {
      return this.spaceCalendarAdapter.rsvpPublicEvent(event, status);
    }

    async publishAtprotoPublicCalendarEvent(event: CalendarEvent) {
      return this.spaceCalendarAdapter.publishPublicEvent(event);
    }

    async shareAtprotoSpaceCalendar(calendarId: string, principalId: string, rights: CalendarRights | null): Promise<{ status: 'shared' | 'revoked' }> {
      this.checkPrivateGroupware('calendar');
      return this.spaceCalendarAdapter.shareCalendar(calendarId, principalId, rights);
    }

    override async createCalendar(...args: Parameters<JMAPClient['createCalendar']>) {
      if (isPublicAtprotoCalendar(args[0])) throw new SpaceCalendarError('Atmosphere calendar is read-only', 'unsupported_operation', 403);
      return super.createCalendar(...args);
    }

    override async updateCalendar(...args: Parameters<JMAPClient['updateCalendar']>) {
      if (isPublicAtprotoCalendar({ id: args[0] }) || isPublicAtprotoCalendar(args[1])) throw new SpaceCalendarError('Atmosphere calendar is read-only', 'unsupported_operation', 403);
      return super.updateCalendar(...args);
    }

    override async setDefaultCalendar(...args: Parameters<JMAPClient['setDefaultCalendar']>) {
      if (isPublicAtprotoCalendar({ id: args[0] })) throw new SpaceCalendarError('Atmosphere calendar is read-only', 'unsupported_operation', 403);
      return super.setDefaultCalendar(...args);
    }

    override async deleteCalendar(...args: Parameters<JMAPClient['deleteCalendar']>) {
      if (isPublicAtprotoCalendar({ id: args[0] })) throw new SpaceCalendarError('Atmosphere calendar is read-only', 'unsupported_operation', 403);
      return super.deleteCalendar(...args);
    }

    override async createCalendarEvent(...args: Parameters<JMAPClient['createCalendarEvent']>) {
      if (isPublicAtprotoEvent(args[0])) throw new SpaceCalendarError('Atmosphere calendar is read-only', 'unsupported_operation', 403);
      return super.createCalendarEvent(...args);
    }

    override async updateCalendarEvent(...args: Parameters<JMAPClient['updateCalendarEvent']>) {
      if (isPublicAtprotoEvent({ id: args[0] }) || isPublicAtprotoEvent(args[1])) throw new SpaceCalendarError('Atmosphere calendar is read-only', 'unsupported_operation', 403);
      return super.updateCalendarEvent(...args);
    }

    override async deleteCalendarEvent(...args: Parameters<JMAPClient['deleteCalendarEvent']>) {
      if (isPublicAtprotoEvent({ id: args[0] })) throw new SpaceCalendarError('Atmosphere calendar is read-only', 'unsupported_operation', 403);
      return super.deleteCalendarEvent(...args);
    }
  };
}

let clientClass: ReturnType<typeof defineComailClient> | undefined;
export type ComailJMAPClient = InstanceType<ReturnType<typeof defineComailClient>>;

export function createComailClient(...args: ConstructorParameters<typeof JMAPClient>): ComailJMAPClient {
  return new (clientClass ??= defineComailClient())(...args);
}

export function createComailBearerClient(...args: Parameters<typeof JMAPClient.withBearer>): ComailJMAPClient {
  const [serverUrl, token, username, refresh] = args;
  const client = createComailClient(serverUrl, username, '');
  client.upgradeToBearer(token, refresh);
  return client;
}

export function isComailClient(client: unknown): client is ComailJMAPClient {
  return clientClass !== undefined && client instanceof clientClass;
}
