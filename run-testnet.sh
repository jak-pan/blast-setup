#!/bin/bash
npx -y @acala-network/chopsticks@latest xcm \
 -r polkadot \
 -p hydradx \
 -p polkadot-asset-hub &
CHOPSTICKS_PID=$!
trap "kill $CHOPSTICKS_PID" SIGINT
sleep 2
node setup-tokens.js
wait $CHOPSTICKS_PID
