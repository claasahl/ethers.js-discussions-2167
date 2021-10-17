#!/bin/bash

set -e
ACTION="RESTART";
while [ "${ACTION}" != 'STOP' ]; do
    ACTION="STOP";
    npm start || ACTION="RESTART";
done
