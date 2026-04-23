#!/bin/bash
PORT=${1:-3333}

# Kill any process using the port
lsof -ti :$PORT | xargs kill -9 2>/dev/null

npx next dev --port $PORT
