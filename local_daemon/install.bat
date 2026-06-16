@echo off
echo =======================================================
echo   Behelith Native Messaging Host Setup
echo =======================================================
echo.

set /p EXT_ID="Enter your Chrome Extension ID (from chrome://extensions): "

if "%EXT_ID%"=="" (
    echo Error: Extension ID cannot be empty.
    pause
    exit /b
)

echo.
echo Updating native_manifest.json with Extension ID: %EXT_ID%...
powershell -Command "$escaped = ('%~dp0behelith_daemon.bat').Replace('\', '\\'); (gc '%~dp0native_manifest.json') -replace 'YOUR_EXTENSION_ID', '%EXT_ID%' -replace 'NATIVE_DAEMON_PATH', $escaped | Out-File -Encoding utf8 '%~dp0native_manifest.json'"

echo.
echo Adding Registry Key to HKCU\Software\Google\Chrome\NativeMessagingHosts\com.behelith.compiler...
reg add "HKCU\Software\Google\Chrome\NativeMessagingHosts\com.behelith.compiler" /ve /t REG_SZ /d "%~dp0native_manifest.json" /f

echo.
echo Setup finished successfully!
echo please reload the extension in Chrome (chrome://extensions) to activate.
echo.
pause
