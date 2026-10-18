param([ValidateSet('protect','unprotect')][string]$Action)
$ErrorActionPreference='Stop'
$inputValue=[Console]::In.ReadToEnd()
try {
 if($Action -eq 'protect') {
  $secretValue=ConvertTo-SecureString -String $inputValue -AsPlainText -Force
  try {[Console]::Out.Write(($secretValue | ConvertFrom-SecureString))} finally {$secretValue.Dispose()}
 } else {
  $secretValue=ConvertTo-SecureString -String $inputValue
  $secretPointer=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($secretValue)
  try {[Console]::Out.Write([Runtime.InteropServices.Marshal]::PtrToStringBSTR($secretPointer))}
  finally {[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($secretPointer);$secretValue.Dispose()}
 }
} catch { [Console]::Error.Write('funding_secret_unavailable');exit 1 }
