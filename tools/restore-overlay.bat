@echo off
:: Kill Steam so DLLs are unlocked
taskkill /F /IM steam.exe >nul 2>&1
taskkill /F /IM steamwebhelper.exe >nul 2>&1
timeout /t 2 /nobreak >nul

cd /d "C:\Program Files (x86)\Steam"
if exist GameOverlayRenderer.dll.disabled ren GameOverlayRenderer.dll.disabled GameOverlayRenderer.dll
if exist GameOverlayRenderer64.dll.disabled ren GameOverlayRenderer64.dll.disabled GameOverlayRenderer64.dll
if exist SteamOverlayVulkanLayer.dll.disabled ren SteamOverlayVulkanLayer.dll.disabled SteamOverlayVulkanLayer.dll
if exist SteamOverlayVulkanLayer64.dll.disabled ren SteamOverlayVulkanLayer64.dll.disabled SteamOverlayVulkanLayer64.dll
if exist gameoverlayui.exe.disabled ren gameoverlayui.exe.disabled gameoverlayui.exe
if exist gameoverlayui64.exe.disabled ren gameoverlayui64.exe.disabled gameoverlayui64.exe

:: Restart Steam with overlay restored
start "" "C:\Program Files (x86)\Steam\steam.exe"
