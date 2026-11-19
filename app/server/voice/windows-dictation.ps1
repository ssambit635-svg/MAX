param(
  [Parameter(Mandatory = $true)]
  [ValidateSet('en-US', 'hi-IN')]
  [string]$CultureName
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$engine = $null

function Send-Event([hashtable]$Event) {
  $json = ConvertTo-Json -InputObject $Event -Compress -Depth 3
  [Console]::Out.WriteLine($json)
  [Console]::Out.Flush()
}

try {
  Add-Type -AssemblyName System.Speech
  $culture = [System.Globalization.CultureInfo]::GetCultureInfo($CultureName)
  $recognizers = [System.Speech.Recognition.SpeechRecognitionEngine]::InstalledRecognizers()
  $match = $recognizers | Where-Object { $_.Culture.Name -eq $CultureName } | Select-Object -First 1
  if (-not $match) {
    Send-Event @{ type = 'error'; code = 'language-unavailable' }
    exit 0
  }

  $engine = [System.Speech.Recognition.SpeechRecognitionEngine]::new($culture)
  $engine.SetInputToDefaultAudioDevice()
  $engine.LoadGrammar([System.Speech.Recognition.DictationGrammar]::new())
  $engine.add_SpeechRecognized({
    param($sender, $eventArgs)
    $text = [string]$eventArgs.Result.Text
    if ($text -and $text.Length -le 1000) {
      $payload = ConvertTo-Json -InputObject @{ type = 'text'; text = $text } -Compress -Depth 3
      [Console]::Out.WriteLine($payload)
      [Console]::Out.Flush()
    }
  })
  $engine.RecognizeAsync([System.Speech.Recognition.RecognizeMode]::Multiple)
  Send-Event @{ type = 'status'; state = 'listening' }

  $stopTask = [Console]::In.ReadLineAsync()
  while (-not $stopTask.IsCompleted) { Start-Sleep -Milliseconds 100 }
  $engine.RecognizeAsyncCancel()
  Send-Event @{ type = 'status'; state = 'stopped' }
} catch {
  # Do not return exception text: it can include machine-specific paths or data.
  Send-Event @{ type = 'error'; code = 'speech-engine-failed' }
} finally {
  if ($engine) { $engine.Dispose() }
}
