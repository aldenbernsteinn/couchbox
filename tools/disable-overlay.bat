@echo off
:: Kill Steam so DLLs are unlocked
taskkill /F /IM steam.exe >nul 2>&1
taskkill /F /IM steamwebhelper.exe >nul 2>&1
timeout /t 2 /nobreak >nul

cd /d "C:\Program Files (x86)\Steam"
if exist GameOverlayRenderer.dll ren GameOverlayRenderer.dll GameOverlayRenderer.dll.disabled
if exist GameOverlayRenderer64.dll ren GameOverlayRenderer64.dll GameOverlayRenderer64.dll.disabled
if exist SteamOverlayVulkanLayer.dll ren SteamOverlayVulkanLayer.dll SteamOverlayVulkanLayer.dll.disabled
if exist SteamOverlayVulkanLayer64.dll ren SteamOverlayVulkanLayer64.dll SteamOverlayVulkanLayer64.dll.disabled
if exist gameoverlayui.exe ren gameoverlayui.exe gameoverlayui.exe.disabled
if exist gameoverlayui64.exe ren gameoverlayui64.exe gameoverlayui64.exe.disabled

:: Restart Steam (no Big Picture)
start "" "C:\Program Files (x86)\Steam\steam.exe"
