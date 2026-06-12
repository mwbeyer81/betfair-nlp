@echo off
cd /d C:\Users\matth\betfair-nlp
set PATH=C:\Users\matth\AppData\Local\nvm\v22.22.2;C:\Program Files\nodejs;C:\Users\matth\AppData\Roaming\npm;%PATH%
"C:\Users\matth\AppData\Local\nvm\v22.22.2\node.exe" "C:\Users\matth\betfair-nlp\node_modules\ts-node-dev\lib\bin.js" --respawn src/server/index.ts
