@echo off
setlocal
title Wonderful Town Dev Server
cd /d "E:\Application\ChatGPT\CodexProject\DesignTest1"
set "PATH=E:\Application\Nodejs;E:\Application\pnpm-global;%PATH%"
echo Starting Wonderful Town...
echo.
echo Node version:
"E:\Application\Nodejs\node.exe" --version
echo pnpm version:
call "E:\Application\pnpm-global\pnpm.cmd" --version
echo.
echo Local URL: http://127.0.0.1:5173/
echo.
call "E:\Application\pnpm-global\pnpm.cmd" dev
echo.
echo Dev server stopped or failed.
pause
