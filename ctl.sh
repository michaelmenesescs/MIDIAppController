#!/bin/bash
# Control script for MIDI Monochrome Controller
PLIST="$HOME/Library/LaunchAgents/com.midi.monochrome-controller.plist"
LOGS="$HOME/Desktop/Coding/MIDIAppController/logs"

case "$1" in
  start)
    launchctl load "$PLIST" 2>/dev/null
    echo "Started"
    ;;
  stop)
    launchctl unload "$PLIST" 2>/dev/null
    echo "Stopped"
    ;;
  restart)
    launchctl unload "$PLIST" 2>/dev/null
    sleep 1
    launchctl load "$PLIST" 2>/dev/null
    echo "Restarted"
    ;;
  status)
    launchctl list | grep midi.monochrome
    ;;
  logs)
    tail -f "$LOGS/stdout.log"
    ;;
  *)
    echo "Usage: $0 {start|stop|restart|status|logs}"
    ;;
esac
