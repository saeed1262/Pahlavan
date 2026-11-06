# Decisions

Sample, made up for the mockups: the shape of the coach's decision log
(trigger, rule, expected effect, review date), one entry per decision.
tools/prep.mjs reads this file for the Plan screen's timeline.

## 2026-03-02 · Week sized to 4 sessions
- Trigger: Intake: 4 days of 60 min available; a lifting rotation of A and B plus a short day.
- Rule: plan.size (the stated days; the week is never sized up from history)
- Expected effect: 3 lifting sessions and 1 short session a week, about 4 hours in all.
- Review: 2026-04-26

## 2026-03-19 · Early deload declined
- Trigger: Readiness in watch on two mornings of week 3, with the scheduled deload 4 days away.
- Rule: stall.triage.2 (fatigued, but the scheduled deload is under 2 weeks away: keep it)
- Expected effect: Week 3 trained as planned; recovery in the week-4 deload.
- Review: 2026-03-29

## 2026-03-30 · Goblet squat in for the back squat
- Trigger: A knee niggle in the deload week, easing.
- Rule: plan.until (a temporary change with its way back named)
- Expected effect: The squat pattern kept at a knee-friendly load; the back squat returns after it.
- Review: 2026-04-19

## 2026-04-05 · Bench: triage step 1
- Trigger: Bench e1RM within 2 % over 3 sessions at 92 % adherence: a stall.
- Rule: stall.triage.1 (sleep, food and readiness before any plan change)
- Expected effect: Sleep toward 7 h; the bench e1RM back above 70 lb within two weeks.
- Review: 2026-04-19
