// Pahlavan: one menu for water, habit ticks, a session, the evening answer and the morning check-in.
//
// It reads Pahlavan's list for the phone (`phone.json`), asks only what is still open, and sends one
// inbox entry itself. It depends only on the user's own Pahlavan Token shortcut.

import { action, dictField, Flow, HAS, HAS_NOT, out, ref, REPEAT_ITEM, runShortcut, text, variable as V } from './shortcut.mjs';

/** The actions. `repoUrl` is the inbox folder's GitHub contents URL, ending in /. */
export function build(repoUrl) {
  const REPO = repoUrl;
  const f = new Flow();

  // 1. The token (from your own Pahlavan Token shortcut) and Pahlavan's list for the phone
  const tok = f.add(runShortcut('Pahlavan Token')); f.set('Token', out(tok, 'Shortcut Result'));
  const headers = (accept) => dictField([['Authorization', text('Bearer ', V('Token'))], ['Accept', text(accept)],
    ['X-GitHub-Api-Version', text('2022-11-28')]]);
  const get = f.add(action('downloadurl', { WFURL: text(REPO + 'phone.json'), WFHTTPMethod: 'GET', ShowHeaders: true,
    WFHTTPHeaders: headers('application/vnd.github.raw+json') }));
  const parse = f.add(action('detect.dictionary', { WFInput: ref(out(get, 'Contents of URL')) })); f.set('Phone', out(parse, 'Dictionary'));
  const st = f.value('status', V('Phone'));
  f.if(HAS, out(st, 'Dictionary Value'));
  f.notify('Pahlavan', ["Couldn't read Pahlavan's list (HTTP ", out(st, 'Dictionary Value'), '). See Troubleshooting in Phone shortcuts.']);
  f.stop(); f.end();

  // 2. The times, and the training day (after midnight until 04:00 it may be yesterday)
  const now = f.add(action('date', { WFDateActionMode: 'Current Date' })); f.set('Now', out(now, 'Date'));
  f.fmtDate(V('Now'), "yyyy-MM-dd'T'HH:mm:ssxxx", 'At');
  f.fmtDate(V('Now'), "yyyy-MM-dd'T'HH-mm-ss", 'Stamp');
  f.fmtDate(V('Now'), 'yyyy-MM-dd', 'TodayText');
  f.fmtDate(V('Now'), 'H', 'Hour');
  f.set('Day', V('TodayText'));
  f.ifMatch(V('Hour'), '^[0-3]$');
  const adj = f.add(action('adjustdate', { WFAdjustOperation: 'Subtract', WFDate: text(V('Now')),
    WFDuration: { Value: { Unit: 'days', Magnitude: '1' }, WFSerializationType: 'WFQuantityFieldValue' } }));
  f.set('Yesterday', out(adj, 'Adjusted Date'));
  f.fmtDate(V('Yesterday'), 'yyyy-MM-dd', 'YesterdayText');
  f.fmtDate(V('Yesterday'), 'EEEE', 'Weekday');
  f.menu(text("It's after midnight. Does this count for ", V('Weekday'), ' (yesterday)?'), ['Yes, yesterday', 'No, today']);
  f.item('Yes, yesterday'); f.set('Day', V('YesterdayText'));
  f.item('No, today');
  f.end(); f.end();
  f.value('date', V('Phone'), 'PhoneDate');
  f.ifNotMatch(V('PhoneDate'), '^', V('TodayText'), '$');
  f.notify('Pahlavan', ["Pahlavan's list is from ", V('PhoneDate'), ": the Mac hasn't sent today's yet."]);
  f.end();

  // 3. The menu
  f.menu('Pahlavan', ['Water', 'Tick habits', 'Log a session', 'Did you train?', 'Morning check-in']);

  // --- Water
  f.item('Water');
  const items = f.value('items', V('Phone'));
  f.repeat(out(items, 'Dictionary Value'));
  const k = f.value('kind', REPEAT_ITEM);
  f.ifMatch(out(k, 'Dictionary Value'), '^amount$'); f.set('Water', REPEAT_ITEM); f.end();
  f.end();
  f.if(HAS_NOT, V('Water')); f.notify('Pahlavan', 'Pahlavan tracks no water.'); f.stop(); f.end();
  f.value('id', V('Water'), 'WaterId'); f.value('value', V('Water'), 'SoFar');
  f.value('target', V('Water'), 'Target'); f.value('unit', V('Water'), 'Unit');
  f.menu(text('Water: ', V('SoFar'), ' of ', V('Target'), ' ', V('Unit'), ' so far'), ['+250', '+500', 'Another amount']);
  f.item('+250'); f.textAs('Amount', '250');
  f.item('+500'); f.textAs('Amount', '500');
  f.item('Another amount'); f.askNumber(['How much, in ', V('Unit'), '? (minus takes some off)'], 'Amount', { negatives: true });
  f.end();
  f.textAs('Entry', '{"v":1,"at":"', V('At'), '","date":"', V('Day'), '","kind":"amount","id":"', V('WaterId'), '","add":"', V('Amount'), '"}');
  f.textAs('Kind', 'amount');

  // --- Tick habits
  f.item('Tick habits');
  const op = f.value('open', V('Phone'));
  const comb = f.add(action('text.combine', { text: ref(out(op, 'Dictionary Value')), WFTextSeparator: 'Custom', WFTextCustomSeparator: ',' }));
  f.textAs('OpenText', ',', out(comb, 'Combined Text'), ',');
  f.ifNotMatch(V('PhoneDate'), '^', V('TodayText'), '$'); f.textAs('OpenText', 'stale'); f.end();
  const empty = f.add(action('dictionary')); f.set('Names', out(empty, 'Dictionary'));
  const items2 = f.value('items', V('Phone'));
  f.repeat(out(items2, 'Dictionary Value'));
  const k2 = f.value('kind', REPEAT_ITEM);
  f.ifNotMatch(out(k2, 'Dictionary Value'), '^amount$');
  f.value('id', REPEAT_ITEM, 'Id'); f.value('name', REPEAT_ITEM, 'Name');
  const addName = () => {
    const sv = f.add(action('setvalueforkey', { WFDictionary: ref(V('Names')), WFDictionaryKey: text(V('Name')), WFDictionaryValue: text(V('Id')) }));
    f.set('Names', out(sv, 'Dictionary'));
  };
  f.ifMatch(V('OpenText'), ',', V('Id'), ','); addName();
  f.otherwise(); f.ifMatch(V('OpenText'), '^stale$'); addName(); f.end();
  f.end();
  f.end();
  f.end();
  const keys = f.value('', V('Names'), null, 'All Keys'); f.set('Choices', out(keys, 'Dictionary Value'));
  f.if(HAS_NOT, V('Choices')); f.notify('Pahlavan', 'Nothing open today.'); f.stop(); f.end();
  const ch = f.add(action('choosefromlist', { WFInput: ref(V('Choices')), WFChooseFromListActionPrompt: text('Done today?'),
    WFChooseFromListActionSelectMultiple: true }));
  f.repeat(out(ch, 'Chosen Item'));
  const idv = f.value(text(REPEAT_ITEM), V('Names')); f.append('Ids', out(idv, 'Dictionary Value'));
  f.end();
  const ci = f.add(action('text.combine', { text: ref(V('Ids')), WFTextSeparator: 'Custom', WFTextCustomSeparator: '","' }));
  f.textAs('Entry', '{"v":1,"at":"', V('At'), '","date":"', V('Day'), '","kind":"tick","ids":["', out(ci, 'Combined Text'), '"]}');
  f.textAs('Kind', 'tick');

  // --- Log a session
  f.item('Log a session');
  f.value('next.type', V('Phone'), 'NextType');
  f.value('sessions', V('Phone'), 'Sessions');
  f.repeat(V('Sessions'));
  f.value('type', REPEAT_ITEM, 'T'); f.value('name', REPEAT_ITEM, 'N');
  f.ifMatch(V('T'), '^', V('NextType'), '$'); f.textAs('First', V('T'), ' ', V('N'), ' (next)');
  f.otherwise(); const tOther = f.text(V('T'), ' ', V('N')); f.append('Others', out(tOther, 'Text'));
  f.end();
  f.end();
  f.append('Labels', V('First')); f.append('Labels', V('Others'));
  const cs = f.add(action('choosefromlist', { WFInput: ref(V('Labels')), WFChooseFromListActionPrompt: text('Which session?') }));
  const sp = f.add(action('text.split', { text: ref(out(cs, 'Chosen Item')), WFTextSeparator: 'Spaces' }));
  const fi = f.add(action('getitemfromlist', { WFItemSpecifier: 'First Item', WFInput: ref(out(sp, 'Split Text')) }));
  f.set('Type', out(fi, 'Item from List'));
  f.repeat(V('Sessions'));
  const tt = f.value('type', REPEAT_ITEM);
  f.ifMatch(out(tt, 'Dictionary Value'), '^', V('Type'), '$'); f.set('Session', REPEAT_ITEM); f.end();
  f.end();
  f.value('kind', V('Session'), 'SessionKind'); f.value('name', V('Session'), 'SessionName');
  f.ifMatch(V('SessionKind'), '^lift$');
  f.value('lifts', V('Session'), 'Lifts');
  for (const i of [1, 2]) {
    const li = f.add(action('getitemfromlist', { WFItemSpecifier: 'Item At Index', WFItemIndex: i, WFInput: ref(V('Lifts')) }));
    f.set(`L${i}`, out(li, 'Item from List'));
    f.value('name', V(`L${i}`), `L${i}Name`); f.value('unit', V(`L${i}`), `L${i}Unit`);
    f.value('last.weight', V(`L${i}`), `L${i}W`); f.value('last.reps', V(`L${i}`), `L${i}R`);
    f.askNumber([V(`L${i}Name`), ': top set weight (', V(`L${i}Unit`), ')'], `W${i}`, { default: V(`L${i}W`), decimals: true });
    f.askNumber([V(`L${i}Name`), ': reps at ', V(`W${i}`), ' ', V(`L${i}Unit`)], `R${i}`, { default: V(`L${i}R`) });
  }
  f.textAs('LiftsPart', ',"lift1":{"weight":"', V('W1'), '","reps":"', V('R1'), '"},"lift2":{"weight":"', V('W2'), '","reps":"', V('R2'), '"}');
  f.menu('Express version?', ['Yes', 'No']);
  f.item('Yes'); f.textAs('ExpressPart', ',"express":true');
  f.item('No');
  f.end();
  f.end();
  f.askNumber(['How many minutes was ', V('SessionName'), '?'], 'Minutes');
  f.if(HAS, V('Minutes')); f.textAs('MinPart', ',"durationMin":"', V('Minutes'), '"'); f.end();
  f.textAs('Entry', '{"v":1,"at":"', V('At'), '","date":"', V('Day'), '","kind":"session","session":{"type":"', V('Type'), '"',
    V('LiftsPart'), V('MinPart'), V('ExpressPart'), '}}');
  f.textAs('Kind', 'session');

  // --- Did you train?
  f.item('Did you train?');
  f.menu(text('Did you train on ', V('Day'), '?'), ['Trained', 'Rest day', 'Missed']);
  f.item('Trained'); f.textAs('Answer', 'trained');
  f.item('Rest day'); f.textAs('Answer', 'rest');
  f.item('Missed'); f.textAs('Answer', 'missed');
  f.end();
  f.textAs('Entry', '{"v":1,"at":"', V('At'), '","date":"', V('Day'), '","kind":"trained","answer":"', V('Answer'), '"}');
  f.textAs('Kind', 'trained');

  // --- Morning check-in: the three scales and sleep hours, only what Pahlavan doesn't hold yet
  f.item('Morning check-in');
  f.value('morning.fields', V('Phone'), 'Fields');
  f.repeat(V('Fields'));
  f.value('value', REPEAT_ITEM, 'OnRecord');
  f.ifNotMatch(V('PhoneDate'), '^', V('TodayText'), '$'); f.textAs('OnRecord', ''); f.end();
  f.if(HAS_NOT, V('OnRecord'));
  f.value('id', REPEAT_ITEM, 'Id'); f.value('lo', REPEAT_ITEM, 'Lo');
  f.if(HAS, V('Lo'));
  f.value('label', REPEAT_ITEM, 'Label'); f.value('hi', REPEAT_ITEM, 'Hi');
  const lst = f.add(action('list', { WFItems: ['1', '2', '3', '4', '5'] }));
  const pick = f.add(action('choosefromlist', { WFInput: ref(out(lst, 'List')), WFChooseFromListActionPrompt: text(V('Label'), ': 1 is ', V('Lo'), ', 5 is ', V('Hi')) }));
  const part = f.text('"', V('Id'), '":"', out(pick, 'Chosen Item'), '"'); f.append('Parts', out(part, 'Text'));
  f.otherwise();
  f.ifMatch(V('Id'), '^sleepH$');
  f.askNumber('Sleep last night, in hours (leave empty to skip)', 'SleepH', { decimals: true });
  f.if(HAS, V('SleepH')); const sp2 = f.text('"sleepH":"', V('SleepH'), '"'); f.append('Parts', out(sp2, 'Text')); f.end();
  f.end();
  f.end();
  f.end();
  f.end();
  f.if(HAS_NOT, V('Parts')); f.notify('Pahlavan', "Nothing new to send: Pahlavan has this morning's check-in."); f.stop(); f.end();
  const pc = f.add(action('text.combine', { text: ref(V('Parts')), WFTextSeparator: 'Custom', WFTextCustomSeparator: ',' }));
  f.textAs('Entry', '{"v":1,"at":"', V('At'), '","date":"', V('TodayText'), '","kind":"morning","morning":{', out(pc, 'Combined Text'), '}}');
  f.textAs('Kind', 'morning');
  f.end(); // the menu

  // 4. Send: real numbers, then one new file on GitHub
  const NUM = 'energy|soreness|sleepQ|sleepH|rhr|weight|steps|floors|reps|durationMin|rating|add';
  const r1 = f.add(action('text.replace', { WFReplaceTextRegularExpression: true, WFInput: text(V('Entry')),
    WFReplaceTextFind: String.raw`"(${NUM})"\s*:\s*"(-?\d+)[.,](\d+)"`, WFReplaceTextReplace: '"$1":$2.$3' }));
  const r2 = f.add(action('text.replace', { WFReplaceTextRegularExpression: true, WFInput: text(out(r1, 'Updated Text')),
    WFReplaceTextFind: String.raw`"(${NUM})"\s*:\s*"(-?\d+)"`, WFReplaceTextReplace: '"$1":$2' }));
  f.set('Final', out(r2, 'Updated Text'));
  const b64 = f.add(action('base64encode', { WFEncodeMode: 'Encode', WFBase64LineBreakMode: 'None', WFInput: ref(V('Final')) }));
  const put = f.add(action('downloadurl', { WFURL: text(REPO, V('Stamp'), '-', V('Kind'), '.json'), WFHTTPMethod: 'PUT', ShowHeaders: true,
    WFHTTPHeaders: headers('application/vnd.github+json'), WFHTTPBodyType: 'JSON',
    WFJSONValues: dictField([['message', text('Phone: ', V('Kind'), ' for ', V('Day'))],
      ['content', text(out(b64, 'Base64 Encoded'))]]) }));
  f.set('Reply', out(put, 'Contents of URL'));
  const cm = f.value('commit', V('Reply'));
  f.if(HAS, out(cm, 'Dictionary Value'));
  f.notify('Sent to Pahlavan', [V('Kind'), ' for ', V('Day'), '. It imports within about an hour.']);
  f.otherwise();
  f.value('status', V('Reply'), 'Status'); f.value('message', V('Reply'), 'Said');
  f.notify(['Not sent (HTTP ', V('Status'), ')'], ['GitHub said: ', V('Said'), '. See Troubleshooting in Phone shortcuts.']);
  f.end();

  return f.done();
}
