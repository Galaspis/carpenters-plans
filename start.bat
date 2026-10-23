@echo off
rem Starts the Carpenter's Plans server and opens it in the default browser.
cd /d "%~dp0"
start "" http://localhost:8765
node app\server.mjs 8765
