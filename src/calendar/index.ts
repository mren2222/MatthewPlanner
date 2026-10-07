import { createHash } from 'node:crypto';
import ICAL from 'ical.js';
import { createDAVClient, type DAVCalendar, type DAVResponse } from 'tsdav';
import type { CalendarInfo, FixedEvent } from '../core/types';

export interface CalendarProvider {
  listCalendars(): Promise<CalendarInfo[]>;
  /** Full non-recurring snapshot, plus recurring instances in the documented horizon. */
  listEvents(calendarId: string): Promise<FixedEvent[]>;
  createEvent(calendarId: string, event: FixedEvent): Promise<FixedEvent>;
  updateEvent(calendarId: string, event: FixedEvent): Promise<FixedEvent>;
  deleteEvent(calendarId: string, event: FixedEvent): Promise<void>;
}

export class CalendarError extends Error {
  constructor(message: string, readonly status?: number) { super(message); this.name = 'CalendarError'; }
}

export interface ICloudOptions {
  username: string;
  password: string;
  timezone?: string;
  fetch?: typeof globalThis.fetch;
}

const allowedFields = new Set(['id', 'title', 'startAt', 'endAt', 'timezone', 'location', 'notes', 'source', 'externalId', 'calendarProvider', 'calendarId', 'etag', 'linkedTaskId', 'createdAt', 'updatedAt']);
const day = 86_400_000;
const MAX_INSTANCES = 50_000;
const MAX_ITERATIONS = 100_000;

function validTimezone(timezone: string): boolean {
  try { new Intl.DateTimeFormat('en', { timeZone: timezone }); return true; } catch { return false; }
}

/** Deliberately rejects Tasks, including Task objects augmented with event timestamps. */
export function assertFixedEvent(value: unknown): asserts value is FixedEvent {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new CalendarError('Calendar accepts fixed events only.');
  const event = value as Record<string, unknown>;
  if (Object.keys(event).some(key => !allowedFields.has(key))) throw new CalendarError('Calendar accepts fixed events only.');
  for (const field of ['id', 'title', 'startAt', 'endAt', 'timezone', 'createdAt', 'updatedAt']) {
    if (typeof event[field] !== 'string' || !(event[field] as string).trim()) throw new CalendarError('A fixed event requires a title and explicit start and end times.');
  }
  for (const field of ['startAt', 'endAt', 'createdAt', 'updatedAt']) {
    if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)$/.test(event[field] as string) || !Number.isFinite(Date.parse(event[field] as string))) throw new CalendarError('Fixed event timestamps must include an explicit UTC offset.');
    const text = event[field] as string;
    const [year, month, date] = text.slice(0, 10).split('-').map(Number);
    const valid = new Date(Date.UTC(year, month - 1, date));
    if (valid.getUTCFullYear() !== year || valid.getUTCMonth() !== month - 1 || valid.getUTCDate() !== date) throw new CalendarError('Invalid fixed event date.');
  }
  if (Date.parse(event.endAt as string) <= Date.parse(event.startAt as string)) throw new CalendarError('Fixed event end must follow its start.');
  if (!validTimezone(event.timezone as string) || !['local', 'icloud'].includes(event.source as string)) throw new CalendarError('Invalid fixed event timezone or source.');
  for (const field of ['location', 'notes', 'externalId', 'calendarProvider', 'calendarId', 'etag', 'linkedTaskId']) {
    if (event[field] !== undefined && typeof event[field] !== 'string') throw new CalendarError('Invalid fixed event metadata.');
  }
}

function appleUrl(input: string, base = 'https://caldav.icloud.com/'): URL {
  let url: URL;
  try { url = new URL(input, base); } catch { throw new CalendarError('Invalid iCloud calendar address.'); }
  if (url.protocol !== 'https:' || !(url.hostname === 'icloud.com' || url.hostname.endsWith('.icloud.com')) || url.username || url.password || (url.port && url.port !== '443')) {
    throw new CalendarError('Calendar connections require a secure iCloud address.');
  }
  return url;
}

/** Validate every redirect before sending Basic credentials; never use fetch's implicit redirects. */
export function secureICloudFetch(transport: typeof globalThis.fetch, timeoutMs = 20_000): typeof globalThis.fetch {
  return async (input, init = {}) => {
    let url = appleUrl(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    const controller = new AbortController();
    const signal = init.signal ? AbortSignal.any([init.signal, controller.signal]) : controller.signal;
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      let request = { ...init, signal, redirect: 'manual' as const };
      for (let hops = 0; hops <= 5; hops++) {
        const response = await transport(url.href, request);
        if ([301, 302, 303, 307, 308].includes(response.status)) {
          const location = response.headers.get('location');
          if (!location) throw new CalendarError('iCloud returned an invalid redirect.');
          const target = appleUrl(location, url.href);
          if (init.redirect === 'manual') return response;
          if (init.redirect === 'error' || hops === 5) throw new CalendarError('iCloud calendar redirect failed.');
          url = target;
          if (response.status === 303) request = { ...request, method: 'GET', body: undefined };
          continue;
        }
        if (response.status === 401) throw new CalendarError('iCloud sign-in failed. Check your Apple Account and app-specific password.');
        if (response.status === 403) throw new CalendarError('iCloud denied calendar access. Check calendar sharing permissions.');
        if (response.status === 412) throw new CalendarError('The calendar event changed elsewhere. Refresh before trying again.', 412);
        if (!response.ok) throw new CalendarError(`iCloud calendar request failed (HTTP ${response.status}).`);
        // Consume DAV bodies before clearing the timeout; a stalled body must also time out.
        if ((request.method ?? 'GET') === 'PROPFIND' || request.method === 'REPORT') {
          const body = await response.text();
          if (response.status === 207 && !/<(?:[\w-]+:)?multistatus[\s/>]/i.test(body)) throw new CalendarError('iCloud returned an invalid calendar response. Previous imported events were kept.');
          return new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers });
        }
        return response;
      }
      throw new CalendarError('iCloud calendar redirect failed.');
    } catch (error) {
      if (error instanceof CalendarError) throw error;
      throw new CalendarError(controller.signal.aborted ? 'iCloud calendar request timed out. Try again.' : 'Could not connect to iCloud Calendar. Check your connection and try again.');
    } finally { clearTimeout(timer); }
  };
}

function propText(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object') {
    const object = value as Record<string, unknown>;
    return propText(object._cdata ?? object._text ?? object.value);
  }
  return undefined;
}

function objectFromResponse(response: DAVResponse, calendarId: string): { url: string; etag: string; data: string } {
  const data = propText(response.props?.calendarData);
  const etag = propText(response.props?.getetag);
  if (!response.ok || response.parseError || !response.href || !data || !etag || response.propStats?.some(stat => !stat.ok)) {
    throw new CalendarError('Calendar refresh is incomplete. Previous imported events were kept.');
  }
  const url = appleUrl(response.href, calendarId);
  if (!url.href.startsWith(calendarId) || url.hash) throw new CalendarError('iCloud returned an event outside the selected calendar.');
  return { url: url.href, etag, data };
}

// Resolve floating / IANA local wall times without depending on the host's timezone.
function wallTime(time: ICAL.Time, timezone: string): number {
  const wanted = Date.UTC(time.year, time.month - 1, time.day, time.hour, time.minute, time.second);
  const formatter = new Intl.DateTimeFormat('en-US', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
  let instant = wanted;
  for (let index = 0; index < 5; index++) {
    const parts = Object.fromEntries(formatter.formatToParts(instant).map(part => [part.type, part.value]));
    const displayed = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second);
    const correction = wanted - displayed;
    if (!correction) return instant;
    instant += correction;
  }
  throw new CalendarError('An event has an invalid or ambiguous local calendar time.');
}

function instant(time: ICAL.Time, component: ICAL.Component, property: string, fallback: string): { at: string; timezone: string } {
  if (!time) throw new CalendarError('An event has no calendar time.');
  const tzid = component.getFirstProperty(property)?.getParameter('tzid');
  const timezone = typeof tzid === 'string' && validTimezone(tzid) ? tzid : time.zone?.tzid === 'UTC' ? 'UTC' : fallback;
  let ms: number;
  if (!time.isDate && time.zone && !['floating', 'local'].includes(time.zone.tzid)) ms = time.toUnixTime() * 1000;
  else {
    if (typeof tzid === 'string' && !validTimezone(tzid)) throw new CalendarError('An event uses an unsupported timezone without a VTIMEZONE definition.');
    ms = wallTime(time, timezone);
  }
  if (!Number.isFinite(ms)) throw new CalendarError('An event has an invalid calendar time.');
  return { at: new Date(ms).toISOString(), timezone };
}

function parseCalendar(data: string): ICAL.Component {
  try {
    const calendar = new ICAL.Component(ICAL.parse(data));
    if (calendar.name !== 'vcalendar') throw new Error();
    if (calendar.getAllSubcomponents().some(component => !['vevent', 'vtimezone'].includes(component.name))) throw new Error();
    for (const component of calendar.getAllSubcomponents('vevent')) {
      for (const name of ['dtstart', 'dtend', 'recurrence-id']) if (component.getAllProperties(name).length > 1) throw new Error();
      for (const name of ['dtstart', 'dtend', 'recurrence-id', 'rdate', 'exdate']) {
        for (const property of component.getAllProperties(name)) {
          const raw = property.toJSON();
          // Period-valued RDATE is uncommon and needs per-instance duration support.
          if (!['date', 'date-time'].includes(raw[2])) throw new Error();
          for (const value of raw.slice(3)) {
            if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\d(?:T\d\d:\d\d:\d\dZ?)?$/.test(value)) throw new Error();
            const [year, month, date] = value.slice(0, 10).split('-').map(Number);
            const valid = new Date(Date.UTC(year, month - 1, date));
            if (valid.getUTCFullYear() !== year || valid.getUTCMonth() !== month - 1 || valid.getUTCDate() !== date) throw new Error();
            if (value.length > 10 && (+value.slice(11, 13) > 23 || +value.slice(14, 16) > 59 || +value.slice(17, 19) > 59)) throw new Error();
          }
        }
      }
    }
    return calendar;
  } catch { throw new CalendarError('An iCloud event could not be read. Previous imported events were kept.'); }
}

export function parseEvents(data: string, url: string, etag: string, calendarId: string, timezone: string, now = new Date()): FixedEvent[] {
  const calendar = parseCalendar(data);
  const components = calendar.getAllSubcomponents('vevent');
  if (!components.length) throw new CalendarError('An iCloud calendar object has no event.');
  const masters = components.filter(component => !component.hasProperty('recurrence-id'));
  if (masters.length !== 1) throw new CalendarError('An iCloud calendar object has an unsupported recurrence structure.');
  const master = masters[0];
  const uid = propText(master.getFirstPropertyValue('uid'));
  if (!uid || components.some(component => component.getFirstPropertyValue('uid') !== uid)) throw new CalendarError('An iCloud event has invalid identifiers.');
  const result: FixedEvent[] = [];
  const addedOccurrences = new Set<string>();
  const base = new ICAL.Event(master, { strictExceptions: true, exceptions: components.filter(component => component !== master) });
  const add = (event: ICAL.Event, start: ICAL.Time, end: ICAL.Time, recurrence?: ICAL.Time) => {
    if (event.component.getFirstPropertyValue('status') === 'CANCELLED') return;
    const startTime = instant(start, event.component, 'dtstart', timezone);
    const endTime = instant(end, event.component, 'dtend', startTime.timezone);
    if (recurrence && (Date.parse(endTime.at) <= now.getTime() - 7 * day || Date.parse(startTime.at) >= now.getTime() + 90 * day)) return;
    const externalId = recurrence ? `${url}#${encodeURIComponent(recurrence.toString())}` : url;
    if (addedOccurrences.has(externalId)) return;
    addedOccurrences.add(externalId);
    const displayZone = event.component.getFirstPropertyValue('x-matthew-timezone');
    const timestamp = now.toISOString();
    const eventValue: FixedEvent = {
      id: `icloud-${createHash('sha256').update(`${calendarId}|${externalId}`).digest('hex').slice(0, 32)}`,
      title: event.summary || '(Untitled event)', startAt: startTime.at, endAt: endTime.at,
      timezone: typeof displayZone === 'string' && validTimezone(displayZone) ? displayZone : startTime.timezone, source: 'icloud', calendarProvider: 'icloud', calendarId, externalId, etag,
      location: event.location || undefined, notes: event.description || undefined,
      createdAt: timestamp, updatedAt: timestamp,
    };
    assertFixedEvent(eventValue);
    result.push(eventValue);
    if (result.length > MAX_INSTANCES) throw new CalendarError('This calendar contains too many recurrence instances to refresh safely.');
  };
  try {
    if (!master.hasProperty('dtstart')) throw new CalendarError('An iCloud event has no start time.');
    if (!base.isRecurring()) {
      if (components.length !== 1) throw new CalendarError('An iCloud event has unsupported recurrence exceptions.');
      add(base, base.startDate, base.endDate);
    } else {
      const iterator = base.iterator();
      let finished = false;
      for (let count = 0; count < MAX_ITERATIONS; count++) {
        const occurrence = iterator.next();
        if (!occurrence) { finished = true; break; }
        if (Date.parse(instant(occurrence, master, 'dtstart', timezone).at) >= now.getTime() + 90 * day) { finished = true; break; }
        const details = base.getOccurrenceDetails(occurrence);
        add(details.item, details.startDate, details.endDate, occurrence);
      }
      if (!finished) throw new CalendarError('A recurrence exceeded the safe expansion limit. Previous imported events were kept.');
      // Overrides may move an anchor outside the horizon into it (or vice versa).
      for (const component of components.filter(component => component !== master)) {
        const event = new ICAL.Event(component);
        const recurrence = component.getFirstPropertyValue('recurrence-id');
        if (!(recurrence instanceof ICAL.Time)) throw new CalendarError('An iCloud recurrence exception has no valid date.');
        add(event, event.startDate, event.endDate, recurrence);
      }
    }
    return result;
  } catch (error) {
    if (error instanceof CalendarError) throw error;
    throw new CalendarError('An iCloud event could not be read. Previous imported events were kept.');
  }
}

export function serializeEvent(event: FixedEvent, existing?: string): string {
  assertFixedEvent(event);
  const calendar = existing ? parseCalendar(existing) : new ICAL.Component('vcalendar');
  const components = calendar.getAllSubcomponents('vevent');
  if (existing && (components.length !== 1 || new ICAL.Event(components[0]).isRecurring() || components[0].hasProperty('recurrence-id'))) throw new CalendarError('Edit recurring events in your Calendar app, then refresh.');
  const component = components[0] ?? new ICAL.Component('vevent');
  if (!existing) {
    calendar.updatePropertyWithValue('version', '2.0');
    calendar.updatePropertyWithValue('prodid', '-//Matthew Planner//Fixed Events//EN');
    calendar.addSubcomponent(component);
    component.updatePropertyWithValue('uid', `${eventKey(event)}@matthew-planner.local`);
  }
  const set = (name: string, value: string | undefined) => {
    component.removeAllProperties(name);
    if (value !== undefined) component.addPropertyWithValue(name, value);
  };
  set('summary', event.title);
  set('location', event.location);
  set('description', event.notes);
  set('x-matthew-timezone', event.timezone);
  component.removeAllProperties('duration');
  for (const [name, value] of [['dtstart', event.startAt], ['dtend', event.endAt], ['dtstamp', new Date().toISOString()], ['last-modified', new Date().toISOString()]]) {
    component.removeAllProperties(name);
    component.addPropertyWithValue(name, ICAL.Time.fromJSDate(new Date(value), true));
  }
  return `${calendar.toString()}\r\n`;
}

function eventKey(event: FixedEvent): string {
  return createHash('sha256').update(event.id).digest('hex');
}

function matchesPublishedEvent(data: string, event: FixedEvent): boolean {
  const calendar = parseCalendar(data);
  const components = calendar.getAllSubcomponents('vevent');
  if (components.length !== 1) return false;
  const component = components[0];
  const candidate = new ICAL.Event(component);
  if (candidate.isRecurring() || component.hasProperty('recurrence-id') || candidate.uid !== `${eventKey(event)}@matthew-planner.local`) return false;
  return candidate.summary === event.title && (candidate.location || '') === (event.location || '') && (candidate.description || '') === (event.notes || '')
    && instant(candidate.startDate, component, 'dtstart', event.timezone).at === new Date(event.startAt).toISOString()
    && instant(candidate.endDate, component, 'dtend', event.timezone).at === new Date(event.endAt).toISOString();
}

export class ICloudCalendarProvider implements CalendarProvider {
  private readonly options: ICloudOptions;
  private client?: ReturnType<typeof createDAVClient>;
  private calendars = new Map<string, DAVCalendar>();
  constructor(options: ICloudOptions) {
    if (!options.username?.trim() || !options.password?.trim()) throw new CalendarError('Enter an Apple Account and app-specific password.');
    if (options.timezone && !validTimezone(options.timezone)) throw new CalendarError('Invalid calendar timezone.');
    this.options = { ...options, timezone: options.timezone ?? 'UTC' };
  }
  private async connection() {
    this.client ??= createDAVClient({ serverUrl: 'https://caldav.icloud.com/', credentials: { username: this.options.username, password: this.options.password }, authMethod: 'Basic', defaultAccountType: 'caldav', fetch: secureICloudFetch(this.options.fetch ?? globalThis.fetch) });
    try { return await this.client; } catch (error) { this.client = undefined; if (error instanceof CalendarError) throw error; throw new CalendarError('iCloud calendar discovery failed. Check your account and try again.'); }
  }
  async listCalendars(): Promise<CalendarInfo[]> {
    try {
      const calendars = await (await this.connection()).fetchCalendars();
      const selected = calendars.filter(calendar => !calendar.components?.length || calendar.components.includes('VEVENT'));
      const map = new Map<string, DAVCalendar>();
      for (const calendar of selected) {
        const id = appleUrl(calendar.url).href;
        if (!id.endsWith('/')) throw new CalendarError('iCloud returned an invalid calendar collection.');
        map.set(id, { ...calendar, url: id });
      }
      this.calendars = map;
      return [...map].map(([id, calendar]) => ({ id, name: typeof calendar.displayName === 'string' ? calendar.displayName : 'iCloud Calendar' }));
    } catch (error) { if (error instanceof CalendarError) throw error; throw new CalendarError('iCloud calendars could not be listed. Try again.'); }
  }
  private async selected(calendarId: string): Promise<DAVCalendar> {
    appleUrl(calendarId);
    if (!this.calendars.has(calendarId)) await this.listCalendars();
    const calendar = this.calendars.get(calendarId);
    if (!calendar) throw new CalendarError('Select a calendar from your iCloud account.');
    return calendar;
  }
  async listEvents(calendarId: string): Promise<FixedEvent[]> {
    const calendar = await this.selected(calendarId);
    try {
      const responses = await (await this.connection()).calendarQuery({ url: calendar.url, props: { 'd:getetag': {}, 'c:calendar-data': {} }, filters: { 'comp-filter': { _attributes: { name: 'VCALENDAR' }, 'comp-filter': { _attributes: { name: 'VEVENT' } } } }, depth: '1' });
      if (responses.length > 20_000) throw new CalendarError('This calendar contains too many objects to refresh safely.');
      const now = new Date();
      const seen = new Set<string>();
      const events = responses.flatMap(response => {
        const object = objectFromResponse(response, calendarId);
        if (seen.has(object.url)) throw new CalendarError('iCloud returned duplicate calendar objects.');
        seen.add(object.url);
        return parseEvents(object.data, object.url, object.etag, calendarId, this.options.timezone!, now);
      });
      if (events.length > MAX_INSTANCES) throw new CalendarError('This calendar has too many events to refresh safely.');
      return events;
    } catch (error) { if (error instanceof CalendarError) throw error; throw new CalendarError('Calendar refresh failed. Previous imported events were kept.'); }
  }
  private writable(calendarId: string, event: FixedEvent): string {
    assertFixedEvent(event);
    if (event.source !== 'icloud' || event.calendarProvider !== 'icloud' || event.calendarId !== calendarId || !event.externalId || !event.etag || /[\r\n]/.test(event.etag)) throw new CalendarError('Refresh this imported event before writing it to iCloud.');
    const url = appleUrl(event.externalId);
    if (url.hash || !url.href.startsWith(calendarId) || url.href === calendarId) throw new CalendarError('Edit recurring events in your Calendar app, then refresh.');
    return url.href;
  }
  async createEvent(calendarId: string, event: FixedEvent): Promise<FixedEvent> {
    assertFixedEvent(event);
    if (event.source !== 'local' || event.externalId) throw new CalendarError('Only a local fixed event can be published as a new iCloud event.');
    const calendar = await this.selected(calendarId);
    const filename = `${eventKey(event)}.ics`;
    const url = new URL(filename, calendarId).href;
    try {
      const response = await (await this.connection()).createCalendarObject({ calendar, filename, iCalString: serializeEvent(event) });
      return { ...event, source: 'icloud', calendarProvider: 'icloud', calendarId, externalId: url, etag: response.headers.get('etag') ?? undefined, updatedAt: new Date().toISOString() };
    } catch (error) {
      if (error instanceof CalendarError && error.status === 412) {
        // A prior PUT may have succeeded remotely while its response was lost.
        // Reconcile only our stable UID and unchanged explicit event fields.
        try {
          const objects = await (await this.connection()).fetchCalendarObjects({ calendar, objectUrls: [url], urlFilter: () => true });
          if (objects.length === 1 && typeof objects[0].data === 'string' && objects[0].etag && matchesPublishedEvent(objects[0].data, event)) {
            return { ...event, source: 'icloud', calendarProvider: 'icloud', calendarId, externalId: url, etag: objects[0].etag, updatedAt: new Date().toISOString() };
          }
        } catch (readError) { if (readError instanceof CalendarError) throw readError; }
        throw new CalendarError('An iCloud event already exists at this address with different content. Refresh and resolve the conflict before publishing.');
      }
      if (error instanceof CalendarError) throw error;
      throw new CalendarError('The fixed event could not be published to iCloud.');
    }
  }
  async updateEvent(calendarId: string, event: FixedEvent): Promise<FixedEvent> {
    const url = this.writable(calendarId, event);
    const calendar = await this.selected(calendarId);
    try {
      const client = await this.connection();
      const objects = await client.fetchCalendarObjects({ calendar, objectUrls: [url], urlFilter: () => true });
      if (objects.length !== 1 || typeof objects[0].data !== 'string' || objects[0].etag !== event.etag) throw new CalendarError('The calendar event changed elsewhere. Refresh before trying again.');
      const response = await client.updateCalendarObject({ calendarObject: { url, etag: event.etag, data: serializeEvent(event, objects[0].data) } });
      return { ...event, etag: response.headers.get('etag') ?? undefined, updatedAt: new Date().toISOString() };
    } catch (error) { if (error instanceof CalendarError) throw error; throw new CalendarError('The fixed event could not be updated in iCloud.'); }
  }
  async deleteEvent(calendarId: string, event: FixedEvent): Promise<void> {
    const url = this.writable(calendarId, event);
    const calendar = await this.selected(calendarId);
    try {
      const client = await this.connection();
      const objects = await client.fetchCalendarObjects({ calendar, objectUrls: [url], urlFilter: () => true });
      if (objects.length !== 1 || typeof objects[0].data !== 'string' || objects[0].etag !== event.etag) throw new CalendarError('The calendar event changed elsewhere. Refresh before trying again.');
      // Validate the remote resource too; removing an occurrence suffix must never delete its series.
      serializeEvent(event, objects[0].data);
      await client.deleteCalendarObject({ calendarObject: { url, etag: event.etag } });
    }
    catch (error) { if (error instanceof CalendarError) throw error; throw new CalendarError('The fixed event could not be deleted from iCloud.'); }
  }
}
