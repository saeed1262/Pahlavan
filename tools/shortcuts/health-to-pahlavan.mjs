// Health to Pahlavan: yesterday's steps and floors and the resting heart rate first, then last night's sleep.
//
// Run each morning by an automation. Fill Missing keeps the first three from ever being empty (a 0 is
// left out); sleep comes last and alone, because with no watch overnight Health has none and the step
// stops the shortcut.

import { action, dictField, Flow, HAS, HAS_NOT, out, ref, REPEAT_ITEM, runShortcut, text, variable as V } from './shortcut.mjs';

const DAY = 16; // NSCalendarUnitDay, for the date filters

/** The actions. `repoUrl` is the inbox folder's GitHub contents URL, ending in /. */
export function build(repoUrl) {
  const REPO = repoUrl;
  const f = new Flow();

  /** Start Date is between two date variables. */
  const between = (a, b) => ({ Bounded: true, Operator: 1003, Property: 'Start Date', Removable: true,
    Values: { Date: ref(V(a)), AnotherDate: ref(V(b)), Unit: DAY } });
  /** Start Date is in the last `n` days, as the phone writes it. */
  const lastDays = (n) => ({ Operator: 1001, Property: 'Start Date', Removable: true, Values: { Number: String(n), Unit: DAY } });

  const find = (kind, date, unit, { group = true, limit = null } = {}) => {
    const p = {
      WFContentItemFilter: {
        Value: {
          WFActionParameterFilterPrefix: 1, WFContentPredicateBoundedDate: false,
          WFActionParameterFilterTemplates: [
            { Bounded: true, Operator: 4, Property: 'Type', Removable: false,
              Values: { Enumeration: { Value: kind, WFSerializationType: 'WFStringSubstitutableState' } } },
            date],
        },
        WFSerializationType: 'WFContentPredicateTableTemplate',
      },
      WFContentItemSortProperty: 'Start Date', WFContentItemSortOrder: 'Oldest First',
      WFContentItemLimitEnabled: limit !== null,
    };
    if (unit) p.WFHKSampleFilteringUnit = unit;
    if (limit !== null) p.WFContentItemLimitNumber = limit;
    if (group) Object.assign(p, { WFHKSampleFilteringGroupBy: 'Day', WFHKSampleFilteringFillMissing: true });
    return f.add(action('filter.health.quantity', p));
  };

  /** The sample's value as digits: rounded to a whole number, separators taken out. */
  const whole = (att) => {
    const val = f.add(action('properties.health.quantity', { WFContentItemPropertyName: 'Value', WFInput: ref(att) }));
    const rnd = f.add(action('round', { WFRoundMode: 'Normal', WFRoundTo: 'Ones Place', WFInput: ref(out(val, 'Value')) }));
    const dig = f.add(action('text.replace', { WFReplaceTextRegularExpression: true, WFInput: text(out(rnd, 'Rounded Number')),
      WFReplaceTextFind: '[^0-9]', WFReplaceTextReplace: '' }));
    return out(dig, 'Updated Text');
  };

  const send = (entryVar, what) => {
    const NUM = 'sleepH|rhr|steps|floors';
    const r1 = f.add(action('text.replace', { WFReplaceTextRegularExpression: true, WFInput: text(V(entryVar)),
      WFReplaceTextFind: String.raw`"(${NUM})"\s*:\s*"(-?\d+)[.,](\d+)"`, WFReplaceTextReplace: '"$1":$2.$3' }));
    const r2 = f.add(action('text.replace', { WFReplaceTextRegularExpression: true, WFInput: text(out(r1, 'Updated Text')),
      WFReplaceTextFind: String.raw`"(${NUM})"\s*:\s*"(-?\d+)"`, WFReplaceTextReplace: '"$1":$2' }));
    const b64 = f.add(action('base64encode', { WFEncodeMode: 'Encode', WFBase64LineBreakMode: 'None', WFInput: ref(out(r2, 'Updated Text')) }));
    const stamp = f.add(action('date', { WFDateActionMode: 'Current Date' }));
    const st = f.add(action('format.date', { WFDateFormatStyle: 'Custom', WFDateFormat: "yyyy-MM-dd'T'HH-mm-ss", WFDate: text(out(stamp, 'Date')) }));
    const put = f.add(action('downloadurl', { WFURL: text(REPO, out(st, 'Formatted Date'), '-morning.json'), WFHTTPMethod: 'PUT', ShowHeaders: true,
      WFHTTPHeaders: dictField([['Authorization', text('Bearer ', V('Token'))], ['Accept', text('application/vnd.github+json')],
        ['X-GitHub-Api-Version', text('2022-11-28')]]),
      WFHTTPBodyType: 'JSON', WFJSONValues: dictField([['message', text('Phone: Health (', what, ') for ', V('TodayText'))],
        ['content', text(out(b64, 'Base64 Encoded'))]]) }));
    const cm = f.value('commit', out(put, 'Contents of URL'));
    f.if(HAS, out(cm, 'Dictionary Value'));
    f.notify('Sent to Pahlavan', ['Health, ', what, ': ', V(entryVar)]);
    f.otherwise();
    const s = f.value('status', out(put, 'Contents of URL')); const m = f.value('message', out(put, 'Contents of URL'));
    f.notify(['Not sent (HTTP ', out(s, 'Dictionary Value'), ')'], ['GitHub said: ', out(m, 'Dictionary Value')]);
    f.end();
  };

  const tok = f.add(runShortcut('Pahlavan Token')); f.set('Token', out(tok, 'Shortcut Result'));
  const now = f.add(action('date', { WFDateActionMode: 'Current Date' })); f.set('Now', out(now, 'Date'));
  f.fmtDate(V('Now'), "yyyy-MM-dd'T'HH:mm:ssxxx", 'At');
  f.fmtDate(V('Now'), 'yyyy-MM-dd', 'TodayText');
  const sod = f.add(action('adjustdate', { WFAdjustOperation: 'Get Start of Day', WFDate: text(V('Now')) })); f.set('TodayStart', out(sod, 'Adjusted Date'));
  const yd = f.add(action('adjustdate', { WFAdjustOperation: 'Subtract', WFDate: text(V('TodayStart')),
    WFDuration: { Value: { Unit: 'days', Magnitude: '1' }, WFSerializationType: 'WFQuantityFieldValue' } }));
  f.set('YdayStart', out(yd, 'Adjusted Date'));
  const sf = f.add(action('adjustdate', { WFAdjustOperation: 'Add', WFDate: text(V('YdayStart')),
    WFDuration: { Value: { Unit: 'hr', Magnitude: '18' }, WFSerializationType: 'WFQuantityFieldValue' } }));
  f.set('SleepFrom', out(sf, 'Adjusted Date'));

  // 1. Yesterday's steps and floors: one day group each (Fill Missing gives 0 on a day with none; a 0 is left out)
  for (const [kind, name] of [['Steps', 'steps'], ['Flights Climbed', 'floors']]) {
    // No Limit: Shortcuts limits the raw samples before grouping. Fill Missing adds an empty bucket for today, so take the first (yesterday's).
    const found = find(kind, between('YdayStart', 'TodayStart'), 'count');
    const first = f.add(action('getitemfromlist', { WFItemSpecifier: 'First Item', WFInput: ref(out(found, 'Health Samples')) }));
    const n = whole(out(first, 'Item from List'));
    f.ifNotMatch(n, '^0$'); const p = f.text('"', name, '":"', n, '"'); f.append('Parts', out(p, 'Text')); f.end();
  }

  // 2. Resting heart rate: yesterday's and today's day groups; the latest that isn't 0 wins
  const rhr = find('Resting Heart Rate', between('YdayStart', 'Now'), 'count/min');
  f.repeat(out(rhr, 'Health Samples'));
  const n = whole(REPEAT_ITEM);
  f.ifNotMatch(n, '^0$'); f.set('RHR', n); f.end();
  f.end();
  f.if(HAS, V('RHR')); const p = f.text('"rhr":"', V('RHR'), '"'); f.append('Parts', out(p, 'Text')); f.end();

  // 3. Send those (nothing to send: say so and carry on to sleep)
  f.if(HAS, V('Parts'));
  const pc = f.add(action('text.combine', { text: ref(V('Parts')), WFTextSeparator: 'Custom', WFTextCustomSeparator: ',' }));
  f.textAs('Entry', '{"v":1,"at":"', V('At'), '","date":"', V('TodayText'), '","kind":"morning","morning":{', out(pc, 'Combined Text'), '}}');
  send('Entry', 'steps, floors, heart rate');
  f.otherwise();
  f.notify('Health to Pahlavan', 'No steps, floors or resting heart rate in Health yet.');
  f.end();

  // 4. Sleep, last and on its own: with no watch overnight, Health has none and the shortcut stops here.
  // A sleep step finds nothing with "is between" two dates (or with no date filter), only with "is in the last",
  // so it takes the last day and skips any stretch that started before 18:00 yesterday (the night before's end).
  const slp = find('Sleep', lastDays(1), null, { group: false });
  f.repeat(out(slp, 'Health Samples'));
  const kindv = f.add(action('properties.health.quantity', { WFContentItemPropertyName: 'Value', WFInput: ref(REPEAT_ITEM) }));
  const s0 = f.add(action('properties.health.quantity', { WFContentItemPropertyName: 'Start Date', WFInput: ref(REPEAT_ITEM) }));
  const gap = f.add(action('gettimebetweendates', { WFTimeUntilUnit: 'Minutes', WFInput: text(out(s0, 'Start Date')), WFTimeUntilFromDate: text(V('SleepFrom')) }));
  const m = f.add(action('text.match', { text: text(out(kindv, 'Value')), WFMatchTextPattern: text('bed|awake'), WFMatchTextCaseSensitive: false }));
  f.if(HAS_NOT, out(m, 'Matches'));
  f.ifNotMatch(out(gap, 'Time Between Dates'), '^\\s*[-−]');
  const s1 = f.add(action('properties.health.quantity', { WFContentItemPropertyName: 'End Date', WFInput: ref(REPEAT_ITEM) }));
  // Seconds, not minutes: whole minutes per stretch lose a few minutes over a night
  const secs = f.add(action('gettimebetweendates', { WFTimeUntilUnit: 'Seconds', WFInput: text(out(s1, 'End Date')), WFTimeUntilFromDate: text(out(s0, 'Start Date')) }));
  f.append('SleepSeconds', out(secs, 'Time Between Dates'));
  f.end();
  f.end();
  f.end();
  f.if(HAS, V('SleepSeconds'));
  const tot = f.add(action('statistics', { WFStatisticsOperation: 'Sum', Input: ref(V('SleepSeconds')) }));
  const hrs = f.add(action('math', { WFMathOperation: '÷', WFMathOperand: 3600, WFInput: ref(out(tot, 'Statistics Result')) }));
  const rh = f.add(action('round', { WFRoundMode: 'Normal', WFRoundTo: 'Tenths', WFInput: ref(out(hrs, 'Calculation Result')) }));
  f.textAs('SleepEntry', '{"v":1,"at":"', V('At'), '","date":"', V('TodayText'), '","kind":"morning","morning":{"sleepH":"', out(rh, 'Rounded Number'), '"}}');
  send('SleepEntry', 'sleep');
  f.otherwise();
  f.notify('Health to Pahlavan', 'No sleep found in Health since 18:00 yesterday (In Bed and Awake don’t count).');
  f.end();

  return f.done();
}
