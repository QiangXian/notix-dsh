# Notix Windows toast helper.
#
# Reads the notification payload from environment variables so that titles and
# bodies never need command-line quoting, registers the Notix application id so
# Windows attributes the toast to "Notix" with the bundled icon, and posts one
# WinRT toast. Exits non-zero with a message on stderr when delivery fails.
#
#   NOTIX_TITLE        toast title (required; defaults to "Notix")
#   NOTIX_BODY         toast body, newline-separated (optional)
#   NOTIX_APP_ID       application id / AUMID (optional; defaults to Notix.DSH)
#   NOTIX_DISPLAY_NAME application name shown by Windows (optional)
#   NOTIX_ICON         absolute path of the PNG shown in the toast (optional)
#   NOTIX_URL          URL opened when the toast is clicked (optional)
#   NOTIX_SOUND        "1" to play the default notification sound (optional)
#   NOTIX_TAG          replacement tag so a repeated notification updates (optional)
#   NOTIX_GROUP        replacement group (optional)
#
# The file is intentionally ASCII-only: Windows PowerShell 5.1 decodes scripts
# with the ANSI code page unless a BOM is present, and user text travels through
# environment variables as UTF-16 instead.

$ErrorActionPreference = 'Stop'

try {
  $title = $env:NOTIX_TITLE
  if ([string]::IsNullOrWhiteSpace($title)) { $title = 'Notix' }

  $body = $env:NOTIX_BODY
  $appId = $env:NOTIX_APP_ID
  if ([string]::IsNullOrWhiteSpace($appId)) { $appId = 'Notix.DSH' }
  $displayName = $env:NOTIX_DISPLAY_NAME
  if ([string]::IsNullOrWhiteSpace($displayName)) { $displayName = 'Notix' }
  $icon = $env:NOTIX_ICON
  $url = $env:NOTIX_URL
  $sound = $env:NOTIX_SOUND -eq '1'
  $group = $env:NOTIX_GROUP
  if ([string]::IsNullOrWhiteSpace($group)) { $group = 'notix' }
  $tag = $env:NOTIX_TAG
  if (-not [string]::IsNullOrWhiteSpace($tag)) {
    $tag = ($tag -replace '[^\w.-]', '_')
    if ($tag.Length -gt 64) { $tag = $tag.Substring(0, 64) }
  }

  # Windows resolves an unpackaged application's toast identity through this
  # per-user registry entry, so the banner shows "Notix" and the whale icon
  # instead of the shell host that posted it. Rewriting equal values is cheap.
  $regPath = "HKCU:\Software\Classes\AppUserModelId\$appId"
  New-Item -Path $regPath -Force | Out-Null
  Set-ItemProperty -Path $regPath -Name 'DisplayName' -Value $displayName -Type String
  $iconExists = (-not [string]::IsNullOrWhiteSpace($icon)) -and (Test-Path -LiteralPath $icon)
  if ($iconExists) {
    Set-ItemProperty -Path $regPath -Name 'IconUri' -Value $icon -Type String
  }

  $null = [Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime]
  $null = [Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime]

  function Escape-ToastText([string]$value) {
    return [System.Security.SecurityElement]::Escape($value)
  }

  $texts = '<text>' + (Escape-ToastText $title) + '</text>'
  if (-not [string]::IsNullOrWhiteSpace($body)) {
    $written = 0
    foreach ($line in ($body -split '\r?\n')) {
      if ([string]::IsNullOrWhiteSpace($line)) { continue }
      if ($written -ge 3) { break }
      $texts += '<text>' + (Escape-ToastText $line) + '</text>'
      $written += 1
    }
  }

  $image = ''
  if ($iconExists) {
    $iconUri = 'file:///' + ($icon -replace '\\', '/')
    $image = '<image placement="appLogoOverride" hint-crop="none" src="' + (Escape-ToastText $iconUri) + '"/>'
  }

  if ($sound) {
    $audio = '<audio src="ms-winsoundevent:Notification.Default"/>'
  } else {
    $audio = '<audio silent="true"/>'
  }

  $activation = ''
  if (-not [string]::IsNullOrWhiteSpace($url)) {
    $activation = ' activationType="protocol" launch="' + (Escape-ToastText $url) + '"'
  }

  $toastXml = '<toast' + $activation + '><visual><binding template="ToastGeneric">' + $texts + $image +
    '</binding></visual>' + $audio + '</toast>'

  $xml = New-Object Windows.Data.Xml.Dom.XmlDocument
  $xml.LoadXml($toastXml)
  $toast = New-Object Windows.UI.Notifications.ToastNotification $xml
  if (-not [string]::IsNullOrWhiteSpace($tag)) {
    $toast.Tag = $tag
    $toast.Group = $group
  }

  [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier($appId).Show($toast)
} catch {
  [Console]::Error.WriteLine('notix: Windows toast delivery failed: ' + $_.Exception.Message)
  exit 1
}
