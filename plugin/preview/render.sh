#!/bin/sh
# Renders the plugin preview (the real view on the synthetic vault) with
# headless Chrome into plugin/preview/renders/.
#   npm run preview && sh plugin/preview/render.sh
cd "$(dirname "$0")" || exit 1
CH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
mkdir -p renders
shot() { # name width height query
  "$CH" --headless=new --disable-gpu --hide-scrollbars --window-size="$2,$3" --virtual-time-budget=6000 \
    --screenshot="renders/$1.png" "file://$PWD/index.html?$4" 2>/dev/null
}
# Home, the tab the view opens on: the overview (mockups/home.html), light and dark, and narrower panes.
shot home-1440-light-workday 1440 1150 "isfahan=1&phase=workday&tab=home"
shot home-1440-dark-night    1440 1150 "isfahan=1&phase=night&tab=home"
shot home-1100-light-workday 1100 1250 "isfahan=1&phase=workday&tab=home"
shot home-720-light-workday   720 2000 "isfahan=1&phase=workday&tab=home"
shot today-1440-light-workday 1440 1500 "isfahan=1&phase=workday&tab=today"
shot today-1440-dark-night    1440 1500 "isfahan=1&phase=night&tab=today"
shot today-1440-isfahan-off   1440 1500 "isfahan=0&mode=light&hour=11&tab=today"
shot today-1100-light-workday 1100 1540 "isfahan=1&phase=workday&tab=today"
shot today-1100-dark-night    1100 1540 "isfahan=1&phase=night&tab=today"
shot today-1100-isfahan-off   1100 1540 "isfahan=0&mode=light&hour=11&tab=today"
shot today-1440-isfahan-off-dark-evening-hour 1440 1500 "isfahan=0&mode=dark&hour=16&tab=today"
shot today-1440-hotel         1440 1500 "isfahan=1&phase=dawn&session=hotel&tab=today"
shot today-1440-pick-light-workday 1440 1500 "isfahan=1&phase=workday&pick=A&tab=today"
shot today-1100-pick-dark-night    1100 1540 "isfahan=1&phase=night&pick=S3&tab=today"
shot today-1440-pick-isfahan-off   1440 1500 "isfahan=0&mode=light&hour=11&pick=S1&session=express&tab=today"
# The plan's supersets, rests and form cues on Today's rows (test/fixtures/supersets.ts): B as suggested, A by pick.
shot today-supersets-1440-light-workday 1440 1800 "isfahan=1&phase=workday&supersets=1&tab=today"
shot today-supersets-1440-dark-night    1440 1800 "isfahan=1&phase=night&supersets=1&tab=today"
shot today-supersets-1100-light-workday 1100 2000 "isfahan=1&phase=workday&supersets=1&tab=today"
shot today-supersets-1100-dark-night    1100 2000 "isfahan=1&phase=night&supersets=1&tab=today"
shot today-supersets-pick-1440-light-workday 1440 1500 "isfahan=1&phase=workday&supersets=1&pick=A&tab=today"
shot today-supersets-pick-1440-dark-night    1440 1500 "isfahan=1&phase=night&supersets=1&pick=A&tab=today"
shot today-supersets-720-light-workday   720 3400 "isfahan=1&phase=workday&supersets=1&tab=today"
shot progress-1440-light-workday 1440 1700 "isfahan=1&phase=workday&tab=progress"
shot progress-1440-dark-night    1440 1700 "isfahan=1&phase=night&tab=progress"
shot progress-1440-isfahan-off   1440 1700 "isfahan=0&mode=light&hour=11&tab=progress"
shot progress-1100-light-workday 1100 1900 "isfahan=1&phase=workday&tab=progress"
shot progress-1100-dark-night    1100 1900 "isfahan=1&phase=night&tab=progress"
shot progress-1100-isfahan-off   1100 1900 "isfahan=0&mode=light&hour=11&tab=progress"
shot progress-1440-dawn          1440 1700 "isfahan=1&phase=dawn&tab=progress"
shot progress-1440-evening       1440 1700 "isfahan=1&phase=evening&tab=progress"
for st in standard swap skip full summary; do
  shot log-$st-1440-light-workday 1440 1500 "isfahan=1&phase=workday&log=new&logstate=$st"
  shot log-$st-1100-dark-night    1100 1400 "isfahan=1&phase=night&log=new&logstate=$st"
done
shot log-edit-1440-light-workday     1440 1500 "isfahan=1&phase=workday&log=edit&tab=today"
shot log-edit-1100-dark-night        1100 1400 "isfahan=1&phase=night&log=edit&tab=today"
shot log-standard-1440-isfahan-off   1440 1500 "isfahan=0&mode=light&hour=11&log=new&tab=today"
shot log-standard-1100-isfahan-off   1100 1400 "isfahan=0&mode=light&hour=11&log=new&tab=today"
shot log-standard-1440-dark-night    1440 1500 "isfahan=1&phase=night&log=new&tab=today"
shot log-standard-1100-light-workday 1100 1400 "isfahan=1&phase=workday&log=new&tab=today"
shot log-summary-1440-isfahan-off    1440 1500 "isfahan=0&mode=light&hour=11&log=new&logstate=summary&tab=today"
# The date field moved: a deload day (its own session and sets) and a day already logged (opens as its edit).
shot log-date-deload-1440-light-workday 1440 1500 "isfahan=1&phase=workday&log=new&logdate=2026-03-26&tab=today"
shot log-date-deload-1440-dark-night    1440 1500 "isfahan=1&phase=night&log=new&logdate=2026-03-26&tab=today"
shot log-date-logged-1440-light-workday 1440 1500 "isfahan=1&phase=workday&log=new&logdate=2026-04-08&tab=today"
shot log-date-logged-1440-dark-night    1440 1500 "isfahan=1&phase=night&log=new&logdate=2026-04-08&tab=today"
for sc in training body health skills; do
  shot progress-$sc-1440-light-workday 1440 1600 "isfahan=1&phase=workday&tab=progress&sec=$sc&rich=1"
  shot progress-$sc-1440-dark-night    1440 1600 "isfahan=1&phase=night&tab=progress&sec=$sc&rich=1"
  shot progress-$sc-1440-isfahan-off   1440 1600 "isfahan=0&mode=light&hour=11&tab=progress&sec=$sc&rich=1"
  shot progress-$sc-1100-light-workday 1100 1900 "isfahan=1&phase=workday&tab=progress&sec=$sc&rich=1"
  shot progress-$sc-1100-dark-night    1100 1900 "isfahan=1&phase=night&tab=progress&sec=$sc&rich=1"
  shot progress-$sc-1100-isfahan-off   1100 1900 "isfahan=0&mode=light&hour=11&tab=progress&sec=$sc&rich=1"
  shot progress-$sc-1440-fixture-only  1440 1600 "isfahan=1&phase=workday&tab=progress&sec=$sc"
done
shot plan-1440-light-workday 1440 2300 "isfahan=1&phase=workday&tab=plan&rich=1"
shot plan-1440-dark-night    1440 2300 "isfahan=1&phase=night&tab=plan&rich=1"
shot plan-1440-isfahan-off   1440 2300 "isfahan=0&mode=light&hour=11&tab=plan&rich=1"
shot plan-1100-light-workday 1100 2500 "isfahan=1&phase=workday&tab=plan&rich=1"
shot plan-1100-dark-night    1100 2500 "isfahan=1&phase=night&tab=plan&rich=1"
shot plan-1100-isfahan-off   1100 2500 "isfahan=0&mode=light&hour=11&tab=plan&rich=1"
shot plan-1440-fixture-only  1440 2300 "isfahan=1&phase=workday&tab=plan"
shot today-1440-rich-light-workday 1440 1900 "isfahan=1&phase=workday&rich=1&tab=today"
shot today-1100-rich-dark-night    1100 2100 "isfahan=1&phase=night&rich=1&tab=today"
shot today-1440-rich-isfahan-off   1440 1900 "isfahan=0&mode=light&hour=11&rich=1&tab=today"
shot checkin-1440-light-workday 1440 3000 "isfahan=1&phase=workday&tab=checkin&rich=1&today=2026-04-12"
shot checkin-1440-dark-night    1440 3000 "isfahan=1&phase=night&tab=checkin&rich=1&today=2026-04-12"
shot checkin-1440-isfahan-off   1440 3000 "isfahan=0&mode=light&hour=11&tab=checkin&rich=1&today=2026-04-12"
shot checkin-1100-light-workday 1100 3300 "isfahan=1&phase=workday&tab=checkin&rich=1&today=2026-04-12"
shot checkin-1100-dark-night    1100 3300 "isfahan=1&phase=night&tab=checkin&rich=1&today=2026-04-12"
shot checkin-1100-isfahan-off   1100 3300 "isfahan=0&mode=light&hour=11&tab=checkin&rich=1&today=2026-04-12"
shot checkin-1440-prefilled-fixture-only 1440 3000 "isfahan=1&phase=workday&tab=checkin"
shot checkin-1440-saved-weekday 1440 1600 "isfahan=1&phase=workday&tab=checkin&rich=1"
# No check-ins file: last Sunday's check-in is still unsaved on a weekday (the late case).
shot checkin-1440-late-light-workday 1440 1600 "isfahan=1&phase=workday&tab=checkin"
shot checkin-1440-late-dark-night    1440 1600 "isfahan=1&phase=night&tab=checkin"
shot settings-1440-light-workday 1440 1200 "isfahan=1&phase=workday&settings=1&tab=today"
shot settings-1440-dark-night    1440 1200 "isfahan=1&phase=night&settings=1&tab=today"
shot settings-1440-off-no-git     1440 1200 "isfahan=0&mode=light&hour=11&settings=1&remind=0&git=0&tab=today"
# The reminder cards over Today, opened by the real machinery at each card's moment (m35-card-*, as the mockups' renders).
for c in morning tape habits evening water stand sitting desk photos tests train; do
  shot m35-card-$c-light-workday 1440 1000 "isfahan=1&phase=workday&card=$c"
  shot m35-card-$c-dark-night    1440 1000 "isfahan=1&phase=night&card=$c"
done
shot m35-card-photos-menu-light-workday 1440 1000 "isfahan=1&phase=workday&card=photos&menu=1&tab=today"
shot m35-card-photos-menu-dark-night    1440 1000 "isfahan=1&phase=night&card=photos&menu=1&tab=today"
shot m35-card-morning-isfahan-off       1440 1000 "isfahan=0&mode=light&hour=8&card=morning&tab=today"
# The stage 3.5 screens (m35-*, the mockups' names and sizes): Due today, the Habits section (its form on an
# item, the empty state with the bring-over), the Body record card and its schedule, the Plan's desk breaks.
# All at 12:15 on 2026-04-10 with the made-up fuller data (&rich=1), as the mockups stand.
R="rich=1"
shot m35-today-1440-light-workday 1440 2050 "isfahan=1&phase=workday&$R&tab=today"
shot m35-today-1440-dark-night    1440 2050 "isfahan=1&phase=night&$R&tab=today"
shot m35-today-1440-isfahan-off   1440 2050 "isfahan=0&mode=light&hour=11&$R&tab=today"
shot m35-today-1100-light-workday 1100 2150 "isfahan=1&phase=workday&$R&tab=today"
shot m35-today-1100-dark-night    1100 2150 "isfahan=1&phase=night&$R&tab=today"
shot m35-today-noactivity-1440-light-workday 1440 2050 "isfahan=1&phase=workday&$R&activity=0&tab=today"
shot m35-habits-1440-light-workday 1440 3700 "isfahan=1&phase=workday&$R&sec=habits&edit=stand"
shot m35-habits-1440-dark-night    1440 3700 "isfahan=1&phase=night&$R&sec=habits&edit=stand"
shot m35-habits-1100-light-workday 1100 3900 "isfahan=1&phase=workday&$R&sec=habits&edit=stand"
shot m35-habits-1100-dark-night    1100 3900 "isfahan=1&phase=night&$R&sec=habits&edit=stand"
shot m35-habits-edit-water-1440-light-workday   1440 3700 "isfahan=1&phase=workday&$R&sec=habits&edit=water"
shot m35-habits-edit-desk-1440-light-workday    1440 3700 "isfahan=1&phase=workday&$R&sec=habits&edit=desk"
shot m35-habits-edit-sitting-1440-dark-night    1440 3700 "isfahan=1&phase=night&$R&sec=habits&edit=sitting"
shot m35-habits-edit-creatine-1440-light-workday 1440 3700 "isfahan=1&phase=workday&$R&sec=habits&edit=creatine"
shot m35-habits-empty-1440-light-workday 1440 2300 "isfahan=1&phase=workday&$R&sec=habits&habits=empty"
shot m35-habits-empty-1440-dark-night    1440 2300 "isfahan=1&phase=night&$R&sec=habits&habits=empty"
shot m35-checkin-1440-light-workday 1440 4050 "isfahan=1&phase=workday&$R&tab=checkin"
shot m35-checkin-1440-dark-night    1440 4050 "isfahan=1&phase=night&$R&tab=checkin"
shot m35-checkin-1100-light-workday 1100 4400 "isfahan=1&phase=workday&$R&tab=checkin"
shot m35-checkin-1100-dark-night    1100 4400 "isfahan=1&phase=night&$R&tab=checkin"
shot m35-checkin-schedule-1440-light-workday 1440 4400 "isfahan=1&phase=workday&$R&tab=checkin&brsched=1&sched=fixed"
shot m35-plan-1440-light-workday 1440 3300 "isfahan=1&phase=workday&$R&tab=plan"
shot m35-plan-1440-dark-night    1440 3300 "isfahan=1&phase=night&$R&tab=plan"
shot m35-plan-1100-light-workday 1100 3600 "isfahan=1&phase=workday&$R&tab=plan"
shot m35-plan-1100-dark-night    1100 3600 "isfahan=1&phase=night&$R&tab=plan"
shot m35-plan-nodesk-1440-light-workday 1440 3300 "isfahan=1&phase=workday&$R&tab=plan&desk=none"
# The Food tab, redesigned (food-*, as mockups/renders/food-v2-*): the first day of a fresh cycle (Mon 2 Nov 2026, a
# lifting day), four weeks on (Sun 29 Nov, a short day and the first check), How it's going opened, the schema 1 plan
# without the coach's words, times and ideas, no eating plan, today ticked with two light checks, and a Why pinned
# open (test/fixtures/food). Each with At a glance open, as on a first visit.
F="tab=food"
shot food-1440-light-workday       1440 2800 "isfahan=1&phase=workday&$F&food=early"
shot food-1440-dark-night          1440 2800 "isfahan=1&phase=night&$F&food=early"
shot food-1100-light-workday       1100 3100 "isfahan=1&phase=workday&$F&food=early"
shot food-1100-dark-night          1100 3100 "isfahan=1&phase=night&$F&food=early"
shot food-open-1440-light-workday  1440 3000 "isfahan=1&phase=workday&$F&food=early&open=going"
shot food-open-1440-dark-night     1440 3000 "isfahan=1&phase=night&$F&food=early&open=going"
shot food-later-1440-light-workday 1440 3000 "isfahan=1&phase=workday&$F&food=later&open=going"
shot food-later-1440-dark-night    1440 3000 "isfahan=1&phase=night&$F&food=later&open=going"
shot food-later-1100-light-workday 1100 3300 "isfahan=1&phase=workday&$F&food=later&open=going"
shot food-later-1100-dark-night    1100 3300 "isfahan=1&phase=night&$F&food=later&open=going"
shot food-plain-1440-light-workday 1440 2400 "isfahan=1&phase=workday&$F&food=early&plan=plain"
shot food-plain-1440-dark-night    1440 2400 "isfahan=1&phase=night&$F&food=early&plan=plain"
shot food-narrow-720-light-workday  720 3600 "isfahan=1&phase=workday&$F&food=early"
shot food-empty-1440-light-workday 1440 1100 "isfahan=1&phase=workday&$F&food=empty"
shot food-empty-1440-dark-night    1440 1100 "isfahan=1&phase=night&$F&food=empty"
shot food-empty-1100-light-workday 1100 1100 "isfahan=1&phase=workday&$F&food=empty"
shot food-empty-1100-dark-night    1100 1100 "isfahan=1&phase=night&$F&food=empty"
shot food-ticked-1440-light-workday 1440 1500 "isfahan=1&phase=workday&$F&food=early&tick=1&checks=1&glance=folded"
shot food-why-1440-light-workday    1440 1500 "isfahan=1&phase=workday&$F&food=early&why=planned&glance=folded"
shot food-why-later-1440-dark-night 1440 2200 "isfahan=1&phase=night&$F&food=later&why=rate&glance=folded&open=going"
shot food-1440-isfahan-off          1440 2800 "isfahan=0&mode=light&hour=11&$F&food=early"
# The Sunday check-in four weeks on, with the eating plan's pattern question (a tap per line).
shot food-checkin-pattern-1440-light-workday 1440 3200 "isfahan=1&phase=workday&tab=checkin&food=later&open=sunday&checks=1"
# At a glance and the foldable sections (glance-*, as mockups/renders/glance-*): each tab on a first visit (the panel
# open, every section in its starting state), light and dark at 1440, Today and Food at 1100; and folded to its one
# line past the first three visits. Today, Progress, the Plan and Check-in on the made-up fuller data (&rich=1).
for ph in light-workday dark-night; do
  P="isfahan=1&phase=${ph#*-}"
  shot glance-today-open-1440-$ph    1440 2100 "$P&rich=1"
  shot glance-today-folded-1440-$ph  1440 1900 "$P&rich=1&glance=folded"
  shot glance-today-open-1100-$ph    1100 2300 "$P&rich=1"
  shot glance-progress-open-1440-$ph 1440 2000 "$P&rich=1&tab=progress"
  shot glance-progress-folded-1440-$ph 1440 1800 "$P&rich=1&tab=progress&glance=folded"
  shot glance-plan-open-1440-$ph     1440 2000 "$P&rich=1&tab=plan"
  shot glance-plan-folded-1440-$ph   1440 1800 "$P&rich=1&tab=plan&glance=folded"
  shot glance-checkin-open-1440-$ph  1440 1300 "$P&rich=1&tab=checkin"
  shot glance-checkin-folded-1440-$ph 1440 1100 "$P&rich=1&tab=checkin&glance=folded"
  shot glance-food-open-1440-$ph     1440 2800 "$P&tab=food&food=early"
  shot glance-food-folded-1440-$ph   1440 2600 "$P&tab=food&food=early&glance=folded"
  shot glance-food-open-1100-$ph     1100 3100 "$P&tab=food&food=early"
done
shot glance-today-open-1440-isfahan-off 1440 2100 "isfahan=0&mode=light&hour=11&rich=1&tab=today"
shot glance-today-open-1440-dark-evening 1440 2100 "isfahan=1&phase=evening&rich=1&tab=today"
shot glance-plan-open-1440-light-dawn    1440 2000 "isfahan=1&phase=dawn&rich=1&tab=plan"
shot glance-progress-training-1440-light-workday 1440 1700 "isfahan=1&phase=workday&rich=1&tab=progress&sec=training"
shot glance-today-narrow-720-light-workday 720 3600 "isfahan=1&phase=workday&rich=1&tab=today"
# Your day and Your routine (yourday-*, routine-*; 0.13.0): the strip at the top of Today on the made-up fuller data,
# light and dark at 1440, 1100 and 720; the Sunday step (answer first, then the command with Copy); the strip's states
# (the morning card still to come with the session open, a rest day with everything ticked, no protein item); and the
# ? menu's Your routine panel.
for ph in light-workday dark-night; do
  P="isfahan=1&phase=${ph#*-}&rich=1"
  shot yourday-1440-$ph 1440 1100 "$P"
  shot yourday-1100-$ph 1100 1200 "$P"
  shot yourday-720-$ph   720 1500 "$P"
  shot yourday-sunday-1440-$ph       1440 1100 "$P&today=2026-04-12"
  shot yourday-sunday-saved-1440-$ph 1440 1100 "$P&today=2026-04-12&coach=saved"
  shot routine-1440-$ph 1440 1250 "$P&helpmenu=routine"
  shot routine-1100-$ph 1100 1250 "$P&helpmenu=routine"
  shot routine-720-$ph   720 1350 "$P&helpmenu=routine"
done
shot yourday-morning-1440-light-dawn      1440 1100 "isfahan=1&phase=dawn&rich=1&yourday=morning,open&time=07:00&tab=today"
shot yourday-rest-done-1440-light-workday 1440 1100 "isfahan=1&phase=workday&rich=1&yourday=rest,done&tab=today"
shot yourday-nofood-1440-isfahan-off      1440 1100 "isfahan=0&mode=light&hour=11&rich=1&yourday=open,nofood&tab=today"
shot yourday-sunday-720-light-workday      720 1500 "isfahan=1&phase=workday&rich=1&today=2026-04-12&coach=saved&tab=today"
echo "renders in $PWD/renders"
