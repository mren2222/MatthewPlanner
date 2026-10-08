import { describe, expect, it, vi } from 'vitest';
import ICAL from 'ical.js';
import { assertFixedEvent, ICloudCalendarProvider, parseEvents, secureICloudFetch, serializeEvent } from '../src/calendar';
import type { FixedEvent } from '../src/core/types';

const calendarId = 'https://p01-caldav.icloud.com/account/calendars/work/';
const objectUrl = `${calendarId}event-without-extension`;
const fixed = (): FixedEvent => ({ id: 'local-one', title: 'Meet, plan; back\\slash\nsecond line', startAt: '2026-10-07T10:00:00-07:00', endAt: '2026-10-07T11:30:00-07:00', timezone: 'America/Los_Angeles', source: 'local', location: 'Desk, home', notes: 'Line one\nLine two', createdAt: '2026-10-07T00:00:00Z', updatedAt: '2026-10-07T00:00:00Z' });
const ics = (properties: string) => `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:test-uid\r\nSUMMARY:Appointment\r\n${properties}\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n`;
const simple = ics('DTSTART:20261007T170000Z\r\nDTEND:20261007T180000Z');
const now = new Date('2026-10-07T00:00:00Z');
const xml = (href: string, props: string, status = '200 OK') => `<d:response><d:href>${href}</d:href><d:propstat><d:prop>${props}</d:prop><d:status>HTTP/1.1 ${status}</d:status></d:propstat></d:response>`;
const multi = (contents: string) => new Response(`<?xml version="1.0"?><d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">${contents}</d:multistatus>`, { status: 207, headers: { 'content-type': 'application/xml' } });

function mockedProvider(report?: () => Response) {
  const transport = vi.fn<typeof fetch>(async (input, init) => {
    const url = String(input);
    const body = String(init?.body ?? '');
    if (url.includes('.well-known')) return new Response(null, { status: 301, headers: { location: 'https://p01-caldav.icloud.com/' } });
    if (body.includes('current-user-principal')) return multi(xml('/', '<d:current-user-principal><d:href>/account/principal/</d:href></d:current-user-principal>'));
    if (body.includes('calendar-home-set')) return multi(xml('/account/principal/', '<c:calendar-home-set><d:href>/account/calendars/</d:href></c:calendar-home-set>'));
    if (body.includes('supported-report-set')) return multi(xml(new URL(calendarId).pathname, '<d:supported-report-set/>'));
    if (init?.method === 'PROPFIND') return multi(xml(new URL(calendarId).pathname, '<d:resourcetype><d:collection/><c:calendar/></d:resourcetype><d:displayname>Work</d:displayname><c:supported-calendar-component-set><c:comp name="VEVENT"/></c:supported-calendar-component-set>'));
    if (init?.method === 'REPORT') return report?.() ?? multi(xml(new URL(objectUrl).pathname, `<d:getetag>"version1"</d:getetag><c:calendar-data><![CDATA[${simple}]]></c:calendar-data>`));
    if (init?.method === 'PUT') return new Response(null, { status: 201, headers: { etag: '"version2"' } });
    if (init?.method === 'DELETE') return new Response(null, { status: 204 });
    throw new Error('Unexpected mock request');
  });
  return { provider: new ICloudCalendarProvider({ username: 'example-user', password: 'test-only-placeholder', timezone: 'America/Los_Angeles', fetch: transport }), transport };
}

describe('fixed-event calendar boundary', () => {
  it('ignores collection metadata alongside real REPORT event resources', async () => {
    const collection = `<d:response><d:href>${new URL(calendarId).pathname}</d:href><d:propstat><d:prop><d:getetag>"collection"</d:getetag></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat><d:propstat><d:prop><c:calendar-data/></d:prop><d:status>HTTP/1.1 404 Not Found</d:status></d:propstat></d:response>`;
    const { provider, transport } = mockedProvider(() => multi(collection + xml(new URL(objectUrl).pathname, `<d:getetag>"1"</d:getetag><c:calendar-data><![CDATA[${simple}]]></c:calendar-data>`)));
    const events = await provider.listEvents(calendarId);
    expect(events).toHaveLength(1);
    expect(events[0].externalId).toBe(objectUrl);
    expect(transport.mock.calls.some(([url, init]) => String(url) === calendarId && init?.method === 'GET')).toBe(false);
  });
  it('accepts an empty calendar REPORT containing only collection metadata', async () => {
    const { provider } = mockedProvider(() => multi(xml(new URL(calendarId).pathname, '<d:getetag>"collection"</d:getetag>')));
    await expect(provider.listEvents(calendarId)).resolves.toEqual([]);
  });
  it('rejects event data incorrectly attached to the collection URL', async () => {
    const { provider } = mockedProvider(() => multi(xml(new URL(calendarId).pathname, `<c:calendar-data><![CDATA[${simple}]]></c:calendar-data>`)));
    await expect(provider.listEvents(calendarId)).rejects.toThrow('invalid event resource');
  });
  it('does not ignore an actual resource missing calendar-data', async () => {
    const { provider, transport } = mockedProvider(() => multi(xml(new URL(objectUrl).pathname, '<d:getetag>"1"</d:getetag>')));
    const original = transport.getMockImplementation()!;
    transport.mockImplementation(async (input, init) => init?.method === 'GET' ? new Response(null, { status: 404 }) : original(input, init));
    await expect(provider.listEvents(calendarId)).rejects.toThrow('HTTP 404');
  });
  it('reads valid data despite unavailable optional properties and a missing ETag', async () => {
    const href = new URL(objectUrl).pathname;
    const { provider } = mockedProvider(() => multi(`<d:response><d:href>${href}</d:href><d:propstat><d:prop><c:calendar-data><![CDATA[${simple}]]></c:calendar-data></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat><d:propstat><d:prop><d:displayname/></d:prop><d:status>HTTP/1.1 404 Not Found</d:status></d:propstat></d:response>`));
    const [event] = await provider.listEvents(calendarId);
    expect(event.title).toBe('Appointment'); expect(event.etag).toBe('');
    await expect(provider.updateEvent(calendarId,event)).rejects.toThrow('Refresh');
  });
  it('recovers missing REPORT data with an authenticated object GET', async () => {
    const { provider,transport } = mockedProvider(() => multi(xml(new URL(objectUrl).pathname,'<d:getetag>"1"</d:getetag>')));
    const original=transport.getMockImplementation()!;
    transport.mockImplementation(async(input,init)=>init?.method==='GET'?new Response(simple,{status:200,headers:{etag:'"recovered"'}}):original(input,init));
    const [event]=await provider.listEvents(calendarId);expect(event.etag).toBe('"recovered"');
    expect(transport.mock.calls.some(([url,init])=>String(url)===objectUrl&&init?.method==='GET')).toBe(true);
  });
  it('rejects Tasks and task/event hybrids before any network call', async () => {
    const { provider, transport } = mockedProvider();
    const task = { id: 'task', title: 'Read', status: 'planned', plannedDate: '2026-10-07', estimatedDurationMinutes: 60 };
    for (const value of [task, { ...fixed(), ...task }, { ...fixed(), startAt: undefined }, { ...fixed(), endAt: fixed().startAt }]) {
      expect(() => assertFixedEvent(value)).toThrow();
      await expect(provider.createEvent(calendarId, value as FixedEvent)).rejects.toThrow();
    }
    expect(transport).toHaveBeenCalledTimes(0);
  });
  it('serializes escaped text and explicit UTC instants without adding task data', () => {
    const result = serializeEvent(fixed());
    const event = new ICAL.Event(new ICAL.Component(ICAL.parse(result)).getFirstSubcomponent('vevent')!);
    expect(event.summary).toBe(fixed().title);
    expect(event.description).toBe(fixed().notes);
    expect(event.startDate.toJSDate().toISOString()).toBe('2026-10-07T17:00:00.000Z');
    expect(result).toContain('DTEND:20261007T183000Z');
    expect(result.includes('VTODO')).toBe(false);
  });
  it('converts all-day and floating times using the configured timezone', () => {
    const [allDay] = parseEvents(ics('DTSTART;VALUE=DATE:20261101\r\nDTEND;VALUE=DATE:20261102'), objectUrl, '"1"', calendarId, 'America/Los_Angeles', now);
    expect(allDay.startAt).toBe('2026-11-01T07:00:00.000Z');
    expect(allDay.endAt).toBe('2026-11-02T08:00:00.000Z');
    expect(allDay.allDay).toBe(true);
    expect(serializeEvent(allDay)).toContain('DTSTART;VALUE=DATE:20261101');
    const [floating] = parseEvents(ics('DTSTART:20261007T090000\r\nDTEND:20261007T100000'), objectUrl, '"1"', calendarId, 'America/Los_Angeles', now);
    expect(floating.startAt).toBe('2026-10-07T16:00:00.000Z');
  });
  it('uses embedded VTIMEZONE for TZID times', () => {
    const data = `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VTIMEZONE\r\nTZID:CustomZone\r\nBEGIN:STANDARD\r\nDTSTART:19700101T000000\r\nTZOFFSETFROM:+0200\r\nTZOFFSETTO:+0200\r\nEND:STANDARD\r\nEND:VTIMEZONE\r\nBEGIN:VEVENT\r\nUID:custom\r\nDTSTART;TZID=CustomZone:20261007T090000\r\nDTEND;TZID=CustomZone:20261007T100000\r\nEND:VEVENT\r\nEND:VCALENDAR`;
    expect(parseEvents(data, objectUrl, '"1"', calendarId, 'UTC', now)[0].startAt).toBe('2026-10-07T07:00:00.000Z');
  });
  it('rejects invalid dates and nonexistent DST times instead of normalizing them', () => {
    expect(() => assertFixedEvent({ ...fixed(), startAt: '2026-02-30T10:00:00Z', endAt: '2026-03-03T10:00:00Z' })).toThrow('Invalid fixed event date');
    expect(() => parseEvents(ics('DTSTART:20260230T170000Z\r\nDTEND:20260303T180000Z'), objectUrl, '"1"', calendarId, 'UTC', now)).toThrow();
    expect(() => parseEvents(ics('DTSTART:20260308T023000\r\nDTEND:20260308T033000'), objectUrl, '"1"', calendarId, 'America/Los_Angeles', now)).toThrow('local calendar time');
  });
  it('expands RRULE, EXDATE and overridden instances with stable occurrence IDs', () => {
    const data = ics('DTSTART:20261006T170000Z\r\nDTEND:20261006T180000Z\r\nRRULE:FREQ=DAILY;COUNT=4\r\nEXDATE:20261007T170000Z').replace('END:VCALENDAR', 'BEGIN:VEVENT\r\nUID:test-uid\r\nRECURRENCE-ID:20261008T170000Z\r\nDTSTART:20261008T190000Z\r\nDTEND:20261008T200000Z\r\nSUMMARY:Moved\r\nEND:VEVENT\r\nEND:VCALENDAR');
    const events = parseEvents(data, objectUrl, '"1"', calendarId, 'UTC', now);
    expect(events).toHaveLength(3);
    expect(events.find(event => event.title === 'Moved')?.startAt).toBe('2026-10-08T19:00:00.000Z');
    expect(events.every(event => event.externalId?.includes('#'))).toBe(true);
    expect(parseEvents(data, objectUrl, '"2"', calendarId, 'UTC', now).map(event => event.id)).toEqual(events.map(event => event.id));
  });
  it('includes an override moved into the horizon from an anchor beyond it', () => {
    const data = ics('DTSTART:20260101T170000Z\r\nDTEND:20260101T180000Z\r\nRRULE:FREQ=MONTHLY;COUNT=15').replace('END:VCALENDAR', 'BEGIN:VEVENT\r\nUID:test-uid\r\nRECURRENCE-ID:20270201T170000Z\r\nDTSTART:20261007T190000Z\r\nDTEND:20261007T200000Z\r\nSUMMARY:Moved far\r\nEND:VEVENT\r\nEND:VCALENDAR');
    const events = parseEvents(data, objectUrl, '"1"', calendarId, 'UTC', now);
    expect(events.filter(event => event.title === 'Moved far')).toHaveLength(1);
  });
});

describe('iCloud discovery, snapshots and writes', () => {
  it('discovers calendar collections and fetches all events regardless of filename or date', async () => {
    const { provider, transport } = mockedProvider();
    expect(await provider.listCalendars()).toEqual([{ id: calendarId, name: 'Work' }]);
    const events = await provider.listEvents(calendarId);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ source: 'icloud', externalId: objectUrl, etag: '"version1"', calendarProvider: 'icloud' });
    const report = transport.mock.calls.find(([, init]) => init?.method === 'REPORT');
    expect(String(report?.[1]?.body).includes('time-range')).toBe(false);
    expect(transport.mock.calls.every(([url]) => new URL(String(url)).hostname.endsWith('.icloud.com'))).toBe(true);
  });
  it('fails a complete refresh when any server object cannot be parsed', async () => {
    const { provider } = mockedProvider(() => multi(xml(new URL(objectUrl).pathname, '<d:getetag>"1"</d:getetag><c:calendar-data>broken</c:calendar-data>')));
    await expect(provider.listEvents(calendarId)).rejects.toThrow('Previous imported events were kept');
  });
  it('returns an empty snapshot for a valid empty collection', async () => {
    const { provider } = mockedProvider(() => multi(''));
    expect(await provider.listEvents(calendarId)).toEqual([]);
  });
  it('fails missing calendar-data and failed property statuses instead of returning an empty snapshot', async () => {
    for (const response of [multi(xml(new URL(objectUrl).pathname, '<d:getetag>"1"</d:getetag>')), multi(xml(new URL(objectUrl).pathname, '<c:calendar-data/>', '404 Not Found')), new Response('malformed', { status: 207 })]) {
      const { provider } = mockedProvider(() => response);
      await expect(provider.listEvents(calendarId)).rejects.toThrow();
    }
  });
  it('publishes only explicit local fixed events with If-None-Match and returned metadata', async () => {
    const { provider, transport } = mockedProvider();
    const published = await provider.createEvent(calendarId, fixed());
    expect(published).toMatchObject({ id: 'local-one', source: 'icloud', calendarId, etag: '"version2"' });
    expect(published.externalId).toMatch(/\.ics$/);
    const put = transport.mock.calls.find(([, init]) => init?.method === 'PUT');
    expect(new Headers(put?.[1]?.headers).get('if-none-match')).toBe('*');
  });
  it('reconciles a retry after the server saved a PUT but the response was lost', async () => {
    const baseline = mockedProvider();
    let saved: { url: string; data: string } | undefined;
    const transport = vi.fn<typeof fetch>(async (input, init) => {
      if (init?.method === 'PUT') {
        if (saved) return new Response(null, { status: 412 });
        saved = { url: String(input), data: String(init.body) };
        throw new Error('Simulated connection loss after remote save');
      }
      if (init?.method === 'REPORT' && saved) return multi(xml(new URL(saved.url).pathname, `<d:getetag>"saved"</d:getetag><c:calendar-data><![CDATA[${saved.data}]]></c:calendar-data>`));
      return baseline.transport(input, init);
    });
    const provider = new ICloudCalendarProvider({ username: 'test-user', password: 'test-only-placeholder', fetch: transport });
    await expect(provider.createEvent(calendarId, fixed())).rejects.toThrow('Could not connect');
    const result = await provider.createEvent(calendarId, fixed());
    expect(result).toMatchObject({ id: fixed().id, source: 'icloud', etag: '"saved"', externalId: saved!.url });
    const puts = transport.mock.calls.filter(([, init]) => init?.method === 'PUT');
    expect(puts.map(([url]) => String(url))).toEqual([saved!.url, saved!.url]);
    const uids = puts.map(([, init]) => new ICAL.Event(new ICAL.Component(ICAL.parse(String(init?.body))).getFirstSubcomponent('vevent')!).uid);
    expect(uids[0]).toBe(uids[1]);
    await expect(provider.createEvent(calendarId, { ...fixed(), title: 'Changed after publish' })).rejects.toThrow('different content');
  });
  it('uses If-Match for updates and deletes and rejects recurring writes', async () => {
    const { provider, transport } = mockedProvider();
    const [event] = await provider.listEvents(calendarId);
    await provider.updateEvent(calendarId, { ...event, title: 'Updated' });
    await provider.deleteEvent(calendarId, event);
    for (const [, init] of transport.mock.calls.filter(([, init]) => ['PUT', 'DELETE'].includes(init?.method ?? ''))) expect(new Headers(init?.headers).get('if-match')).toBe('"version1"');
    await expect(provider.deleteEvent(calendarId, { ...event, externalId: `${objectUrl}#instance` })).rejects.toThrow('recurring');
  });
  it('refuses arbitrary calendars and mismatched event resource addresses', async () => {
    const { provider } = mockedProvider();
    await expect(provider.listEvents('https://attacker.example/calendar/')).rejects.toThrow('secure iCloud');
    const [event] = await provider.listEvents(calendarId);
    await expect(provider.deleteEvent(calendarId, { ...event, externalId: 'https://p01-caldav.icloud.com/another-account/x' })).rejects.toThrow();
  });
  it('checks the live ETag and rejects a forged recurring-series delete', async () => {
    const recurring = ics('DTSTART:20261007T170000Z\r\nDTEND:20261007T180000Z\r\nRRULE:FREQ=DAILY;COUNT=2');
    const { provider, transport } = mockedProvider(() => multi(xml(new URL(objectUrl).pathname, `<d:getetag>"version1"</d:getetag><c:calendar-data><![CDATA[${recurring}]]></c:calendar-data>`)));
    const imported = { ...fixed(), source: 'icloud' as const, calendarId, calendarProvider: 'icloud', externalId: objectUrl, etag: '"version1"' };
    await expect(provider.deleteEvent(calendarId, imported)).rejects.toThrow('recurring');
    await expect(provider.updateEvent(calendarId, { ...imported, etag: '"old"' })).rejects.toThrow('changed elsewhere');
    expect(transport.mock.calls.filter(([, init]) => ['PUT', 'DELETE'].includes(init?.method ?? ''))).toHaveLength(0);
  });
});

describe('secure transport', () => {
  it('allows Apple mainland-China discovery redirects and calendar collections over HTTPS', async () => {
    const baseline = mockedProvider();
    const chinaCalendar = calendarId.replace('.icloud.com', '.icloud.com.cn');
    const transport = vi.fn<typeof fetch>(async (input, init) => {
      const response = await baseline.transport(input, init);
      if (String(input).includes('.well-known')) return new Response(null, { status: 301, headers: { location: 'https://p01-caldav.icloud.com.cn/' } });
      return response;
    });
    const provider = new ICloudCalendarProvider({ username: 'example-user', password: 'test-only-placeholder', fetch: transport });
    expect(await provider.listCalendars()).toEqual([{ id: chinaCalendar, name: 'Work' }]);
    expect(await provider.listEvents(chinaCalendar)).toHaveLength(1);
    expect(transport.mock.calls.some(([input]) => new URL(String(input)).hostname === 'p01-caldav.icloud.com.cn')).toBe(true);
  });
  it('keeps rejected-address diagnostics free of credentials, account paths and query values', async () => {
    const transport = vi.fn<typeof fetch>();
    const result = secureICloudFetch(transport)('https://private-user:private-password@attacker.example/private-account?token=private-token');
    await expect(result).rejects.toThrow('Blocked https://attacker.example.');
    expect(transport).toHaveBeenCalledTimes(0);
  });
  it('accepts a China calendar home discovered from the global entry point', async () => {
    const baseline = mockedProvider();
    const chinaCalendar = calendarId.replace('.icloud.com', '.icloud.com.cn');
    const transport: typeof fetch = async (input, init) => {
      const body = String(init?.body ?? '');
      if (body.includes('calendar-home-set')) return multi(xml('/account/principal/', '<c:calendar-home-set><d:href>https://p01-caldav.icloud.com.cn/account/calendars/</d:href></c:calendar-home-set>'));
      if (init?.method === 'PROPFIND' && !body.includes('current-user-principal') && !body.includes('supported-report-set') && !String(input).includes('.well-known')) {
        return multi(xml(chinaCalendar, '<d:resourcetype><d:collection/><c:calendar/></d:resourcetype><d:displayname>Work</d:displayname>'));
      }
      return baseline.transport(input, init);
    };
    const provider = new ICloudCalendarProvider({ username: 'example-user', password: 'test-only-placeholder', fetch: transport });
    expect(await provider.listCalendars()).toEqual([{ id: chinaCalendar, name: 'Work' }]);
    expect(await provider.listEvents(chinaCalendar)).toHaveLength(1);
  });
  it('blocks insecure and non-iCloud redirects before credentials leave the allowed hosts', async () => {
    for (const target of ['http://caldav.icloud.com/', 'http://caldav.icloud.com.cn/', 'https://icloud.com.attacker.example/', 'https://icloud.com.cn.attacker.example/', 'https://attackericloud.com.cn/', 'https://attacker.example/', 'https://user:pass@caldav.icloud.com/', 'https://p01-caldav.icloud.com.cn:8443/']) {
      const fetchMock = vi.fn<typeof fetch>(async () => new Response(null, { status: 302, headers: { location: target } }));
      await expect(secureICloudFetch(fetchMock)('https://caldav.icloud.com/', { headers: { authorization: 'Basic placeholder' } })).rejects.toThrow('secure iCloud');
      expect(fetchMock).toHaveBeenCalledTimes(1);
    }
  });
  it('redacts underlying transport errors and provides actionable authentication/conflict messages', async () => {
    const transport = vi.fn<typeof fetch>(async () => { throw new Error('secret-error-do-not-display'); });
    await expect(secureICloudFetch(transport)('https://caldav.icloud.com/')).rejects.toThrow('Could not connect');
    for (const [status, message] of [[401, 'sign-in failed'], [403, 'denied'], [412, 'changed elsewhere']] as const) {
      await expect(secureICloudFetch(async () => new Response(null, { status }))('https://caldav.icloud.com/')).rejects.toThrow(message);
    }
  });
  it('aborts timed-out requests', async () => {
    const transport: typeof fetch = async (_input, init) => new Promise((_resolve, reject) => init?.signal?.addEventListener('abort', () => reject(new Error('abort')), { once: true }));
    await expect(secureICloudFetch(transport, 5)('https://caldav.icloud.com/')).rejects.toThrow('timed out');
  });
  it('keeps GET response-body consumption within the same timeout', async () => {
    const transport: typeof fetch = async (_input, init) => new Response(new ReadableStream({
      start(controller) { init?.signal?.addEventListener('abort', () => controller.error(new Error('body aborted')), { once: true }); },
    }));
    await expect(secureICloudFetch(transport, 5)('https://caldav.icloud.com/event.ics', { method: 'GET' })).rejects.toThrow('timed out');
  });
});
