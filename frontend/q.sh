#!/bin/bash
T=$(security find-generic-password -s "Supabase CLI" -w | sed 's/^go-keyring-base64://' | base64 -d)
jq -n --arg q "$1" '{query:$q}' > /tmp/claude-501/qbody.json 2>/dev/null || jq -n --arg q "$1" '{query:$q}' > "$(dirname "$0")/qbody.json"
curl -s -X POST https://api.supabase.com/v1/projects/avooqcxehfeurjhqqgui/database/query -H "Authorization: Bearer $T" -H 'Content-Type: application/json' --data-binary @"$(dirname "$0")/qbody.json"
