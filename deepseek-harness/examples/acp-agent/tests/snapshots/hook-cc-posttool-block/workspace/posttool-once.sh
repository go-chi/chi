#!/bin/sh
if test -e .posttool-blocked; then
  exit 0
fi
: > .posttool-blocked
printf '%s\n' 'tool output rejected by policy: retry once' >&2
exit 2
