param()
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$form = New-Object Windows.Forms.Form
$form.Text = 'Vegetation Group - API key'
$form.Size = New-Object Drawing.Size(460,190)
$form.StartPosition = 'CenterScreen'
$form.FormBorderStyle = 'FixedDialog'
$form.MaximizeBox = $false
$label = New-Object Windows.Forms.Label
$label.Text = 'Enter the account API key (not a team code).'
$label.SetBounds(20,15,410,25)
$inputBox = New-Object Windows.Forms.TextBox
$inputBox.UseSystemPasswordChar = $true
$inputBox.SetBounds(20,45,405,25)
$save = New-Object Windows.Forms.Button
$save.Text = 'Save locally'
$save.SetBounds(210,95,105,30)
$cancel = New-Object Windows.Forms.Button
$cancel.Text = 'Cancel'
$cancel.DialogResult = [Windows.Forms.DialogResult]::Cancel
$cancel.SetBounds(325,95,100,30)
$form.AcceptButton = $save
$form.CancelButton = $cancel
$save.Add_Click({
    $keyValue = $inputBox.Text.Trim()
    if ($keyValue -notmatch '^(sk-ctm-|ctm_)[A-Za-z0-9_-]+$') {
        [Windows.Forms.MessageBox]::Show('Use an account API key beginning sk-ctm- or ctm_.', 'Invalid key format') | Out-Null
        return
    }
    try {
        [Environment]::SetEnvironmentVariable('COTEMU_API_KEY', $keyValue, 'User')
        $inputBox.Clear()
        $form.DialogResult = [Windows.Forms.DialogResult]::OK
        $form.Close()
    } catch {
        [Windows.Forms.MessageBox]::Show('Unable to save the user environment variable.', 'Configuration failed') | Out-Null
    } finally { $keyValue = $null }
})
$form.Controls.AddRange(@($label,$inputBox,$save,$cancel))
try {
    if ($form.ShowDialog() -eq [Windows.Forms.DialogResult]::OK) {
        [Windows.Forms.MessageBox]::Show('Saved locally. Fully exit and restart Codex before opening the usage ring.', 'Configuration saved') | Out-Null
    }
} finally { $inputBox.Clear(); $form.Dispose() }
