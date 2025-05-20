#!/bin/bash
npx -y @acala-network/chopsticks@latest --config=chopsticks.yml &
CHOPSTICKS_PID=$!
trap "kill $CHOPSTICKS_PID" SIGINT
sleep 2
node setup-testnet.js
wait $CHOPSTICKS_PID