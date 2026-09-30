@echo off
echo Instalando dependencias...
npm install
echo.
echo Registrando comandos slash...
node deploy-commands.js
echo.
echo Concluido!
pause
