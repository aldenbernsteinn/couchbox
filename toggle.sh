#!/bin/bash
# Toggle Patatin - used by keyboard shortcut
if pgrep -f "electron /home/aldenb/Patatin/app" > /dev/null; then
  pkill -f "electron /home/aldenb/Patatin/app"
else
  /home/aldenb/Patatin/app/node_modules/electron/dist/electron /home/aldenb/Patatin/app &
fi
