#!/usr/bin/env bash
# Requires Expo Go showing Transactions, a backup containing 12.34, and a current
# transaction of 98.76 that is absent from the backup.
set -euo pipefail
ui() { adb shell uiautomator dump /sdcard/restore-ui.xml >/dev/null 2>&1; adb shell cat /sdcard/restore-ui.xml; }
point() {
  ui | python3 -c 'import sys,xml.etree.ElementTree as E,re
label=sys.argv[1]
for node in E.fromstring(sys.stdin.read()).iter():
 if node.attrib.get("text")==label:
  x1,y1,x2,y2=map(int,re.findall(r"\d+",node.attrib["bounds"]))
  print((x1+x2)//2,(y1+y2)//2);break
else: raise SystemExit("UI label not found: "+label)' "$1"
}
tap() { read -r x y < <(point "$1"); adb shell input tap "$x" "$y"; }
before="$(ui)"
if ! grep -q -- '-98.76' <<< "$before"; then echo 'FAIL: current-only transaction missing before restore'; exit 1; fi
tap 'Restore JSON backup'
sleep 1
tap 'CHOOSE BACKUP'
sleep 2
tap 'expense-backup.json'
sleep 3
screen="$(ui)"
if grep -q 'Operation failed\|isn.t readable' <<< "$screen"; then echo 'FAIL: restore error'; exit 1; fi
if ! grep -q -- '-12.34' <<< "$screen"; then echo 'FAIL: expected backed-up transaction missing'; exit 1; fi
if grep -q -- '-98.76' <<< "$screen"; then echo 'FAIL: current-only transaction survived restore'; exit 1; fi
echo 'PASS: backup transaction present, current-only transaction removed'
