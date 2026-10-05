@echo off
setlocal
where dotnet >nul 2>nul
if errorlevel 1 (
  echo MAX needs the .NET 8 SDK to build locally.
  echo For a no-terminal user download, use the Windows artifact from the GitHub Actions workflow.
  pause
  exit /b 1
)

dotnet publish "%~dp0MAX.Windows.csproj" -c Release -r win-x64 --self-contained true -p:PublishSingleFile=true -p:IncludeNativeLibrariesForSelfExtract=true -p:EnableCompressionInSingleFile=true -o "%~dp0..\publish\MAX"
if errorlevel 1 (
  echo Build failed. See the error above.
  pause
  exit /b 1
)
start "" "%~dp0..\publish\MAX\MAX.exe"
endlocal
