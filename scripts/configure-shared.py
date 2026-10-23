"""Administrator only: encrypt the local account key into a GitHub Actions secret."""
import argparse
import base64
import json
import os
import subprocess
import sys
import urllib.request

REPOSITORY = 'wwzh6/vegGPTUsage'


def local_key():
    if sys.platform == 'win32':
        import winreg
        with winreg.OpenKey(winreg.HKEY_CURRENT_USER, 'Environment') as registry:
            return winreg.QueryValueEx(registry, 'COTEMU_API_KEY')[0].strip()
    return os.environ.get('COTEMU_API_KEY', '').strip()


def github_token():
    env = {**os.environ, 'GIT_TERMINAL_PROMPT': '0', 'GCM_INTERACTIVE': 'Never'}
    flags = subprocess.CREATE_NO_WINDOW if sys.platform == 'win32' else 0
    try:
        value = subprocess.run(['git', '-c', 'credential.interactive=never', 'credential', 'fill'],
                               input=f'protocol=https\nhost=github.com\npath={REPOSITORY}.git\n\n',
                               text=True, capture_output=True, check=True, timeout=15, env=env, creationflags=flags)
        fields = dict(line.split('=', 1) for line in value.stdout.splitlines() if '=' in line)
        if fields.get('password'):
            return fields['password']
    except Exception:
        pass
    return subprocess.run(['gh', 'auth', 'token', '--hostname', 'github.com'], text=True,
                          capture_output=True, check=True, timeout=15, env=env, creationflags=flags).stdout.strip()


def opener():
    proxy = os.environ.get('VEGETATION_HTTPS_PROXY')
    if not proxy and sys.platform == 'win32':
        import winreg
        with winreg.OpenKey(winreg.HKEY_CURRENT_USER, r'Software\Microsoft\Windows\CurrentVersion\Internet Settings') as registry:
            if winreg.QueryValueEx(registry, 'ProxyEnable')[0]:
                proxy = winreg.QueryValueEx(registry, 'ProxyServer')[0]
                if '=' in proxy:
                    proxy = next((part[6:] for part in proxy.split(';') if part.startswith('https=')), None)
                if proxy and '://' not in proxy:
                    proxy = 'http://' + proxy
    class NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, *args, **kwargs):
            return None
    return urllib.request.build_opener(urllib.request.ProxyHandler({'https': proxy}) if proxy else urllib.request.ProxyHandler(), NoRedirect())


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--upload-only', action='store_true')
    args = parser.parse_args()
    from nacl.public import PublicKey, SealedBox
    key = local_key()
    if not (key.startswith('sk-ctm-') or key.startswith('ctm_')):
        raise ValueError('missing-account-key')
    token = github_token()
    network = opener()
    def api(path, method='GET', payload=None):
        request = urllib.request.Request('https://api.github.com/repos/' + REPOSITORY + path,
            data=json.dumps(payload).encode() if payload is not None else None, method=method,
            headers={'Authorization': 'Bearer ' + token, 'Accept': 'application/vnd.github+json',
                     'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'VegetationQuota-admin', 'Content-Type': 'application/json'})
        with network.open(request, timeout=30) as response:
            body = response.read()
            return json.loads(body) if body else None
    public = api('/actions/secrets/public-key')
    encrypted = SealedBox(PublicKey(base64.b64decode(public['key']))).encrypt(key.encode())
    api('/actions/secrets/COTEMU_API_KEY', 'PUT', {'key_id': public['key_id'], 'encrypted_value': base64.b64encode(encrypted).decode()})
    print(json.dumps({'sharedSecretConfigured': True}), flush=True)
    if not args.upload_only:
        api('/actions/workflows/sync-usage.yml/dispatches', 'POST', {'ref': 'main'})
        print(json.dumps({'synchronizationRequested': True}), flush=True)


if __name__ == '__main__':
    try:
        main()
    except Exception:
        print('Shared setup failed. Check the locally configured account key, PyNaCl, GitHub administrator access, and network. No credential or raw response was logged.', file=sys.stderr)
        sys.exit(1)
