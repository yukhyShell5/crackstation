#!/bin/bash
# run_clients.sh
# Usage: ./run_clients.sh [number_of_clients]

COUNT=${1:-2}

echo "Starting $COUNT clients..."

for i in $(seq 1 $COUNT); do
    echo "Launching Client $i..."
    (cd client && go run main.go --server http://localhost:3000) &
    PID=$!
    echo "Client $i started with PID $PID"
    sleep 1 # Stagger start slightly
done

wait
