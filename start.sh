#!/bin/bash
cd "$(dirname "$0")"
npm run build && node dist/index.js
